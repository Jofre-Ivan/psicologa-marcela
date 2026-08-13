// =============================================================================
// servidor/routes/webhooks.js - Webhooks de pago (Mercado Pago + PayPal)
// =============================================================================

const express = require('express');
const router = express.Router();
const { procesarWebhook: procesarMP } = require('../services/mercadoPagoService');
const { procesarWebhook: procesarPayPal } = require('../services/paypalService');
const { webhookLimiter } = require('../middlewares/rateLimit');
const auditLogger = require('../services/auditLogger');

router.use(webhookLimiter);

router.post('/mercadopago', express.raw({ type: 'application/json' }), async (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'];
  let body;

  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    // Body inválido: se loguea pero se responde 200 para evitar reintentos en bucle
    auditLogger.registrar('Webhook MP: body inválido', auditLogger.TIPOS.WEBHOOK_RECHAZADO, {
      ip,
      resultado: 'error'
    });
    return res.json({ received: true });
  }

  const resultado = await procesarMP(body, req.headers, ip);

  // Solo se responde 401 si la firma no es válida; cualquier error interno
  // (turno no encontrado, DB, etc.) se loguea y responde 200 para que
  // Mercado Pago no reintente en bucle errores que no se resuelven solos.
  if (!resultado.valido) {
    return res.status(401).json({ error: resultado.error });
  }

  res.json({ received: true });
});

router.post('/paypal', express.raw({ type: 'application/json' }), async (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'];
  let body;

  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    auditLogger.registrar('Webhook PayPal: body inválido', auditLogger.TIPOS.WEBHOOK_RECHAZADO, {
      ip,
      resultado: 'error'
    });
    return res.status(400).json({ error: 'Body inválido' });
  }

  const resultado = await procesarPayPal(body, req.headers, ip);

  if (!resultado.valido) {
    return res.status(resultado.status || 401).json({ error: resultado.error });
  }

  res.json({ received: true });
});

// Error handler del router: cualquier error de parseo o interno se loguea y se
// responde 200 para que Mercado Pago no reintente en bucle errores irreversibles.
router.use((err, req, res, next) => {
  auditLogger.registrar('Webhook: error procesando', auditLogger.TIPOS.WEBHOOK_RECHAZADO, {
    ip: req.ip,
    resultado: 'error',
    datos: { error: err?.message || 'Error desconocido', path: req.path }
  });
  res.json({ received: true });
});

module.exports = router;
