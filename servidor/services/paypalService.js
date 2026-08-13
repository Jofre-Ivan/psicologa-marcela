// =============================================================================
// servidor/services/paypalService.js - Integración PayPal segura
// =============================================================================

const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const { getDb, transaction } = require('../models/db');
const auditLogger = require('./auditLogger');

let accessToken = null;
let tokenExpiry = null;

function getApiBase() {
  return config.paypal.environment === 'production'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function getAccessToken() {
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }

  try {
    const auth = Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString('base64');

    const response = await axios.post(
      `${getApiBase()}/v1/oauth2/token`,
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    accessToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;

    return accessToken;
  } catch (error) {
    throw new Error('Error obteniendo token de PayPal');
  }
}

async function crearOrden(turno, servicio) {
  const token = await getAccessToken();

  const orden = {
    intent: 'CAPTURE',
    purchase_units: [{
      amount: {
        currency_code: 'ARS',
        value: servicio.precio.toFixed(2)
      },
      description: `Sesión de ${servicio.nombre} - Lic. Marcela Rolón`,
      custom_id: `turno_${turno.id}`
    }],
    application_context: {
      brand_name: 'Lic. Marcela Rolón - Psicología',
      landing_page: 'BILLING',
      user_action: 'PAY_NOW',
      return_url: `${config.urlBase}/reservar?pago=exitoso`,
      cancel_url: `${config.urlBase}/reservar?pago=cancelado`
    }
  };

  try {
    const response = await axios.post(
      `${getApiBase()}/v2/checkout/orders`,
      orden,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const approveLink = response.data.links.find(l => l.rel === 'approve');

    return {
      success: true,
      ordenId: response.data.id,
      approveUrl: approveLink?.href,
      status: response.data.status
    };
  } catch (error) {
    auditLogger.registrar('Error creando orden PayPal', auditLogger.TIPOS.ERROR_SISTEMA, {
      resultado: 'error',
      datos: { error: error.message }
    });
    return { success: false, error: 'Error creando la orden de pago' };
  }
}

async function capturarPago(ordenId) {
  const token = await getAccessToken();

  try {
    const response = await axios.post(
      `${getApiBase()}/v2/checkout/orders/${ordenId}/capture`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: true,
      status: response.data.status,
      captureId: response.data.purchase_units[0]?.payments?.captures[0]?.id,
      amount: response.data.purchase_units[0]?.amount
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

async function verificarPago(ordenId) {
  const token = await getAccessToken();

  try {
    const response = await axios.get(
      `${getApiBase()}/v2/checkout/orders/${ordenId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    return {
      success: true,
      status: response.data.status,
      purchaseUnits: response.data.purchase_units
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function validarFirmaWebhook(headers, body) {
  const transmissionId = headers['paypal-transmission-id'];
  const certUrl = headers['paypal-cert-url'];
  const authAlgo = headers['paypal-auth-algo'];
  const transmissionSig = headers['paypal-transmission-sig'];
  const transmissionTime = headers['paypal-transmission-time'];

  if (!transmissionId || !certUrl || !authAlgo || !transmissionSig || !transmissionTime) {
    return { valido: false, razon: 'Faltan headers de verificación' };
  }

  if (!certUrl.startsWith('https://api.') || (!certUrl.includes('paypal.com') && !certUrl.includes('paypalobjects.com'))) {
    return { valido: false, razon: 'URL de certificado no confiable' };
  }

  if (authAlgo !== 'SHA256withRSA') {
    return { valido: false, razon: 'Algoritmo no soportado' };
  }

  return {
    valido: true,
    webhookId: config.paypal.webhookId,
    transmissionId,
    certUrl,
    authAlgo,
    transmissionSig,
    transmissionTime,
    body
  };
}

async function procesarWebhook(body, headers, ip) {
  const firma = validarFirmaWebhook(headers, body);

  if (!firma.valido) {
    auditLogger.registrar('Webhook PayPal: firma inválida', auditLogger.TIPOS.WEBHOOK_FIRMA_INVALIDA, {
      ip,
      resultado: 'error',
      datos: { razon: firma.razon }
    });
    return { valido: false, status: 401, error: 'Headers inválidos' };
  }

  const eventType = body.event_type;
  const resource = body.resource;

  auditLogger.registrar('Webhook PayPal recibido', auditLogger.TIPOS.WEBHOOK_RECIBIDO, {
    ip,
    resultado: 'exitoso',
    datos: { tipo: evento }
  });

  if (eventType === 'CHECKOUT.ORDER.APPROVED') {
    const ordenId = resource.id;
    const captura = await capturarPago(ordenId);

    if (captura.success && captura.status === 'COMPLETED') {
      const turnoId = resource.purchase_units[0]?.custom_id?.replace('turno_', '');
      if (turnoId) {
        await procesarPagoConfirmado('paypal_' + captura.captureId, turnoId, captura.amount?.value);
      }
    }

    return { valido: true, procesado: true };
  }

  if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
    const capturaId = resource.id;
    const customId = resource.supplementary?.data?.related_ids?.order_id || '';
    const ordenId = customId;

    const ordenResponse = await verificarPago(ordenId);
    if (ordenResponse.success) {
      const turnoId = ordenResponse.purchaseUnits?.[0]?.custom_id?.replace('turno_', '');
      if (turnoId) {
        await procesarPagoConfirmado('paypal_' + capturaId, turnoId, resource.amount?.value);
      }
    }

    return { valido: true, procesado: true };
  }

  return { valido: true, procesado: false, mensaje: 'Evento no procesado' };
}

async function procesarPagoConfirmado(paymentId, turnoId, monto) {
  const db = getDb();

  const existente = db.prepare('SELECT id FROM pagos WHERE payment_id = ?').get(paymentId);
  if (existente) {
    auditLogger.registrar('Pago PayPal duplicado ignorado', auditLogger.TIPOS.PAGO_CONFIRMADO, {
      resultado: 'exitoso',
      datos: { payment_id: paymentId, nota: 'Idempotencia' }
    });
    return { success: true, duplicado: true };
  }

  const idempotenciaKey = crypto.createHash('sha256')
    .update(`paypal_${paymentId}`)
    .digest('hex');

  try {
    transaction(() => {
      db.prepare(`
        INSERT INTO pagos (turno_id, proveedor, payment_id, monto, estado, idempotencia_key, fecha_confirmacion)
        VALUES (?, 'paypal', ?, ?, 'confirmado', ?, datetime('now'))
      `).run(turnoId, paymentId, monto || 0, idempotenciaKey);

      db.prepare("UPDATE turnos SET estado = 'confirmado' WHERE id = ?").run(turnoId);

      auditLogger.registrar('Pago PayPal confirmado', auditLogger.TIPOS.PAGO_CONFIRMADO, {
        resultado: 'exitoso',
        datos: { turno_id: turnoId, payment_id: paymentId }
      });
    });

    const { confirmarTurnoCalendario } = require('./calendarService');
    await confirmarTurnoCalendario(turnoId);

    return { success: true };
  } catch (error) {
    auditLogger.registrar('Error procesando pago PayPal', auditLogger.TIPOS.ERROR_SISTEMA, {
      resultado: 'error',
      datos: { error: error.message }
    });
    return { success: false, error: error.message };
  }
}

module.exports = {
  crearOrden,
  capturarPago,
  verificarPago,
  procesarWebhook,
  validarFirmaWebhook
};
