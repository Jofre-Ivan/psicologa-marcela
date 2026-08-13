// =============================================================================
// servidor/services/otpService.js - Verificación OTP por SMS (Twilio)
// =============================================================================

const crypto = require('crypto');
const config = require('../config');
const { getDb } = require('../models/db');
const auditLogger = require('./auditLogger');

let twilioClient = null;

function getTwilioClient() {
  if (twilioClient) return twilioClient;

  if (!config.twilio.accountSid || !config.twilio.authToken) {
    return null;
  }

  if (!config.twilio.accountSid.startsWith('AC')) {
    return null;
  }

  try {
    twilioClient = require('twilio')(config.twilio.accountSid, config.twilio.authToken);
    return twilioClient;
  } catch (e) {
    console.error('Error inicializando Twilio:', e.message);
    return null;
  }
}

function generarCodigo() {
  return crypto.randomInt(100000, 999999).toString();
}

function hashCodigo(codigo) {
  return crypto.createHash('sha256').update(codigo).digest('hex');
}

function hashTelefono(telefono) {
  return crypto.createHash('sha256').update(telefono.replace(/\D/g, '')).digest('hex');
}

async function enviarOTP(telefono, tipo = 'sms') {
  const db = getDb();
  const telefonoLimpio = telefono.replace(/\D/g, '');
  const telefonoHash = hashTelefono(telefonoLimpio);

  const reciente = db.prepare(`
    SELECT COUNT(*) as c FROM verificaciones_otp
    WHERE telefono_hash = ? AND fecha_creacion > datetime('now', '-2 minutes')
  `).get(telefonoHash);

  if (reciente.c > 0) {
    return {
      success: false,
      error: 'Esperá un momento antes de solicitar otro código'
    };
  }

  const intentosRecientes = db.prepare(`
    SELECT COUNT(*) as c FROM verificaciones_otp
    WHERE telefono_hash = ? AND fecha_creacion > datetime('now', '-1 hour')
  `).get(telefonoHash);

  if (intentosRecientes.c >= 5) {
    auditLogger.registrar('OTP bloqueado por exceso de intentos', auditLogger.TIPOS.OTP_BLOQUEADO, {
      resultado: 'bloqueado',
      datos: { telefono: telefonoLimpio.replace(/(\d{2})\d+(\d{2})/, '$1****$2') }
    });
    return {
      success: false,
      error: 'Demasiados intentos. Intentá en una hora.'
    };
  }

  const codigo = generarCodigo();
  const codigoHash = hashCodigo(codigo);
  const expiracion = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO verificaciones_otp (telefono_hash, codigo_hash, tipo, fecha_expiracion)
    VALUES (?, ?, ?, ?)
  `).run(telefonoHash, codigoHash, tipo, expiracion);

  const client = getTwilioClient();

  if (!client) {
    if (!config.isProduction) {
      console.log(`\n🔑 [MODO DESARROLLO] OTP para ${telefonoLimpio}: ${codigo}\n`);
      return { success: true, devMode: true, message: 'Código: ' + código + ' (modo desarrollo)' };
    }
    return { success: false, error: 'Servicio OTP no disponible' };
  }

  try {
    if (config.twilio.verifyServiceSid) {
      await client.verify.v2.services(config.twilio.verifyServiceSid)
        .verifications
        .create({ to: `+${telefonoLimpio}`, channel: tipo });

      auditLogger.registrar('OTP enviado (Verify)', auditLogger.TIPOS.OTP_ENVIADO, {
        resultado: 'exitoso',
        datos: { tipo }
      });

      return { success: true, message: 'Código enviado' };
    } else {
      await client.messages.create({
        body: `Tu código de verificación es: ${codigo}. Válido por 5 minutos. No compartas este código.`,
        from: config.twilio.phoneNumber,
        to: `+${telefonoLimpio}`
      });

      auditLogger.registrar('OTP enviado (SMS)', auditLogger.TIPOS.OTP_ENVIADO, {
        resultado: 'exitoso',
        datos: { tipo: 'sms' }
      });

      return { success: true, message: 'Código enviado' };
    }
  } catch (error) {
    auditLogger.registrar('Error enviando OTP', auditLogger.TIPOS.OTP_FALLIDO, {
      resultado: 'error',
      datos: { error: error.message }
    });
    return { success: false, error: 'Error enviando el código' };
  }
}

async function verificarOTP(telefono, codigo) {
  const db = getDb();
  const telefonoLimpio = telefono.replace(/\D/g, '');
  const telefonoHash = hashTelefono(telefonoLimpio);
  const codigoHash = hashCodigo(codigo);

  const registro = db.prepare(`
    SELECT * FROM verificaciones_otp
    WHERE telefono_hash = ? AND verificado = 0 AND expirado = 0
    ORDER BY fecha_creacion DESC LIMIT 1
  `).get(telefonoHash);

  if (!registro) {
    auditLogger.registrar('OTP inválido: no hay registro', auditLogger.TIPOS.OTP_FALLIDO, {
      resultado: 'error'
    });
    return { success: false, error: 'Código no encontrado o expirado' };
  }

  if (new Date(registro.fecha_expiracion) < new Date()) {
    db.prepare('UPDATE verificaciones_otp SET expirado = 1 WHERE id = ?').run(registro.id);
    auditLogger.registrar('OTP expirado', auditLogger.TIPOS.OTP_FALLIDO, {
      resultado: 'error'
    });
    return { success: false, error: 'El código expiró' };
  }

  if (registro.intentos >= 5) {
    db.prepare('UPDATE verificaciones_otp SET expirado = 1 WHERE id = ?').run(registro.id);
    auditLogger.registrar('OTP bloqueado: demasiados intentos', auditLogger.TIPOS.OTP_BLOQUEADO, {
      resultado: 'bloqueado'
    });
    return { success: false, error: 'Demasiados intentos. Solicitá un nuevo código.' };
  }

  db.prepare('UPDATE verificaciones_otp SET intentos = intentos + 1 WHERE id = ?').run(registro.id);

  if (registro.codigo_hash !== codigoHash) {
    auditLogger.registrar('OTP incorrecto', auditLogger.TIPOS.OTP_FALLIDO, {
      resultado: 'error'
    });
    return { success: false, error: 'Código incorrecto' };
  }

  db.prepare('UPDATE verificaciones_otp SET verificado = 1 WHERE id = ?').run(registro.id);

  auditLogger.registrar('OTP verificado correctamente', auditLogger.TIPOS.OTP_VERIFICADO, {
    resultado: 'exitoso'
  });

  return { success: true, verificationId: registro.id };
}

async function verificarOTPWithTwilioService(telefono, codigo) {
  const client = getTwilioClient();

  if (!client || !config.twilio.verifyServiceSid) {
    return verificarOTP(telefono, codigo);
  }

  const telefonoLimpio = telefono.replace(/\D/g, '');

  try {
    const result = await client.verify.v2.services(config.twilio.verifyServiceSid)
      .verificationChecks
      .create({ to: `+${telefonoLimpio}`, code: codigo });

    if (result.status === 'approved') {
      auditLogger.registrar('OTP verificado (Verify)', auditLogger.TIPOS.OTP_VERIFICADO, {
        resultado: 'exitoso'
      });
      return { success: true };
    }

    auditLogger.registrar('OTP incorrecto (Verify)', auditLogger.TIPOS.OTP_FALLIDO, {
      resultado: 'error'
    });
    return { success: false, error: 'Código incorrecto' };
  } catch (error) {
    auditLogger.registrar('Error verificando OTP (Verify)', auditLogger.TIPOS.OTP_FALLIDO, {
      resultado: 'error',
      datos: { error: error.message }
    });
    return { success: false, error: 'Error verificando el código' };
  }
}

module.exports = {
  enviarOTP,
  verificarOTP,
  verificarOTPWithTwilioService,
  hashTelefono
};
