# Psicóloga Marcela Rolón - Sistema de Turnos Seguro

Sistema web profesional para la **Lic. Marcela Rolón** (Psicóloga Clínica Gestalt, Mat. 3204).
Sistema de reserva de turnos con pagos online, verificación de identidad 

## 🔒 Características de Seguridad

### Protección de Datos
- ✅ **Cifrado AES-256-GCM** para datos sensibles (DNI, teléfono, email) en reposo
- ✅ **Hash HMAC** para búsquedas sin descifrar



### Autenticación y Control de Acceso
- ✅ **Argon2id** para hash de contraseñas (no bcrypt)
- ✅ **2FA con TOTP** (Google Authenticator) obligatorio para admin
- ✅ **RBAC** (Control de acceso basado en roles)
- ✅ **Sesiones con timeout** (30 minutos de inactividad)

### Protección Anti-Bot
- ✅ **Cloudflare Turnstile** en formularios públicos
- ✅ **Rate limiting** por IP y por teléfono
- ✅ **Verificación OTP** (SMS vía Twilio) antes de confirmar turno
- ✅ **Honeypot** en formularios

### Seguridad Web
- ✅ **Helmet** con CSP, HSTS, X-Frame-Options, etc.
- ✅ **Cookies** httpOnly, Secure, SameSite=Strict
- ✅ **CORS** restrictivo
- ✅ **Validación de inputs** en backend (express-validator)
- ✅ **Consultas parametrizadas** (prevención SQL Injection)
- ✅ **Escapeo de HTML** (prevención XSS)

### Pagos Seguros
- ✅ **Mercado Pago** con validación de firma de webhook
- ✅ **PayPal** con verificación de webhook
- ✅ **Idempotencia** en pagos (no duplicados)
- ✅ **Confirmación server-to-server** del estado del pago
- ✅ **Endpoint de webhook aislado** sin lógica de negocio

### Auditoría y Monitoreo
- ✅ **Log de auditoría** en base de datos y archivos
- ✅ **Detección de anomalías** (múltiples intentos fallidos)
- ✅ **Backups cifrados** automáticos
- ✅ **Sin logs de datos sensibles** (DNI, tokens enmascarados)

## 🚀 Inicio Rápido

### Requisitos
- Node.js 
- Cuenta de Twilio (para OTP)
- Cuenta de Mercado Pago y/o PayPal
- Cuenta de Google Cloud (Calendar API)
- Cuenta de Telegram (para notificaciones)
- Cuenta de Cloudflare (Turnstile)

### Instalación

```bash
# Clonar e instalar
cd psicologa-marcela
npm install

# Configurar variables de entorno
cp .env.example .env.local
# Editar .env.local con tus credenciales

# Generar clave de cifrado
npm run generate-key
# Copiar el resultado en ENCRYPTION_KEY de .env.local

# Ejecutar
npm start
```

### Primer Inicio

Al iniciar por primera vez, se crea un admin inicial:
- Usuario: `marcela` (o el configurado en ADMIN_USER)
- Contraseña: `Cambiar123!` (CAMBIAR INMEDIATAMENTE)
- Se muestra el secreto TOTP para Google Authenticator

## 📋 Configuración de Servicios

### Twilio (OTP por SMS)
1. Crear cuenta en [twilio.com](https://www.twilio.com)
2. Obtener Account SID y Auth Token
3. Comprar un número de teléfono
4. (Opcional) Crear Verify Service para OTP más seguro

### Cloudflare Turnstile
1. Ir a [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/)
2. Crear un widget gratuito
3. Obtener Site Key y Secret Key

### Mercado Pago
1. Crear aplicación en [Mercado Pago Developers](https://www.mercadopago.com.ar/developers)
2. Obtener Access Token y Public Key
3. Configurar webhook URL: `https://tudominio.com/webhooks/mercadopago`

### PayPal
1. Crear aplicación en [PayPal Developer](https://developer.paypal.com)
2. Obtener Client ID y Secret
3. Configurar webhook para eventos de pago

### Google Calendar
1. Crear proyecto en [Google Cloud Console](https://console.cloud.google.com)
2. Habilitar Calendar API
3. Crear credenciales OAuth2
4. Obtener Refresh Token

### Telegram Bot
1. Crear bot con @BotFather
2. Obtener token del bot
3. Enviar un mensaje al bot
4. Visitar: `https://api.telegram.org/bot<TOKEN>/getUpdates` para obtener chat_id

## 📁 Estructura del Proyecto

```
psicologa-marcela/
├── servidor/
│   ├── index.js                 # Entry point
│   ├── config/
│   │   ├── index.js             # Configuración central
│   │   └── encryption.js        # AES-256-GCM
│   ├── middlewares/
│   │   ├── auth.js              # Autenticación + TOTP
│   │   ├── security.js          # Headers Helmet
│   │   ├── rateLimit.js         # Rate limiting
│   │   ├── validator.js         # Validación inputs
│   │   └── turnstile.js         # Cloudflare Turnstile
│   ├── routes/
│   │   ├── public.js            # API pública
│   │   ├── admin.js             # API admin
│   │   └── webhooks.js          # Webhooks de pago
│   ├── services/
│   │   ├── mercadoPagoService.js # MP seguro
│   │   ├── paypalService.js     # PayPal seguro
│   │   ├── otpService.js        # OTP Twilio
│   │   ├── calendarService.js   # Google Calendar
│   │   ├── telegramService.js   # Telegram
│   │   └── auditLogger.js       # Auditoría
│   └── models/
│       └── db.js                # Base de datos
├── vistas/
│   ├── index.html
│   ├── servicios.html
│   ├── reserva.html             # Con Turnstile
│   ├── contacto.html
│   └── admin/
│       ├── login.html           # Con 2FA
│       └── panel.html
├── estilos/
│   ├── base.css
│   ├── componentes.css
│   ├── layout.css
│   ├── reserva.css
│   └── admin.css
├── scripts-js/
│   ├── main.js
│   ├── reserva.js
│   └── admin.js
├── scripts/
│   ├── backup.sh                # Backup cifrado
│   └── audit.sh                 # Auditoría
├── logs/                        # Ignorado en git
├── backups/                     # Ignorado en git
├── .env.example                 # Template
├── .gitignore
├── package.json
└── README.md
```

## 🔐 Checklist de Seguridad

| Requisito | Estado | Ubicación |
|-----------|--------|-----------|
| Validar firma webhook MP | ✅ | `mercadoPagoService.js` |
| Confirmar pago server-to-server | ✅ | `confirmarPago()` |
| Idempotencia en pagos | ✅ | UNIQUE constraint + verificación |
| Logging de webhooks | ✅ | `auditLogger.js` |
| DNI + Teléfono requeridos | ✅ | `validarPaciente` |
| OTP por SMS | ✅ | `otpService.js` (Twilio) |
| Expiración OTP (5 min) | ✅ | Campo `fecha_expiracion` |
| Límite intentos OTP | ✅ | Máximo 5 intentos |
| Expiración reservas (15 min) | ✅ | Cron job |
| Credenciales en .env | ✅ | `config/index.js` |
| Llamadas API server-side | ✅ | Todos los services |
| Turnstile anti-bot | ✅ | `turnstile.js` |
| Rate limiting | ✅ | `rateLimit.js` |
| HTTPS + HSTS | ✅ | `security.js` (Helmet) |
| CSP Headers | ✅ | `security.js` |
| Sanitización inputs | ✅ | `validator.js` |
| Consultas parametrizadas | ✅ | `db.js` |
| Cookies seguras | ✅ | `index.js` |
| Argon2id para passwords | ✅ | `auth.js` |
| TOTP 2FA admin | ✅ | `auth.js` |
| RBAC | ✅ | `requireRole()` |
| Sesión timeout | ✅ | `maxAge` cookie |
| AES-256-GCM en reposo | ✅ | `encryption.js` |
| Minimización datos | ✅ | Formularios |
| Consentimiento explícito | ✅ | Checkbox en reserva |
| Transacciones BD | ✅ | `transaction().immediate()` |
| Sincronización Calendar | ✅ | `calendarService.js` |
| Audit logging | ✅ | `auditLogger.js` |
| Sin datos sensibles en logs | ✅ | `maskSensitive()` |
| Backups cifrados | ✅ | `backup.sh` |
| Manejo de errores seguro | ✅ | `errorHandler` |

## ⚖️ Cumplimiento Legal (Argentina)

- **Ley 25.326** - Protección de Datos Personales
  - Consentimiento informado
  - Finalidad limitada (solo gestión de turnos)
  - Seguridad de los datos (cifrado + controles)
  - Derecho de acceso y eliminación

## 📞 Soporte

Para consultas sobre el sistema o configuración, contactar al desarrollador.

---

**Nota**: Este sistema está diseñado con seguridad en profundidad. Mantené las dependencias actualizadas con `npm audit` y ejecutá `npm run audit` regularmente.
