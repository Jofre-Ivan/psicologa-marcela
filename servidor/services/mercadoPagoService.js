// =============================================================================
// servidor/services/mercadoPagoService.js - Integración Mercado Pago segura
// =============================================================================

const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const { getDb, transaction } = require('../models/db');
const auditLogger = require('./auditLogger');

const MP_API_BASE = 'https://api.mercadopago.com';

function getHeaders() {
  return {
    'Authorization': `Bearer ${config.mercadoPago.accessToken}`,
    'Content-Type': 'application/json'
  };
}

function validarFirmaWebhook(headers, body) {
  const signature = headers['x-signature'];
  const requestId = headers['x-request-id'];

  if (!signature || !requestId) {
    return { valido: false, razon: 'Faltan headers de firma' };
  }

  const parts = signature.split(',');
  const ts = parts.find(p => p.startsWith('ts='))?.split('=')[1];
  const sig = parts.find(p => p.startsWith('v1='))?.split('=')[1];

  if (!ts || !sig) {
    return { valido: false, razon: 'Formato de firma inválido' };
  }

  // Anti-replay: el ts de la firma no puede tener más de 5 minutos de antigüedad
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) {
    return { valido: false, razon: 'Formato de firma inválido' };
  }
  const ahora = Math.floor(Date.now() / 1000);
  if (Math.abs(ahora - tsNum) > 300) {
    return { valido: false, razon: 'Timestamp expirado' };
  }

  const dataId = body?.data?.id || body?.id || '';
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;

  const expectedSig = crypto
    .createHmac('sha256', config.mercadoPago.webhookSecret)
    .update(manifest)
    .digest('hex');

  if (sig !== expectedSig) {
    return { valido: false, razon: 'Firma no coincide' };
  }

  return { valido: true };
}

async function crearPreferencia(turno, servicio, paciente) {
  const preference = {
    items: [{
      title: `Sesión de ${servicio.nombre} - Lic. Marcela Rolón`,
      quantity: 1,
      unit_price: servicio.precio,
      currency_id: 'ARS',
      description: `Turno: ${turno.fecha} ${turno.hora}`
    }],
    external_reference: `turno_${turno.id}`,
    back_urls: {
      success: `${config.urlBase}/reservar?pago=exitoso`,
      failure: `${config.urlBase}/reservar?pago=fallido`,
      pending: `${config.urlBase}/reservar?pago=pendiente`
    },
    auto_return: 'approved',
    notification_url: `${config.urlBase}/webhooks/mercadopago`,
    statement_descriptor: 'PSICOLOGIA MARCELA',
    metadata: {
      turno_id: turno.id,
      paciente_id: paciente.id
    }
  };

  try {
    const response = await axios.post(
      `${MP_API_BASE}/checkout/preferences`,
      preference,
      { headers: getHeaders() }
    );

    return {
      success: true,
      preferenceId: response.data.id,
      initPoint: response.data.init_point,
      sandboxInitPoint: response.data.sandbox_init_point
    };
  } catch (error) {
    auditLogger.registrar('Error creando preferencia MP', auditLogger.TIPOS.ERROR_SISTEMA, {
      resultado: 'error',
      datos: { error: error.message }
    });
    return { success: false, error: 'Error creando la preferencia de pago' };
  }
}

async function confirmarPago(paymentId) {
  try {
    const response = await axios.get(
      `${MP_API_BASE}/v1/payments/${paymentId}`,
      { headers: getHeaders() }
    );

    return {
      success: true,
      status: response.data.status,
      statusDetail: response.data.status_detail,
      metadata: response.data.metadata,
      transactionAmount: response.data.transaction_amount
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

async function procesarWebhook(body, headers, ip) {
  const firma = validarFirmaWebhook(headers, body);

  if (!firma.valido) {
    auditLogger.registrar('Webhook MP: firma inválida', auditLogger.TIPOS.WEBHOOK_FIRMA_INVALIDA, {
      ip,
      resultado: 'error',
      datos: { razon: firma.razon }
    });
    return { valido: false, status: 401, error: 'Firma inválida' };
  }

  const tipo = body.type;
  const dataId = body.data?.id || body.id;

  auditLogger.registrar('Webhook MP recibido', auditLogger.TIPOS.WEBHOOK_RECIBIDO, {
    ip,
    resultado: 'exitoso',
    datos: { tipo, payment_id: dataId }
  });

  if (tipo !== 'payment' && tipo !== 'subscription_authorized_payment') {
    return { valido: true, procesado: false, mensaje: 'Tipo no procesado' };
  }

  const confirmacion = await confirmarPago(dataId);

  if (!confirmacion.success) {
    auditLogger.registrar('Webhook MP: error confirmando pago', auditLogger.TIPOS.ERROR_SISTEMA, {
      ip,
      resultado: 'error',
      datos: { payment_id: dataId }
    });
    return { valido: true, procesado: false, error: 'No se pudo confirmar el pago' };
  }

  const resultado = await procesarPagoConfirmado(
    dataId,
    confirmacion.status,
    confirmacion.metadata,
    confirmacion.transactionAmount,
    body
  );

  return { valido: true, procesado: true, resultado };
}

// Detecta si un error de SQLite es por violación del constraint UNIQUE
function esViolacionUnique(error) {
  return !!error && (
    error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    (typeof error.message === 'string' && /UNIQUE constraint failed/i.test(error.message))
  );
}

async function procesarPagoConfirmado(paymentId, status, metadata, transactionAmount, rawBody) {
  const db = getDb();

  const existente = db.prepare('SELECT id FROM pagos WHERE payment_id = ?').get(paymentId);
  if (existente) {
    auditLogger.registrar('Pago duplicado ignorado', auditLogger.TIPOS.PAGO_CONFIRMADO, {
      resultado: 'exitoso',
      datos: { payment_id: paymentId, nota: 'Idempotencia' }
    });
    return { success: true, duplicado: true };
  }

  const turnoId = metadata?.turno_id;
  if (!turnoId) {
    return { success: false, error: 'Turno no encontrado en metadata' };
  }

  const idempotenciaKey = crypto.createHash('sha256')
    .update(`mp_${paymentId}`)
    .digest('hex');

  let resultado;
  try {
    resultado = transaction(() => {
      const turno = db.prepare('SELECT * FROM turnos WHERE id = ?').get(turnoId);
      if (!turno) throw new Error('Turno no encontrado');

      const servicio = db.prepare('SELECT * FROM servicios WHERE id = ?').get(turno.servicio_id);

      // Validación de monto: el monto efectivamente pagado debe coincidir con el precio
      let montoOk = true;
      if (status === 'approved') {
        montoOk = transactionAmount != null &&
          Math.abs(Number(transactionAmount) - Number(servicio?.precio || 0)) < 0.01;
      }

      const estadoPago = status === 'approved'
        ? (montoOk ? 'confirmado' : 'monto_invalido')
        : 'rechazado';

      // INSERT con manejo de race condition: si dos webhooks llegan a la vez,
      // el segundo choca contra el UNIQUE(payment_id) y se trata como duplicado.
      try {
        db.prepare(`
          INSERT INTO pagos (turno_id, proveedor, payment_id, monto, estado, datos_webhook, idempotencia_key, fecha_confirmacion)
          VALUES (?, 'mercadopago', ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          turnoId,
          paymentId,
          servicio?.precio || 0,
          estadoPago,
          JSON.stringify({ status, transaction_amount: transactionAmount, raw_body_id: rawBody.id }),
          idempotenciaKey
        );
      } catch (error) {
        if (esViolacionUnique(error)) {
          return { duplicado: true };
        }
        throw error;
      }

      if (status === 'approved') {
        if (!montoOk) {
          auditLogger.registrar('Webhook MP: monto no coincide', auditLogger.TIPOS.ERROR_SISTEMA, {
            resultado: 'error',
            datos: { payment_id: paymentId, turno_id: turnoId, esperado: servicio?.precio, recibido: transactionAmount }
          });
          return { montoInvalido: true };
        }
        db.prepare("UPDATE turnos SET estado = 'confirmado' WHERE id = ?").run(turnoId);
        auditLogger.registrar('Pago confirmado y turno actualizado', auditLogger.TIPOS.PAGO_CONFIRMADO, {
          resultado: 'exitoso',
          datos: { turno_id: turnoId, payment_id: paymentId }
        });
      } else {
        db.prepare("UPDATE turnos SET estado = 'pago_rechazado' WHERE id = ?").run(turnoId);
        auditLogger.registrar('Pago rechazado', auditLogger.TIPOS.PAGO_RECHAZADO, {
          resultado: 'error',
          datos: { turno_id: turnoId, payment_id: paymentId, status }
        });
      }

      return { ok: true };
    });
  } catch (error) {
    auditLogger.registrar('Error procesando pago', auditLogger.TIPOS.ERROR_SISTEMA, {
      resultado: 'error',
      datos: { error: error.message, payment_id: paymentId }
    });
    return { success: false, error: error.message };
  }

  if (resultado?.duplicado) {
    auditLogger.registrar('Pago duplicado (constraint) ignorado', auditLogger.TIPOS.PAGO_CONFIRMADO, {
      resultado: 'exitoso',
      datos: { payment_id: paymentId, nota: 'Race condition' }
    });
    return { success: true, duplicado: true };
  }

  if (resultado?.montoInvalido) {
    return { success: true, montoInvalido: true };
  }

  if (status === 'approved') {
    const { confirmarTurnoCalendario } = require('./calendarService');
    await confirmarTurnoCalendario(turnoId);
  }

  return { success: true, turnoId };
}

module.exports = {
  crearPreferencia,
  confirmarPago,
  procesarWebhook,
  validarFirmaWebhook
};
