// =============================================================================
// servidor/services/telegramService.js - Notificaciones por Telegram
// =============================================================================

const TelegramBot = require('telegram-bot-api');
const config = require('../config');
const auditLogger = require('./auditLogger');

let bot = null;

function getBot() {
  if (!bot && config.telegram.botToken) {
    try {
      bot = new TelegramBot({
        token: config.telegram.botToken,
        polling: false
      });
    } catch (error) {
      console.error('Error inicializando bot de Telegram:', error.message);
    }
  }
  return bot;
}

function estaHabilitado() {
  return !!(config.telegram.botToken && config.telegram.chatId);
}

async function enviarMensaje(mensaje) {
  const client = getBot();
  if (!client || !config.telegram.chatId) {
    return { success: false, razon: 'Telegram no configurado' };
  }

  try {
    await client.sendMessage({
      chat_id: config.telegram.chatId,
      text: mensaje,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });

    return { success: true };
  } catch (error) {
    auditLogger.registrar('Error enviando mensaje Telegram', auditLogger.TIPOS.ERROR_SISTEMA, {
      resultado: 'error',
      datos: { error: error.message }
    });
    return { success: false, error: error.message };
  }
}

async function notificarNuevoTurno(turno, servicio, paciente) {
  const [a, m, d] = turno.fecha.split('-');

  const mensaje = `<b>🔔 Nuevo turno solicitado</b>\n\n` +
    `📅 <b>Fecha:</b> ${d}/${m}/${a} ${turno.hora}\n` +
    `🦷 <b>Servicio:</b> ${servicio?.nombre || 'Consulta'}\n` +
    `👤 <b>Paciente:</b> ${paciente?.nombre || 'No verificado'}\n` +
    `📞 <b>Teléfono:</b> ${paciente?.telefono || 'Pendiente'}\n` +
    `💰 <b>Monto:</b> $${servicio?.precio || 0}\n\n` +
    `Usá <b>/turnos</b> para ver los pendientes`;

  return enviarMensaje(mensaje);
}

async function notificarPagoConfirmado(turno, pago, servicio) {
  const [a, m, d] = turno.fecha.split('-');

  const mensaje = `<b>💰 Pago confirmado</b>\n\n` +
    `📅 <b>Fecha:</b> ${d}/${m}/${a} ${turno.hora}\n` +
    `🦷 <b>Servicio:</b> ${servicio?.nombre || 'Consulta'}\n` +
    `💳 <b>Proveedor:</b> ${pago.proveedor}\n` +
    `💰 <b>Monto:</b> $${pago.monto}\n` +
    `🆔 <b>Payment ID:</b> <code>${pago.payment_id.slice(-8)}</code>`;

  return enviarMensaje(mensaje);
}

async function notificarCancelacion(turno, servicio) {
  const [a, m, d] = turno.fecha.split('-');

  const mensaje = `<b>🚫 Turno cancelado</b>\n\n` +
    `📅 <b>Fecha:</b> ${d}/${m}/${a} ${turno.hora}\n` +
    `🦷 <b>Servicio:</b> ${servicio?.nombre || 'Consulta'}\n` +
    `🆔 <b>Turno ID:</b> ${turno.id}`;

  return enviarMensaje(mensaje);
}

async function enviarResumenDiario(turnos) {
  if (!turnos || turnos.length === 0) return;

  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  const fecha = manana.toISOString().split('T')[0];

  let mensaje = `<b>📋 Turnos para mañana (${fecha})</b>\n\n`;

  turnos.forEach(t => {
    const estado = t.estado === 'confirmado' ? '✅' : '⏳';
    mensaje += `${estado} <b>${t.hora}</b> - ${t.servicio} - ${t.nombre}\n`;
  });

  return enviarMensaje(mensaje);
}

module.exports = {
  getBot,
  estaHabilitado,
  enviarMensaje,
  notificarNuevoTurno,
  notificarPagoConfirmado,
  notificarCancelacion,
  enviarResumenDiario
};
