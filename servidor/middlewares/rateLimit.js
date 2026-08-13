// =============================================================================
// servidor/middlewares/rateLimit.js - Rate limiting avanzado
// =========================================================================

const rateLimit = require('express-rate-limit');
const config = require('../config');
const auditLogger = require('../services/auditLogger');

function createRateLimiter(options = {}) {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    message = 'Demasiadas solicitudes. Intentá más tarde.',
    keyGenerator = null,
    skipSuccessfulRequests = false,
    tipoEvento = 'rate_limit'
  } = options;

  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    keyGenerator: keyGenerator || ((req) => {
      return req.ip || req.headers['x-forwarded-for'] || 'desconocida';
    }),
    handler: (req, res, next, options) => {
      auditLogger.registrar(
        `Rate limit excedido: ${req.path}`,
        auditLogger.TIPOS.RATE_LIMIT_EXCEDIDO,
        {
          ip: req.ip,
          resultado: 'bloqueado',
          datos: { path: req.path, method: req.method }
        }
      );
      res.status(429).json({ error: message });
    }
  });
}

const generalLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Demasiadas solicitudes. Esperá un momento.'
});

const turnosLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Demasiados intentos de reserva. Intentá en unos minutos.',
  tipoEvento: 'turnos'
});

const otpLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Demasiados códigos solicitados. Intentá más tarde.',
  keyGenerator: (req) => {
    const telefono = req.body?.telefono || '';
    return `${req.ip}:${telefono}`;
  },
  tipoEvento: 'otp'
});

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Demasiados intentos de inicio de sesión. Intentá en 15 minutos.',
  tipoEvento: 'login'
});

const webhookLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.ip,
  tipoEvento: 'webhook'
});

const webhookIpWhitelist = (req, res, next) => {
  const allowedIps = [
    '104.16.0.0/12',
    '18.228.0.0/16',
    '18.229.0.0/16',
    '209.85.128.0/17',
    '35.244.0.0/16',
    '64.233.160.0/19',
    '66.102.0.0/20',
    '66.249.64.0/19',
    '72.14.192.0/18',
    '74.125.0.0/16',
    '108.177.0.0/17',
    '173.194.0.0/16',
    '209.85.128.0/17',
    '216.58.192.0/19',
    '216.239.32.0/19',
    '3.120.0.0/14',
    '3.121.0.0/16',
    '18.196.0.0/15',
    '18.200.0.0/16',
    '18.236.0.0/15',
    '216.239.32.0/19',
    '34.192.0.0/12',
    '34.224.0.0/12',
    '52.20.0.0/14',
    '54.88.0.0/16',
    '64.233.160.0/19',
    '72.14.192.0/18',
    '108.177.0.0/17',
    '173.194.0.0/16',
    '209.85.128.0/17',
    '216.58.192.0/19',
    '34.192.0.0/12',
    '35.168.0.0/13',
    '52.20.0.0/14'
  ];

  const clientIp = req.ip || req.headers['x-forwarded-for']?.split(',')[0].trim();

  if (config.isProduction && !clientIp.startsWith('127.') && !clientIp.startsWith('10.') && !clientIp.startsWith('192.168.')) {
    const isAllowed = allowedIps.some(range => ipInRange(clientIp, range));
    if (!isAllowed) {
      auditLogger.registrar(
        'Webhook desde IP no permitida',
        auditLogger.TIPOS.WEBHOOK_RECHAZADO,
        { ip: clientIp, resultado: 'bloqueado' }
      );
      return res.status(403).json({ error: 'Acceso denegado' });
    }
  }

  next();
};

function ipInRange(ip, range) {
  const [rangeIp, prefix] = range.split('/');
  const prefixLen = parseInt(prefix, 10);
  const ipNum = ipToNumber(ip);
  const rangeNum = ipToNumber(rangeIp);
  const mask = -1 << (32 - prefixLen);
  return (ipNum & mask) === (rangeNum & mask);
}

function ipToNumber(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

module.exports = {
  generalLimiter,
  turnosLimiter,
  otpLimiter,
  loginLimiter,
  webhookLimiter,
  createRateLimiter,
  webhookIpWhitelist
};
