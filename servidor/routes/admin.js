// =============================================================================
// servidor/routes/admin.js - Rutas de administración (protegidas)
// =============================================================================

const express = require('express');
const router = express.Router();
const { getDb, transaction } = require('../models/db');
const { encrypt, decrypt } = require('../config/encryption');
const { loginAdmin, requireAuth, logoutAdmin } = require('../middlewares/auth');
const { loginLimiter } = require('../middlewares/rateLimit');
const { validarLogin } = require('../middlewares/validator');
const auditLogger = require('../services/auditLogger');
const { notificarCancelacion } = require('../services/telegramService');

router.post('/login', loginLimiter, validarLogin, async (req, res) => {
  const { username, password, totpToken } = req.body;
  const ip = req.ip || req.headers['x-forwarded-for'];

  const resultado = await loginAdmin(username, password, totpToken, ip);

  if (resultado.success) {
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Error de sesión' });
      req.session.admin = resultado.admin;
      res.json({ ok: true });
    });
  } else {
    res.status(401).json({ error: resultado.error });
  }
});

router.post('/logout', requireAuth, (req, res) => {
  logoutAdmin(req);
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/turnos', requireAuth, (req, res) => {
  const db = getDb();
  const turnos = db.prepare(`
    SELECT t.*, s.nombre as servicio, s.precio,
           p.nombre_cifrado, p.telefono_cifrado, p.dni_cifrado, p.email_cifrado
    FROM turnos t
    LEFT JOIN servicios s ON s.id = t.servicio_id
    LEFT JOIN pacientes p ON p.id = t.paciente_id
    ORDER BY t.fecha DESC, t.hora DESC
  `).all();

  const turnosDesencriptados = turnos.map(t => ({
    ...t,
    nombre: t.nombre_cifrado ? decrypt(t.nombre_cifrado) : 'No verificado',
    telefono: t.telefono_cifrado ? decrypt(t.telefono_cifrado) : 'Pendiente',
    dni: t.dni_cifrado ? decrypt(t.dni_cifrado) : 'Pendiente',
    email: t.email_cifrado ? decrypt(t.email_cifrado) : null,
    nombre_cifrado: undefined,
    telefono_cifrado: undefined,
    dni_cifrado: undefined,
    email_cifrado: undefined
  }));

  res.json(turnosDesencriptados);
});

router.patch('/turnos/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  const db = getDb();

  if (!['pendiente', 'confirmado', 'cancelado'].includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  const turno = db.prepare('SELECT * FROM turnos WHERE id = ?').get(id);
  if (!turno) {
    return res.status(404).json({ error: 'Turno no encontrado' });
  }

  const servicio = db.prepare('SELECT * FROM servicios WHERE id = ?').get(turno.servicio_id);

  if (estado === 'cancelado') {
    notificarCancelacion(turno, servicio);
    const calendar = require('../services/calendarService');
    if (calendar.estaHabilitado()) {
      await calendar.cancelarTurnoCalendario(id);
    }
  }

  if (estado === 'confirmado') {
    const calendar = require('../services/calendarService');
    if (calendar.estaHabilitado()) {
      if (!turno.evento_id) {
        const disponibilidad = await calendar.verificarDisponibilidad(turno.fecha, turno.hora, servicio.duracion_min);
        if (!disponibilidad.disponible) {
          return res.status(409).json({ error: 'El horario ya está ocupado en Google Calendar' });
        }
      }
      await calendar.confirmarTurnoCalendario(id);
    }
  }

  db.prepare('UPDATE turnos SET estado = ? WHERE id = ?').run(estado, id);

  auditLogger.registrar(`Turno ${estado}`, auditLogger.TIPOS.TURNO_CONFIRMADO, {
    ip: req.ip,
    usuarioId: req.session.admin.username,
    resultado: 'exitoso',
    datos: { turno_id: id, nuevo_estado: estado }
  });

  res.json({ ok: true });
});

router.get('/disponibilidad', requireAuth, (req, res) => {
  const db = getDb();
  const disponibilidad = db.prepare('SELECT * FROM disponibilidad ORDER BY dia, hora_inicio').all();
  res.json(disponibilidad);
});

router.post('/disponibilidad', requireAuth, (req, res) => {
  const { lista } = req.body;
  const db = getDb();

  if (!Array.isArray(lista)) {
    return res.status(400).json({ error: 'Formato inválido' });
  }

  transaction(() => {
    db.prepare('DELETE FROM disponibilidad').run();
    const insert = db.prepare('INSERT INTO disponibilidad (dia, hora_inicio, hora_fin) VALUES (?, ?, ?)');
    for (const f of lista) {
      insert.run(f.dia, f.hora_inicio, f.hora_fin);
    }
  });

  auditLogger.registrar('Disponibilidad actualizada', auditLogger.TIPOS.TURNO_CONFIRMADO, {
    ip: req.ip,
    usuarioId: req.session.admin.username,
    resultado: 'exitoso'
  });

  res.json({ ok: true });
});

router.get('/pagos', requireAuth, (req, res) => {
  const db = getDb();
  const pagos = db.prepare(`
    SELECT pg.*, t.fecha, t.hora, s.nombre as servicio
    FROM pagos pg
    LEFT JOIN turnos t ON t.id = pg.turno_id
    LEFT JOIN servicios s ON s.id = t.servicio_id
    ORDER BY pg.fecha_creacion DESC
  `).all();

  res.json(pagos);
});

router.get('/audit-log', requireAuth, (req, res) => {
  const { limite = 100, tipo, desde, hasta } = req.query;
  const { consultar } = require('../services/auditLogger');
  const logs = consultar({ tipo, desde, hasta }, parseInt(limite, 10));
  res.json(logs);
});

router.get('/estadisticas', requireAuth, (req, res) => {
  const db = getDb();
  const stats = {
    turnos: {
      total: db.prepare('SELECT COUNT(*) as c FROM turnos').get().c,
      pendientes: db.prepare("SELECT COUNT(*) as c FROM turnos WHERE estado = 'pendiente_verificacion'").get().c,
      confirmados: db.prepare("SELECT COUNT(*) as c FROM turnos WHERE estado = 'confirmado'").get().c,
      cancelados: db.prepare("SELECT COUNT(*) as c FROM turnos WHERE estado = 'cancelado'").get().c
    },
    pagos: {
      total: db.prepare('SELECT COUNT(*) as c FROM pagos').get().c,
      confirmados: db.prepare("SELECT COUNT(*) as c FROM pagos WHERE estado = 'confirmado'").get().c,
      montoTotal: db.prepare("SELECT COALESCE(SUM(monto), 0) as total FROM pagos WHERE estado = 'confirmado'").get().total
    },
    pacientes: db.prepare('SELECT COUNT(*) as c FROM pacientes').get().c
  };

  res.json(stats);
});

module.exports = router;
