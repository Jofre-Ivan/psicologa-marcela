// =============================================================================
// servidor/routes/public.js - Rutas públicas (API de turnos, OTP, servicios)
// =============================================================================

const express = require('express');
const router = express.Router();
const { getDb, transaction } = require('../models/db');
const { encrypt, hashForSearch } = require('../config/encryption');
const { enviarOTP, verificarOTP } = require('../services/otpService');
const { turnosLimiter, otpLimiter } = require('../middlewares/rateLimit');
const auditLogger = require('../services/auditLogger');

const PRECIOS = {
  apross: 16000,
  particular: 35000
};

router.get('/servicios', (req, res) => {
  const db = getDb();
  const servicios = db.prepare('SELECT id, nombre, slug, duracion_min, descripcion FROM servicios WHERE activo = 1').all();
  res.json(servicios);
});

router.get('/disponibilidad', (req, res) => {
  const db = getDb();
  const { mes, servicioId } = req.query;

  if (!mes || !servicioId) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  if (!/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ error: 'Formato de mes inválido' });
  }

  const [anio, mesNum] = mes.split('-').map(Number);
  const servicio = db.prepare('SELECT * FROM servicios WHERE id = ?').get(servicioId);
  if (!servicio) {
    return res.status(404).json({ error: 'Servicio no encontrado' });
  }

  const ultimoDia = new Date(anio, mesNum, 0).getDate();
  const hoy = new Date();
  const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

  const turnosExistentes = db.prepare(`
    SELECT fecha, hora FROM turnos
    WHERE fecha LIKE ? AND estado IN ('pendiente_verificacion', 'confirmado', 'pendiente_pago')
  `).all(`${mes}-%`);

  const ocupadosPorFecha = {};
  turnosExistentes.forEach(t => {
    if (!ocupadosPorFecha[t.fecha]) ocupadosPorFecha[t.fecha] = [];
    ocupadosPorFecha[t.fecha].push({ hora: t.hora, duracion: servicio.duracion_min });
  });

  const bloqueos = db.prepare(`
    SELECT fecha, hora_inicio, hora_fin FROM bloqueos_calendar
    WHERE fecha LIKE ? AND fecha >= ?
  `).all(`${mes}-%`, hoyStr);

  bloqueos.forEach(b => {
    if (!ocupadosPorFecha[b.fecha]) ocupadosPorFecha[b.fecha] = [];
    const [hIni, mIni] = b.hora_inicio.split(':').map(Number);
    const [hFin, mFin] = b.hora_fin.split(':').map(Number);
    ocupadosPorFecha[b.fecha].push({
      hora: b.hora_inicio,
      duracion: (hFin * 60 + mFin) - (hIni * 60 + mIni)
    });
  });

  const conCupo = [];
  for (let d = 1; d <= ultimoDia; d++) {
    const fecha = `${anio}-${String(mesNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (fecha < hoyStr) continue;

    const dia = new Date(`${fecha}T00:00:00`).getDay();
    if (dia === 0 || dia === 6) continue;

    const rangos = db.prepare('SELECT hora_inicio, hora_fin FROM disponibilidad WHERE dia = ?').all(dia);
    if (rangos.length === 0) continue;

    let tieneCupo = false;
    for (const r of rangos) {
      const [hIni, mIni] = r.hora_inicio.split(':').map(Number);
      const [hFin, mFin] = r.hora_fin.split(':').map(Number);
      const inicioMin = hIni * 60 + mIni;
      const finMin = hFin * 60 + mFin;

      for (let m = inicioMin; m + servicio.duracion_min <= finMin; m += 30) {
        const hora = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const ocupados = ocupadosPorFecha[fecha] || [];
        const finActual = m + servicio.duracion_min;

        const solapado = ocupados.some(o => {
          const [oH, oM] = o.hora.split(':').map(Number);
          const oInicio = oH * 60 + oM;
          const oFin = oInicio + o.duracion;
          return m < oFin && finActual > oInicio;
        });

        if (!solapado) {
          tieneCupo = true;
          break;
        }
      }
      if (tieneCupo) break;
    }

    if (tieneCupo) conCupo.push(d);
  }

  res.json(conCupo);
});

router.get('/horarios', (req, res) => {
  const db = getDb();
  const { fecha, servicioId } = req.query;

  if (!fecha || !servicioId) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'Formato de fecha inválido' });
  }

  const servicio = db.prepare('SELECT * FROM servicios WHERE id = ?').get(servicioId);
  if (!servicio) {
    return res.status(404).json({ error: 'Servicio no encontrado' });
  }

  const hoy = new Date();
  const fechaTurno = new Date(`${fecha}T00:00:00`);
  if (fechaTurno < hoy) return res.json([]);

  const dia = fechaTurno.getDay();
  if (dia === 0 || dia === 6) return res.json([]);

  const rangos = db.prepare('SELECT hora_inicio, hora_fin FROM disponibilidad WHERE dia = ?').all(dia);
  if (rangos.length === 0) return res.json([]);

  const ocupados = db.prepare(`
    SELECT hora FROM turnos
    WHERE fecha = ? AND estado IN ('pendiente_verificacion', 'confirmado', 'pendiente_pago')
  `).all(fecha).map(t => {
    const [h, m] = t.hora.split(':').map(Number);
    return { inicio: h * 60 + m, fin: h * 60 + m + servicio.duracion_min };
  });

  const bloqueos = db.prepare(`
    SELECT hora_inicio, hora_fin FROM bloqueos_calendar WHERE fecha = ?
  `).all(fecha).map(b => {
    const [hI, mI] = b.hora_inicio.split(':').map(Number);
    const [hF, mF] = b.hora_fin.split(':').map(Number);
    return { inicio: hI * 60 + mI, fin: hF * 60 + mF };
  });

  ocupados.push(...bloqueos);

  const libres = [];
  for (const r of rangos) {
    const [hIni, mIni] = r.hora_inicio.split(':').map(Number);
    const [hFin, mFin] = r.hora_fin.split(':').map(Number);
    const inicioMin = hIni * 60 + mIni;
    const finMin = hFin * 60 + mFin;

    for (let m = inicioMin; m + servicio.duracion_min <= finMin; m += 30) {
      const finActual = m + servicio.duracion_min;
      const solapado = ocupados.some(o => m < o.fin && finActual > o.inicio);
      if (!solapado) {
        libres.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
      }
    }
  }

  res.json(libres);
});

router.post('/otp/solicitar', otpLimiter, async (req, res) => {
  const { telefono } = req.body;

  if (!telefono || !/^\+?[\d\s-]{10,18}$/.test(telefono)) {
    return res.status(400).json({ error: 'Teléfono inválido' });
  }

  const resultado = await enviarOTP(telefono);

  if (resultado.success) {
    res.json({ message: resultado.message || 'Código enviado' });
  } else {
    res.status(429).json({ error: resultado.error });
  }
});

router.post('/otp/verificar', otpLimiter, async (req, res) => {
  const { telefono, codigo } = req.body;

  if (!telefono || !codigo || !/^\d{6}$/.test(codigo)) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }

  const resultado = await verificarOTP(telefono, codigo);

  if (resultado.success) {
    res.json({ verified: true });
  } else {
    res.status(400).json({ error: resultado.error });
  }
});

router.post('/turnos', turnosLimiter, async (req, res) => {
  const { servicioId, tipoCobertura, fecha, hora } = req.body;
  const ip = req.ip || req.headers['x-forwarded-for'];

  if (!servicioId || !fecha || !hora || !tipoCobertura) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'Fecha inválida' });
  }

  if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(hora)) {
    return res.status(400).json({ error: 'Hora inválida' });
  }

  if (!['apross', 'particular'].includes(tipoCobertura)) {
    return res.status(400).json({ error: 'Tipo de cobertura inválido' });
  }

  const db = getDb();
  const servicio = db.prepare('SELECT * FROM servicios WHERE id = ?').get(servicioId);
  if (!servicio) {
    return res.status(404).json({ error: 'Servicio no encontrado' });
  }

  const monto = PRECIOS[tipoCobertura];
  const expiracion = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // Verificación local contra bloqueos de Google Calendar (funciona aunque Google esté caído)
  const [hReserva, mReserva] = hora.split(':').map(Number);
  const inicioReserva = hReserva * 60 + mReserva;
  const finReserva = inicioReserva + servicio.duracion_min;

  const bloqueoLocal = db.prepare(`
    SELECT 1 FROM bloqueos_calendar WHERE fecha = ?
    AND (CAST(substr(hora_inicio, 1, 2) AS INTEGER) * 60 + CAST(substr(hora_inicio, 4, 2) AS INTEGER)) < ?
    AND (CAST(substr(hora_fin, 1, 2) AS INTEGER) * 60 + CAST(substr(hora_fin, 4, 2) AS INTEGER)) > ?
  `).get(fecha, finReserva, inicioReserva);

  if (bloqueoLocal) {
    return res.status(409).json({ error: 'Ese horario ya está ocupado' });
  }

  const calendarService = require('../services/calendarService');
  if (calendarService.estaHabilitado()) {
    const disponibilidad = await calendarService.verificarDisponibilidad(fecha, hora, servicio.duracion_min);
    if (disponibilidad.disponible === false) {
      return res.status(409).json({ error: 'Ese horario ya está ocupado' });
    }
  }

  try {
    const turnoId = transaction(() => {
      const existente = db.prepare(`
        SELECT id FROM turnos
        WHERE fecha = ? AND hora = ? AND servicio_id = ?
        AND estado IN ('pendiente_verificacion', 'confirmado', 'pendiente_pago')
      `).get(fecha, hora, servicioId);

      if (existente) {
        throw new Error('HORARIO_OCUPADO');
      }

      const result = db.prepare(`
        INSERT INTO turnos (paciente_id, servicio_id, tipo_cobertura, monto, fecha, hora, estado, fecha_expiracion)
        VALUES (NULL, ?, ?, ?, ?, ?, 'pendiente_verificacion', ?)
      `).run(servicioId, tipoCobertura, monto, fecha, hora, expiracion);

      return result.lastInsertRowid;
    });

    // Reserva tentativa en Google Calendar para que la profesional la vea al instante
    if (calendarService.estaHabilitado()) {
      const turno = db.prepare('SELECT * FROM turnos WHERE id = ?').get(turnoId);
      const evento = await calendarService.crearEventoTentativo(turno, servicio, null);
      if (evento.success) {
        db.prepare('UPDATE turnos SET evento_id = ? WHERE id = ?').run(evento.eventId, turnoId);
      }
    }

    auditLogger.registrar('Turno creado', auditLogger.TIPOS.TURNO_CREADO, {
      ip,
      resultado: 'exitoso',
      datos: { turno_id: turnoId, tipo_cobertura: tipoCobertura }
    });

    res.status(201).json({
      success: true,
      turnoId,
      message: 'Turno reservado. Verificá tu teléfono para continuar.',
      expiracion
    });
  } catch (error) {
    if (error.message === 'HORARIO_OCUPADO') {
      return res.status(409).json({ error: 'Ese horario ya fue reservado' });
    }
    auditLogger.registrar('Error creando turno', auditLogger.TIPOS.ERROR_SISTEMA, {
      ip,
      resultado: 'error',
      datos: { error: error.message }
    });
    res.status(500).json({ error: 'Error interno' });
  }
});

router.put('/turnos/:id/verificar', turnosLimiter, async (req, res) => {
  const { id } = req.params;
  const { nombre, dni, telefono, email, consentimiento } = req.body;
  const ip = req.ip || req.headers['x-forwarded-for'];

  if (!nombre || nombre.length < 2 || nombre.length > 100) {
    return res.status(400).json({ error: 'Nombre inválido' });
  }

  if (!dni || !/^\d{7,8}$/.test(dni)) {
    return res.status(400).json({ error: 'DNI inválido' });
  }

  if (!telefono || !/^\+?[\d\s-]{10,18}$/.test(telefono)) {
    return res.status(400).json({ error: 'Teléfono inválido' });
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email inválido' });
  }

  if (!consentimiento) {
    return res.status(400).json({ error: 'Debés aceptar la política de privacidad' });
  }

  const db = getDb();
  const turno = db.prepare('SELECT * FROM turnos WHERE id = ?').get(id);

  if (!turno) {
    return res.status(404).json({ error: 'Turno no encontrado' });
  }

  if (turno.estado !== 'pendiente_verificacion') {
    return res.status(400).json({ error: 'El turno no está pendiente de verificación' });
  }

  const dniHash = hashForSearch(dni);
  let paciente = db.prepare('SELECT id FROM pacientes WHERE dni_hash = ?').get(dniHash);

  if (!paciente) {
    const result = db.prepare(`
      INSERT INTO pacientes (dni_hash, dni_cifrado, nombre_cifrado, telefono_cifrado, email_cifrado, consentimiento)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(dniHash, encrypt(dni), encrypt(nombre), encrypt(telefono), email ? encrypt(email) : null);
    paciente = { id: result.lastInsertRowid };
  }

  db.prepare(`UPDATE turnos SET paciente_id = ?, estado = 'pendiente_pago' WHERE id = ?`).run(paciente.id, id);

  const servicio = db.prepare('SELECT * FROM servicios WHERE id = ?').get(turno.servicio_id);

  auditLogger.registrar('Datos verificados', auditLogger.TIPOS.TURNO_CONFIRMADO, {
    ip,
    resultado: 'exitoso',
    datos: { turno_id: id }
  });

  res.json({
    success: true,
    turnoId: id,
    servicio: {
      id: servicio.id,
      nombre: servicio.nombre
    }
  });
});

router.post('/pagos/crear', turnosLimiter, async (req, res) => {
  const { turnoId, proveedor } = req.body;
  const ip = req.ip || req.headers['x-forwarded-for'];

  if (!turnoId || !proveedor) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  if (!['mercadopago', 'paypal'].includes(proveedor)) {
    return res.status(400).json({ error: 'Proveedor no soportado' });
  }

  const db = getDb();
  const turno = db.prepare('SELECT * FROM turnos WHERE id = ?').get(turnoId);

  if (!turno) {
    return res.status(404).json({ error: 'Turno no encontrado' });
  }

  if (turno.estado !== 'pendiente_pago') {
    return res.status(400).json({ error: 'El turno no está listo para pagar' });
  }

  const servicio = db.prepare('SELECT * FROM servicios WHERE id = ?').get(turno.servicio_id);
  const paciente = db.prepare('SELECT * FROM pacientes WHERE id = ?').get(turno.paciente_id);

  try {
    if (proveedor === 'mercadopago') {
      const mpService = require('../services/mercadoPagoService');
      const resultado = await mpService.crearPreferencia(turno, servicio, paciente);

      if (resultado.success) {
        auditLogger.registrar('Preferencia MP creada', auditLogger.TIPOS.PAGO_CREADO, {
          ip,
          resultado: 'exitoso',
          datos: { turno_id: turnoId }
        });
        res.json({ success: true, initPoint: resultado.initPoint });
      } else {
        res.status(500).json({ error: resultado.error });
      }
    } else if (proveedor === 'paypal') {
      const paypalService = require('../services/paypalService');
      const resultado = await paypalService.crearOrden(turno, servicio);

      if (resultado.success) {
        auditLogger.registrar('Orden PayPal creada', auditLogger.TIPOS.PAGO_CREADO, {
          ip,
          resultado: 'exitoso',
          datos: { turno_id: turnoId }
        });
        res.json({ success: true, approveUrl: resultado.approveUrl });
      } else {
        res.status(500).json({ error: resultado.error });
      }
    }
  } catch (error) {
    auditLogger.registrar('Error creando pago', auditLogger.TIPOS.ERROR_SISTEMA, {
      ip,
      resultado: 'error',
      datos: { error: error.message }
    });
    res.status(500).json({ error: 'Error procesando el pago' });
  }
});

module.exports = router;
