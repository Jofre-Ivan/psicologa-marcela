// =============================================================================
// servidor/config/encryption.js - Servicio de cifrado AES-256-GCM
// =============================================================================

const crypto = require('crypto');
const config = require('./index');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

// Derivar clave maestra usando PBKDF2
function deriveKey(salt) {
  return crypto.pbkdf2Sync(
    Buffer.from(config.encryption.key, 'hex'),
    salt,
    100000,
    32,
    'sha256'
  );
}

/**
 * Cifra un texto usando AES-256-GCM
 * @param {string} plaintext - Texto a cifrar
 * @returns {string} - Formato: salt:iv:authTag:ciphertext (base64)
 */
function encrypt(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') return null;

  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
  ciphertext += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  return [
    salt.toString('base64'),
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext
  ].join(':');
}

/**
 * Descifra un texto cifrado con AES-256-GCM
 * @param {string} encryptedData - Formato: salt:iv:authTag:ciphertext
 * @returns {string} - Texto descifrado
 */
function decrypt(encryptedData) {
  if (!encryptedData || typeof encryptedData !== 'string') return null;

  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 4) return null;

    const [saltB64, ivB64, authTagB64, ciphertext] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const key = deriveKey(salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let plaintext = decipher.update(ciphertext, 'base64', 'utf8');
    plaintext += decipher.final('utf8');

    return plaintext;
  } catch (error) {
    console.error('Error de descifrado:', error.message);
    return null;
  }
}

/**
 * Genera un hash seguro para búsqueda (HMAC)
 * Útil para buscar por DNI sin descifrar toda la BD
 */
function hashForSearch(value) {
  return crypto
    .createHmac('sha256', config.encryption.key)
    .update(value.toLowerCase().trim())
    .digest('hex');
}

/**
 * Enmascara datos sensibles para logging
 */
function maskSensitive(data, field) {
  if (!data) return '***';

  switch (field) {
    case 'dni':
      return data.slice(0, -3) + '***';
    case 'telefono':
      return data.slice(0, -4) + '****';
    case 'email':
      const [user, domain] = data.split('@');
      return user.slice(0, 2) + '***@' + domain;
    default:
      return '***';
  }
}

module.exports = {
  encrypt,
  decrypt,
  hashForSearch,
  maskSensitive
};
