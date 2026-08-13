#!/usr/bin/env node
// =============================================================================
// scripts/google-token.js - Conectá Google Calendar y generá el refresh token
// =============================================================================
// Uso:
//   1) Completá GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env.local
//      (console.cloud.google.com -> Credenciales OAuth 2.0 tipo "Web app").
//   2) Agregá "http://localhost:3001/oauth2callback" en Authorized redirect URIs.
//   3) Ejecutá: node scripts/google-token.js
//   4) Autorizá con la cuenta de Google de la profesional.
//   5) El script escribe GOOGLE_REFRESH_TOKEN en .env.local automáticamente.
// =============================================================================

const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');

const config = require('../servidor/config');

const PORT = 3001;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const ENV_PATH = path.join(__dirname, '..', '.env.local');

if (!config.google.clientId || !config.google.clientSecret) {
  console.error('❌ Falta configurar Google.');
  console.error('   1. Andá a https://console.cloud.google.com -> Crear proyecto.');
  console.error('   2. Habilitá "Google Calendar API".');
  console.error('   3. Pantalla de consentimiento OAuth -> External -> agregá tu Gmail como test user.');
  console.error('   4. Credenciales -> Crear credenciales -> OAuth 2.0 -> tipo "Web app".');
  console.error('   5. En Authorized redirect URIs agregá: ' + REDIRECT_URI);
  console.error('   6. Pegá el Client ID y Client Secret en .env.local (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).');
  process.exit(1);
}

const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  config.google.clientId,
  config.google.clientSecret,
  REDIRECT_URI
);

function abrirNavegador(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start ""'
    : 'xdg-open';
  exec(`${cmd} "${url}"`, () => {});
}

function escribirRefreshToken(token) {
  if (!fs.existsSync(ENV_PATH)) {
    console.log('\nℹ️  No se encontró .env.local. Guardá el token manualmente:');
    console.log(`   GOOGLE_REFRESH_TOKEN=${token}`);
    return false;
  }

  let contenido = fs.readFileSync(ENV_PATH, 'utf8');
  const linea = `GOOGLE_REFRESH_TOKEN=${token}`;
  const tieneConfig = /^GOOGLE_REFRESH_TOKEN=/m;

  if (tieneConfig.test(contenido)) {
    contenido = contenido.replace(/^GOOGLE_REFRESH_TOKEN=.*$/m, linea);
  } else {
    contenido += `\n${linea}\n`;
  }

  fs.writeFileSync(ENV_PATH, contenido);
  return true;
}

async function intercambiarCodigo(code) {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Asegura que el refresh_token esté presente
  if (!tokens.refresh_token) {
    const refreshed = await oauth2Client.refreshAccessToken();
    if (!refreshed.credentials.refresh_token) {
      throw new Error('No se obtuvo refresh_token. Probá revocar el acceso e intentar de nuevo.');
    }
    return refreshed.credentials.refresh_token;
  }

  return tokens.refresh_token;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, REDIRECT_URI);

  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404);
    res.end('No encontrado');
    return;
  }

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h3>❌ Autorización cancelada o con error.</h3><p>Volvé a ejecutar: node scripts/google-token.js</p>');
    console.error('❌ Autorización rechazada:', error || 'sin código');
    process.exit(1);
    return;
  }

  intercambiarCodigo(code)
    .then(refreshToken => {
      const escrito = escribirRefreshToken(refreshToken);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h3>✅ ¡Conectado!</h3><p>Podés cerrar esta pestaña.</p>`);

      console.log('\n' + '═'.repeat(50));
      console.log('✅ ¡Google Calendar conectado!');
      if (escrito) {
        console.log('   GOOGLE_REFRESH_TOKEN guardado en .env.local');
      } else {
        console.log('   GOOGLE_REFRESH_TOKEN=' + refreshToken);
      }
      console.log('   Reiniciá el servidor para aplicar los cambios.');
      console.log('═'.repeat(50));
      process.exit(0);
    })
    .catch(err => {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h3>❌ Error al obtener el token.</h3><p>' + (err.message || 'Desconocido') + '</p>');
      console.error('❌ Error:', err.message);
      process.exit(1);
    });
});

server.listen(PORT, () => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPE,
    prompt: 'consent'
  });

  console.log('═'.repeat(50));
  console.log('📅 Conectando Google Calendar');
  console.log('   Servidor local escuchando en http://localhost:' + PORT);
  console.log('   Se va a abrir el navegador para autorizar.');
  console.log('   Autorizá con el Gmail de la profesional.');
  console.log('═'.repeat(50) + '\n');

  abrirNavegador(url);
  console.log('   Si no se abrió, entrá a esta URL:');
  console.log('   ' + url + '\n');

  // Cierre de seguridad después de 5 minutos
  setTimeout(() => {
    console.error('⏱️  Tiempo agotado (5 min). Volvé a ejecutar el script.');
    process.exit(1);
  }, 5 * 60 * 1000);
});
