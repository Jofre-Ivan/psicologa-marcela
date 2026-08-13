// =============================================================================
// servidor/index.js - Entry point del servidor
// =============================================================================

const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');

const config = require('./config');
const { securityHeaders, securityInfo, preventCache } = require('./middlewares/security');
const { generalLimiter } = require('./middlewares/rateLimit');
const { crearAdminInicial } = require('./middlewares/auth');
const auditLogger = require('./services/auditLogger');
const { getDb } = require('./models/db');

const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const webhookRoutes = require('./routes/webhooks');

const app = express();

app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(securityInfo);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

app.use(session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  name: '__psico_session',
  cookie: {
    secure: config.isProduction,
    httpOnly: true,
    sameSite: 'strict',
    maxAge: config.session.timeoutMin * 60 * 1000,
    path: '/'
  }
}));

app.use((req, res, next) => {
  if (req.session?.admin) {
    req.session.touch();
  }
  next();
});

app.use(generalLimiter);

app.use('/estilos', express.static(path.join(__dirname, '..', 'estilos')));
app.use('/scripts-js', express.static(path.join(__dirname, '..', 'scripts-js')));
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

app.use('/webhooks', webhookRoutes);
app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

const vista = (nombre) => (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'vistas', nombre));
};

app.get('/', vista('index.html'));
app.get('/servicios', vista('servicios.html'));
app.get('/reservar', vista('reserva.html'));
app.get('/contacto', vista('contacto.html'));

app.get('/admin', preventCache, (req, res) => {
  if (req.session && req.session.admin) return res.redirect('/admin/panel');
  res.sendFile(path.join(__dirname, '..', 'vistas', 'admin', 'login.html'));
});

app.get('/admin/panel', preventCache, (req, res) => {
  if (!req.session || !req.session.admin) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, '..', 'vistas', 'admin', 'panel.html'));
});

app.use((req, res) => {
  res.status(404).json({ error: 'No encontrado' });
});

// Errores de parseo en webhooks: se responde 200 para no provocar reintentos en bucle
app.use('/webhooks', (err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large' || err.type === 'entity.verify.failed')) {
    auditLogger.registrar('Webhook: body inválido', auditLogger.TIPOS.WEBHOOK_RECHAZADO, {
      ip: req.ip,
      resultado: 'error',
      datos: { error: err.message }
    });
    return res.json({ received: true });
  }
  next(err);
});

app.use((err, req,res, next) => {
  auditLogger.registrar('Error no manejado', auditLogger.TIPOS.ERROR_SISTEMA, {
    ip: req.ip,
    resultado: 'error',
    datos: { error: err.message, path: req.path }
  });

  if (config.isProduction) {
    res.status(500).json({ error: 'Error interno' });
  } else {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

async function iniciarServidor() {
  try {
    getDb();
    await crearAdminInicial();

    const telegramService = require('./services/telegramService');
    if (telegramService.estaHabilitado()) {
      cron.schedule('0 9 * * *', async () => {
        try {
          const db = getDb();
          const manana = new Date();
          manana.setDate(manana.getDate() + 1);
          const fecha = manana.toISOString().split('T')[0];

          const turnos = db.prepare(`
            SELECT t.*, s.nombre as servicio, p.nombre_cifrado
            FROM turnos t
            LEFT JOIN servicios s ON s.id = t.servicio_id
            LEFT JOIN pacientes p ON p.id = t.paciente_id
            WHERE t.fecha = ? AND t.estado = 'confirmado'
            ORDER BY t.hora
          `).all(fecha);

          const { decrypt } = require('./config/encryption');
          const turnosFormateados = turnos.map(t => ({
            ...t,
            nombre: t.nombre_cifrado ? decrypt(t.nombre_cifrado) : 'Paciente'
          }));

          await telegramService.enviarResumenDiario(turnosFormateados);
        } catch (e) {
          console.error('Error en cron de resumen diario:', e.message);
        }
      });
      console.log('✅ Cron de resumen diario configurado (9 AM)');
    }

    cron.schedule('*/5 * * * *', () => {
      try {
        const db = getDb();
        const expirados = db.prepare(`
          SELECT id, evento_id FROM turnos
          WHERE estado = 'pendiente_verificacion'
          AND fecha_expiracion < datetime('now') AND expirado = 0
        `).all();

        db.prepare(`
          UPDATE turnos SET estado = 'expirado', expirado = 1
          WHERE estado = 'pendiente_verificacion'
          AND fecha_expiracion < datetime('now') AND expirado = 0
        `).run();

        if (expirados.length > 0) {
          const calendar = require('./services/calendarService');
          if (calendar.estaHabilitado()) {
            for (const t of expirados) {
              if (t.evento_id) {
                calendar.cancelarTurnoCalendario(t.id).catch(() => {});
              }
            }
          }
        }
      } catch (e) {
        console.error('Error en cron de expiración:', e.message);
      }
    });

    const calendarService = require('./services/calendarService');
    if (calendarService.estaHabilitado()) {
      cron.schedule('*/3 * * * *', async () => {
        try {
          await calendarService.sincronizarBloqueos();
        } catch (e) {
          console.error('Error en cron de sincronización de Calendar:', e.message);
        }
      });

      calendarService.sincronizarBloqueos().catch(e => {
        console.error('Error en sync inicial de Calendar:', e.message);
      });
      console.log('✅ Sincronización con Google Calendar configurada (cada 3 min)');
    }

    app.listen(config.puerto, () => {
      console.log('═'.repeat(50));
      console.log('🧠 Sitio: Lic. Marcela Rolón - Psicología');
      console.log(`🌐 URL: ${config.urlBase}`);
      console.log(`🔧 Entorno: ${config.env}`);
      console.log('═'.repeat(50));
    });
  } catch (error) {
    console.error('❌ Error iniciando el servidor:', error.message);
    process.exit(1);
  }
}

iniciarServidor();

module.exports = app;
