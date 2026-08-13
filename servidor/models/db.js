// =============================================================================
// servidor/models/db.js - Base de datos con cifrado y transacciones seguras
// =============================================================================

const Database = require('better-sqlite3');
const path = require('path');
const config = require('../config');
const { encrypt, decrypt } = require('../config/encryption');

let db;

function getDb() {
  if (!db) {
    db = new Database(config.db.path);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    crearTablas();
  }
  return db;
}

function crearTablas() {
  const db = getDb();

  db.exec(`
    -- Pacientes (datos cifrados)
    CREATE TABLE IF NOT EXISTS pacientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dni_hash TEXT UNIQUE NOT NULL,
      dni_cifrado TEXT NOT NULL,
      nombre_cifrado TEXT NOT NULL,
      telefono_cifrado TEXT NOT NULL,
      email_cifrado TEXT,
      fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
      consentimiento INTEGER NOT NULL DEFAULT 0
    );

    -- Turnos
    CREATE TABLE IF NOT EXISTS turnos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paciente_id INTEGER,
      servicio_id INTEGER NOT NULL,
      tipo_cobertura TEXT NOT NULL DEFAULT 'particular' CHECK (tipo_cobertura IN ('apross', 'particular')),
      monto REAL NOT NULL DEFAULT 0,
      fecha TEXT NOT NULL,
      hora TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'pendiente_verificacion',
      fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
      fecha_expiracion TEXT,
      expirado INTEGER NOT NULL DEFAULT 0,
      evento_id TEXT,
      FOREIGN KEY (paciente_id) REFERENCES pacientes(id)
    );

    -- Bloqueos importados desde Google Calendar (turnos manuales de la profesional)
    CREATE TABLE IF NOT EXISTS bloqueos_calendar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evento_id TEXT UNIQUE NOT NULL,
      fecha TEXT NOT NULL,
      hora_inicio TEXT NOT NULL,
      hora_fin TEXT NOT NULL,
      todo_dia INTEGER NOT NULL DEFAULT 0,
      titulo TEXT,
      fecha_sync TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Pagos (idempotencia garantizada)
    CREATE TABLE IF NOT EXISTS pagos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turno_id INTEGER NOT NULL,
      proveedor TEXT NOT NULL,
      payment_id TEXT UNIQUE NOT NULL,
      monto REAL NOT NULL,
      moneda TEXT NOT NULL DEFAULT 'ARS',
      estado TEXT NOT NULL DEFAULT 'pendiente',
      datos_webhook TEXT,
      fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
      fecha_confirmacion TEXT,
      idempotencia_key TEXT UNIQUE NOT NULL,
      FOREIGN KEY (turno_id) REFERENCES turnos(id)
    );

    -- Verificaciones OTP
    CREATE TABLE IF NOT EXISTS verificaciones_otp (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telefono_hash TEXT NOT NULL,
      codigo_hash TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'sms',
      intentos INTEGER NOT NULL DEFAULT 0,
      verificado INTEGER NOT NULL DEFAULT 0,
      expirado INTEGER NOT NULL DEFAULT 0,
      fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
      fecha_expiracion TEXT NOT NULL
    );

    -- Log de auditoría
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evento TEXT NOT NULL,
      tipo TEXT NOT NULL,
      ip_origen TEXT,
      usuario_id TEXT,
      datos TEXT,
      resultado TEXT NOT NULL,
      fecha TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Admins
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      totp_secret TEXT,
      activo INTEGER NOT NULL DEFAULT 1,
      ultimo_acceso TEXT,
      fecha_creacion TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Servicios
    CREATE TABLE IF NOT EXISTS servicios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      duracion_min INTEGER NOT NULL DEFAULT 50,
      precio REAL NOT NULL DEFAULT 0,
      descripcion TEXT NOT NULL DEFAULT '',
      activo INTEGER NOT NULL DEFAULT 1
    );

    -- Disponibilidad
    CREATE TABLE IF NOT EXISTS disponibilidad (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dia INTEGER NOT NULL CHECK (dia BETWEEN 0 AND 6),
      hora_inicio TEXT NOT NULL,
      hora_fin TEXT NOT NULL
    );

    -- Sesiones admin
    CREATE TABLE IF NOT EXISTS sesiones_admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      ip TEXT NOT NULL,
      user_agent TEXT,
      activo INTEGER NOT NULL DEFAULT 1,
      fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
      fecha_expiracion TEXT NOT NULL,
      FOREIGN KEY (admin_id) REFERENCES admins(id)
    );

    -- Índices
    CREATE INDEX IF NOT EXISTS idx_turnos_fecha ON turnos(fecha, hora);
    CREATE INDEX IF NOT EXISTS idx_turnos_estado ON turnos(estado);
    CREATE INDEX IF NOT EXISTS idx_bloqueos_fecha ON bloqueos_calendar(fecha);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_payment_id ON pagos(payment_id);
    CREATE INDEX IF NOT EXISTS idx_otp_telefono ON verificaciones_otp(telefono_hash);
    CREATE INDEX IF NOT EXISTS idx_audit_fecha ON audit_log(fecha);
  `);

  // Migración: agregar evento_id a turnos si la base ya existía
  const colsTurnos = db.prepare('PRAGMA table_info(turnos)').all();
  if (!colsTurnos.some(c => c.name === 'evento_id')) {
    db.exec('ALTER TABLE turnos ADD COLUMN evento_id TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_turnos_evento ON turnos(evento_id)');

  // Seed de servicios (solo uno). El precio puede venir de la variable de
  // entorno SERVICIO_PRECIO (importante en producción, ej: 35000).
  const count = db.prepare('SELECT COUNT(*) as c FROM servicios').get();
  if (count.c === 0) {
    db.prepare(
      'INSERT INTO servicios (nombre, slug, duracion_min, precio, descripcion) VALUES (?, ?, ?, ?, ?)'
    ).run('Terapia Individual', 'terapia-individual', 60, Number(process.env.SERVICIO_PRECIO) || 0, 'Sesión de terapia Gestalt individual para adultos. Duración: 1 hora.');
  }

  // Aplica el precio desde entorno (idempotente: también actualiza DBs existentes)
  const precioEnv = Number(process.env.SERVICIO_PRECIO);
  if (Number.isFinite(precioEnv) && precioEnv >= 0) {
    db.prepare('UPDATE servicios SET precio = ? WHERE activo = 1').run(precioEnv);
  }

  // Seed de disponibilidad (lunes a viernes 8:00-21:00)
  const dias = db.prepare('SELECT COUNT(*) as c FROM disponibilidad').get();
  if (dias.c === 0) {
    const insert = db.prepare(
      'INSERT INTO disponibilidad (dia, hora_inicio, hora_fin) VALUES (?, ?, ?)'
    );
    const tx = db.transaction(() => {
      for (let dia = 1; dia <= 5; dia++) {
        insert.run(dia, '08:00', '21:00');
      }
    });
    tx();
  }
}

/**
 * Ejecuta una transacción con IMMEDIATE locking para evitar condiciones de carrera
 */
function transaction(fn) {
  const db = getDb();
  return db.transaction(fn).immediate();
}

module.exports = {
  getDb,
  crearTablas,
  transaction
};
