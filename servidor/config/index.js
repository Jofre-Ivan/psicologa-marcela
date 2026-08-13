// =============================================================================
// servidor/config/index.js - Configuración central y validación de variables
// =============================================================================

const path = require('path');
const fs = require('fs');

// Cargar .env.local si existe, sino .env
const envPath = path.join(__dirname, '..', '..', '.env.local');
const altPath = path.join(__dirname, '..', '..', '.env');

if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else if (fs.existsSync(altPath)) {
  require('dotenv').config({ path: altPath });
} else {
  console.error('❌ ERROR: No se encontró archivo .env');
  console.error('   Copiá .env.example a .env.local y completá las variables');
  process.exit(1);
}

// Definición de variables requeridas
const requiredVars = [
  'ENCRYPTION_KEY',
  'SESSION_SECRET',
  'MP_ACCESS_TOKEN',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN'
];

const missing = requiredVars.filter(v => !process.env[v]);

if (missing.length > 0 && process.env.NODE_ENV === 'production') {
  console.error('❌ FALTAN VARIABLES REQUERIDAS EN PRODUCCIÓN:');
  missing.forEach(v => console.error(`   - ${v}`));
  process.exit(1);
}

// Validar longitud de clave de cifrado
if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length !== 64) {
  console.error('❌ ENCRYPTION_KEY debe ser de 32 bytes (64 caracteres hex)');
  console.error('   Generar con: npm run generate-key');
  process.exit(1);
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  puerto: parseInt(process.env.PUERTO, 10) || parseInt(process.env.PORT, 10) || 3000,
  urlBase: process.env.URL_BASE || 'http://localhost:3000',

  db: {
    path: process.env.DB_PATH || path.join(__dirname, '..', '..', 'datos.db')
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY || 'dev-key-replace-in-production-32bytes!!'
  },

  session: {
    secret: process.env.SESSION_SECRET || 'dev-secret-replace-me',
    timeoutMin: parseInt(process.env.SESSION_TIMEOUT_MIN, 10) || 30
  },

  mercadoPago: {
    accessToken: process.env.MP_ACCESS_TOKEN,
    publicKey: process.env.MP_PUBLIC_KEY,
    webhookSecret: process.env.MP_WEBHOOK_SECRET
  },

  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET,
    webhookId: process.env.PAYPAL_WEBHOOK_ID,
    environment: process.env.PAYPAL_ENVIRONMENT || 'sandbox'
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
    verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary'
  },

  turnstile: {
    siteKey: process.env.TURNSTILE_SITE_KEY,
    secretKey: process.env.TURNSTILE_SECRET_KEY
  },

  admin: {
    user: process.env.ADMIN_USER || 'admin',
    totpSecret: process.env.ADMIN_TOTP_SECRET
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    auditPath: process.env.AUDIT_LOG_PATH || path.join(__dirname, '..', '..', 'logs', 'audit.log'),
    errorPath: process.env.ERROR_LOG_PATH || path.join(__dirname, '..', '..', 'logs', 'error.log')
  }
};

module.exports = config;
