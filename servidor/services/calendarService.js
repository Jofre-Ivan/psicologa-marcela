// =============================================================================
// servidor/services/calendarService.js - Google Calendar (server-side)
// =============================================================================

const { google } = require('googleapis');
const config = require('../config');
const auditLogger = require('./auditLogger');
const { getDb, transaction } = require('../models/db');
const { decrypt } = require('../config/encryption');

const TIMEZONE = 'America/Argentina/Cordoba';
const ZONA_OFFSET = '-03:00';

let authClient = null;
let calendarClient = null;

function getAuthClient() {
  if (!authClient && config.google.clientId && config.google.clientSecret) {
    authClient = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      `${config.urlBase}/auth/google/callback`
    );

    if (config.google.refreshToken) {
      authClient.setCredentials({ refresh_token: config.google.refreshToken });
    }
  }
  return authClient;
}

function getCalendarClient() {
  if (!calendarClient) {
    const auth = getAuthClient();
    if (auth) {
      calendarClient = google.calendar({ version: 'v3', auth });
    }
  }
  return calendarClient;
}

function estaHabilitado() {
  return !!(config.google.clientId && config.google.clientSecret && config.google.refreshToken);
}

// Devuelve el nombre del paciente, descifrando si viene de la base de datos
function nombrePaciente(paciente) {
  if (!paciente) return 'Paciente';
  if (paciente.nombre_cifrado) {
    try {
      const nombre = decrypt(paciente.nombre_cifrado);
      return nombre || 'Paciente';
    } catch (e) {
      return 'Paciente';
    }
  }
  return paciente.nombre || 'Paciente';
}

function construirEvento(turno, servicio, paciente, { tentativo }) {
  const fechaInicio = new Date(`${turno.fecha}T${turno.hora}:00${ZONA_OFFSET}`);
  const fechaFin = new Date(fechaInicio.getTime() + (servicio?.duracion_min || 50) * 60000);
  const nombre = nombrePaciente(paciente);

  return {
    summary: tentativo ? `⏳ Pendiente - ${nombre}` : `Sesión - ${nombre}`,
    description: `Servicio: ${servicio?.nombre || 'Consulta'}\nEstado: ${tentativo ? 'pendiente' : turno.estado}\nTurno ID: ${turno.id}`,
    start: {
      dateTime: fechaInicio.toISOString(),
      timeZone: TIMEZONE
    },
    end: {
      dateTime: fechaFin.toISOString(),
      timeZone: TIMEZONE
    },
    reminders: tentativo
      ? { useDefault: false }
      : {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 60 },
            { method: 'popup', minutes: 15 }
          ]
        },
    colorId: tentativo ? '5' : '2'
  };
}

async function verificarDisponibilidad(fecha, hora, duracionMin = 50) {
  const calendar = getCalendarClient();
  if (!calendar) return { disponible: true, razon: 'Calendar no configurado' };

  try {
    const fechaInicio = new Date(`${fecha}T${hora}:00${ZONA_OFFSET}`);
    const fechaFin = new Date(fechaInicio.getTime() + duracionMin * 60000);

    const response = await calendar.events.list({
      calendarId: config.google.calendarId,
      timeMin: fechaInicio.toISOString(),
      timeMax: fechaFin.toISOString(),
      singleEvents: true,
      maxResults: 10
    });

    const eventos = response.data.items || [];
    const hayConflicto = eventos.some(e => {
      const inicio = new Date(e.start.dateTime || e.start.date);
      const fin = new Date(e.end.dateTime || e.end.date);
      return inicio < fechaFin && fin > fechaInicio;
    });

    return {
      disponible: !hayConflicto,
      eventos: eventos.length
    };
  } catch (error) {
    auditLogger.registrar('Error verificando Calendar', auditLogger.TIPOS.ERROR_SISTEMA, {
      resultado: 'error',
      datos: { error: error.message }
    });
    return { disponible: true, razon: 'Error en consulta' };
  }
}

async function crearEventoTentativo(turno, servicio, paciente) {
  const calendar = getCalendarClient();
  if (!calendar) return { success: false, razon: 'Calendar no configurado' };

  try {
    const evento = construirEvento(turno, servicio, paciente, { tentativo: true });

    const response = await calendar.events.insert({
      calendarId: config.google.calendarId,
      resource: evento
    });

    auditLogger.registrar('Evento tentativo creado en Calendar', auditLogger.TIPOS.TURNO_CREADO, {
      resultado: 'exitoso',
      datos: { turno_id: turno.id, event_id: response.data.id }
    });

    return { success: true, eventId: response.data.id };
  } catch (error) {
    auditLogger.registrar('Error creando evento tentativo Calendar', auditLogger.TIPOS.ERROR_SISTEMA, {
      resultado: 'error',
      datos: { error: error.message }
    });
    return { success: false, error: error.message };
  }
}

async function crearEvento(turno, servicio, paciente) {
  // Si el turno ya tiene evento, lo actualizamos (ej: pendiente -> confirmado)
  if (turno.evento_id) {
    return actualizarEvento(turno.evento_id, turno, servicio, paciente);
  }

  const calendar = getCalendarClient();
  if (!calendar) return { success: false, razon: 'Calendar no configurado' };

  try {
    const evento = construirEvento(turno, servicio, paciente, { tentativo: false });

    const response = await calendar.events.insert({
      calendarId: config.google.calendarId,
      resource: evento
    });

    auditLogger.registrar('Evento creado en Calendar', auditLogger.TIPOS.TURNO_CONFIRMADO, {
      resultado: 'exitoso',
      datos: { turno_id: turno.id, event_id: response.data.id }
    });

    return { success: true, eventId: response.data.id };
  } catch (error) {
    auditLogger.registrar('Error creando evento Calendar', auditLogger.TIPOS.ERROR_SISTEMA, {
      resultado: 'error',
      datos: { error: error.message }
    });
    return { success: false, error: error.message };
  }
}

async function actualizarEvento(eventoId, turno, servicio, paciente) {
  const calendar = getCalendarClient();
  if (!calendar) return { success: false, razon: 'Calendar no configurado' };

  try {
    const evento = construirEvento(turno, servicio, paciente, { tentativo: false });

    const response = await calendar.events.patch({
      calendarId: config.google.calendarId,
      eventId: eventoId,
      resource: {
        summary: evento.summary,
        description: evento.description,
        reminders: evento.reminders,
        colorId: evento.colorId
      }
    });

    auditLogger.registrar('Evento actualizado en Calendar', auditLogger.TIPOS.TURNO_CONFIRMADO, {
      resultado: 'exitoso',
      datos: { turno_id: turno.id, event_id: response.data.id }
    });

    return { success: true, eventId: response.data.id };
  } catch (error) {
    auditLogger.registrar('Error actualizando evento Calendar', auditLogger.TIPOS.ERROR_SISTEMA, {
      resultado: 'error',
      datos: { error: error.message, event_id: eventoId }
    });
    return { success: false, error: error.message };
  }
}

async function eliminarEvento(eventoId) {
  const calendar = getCalendarClient();
  if (!calendar) return { success: false };

  try {
    await calendar.events.delete({
      calendarId: config.google.calendarId,
      eventId: eventoId
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Promueve un turno a confirmado en Calendar (usa el evento tentativo si existe,
 * sino crea el evento). Devuelve el evento guardado en la base.
 */
async function confirmarTurnoCalendario(turnoId) {
  if (!estaHabilitado()) return { success: false, razon: 'Calendar no configurado' };
  const db = getDb();

  const turno = db.prepare('SELECT * FROM turnos WHERE id = ?').get(turnoId);
  if (!turno) return { success: false, error: 'Turno no encontrado' };

  const servicio = db.prepare('SELECT * FROM servicios WHERE id = ?').get(turno.servicio_id);
  const paciente = turno.paciente_id
    ? db.prepare('SELECT * FROM pacientes WHERE id = ?').get(turno.paciente_id)
    : null;

  if (turno.evento_id) {
    return actualizarEvento(turno.evento_id, turno, servicio, paciente);
  }

  const resultado = await crearEvento(turno, servicio, paciente);
  if (resultado.success) {
    db.prepare('UPDATE turnos SET evento_id = ? WHERE id = ?').run(resultado.eventId, turnoId);
  }
  return resultado;
}

/**
 * Elimina el evento de Calendar de un turno y libera el horario.
 */
async function cancelarTurnoCalendario(turnoId) {
  if (!estaHabilitado()) return { success: false, razon: 'Calendar no configurado' };
  const db = getDb();

  const turno = db.prepare('SELECT evento_id FROM turnos WHERE id = ?').get(turnoId);
  if (!turno || !turno.evento_id) return { success: false, error: 'Sin evento vinculado' };

  const resultado = await eliminarEvento(turno.evento_id);
  if (resultado.success) {
    db.prepare('UPDATE turnos SET evento_id = NULL WHERE id = ?').run(turnoId);
  }
  return resultado;
}

async function listarEventos(fechaInicio, fechaFin) {
  const calendar = getCalendarClient();
  if (!calendar) return [];

  try {
    const response = await calendar.events.list({
      calendarId: config.google.calendarId,
      timeMin: fechaInicio.toISOString(),
      timeMax: fechaFin.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });

    return response.data.items || [];
  } catch (error) {
    return [];
  }
}

// -----------------------------------------------------------------------------
// Sincronización Google Calendar -> tabla bloqueos_calendar
// -----------------------------------------------------------------------------

function formatearFechaLocal(d) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const get = (t) => partes.find(p => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function formatearHoraLocal(d) {
  let hora = new Intl.DateTimeFormat('es-AR', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(d);
  hora = hora.replace('24:', '00:');
  return hora;
}

/**
 * Trae los eventos del calendario (próximos `dias`) y refleja en la base de
 * datos los horarios ocupados. Es la fuente de verdad para los turnos que la
 * profesional carga manualmente (WhatsApp, bloqueos, feriados).
 */
async function sincronizarBloqueos(dias = 90) {
  const calendar = getCalendarClient();
  if (!calendar) return { ok: false, razon: 'Calendar no configurado' };
  const db = getDb();

  try {
    const hoy = new Date();
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const fin = new Date(inicio.getTime() + dias * 86400000);
    fin.setHours(23, 59, 59, 999);

    const response = await calendar.events.list({
      calendarId: config.google.calendarId,
      timeMin: inicio.toISOString(),
      timeMax: fin.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 500
    });

    const eventos = response.data.items || [];

    const filas = eventos.map(e => {
      const esTodoDia = !!(e.start && e.start.date && !e.start.dateTime);

      if (esTodoDia) {
        return {
          evento_id: e.id,
          fecha: e.start.date,
          hora_inicio: '00:00',
          hora_fin: '23:59',
          todo_dia: 1,
          titulo: e.summary || null
        };
      }

      const ini = new Date(e.start.dateTime);
      const term = new Date(e.end.dateTime);

      return {
        evento_id: e.id,
        fecha: formatearFechaLocal(ini),
        hora_inicio: formatearHoraLocal(ini),
        hora_fin: formatearHoraLocal(term),
        todo_dia: 0,
        titulo: e.summary || null
      };
    });

    transaction(() => {
      db.prepare('DELETE FROM bloqueos_calendar').run();
      const insert = db.prepare(`
        INSERT INTO bloqueos_calendar (evento_id, fecha, hora_inicio, hora_fin, todo_dia, titulo)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const f of filas) {
        insert.run(f.evento_id, f.fecha, f.hora_inicio, f.hora_fin, f.todo_dia, f.titulo);
      }
    });

    return { ok: true, cantidad: filas.length };
  } catch (error) {
    auditLogger.registrar('Error sincronizando Calendar', auditLogger.TIPOS.ERROR_SISTEMA, {
      resultado: 'error',
      datos: { error: error.message }
    });
    return { ok: false, error: error.message };
  }
}

module.exports = {
  estaHabilitado,
  verificarDisponibilidad,
  crearEvento,
  crearEventoTentativo,
  actualizarEvento,
  eliminarEvento,
  confirmarTurnoCalendario,
  cancelarTurnoCalendario,
  listarEventos,
  sincronizarBloqueos
};
