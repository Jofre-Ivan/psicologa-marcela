#!/bin/bash
# =============================================================================
# Script de backup cifrado de la base de datos
# Uso: npm run backup
# =============================================================================

set -euo pipefail

# Configuración
DB_PATH="${DB_PATH:-./datos.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
  echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"
}

error() {
  echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1"
  exit 1
}

# Verificar que existe la base de datos
if [ ! -f "$DB_PATH" ]; then
  error "No se encontró la base de datos en $DB_PATH"
fi

# Crear directorio de backups si no existe
mkdir -p "$BACKUP_DIR"

# Nombre del archivo de backup con timestamp
TIMESTAMP=$(date +'%Y%m%d_%H%M%S')
BACKUP_FILE="$BACKUP_DIR/backup_${TIMESTAMP}.db"
ENCRYPTED_FILE="${BACKUP_FILE}.gpg"

log "Iniciando backup de $DB_PATH..."

# Hacer backup con SQLite (consistente)
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

if [ ! -f "$BACKUP_FILE" ]; then
  error "Error creando el backup"
fi

# Cargar el backup para verificar integridad
if sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" | grep -q "ok"; then
  log "Backup verificado: integridad OK"
else
  error "El backup no pasó la verificación de integridad"
fi

# Cifrar el backup si hay clave de cifrado
if [ -n "$ENCRYPTION_KEY" ]; then
  log "Cifrando backup..."
  gpg --symmetric \
    --cipher-algo AES256 \
    --compress-algo 2 \
    --passphrase "$ENCRYPTION_KEY" \
    --batch \
    --yes \
    -o "$ENCRYPTED_FILE" \
    "$BACKUP_FILE"

  if [ -f "$ENCRYPTED_FILE" ]; then
    rm -f "$BACKUP_FILE"
    log "Backup cifrado: $ENCRYPTED_FILE"
  else
    error "Error cifrando el backup"
  fi
else
  warn "BACKUP_ENCRYPTION_KEY no configurada. Backup sin cifrar."
  warn "Para mayor seguridad, configurá la variable de entorno."
fi

# Limpiar backups antiguos
log "Limpiando backups anteriores a $RETENTION_DAYS días..."
find "$BACKUP_DIR" -name "backup_*.db*" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true

# Contar backups existentes
BACKUP_COUNT=$(find "$BACKUP_DIR" -name "backup_*.db*" | wc -l)
log "Backups activos: $BACKUP_COUNT"

log "Backup completado exitosamente"
