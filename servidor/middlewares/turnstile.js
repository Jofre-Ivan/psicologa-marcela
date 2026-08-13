// =============================================================================
// servidor/middlewares/turnstile.js - Cloudflare Turnstile
// =============================================================================

const axios = require('axios');
const config = require('../config');
const auditLogger = require('../services/auditLogger');

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verificarTurnstile(token, ip) {
  if (!config.turnstile.secretKey) {
    if (!config.isProduction) {
      return { success: true, razon: 'Modo desarrollo' };
    }
    return { success: false, razon: 'Turnstile no configurado' };
  }

  if (!token) {
    return { success: false, razon: 'Token faltante' };
  }

  try {
    const response = await axios.post(VERIFY_URL, {
      secret: config.turnstile.secretKey,
      response: token,
      remoteip: ip
    }, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 5000
    });

    const { success, 'error-codes': errorCodes, action, hostname } = response.data;

    if (!success) {
      auditLogger.registrar('Turnstile: verificación fallida', auditLogger.TIPOS.ERROR_SISTEMA, {
        ip,
        resultado: 'error',
        datos: { errores: errorCodes }
      });
      return { success: false, razon: 'Verificación fallida', errores: errorCodes };
    }

    if (config.isProduction && hostname !== new URL(config.urlBase).hostname) {
      auditLogger.registrar('Turnstile: hostname inválido', auditLogger.TIPOS.ERROR_SISTEMA, {
        ip,
        resultado: 'error',
        datos: { hostname, esperado: config.urlBase }
      });
      return { success: false, razon: 'Hostname inválido' };
    }

    return { success: true, action };
  } catch (error) {
    auditLogger.registrar('Turnstile: error de red', auditLogger.TIPOS.ERROR_SISTEMA, {
      ip,
      resultado: 'error',
      datos: { error: error.message }
    });
    return { success: false, razon: 'Error de verificación' };
  }
}

function middlewareTurnstile(req, res, next) {
  const token = req.body?.turnstileToken || req.headers['x-turnstile-token'];
  const ip = req.ip || req.headers['x-forwarded-for'];

  verificarTurnstile(token, ip).then(resultado => {
    if (resultado.success) {
      next();
    } else {
      res.status(403).json({ error: 'Verificación de seguridad fallida' });
    }
  });
}

module.exports = {
  verificarTurnstile,
  middlewareTurnstile
};
