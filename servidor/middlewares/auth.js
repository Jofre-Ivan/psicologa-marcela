// =============================================================================
// servidor/middlewares/auth.js - Autenticación admin con TOTP/2FA
// =============================================================================

const argon2 = require('argon2');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { getDb } = require('../models/db');
const config = require('../config');
const auditLogger = require('../services/auditLogger');

async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4
  });
}

async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

function generateTotpSecret() {
  return speakeasy.generateSecret({
    name: `Psicologia Admin (${config.admin.user})`,
    issuer: 'Psicologa Marcela',
    length: 32
  });
}

function verifyTotpToken(secret, token) {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 1
  });
}

async function generateQRCode(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl);
}

async function crearAdminInicial() {
  const db = getDb();
  const existente = db.prepare('SELECT COUNT(*) as c FROM admins').get();

  if (existente.c === 0) {
    const secret = generateTotpSecret();
    const passwordHash = await hashPassword('Cambiar123!');

    db.prepare(`
      INSERT INTO admins (username, password_hash, totp_secret, activo)
      VALUES (?, ?, ?, 1)
    `).run(config.admin.user, passwordHash, secret.base32);

    console.log('═'.repeat(60));
    console.log('🔐 ADMIN INICIAL CREADO');
    console.log(`   Usuario: ${config.admin.user}`);
    console.log('   Contraseña: Cambiar123! (CAMBIAR INMEDIATAMENTE)');
    console.log(`   TOTP Secret: ${secret.base32}`);
    console.log('═'.repeat(60));

    try {
      const qrCode = await generateQRCode(secret.otpauth_url);
      console.log('   Escaneá este QR con Google Authenticator:');
      console.log(`   ${qrCode.substring(0, 80)}...`);
    } catch (e) {
      console.log('   otpauth URL:', secret.otpauth_url);
    }
    console.log('═'.repeat(60));
  }
}

async function loginAdmin(username, password, totpToken, ip) {
  const db = getDb();
  const admin = db.prepare('SELECT * FROM admins WHERE username = ? AND activo = 1').get(username);

  if (!admin) {
    auditLogger.registrar('Login fallido: usuario no encontrado', auditLogger.TIPOS.LOGIN_FALLIDO, {
      ip,
      usuarioId: username,
      resultado: 'error'
    });
    return { success: false, error: 'Credenciales inválidas' };
  }

  const passwordValid = await verifyPassword(admin.password_hash, password);
  if (!passwordValid) {
    auditLogger.registrar('Login fallido: contraseña incorrecta', auditLogger.TIPOS.LOGIN_FALLIDO, {
      ip,
      usuarioId: username,
      resultado: 'error'
    });
    return { success: false, error: 'Credenciales inválidas' };
  }

  if (!admin.totp_secret) {
    return { success: false, error: 'TOTP no configurado' };
  }

  const totpValid = verifyTotpToken(admin.totp_secret, totpToken);
  if (!totpValid) {
    auditLogger.registrar('Login fallido: TOTP inválido', auditLogger.TIPOS.LOGIN_FALLIDO, {
      ip,
      usuarioId: username,
      resultado: 'error'
    });
    return { success: false, error: 'Código 2FA inválido' };
  }

  db.prepare("UPDATE admins SET ultimo_acceso = datetime('now') WHERE id = ?").run(admin.id);

  auditLogger.registrar('Login exitoso', auditLogger.TIPOS.LOGIN_EXITOSO, {
    ip,
    usuarioId: username,
    resultado: 'exitoso'
  });

  return { success: true, admin: { id: admin.id, username: admin.username } };
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.admin) {
    auditLogger.registrar('Acceso no autorizado', auditLogger.TIPOS.ACCESO_NO_AUTORIZADO, {
      ip: req.ip,
      datos: { path: req.path },
      resultado: 'bloqueado'
    });
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.session?.admin?.role || !roles.includes(req.session.admin.role)) {
      return res.status(403).json({ error: 'Permisos insuficientes' });
    }
    next();
  };
}

function logoutAdmin(req) {
  if (req.session?.admin) {
    auditLogger.registrar('Logout', auditLogger.TIPOS.LOGOUT, {
      ip: req.ip,
      usuarioId: req.session.admin.username,
      resultado: 'exitoso'
    });
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateTotpSecret,
  verifyTotpToken,
  generateQRCode,
  crearAdminInicial,
  loginAdmin,
  requireAuth,
  requireRole,
  logoutAdmin
};
