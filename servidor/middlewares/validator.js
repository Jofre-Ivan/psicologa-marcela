// =============================================================================
// servidor/middlewares/validator.js - Validación de inputs
// =============================================================================

const { body, param, query, validationResult } = require('express-validator');
const auditLogger = require('../services/auditLogger');

const manejarErroresValidacion = (req, res, next) => {
  const errores = validationResult(req);
  if (!errores.isEmpty()) {
    auditLogger.registrar('Validación fallida', auditLogger.TIPOS.ERROR_SISTEMA, {
      ip: req.ip,
      resultado: 'error',
      datos: { path: req.path, errores: errores.array().map(e => e.path) }
    });
    return res.status(400).json({
      error: 'Datos inválidos',
      campos: errores.array().map(e => e.path)
    });
  }
  next();
};

const validarPaciente = [
  body('nombre')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Nombre debe tener entre 2 y 100 caracteres')
    .matches(/^[a-záéíóúñüA-ZÁÉÍÓÚÑÜ\s]+$/)
    .withMessage('Nombre solo puede contener letras'),

  body('dni')
    .trim()
    .notEmpty().withMessage('DNI es requerido')
    .matches(/^\d{7,8}$|^[A-Z]{1}\d{7,8}$/)
    .withMessage('Formato de DNI inválido'),

  body('telefono')
    .trim()
    .notEmpty().withMessage('Teléfono es requerido')
    .matches(/^\+?[\d\s-]{10,18}$/)
    .withMessage('Formato de teléfono inválido'),

  body('email')
    .optional({ checkFalsy: true })
    .trim()
    .isEmail().withMessage('Email inválido')
    .normalizeEmail()
    .isLength({ max: 254 }),

  body('consentimiento')
    .isBoolean()
    .equals('true')
    .withMessage('Debes aceptar la política de privacidad'),

  manejarErroresValidacion
];

const validarOTP = [
  body('telefono')
    .trim()
    .notEmpty()
    .matches(/^\+?[\d\s-]{10,18}$/),

  body('codigo')
    .trim()
    .notEmpty()
    .matches(/^\d{6}$/),

  manejarErroresValidacion
];

const validarSolicitudOTP = [
  body('telefono')
    .trim()
    .notEmpty()
    .matches(/^\+?[\d\s-]{10,18}$/),

  manejarErroresValidacion
];

const validarLogin = [
  body('username').trim().notEmpty().isLength({ max: 50 }),
  body('password').trim().notEmpty().isLength({ max: 128 }),
  body('totpToken').trim().matches(/^\d{6}$/),

  manejarErroresValidacion
];

const validarTurno = [
  body('servicioId').isInt({ min: 1 }),
  body('fecha').matches(/^\d{4}-\d{2}-\d{2}$/),
  body('hora').matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('turnstileToken').trim().notEmpty(),

  manejarErroresValidacion
];

const validarPago = [
  body('turnoId').isInt({ min: 1 }),
  body('proveedor').isIn(['mercadopago', 'paypal']),

  manejarErroresValidacion
];

module.exports = {
  validarPaciente,
  validarOTP,
  validarSolicitudOTP,
  validarLogin,
  validarTurno,
  validarPago,
  manejarErroresValidacion
};
