// =============================================================================
// servidor/services/auditLogger.js - Sistema de logging y auditoría
// =============================================================================

const winston = require('winston');
const path = require('path');
const config = require('../config');
const { getDb } = require('../models/db');

// Asegurar directorio de logs
const fs = require('fs');
const logsDir = path.dirname(config.logging.auditPath);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Logger Winston para archivo
const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: config.logging.errorPath,
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: config.logging.auditPath,
      maxsize: 10485760,
      maxFiles: 10
    })
  ]
});

if (!config.isProduction) {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

const TIPOS = {
  LOGIN_EXITOSO: 'login_exitoso',
  LOGIN_FALLIDO: 'login_fallido',
  LOGOUT: 'logout',
  WEBHOOK_RECIBIDO: 'webhook_recibido',
  WEBHOOK_RECHAZADO: 'webhook_rechazado',
  WEBHOOK_FIRMA_INVALIDA: 'webhook_firma_invalida',
  TURNO_CREADO: 'turno_creado',
  TURNO_CONFIRMADO: 'turno_confirmado',
  TURNO_CANCELADO: 'turno_cancelado',
  TURNO_EXPIRADO: 'turno_expirado',
  PAGO_CREADO: 'pago_creado',
  PAGO_CONFIRMADO: 'pago_confirmado',
  PAGO_RECHAZADO: 'pago_rechazado',
  OTP_ENVIADO: 'otp_enviado',
  OTP_VERIFICADO: 'otp_verificado',
  OTP_FALLIDO: 'otp_fallido',
  OTP_BLOQUEADO: 'otp_bloqueado',
  RATE_LIMIT_EXCEDIDO: 'rate_limit_excedido',
  CSRF_INVALIDO: 'csrf_invalido',
  ACCESO_NO_AUTORIZADO: 'acceso_no_autorizado',
  ERROR_SISTEMA: 'error_sistema'
};

function registrar(evento, tipo, { ip, usuarioId = null, datos = null, resultado = 'exitoso' } = {}) {
  const registro = {
    evento,
    tipo,
    ip_origen: ip || 'desconocida',
    usuario_id: usuarioId,
    datos: datos ? JSON.stringify(datos) : null,
    resultado,
    fecha: new Date().toISOString()
  };

  // Guardar en base de datos para consultas
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO audit_log (evento, tipo, ip_origen, usuario_id, datos, resultado)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(registro.evento, registro.tipo, registro.ip_origen, registro.usuario_id, registro.datos, registro.resultado);
  } catch (e) {
    logger.error('Error guardando audit log en BD', { error: e.message });
  }

  // Guardar en archivo
  const nivel = resultado === 'error' ? 'error' : 'info';
  logger.log(nivel, evento, registro);

  return registro;
}

function consultar(filtros = {}, limite = 100) {
  const db = getDb();
  let query = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];

  if (filtros.tipo) {
    query += ' AND tipo = ?';
    params.push(filtros.tipo);
  }
  if (filtros.ip) {
    query += ' AND ip_origen = ?';
    params.push(filtros.ip);
  }
  if (filtros.desde) {
    query += ' AND fecha >= ?';
    params.push(filtros.desde);
  }
  if (filtros.hasta) {
    query += ' AND fecha <= ?';
    params.push(filtros.hasta);
  }

  query += ' ORDER BY fecha DESC LIMIT ?';
  params.push(limite);

  return db.prepare(query).all(...params);
}

function detectarAnomalias(ventanaMinutos = 60) {
  const db = getDb();
  const desde = new Date(Date.now() - ventanaMinutos * 60000).toISOString();

  return db.prepare(`
    SELECT ip_origen, tipo, COUNT(*) as total
    FROM audit_log
    WHERE fecha >= ? AND resultado IN ('error', 'bloqueado')
    GROUP BY ip_origen, tipo
    HAVING total >= 5
    ORDER BY total DESC
  `).all(desde);
}

module.exports = {
  registrar,
  consultar,
  detectarAnomalias,
  TIPOS
};
