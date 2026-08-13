#!/bin/bash
# =============================================================================
# Script de auditoría de seguridad
# Uso: npm run audit
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ISSUES=0
WARNINGS=0

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_ok() {
  echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
  ((WARNINGS++))
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
  ((ISSUES++))
}

echo "═══════════════════════════════════════════════════════════════"
echo "  AUDITORÍA DE SEGURIDAD - Psicóloga Marcela Rolón"
echo "  Fecha: $(date)"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# 1. Verificar archivo .env
log_info "Verificando configuración de entorno..."

if [ -f ".env" ] || [ -f ".env.local" ]; then
  if [ -f ".env" ]; then
    log_warn "Archivo .env encontrado (usar .env.local en su lugar)"
  fi

  # Verificar que no haya credenciales hardcodeadas
  if grep -q "ENCRYPTION_KEY=.\{1,\}" .env.local 2>/dev/null; then
    log_ok "ENCRYPTION_KEY configurada"
  else
    log_error "ENCRYPTION_KEY no configurada"
  fi

  if grep -q "SESSION_SECRET=.\{1,\}" .env.local 2>/dev/null; then
    log_ok "SESSION_SECRET configurada"
  else
    log_error "SESSION_SECRET no configurada"
  fi
else
  log_error "No se encontró archivo .env.local"
fi

# 2. Verificar .gitignore
log_info "Verificando .gitignore..."

if [ -f ".gitignore" ]; then
  if grep -q ".env" .gitignore; then
    log_ok ".env está en .gitignore"
  else
    log_error ".env no está en .gitignore"
  fi

  if grep -q "datos.db" .gitignore; then
    log_ok "Base de datos está en .gitignore"
  else
    log_error "Base de datos no está en .gitignore"
  fi

  if grep -q "node_modules" .gitignore; then
    log_ok "node_modules está en .gitignore"
  else
    log_error "node_modules no está en .gitignore"
  fi
else
  log_error "No se encontró .gitignore"
fi

# 3. Verificar dependencias
log_info "Verificando dependencias..."

if [ -f "package.json" ]; then
  # npm audit
  if npm audit --production 2>/dev/null | grep -q "found 0 vulnerabilities"; then
    log_ok "Sin vulnerabilidades conocidas en dependencias"
  else
    log_warn "Hay vulnerabilidades en dependencias - revisar con 'npm audit'"
  fi
else
  log_error "No se encontró package.json"
fi

# 4. Verificar permisos de archivos
log_info "Verificando permisos..."

if [ -f ".env.local" ]; then
  PERMS=$(stat -f "%Lp" ".env.local" 2>/dev/null || stat -c "%a" ".env.local" 2>/dev/null)
  if [ "$PERMS" = "600" ] || [ "$PERMS" = "400" ]; then
    log_ok "Permisos de .env.local correctos ($PERMS)"
  else
    log_warn "Permisos de .env.local: $PERMS (recomendado: 600)"
  fi
fi

# 5. Verificar headers de seguridad en el código
log_info "Verificando implementación de seguridad..."

if grep -q "helmet" servidor/index.js 2>/dev/null; then
  log_ok "Helmet configurado"
else
  log_error "Helmet no configurado"
fi

if grep -q "rateLimit" servidor/index.js 2>/dev/null; then
  log_ok "Rate limiting configurado"
else
  log_error "Rate limiting no configurado"
fi

if grep -q "httpOnly" servidor/index.js 2>/dev/null; then
  log_ok "Cookies httpOnly configuradas"
else
  log_error "Cookies httpOnly no configuradas"
fi

# 6. Verificar cifrado
log_info "Verificando cifrado de datos..."

if grep -q "encrypt" servidor/config/encryption.js 2>/dev/null; then
  log_ok "Módulo de cifrado implementado"
else
  log_error "Módulo de cifrado no implementado"
fi

# 7. Verificar auditoría
log_info "Verificando sistema de auditoría..."

if [ -d "logs" ]; then
  log_ok "Directorio de logs existe"
else
  log_warn "Directorio de logs no existe"
fi

if grep -q "auditLogger" servidor/index.js 2>/dev/null; then
  log_ok "Sistema de auditoría configurado"
else
  log_error "Sistema de auditoría no configurado"
fi

# Resumen
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  RESUMEN"
echo "═══════════════════════════════════════════════════════════════"
echo -e "  Errores:   ${RED}$ISSUES${NC}"
echo -e "  Alertas:   ${YELLOW}$WARNINGS${NC}"
echo "═══════════════════════════════════════════════════════════════"

if [ $ISSUES -gt 0 ]; then
  echo -e "${RED}  ❌ Se encontraron problemas de seguridad${NC}"
  exit 1
else
  echo -e "${GREEN}  ✅ Auditoría completada sin errores críticos${NC}"
  exit 0
fi
