#!/usr/bin/env bash
# deploy.sh — CRM Centro Amalia production deployment helper
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh          # first-time setup + launch
#   ./deploy.sh update   # pull latest, rebuild, restart
#   ./deploy.sh status   # show container status + health
#   ./deploy.sh seed     # run seed data (pipelines/stages/properties)
#   ./deploy.sh backup   # trigger manual backup
#   ./deploy.sh logs     # tail all service logs

set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"
API_CONTAINER="$(basename "$(pwd)")_api_1"

# ── colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()  { echo -e "${YELLOW}[deploy]${NC} $*"; }
error() { echo -e "${RED}[deploy]${NC} $*" >&2; }

# ── helpers ───────────────────────────────────────────────────────────────────
require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    error "$1 is not installed. Please install it and re-run."
    exit 1
  fi
}

check_env() {
  if [[ ! -f .env ]]; then
    warn ".env not found — copying from .env.example"
    cp .env.example .env
    warn "ACTION REQUIRED: Edit .env and fill in all secrets before continuing."
    warn "  nano .env   (or your preferred editor)"
    exit 1
  fi

  local missing=()
  while IFS= read -r line; do
    # skip blank lines and comments
    [[ -z "$line" || "$line" == \#* ]] && continue
    local key="${line%%=*}"
    local val="${line#*=}"
    # flag if value still looks like a placeholder
    if [[ "$val" == *"change-me"* || "$val" == *"your-"* || -z "$val" ]]; then
      missing+=("$key")
    fi
  done < .env

  if [[ ${#missing[@]} -gt 0 ]]; then
    warn "The following .env values still look like placeholders:"
    for k in "${missing[@]}"; do warn "  $k"; done
    warn "Edit .env and fill in the real values, then re-run."
    exit 1
  fi
}

health_check() {
  local url="${1:-http://localhost/api/health}"
  local retries=20
  local i=0
  info "Waiting for API to become healthy at $url ..."
  while [[ $i -lt $retries ]]; do
    if curl -sf "$url" | grep -q '"status":"ok"'; then
      info "Health check passed."
      return 0
    fi
    sleep 3
    ((i++))
  done
  error "API did not become healthy after $((retries * 3))s."
  error "Check logs: $COMPOSE logs api"
  return 1
}

# ── commands ──────────────────────────────────────────────────────────────────
cmd_setup() {
  info "=== First-time setup ==="
  require_cmd docker
  require_cmd curl

  check_env

  info "Building and starting services..."
  $COMPOSE up -d --build

  health_check

  info "Running seed data (pipelines, stages, properties)..."
  cmd_seed

  echo ""
  info "=== Setup complete ==="
  info "CRM is running at http://localhost"
  info "If Caddy is configured, it will be available at https://intranet.centroamalia.com"
  info "Run './deploy.sh status' to check container health."
}

cmd_update() {
  info "=== Updating to latest code ==="
  check_env

  info "Pulling latest changes..."
  git pull --ff-only

  info "Rebuilding and restarting services..."
  $COMPOSE up -d --build

  health_check
  info "Update complete."
}

cmd_status() {
  echo ""
  info "=== Container status ==="
  $COMPOSE ps
  echo ""
  info "=== Health check ==="
  local health
  health=$(curl -sf http://localhost/api/health 2>/dev/null || echo '{"status":"unreachable"}')
  echo "$health"
  echo ""
}

cmd_seed() {
  info "Running seed script inside api container..."
  # Find running api container (name may vary by compose project name)
  local api_cid
  api_cid=$($COMPOSE ps -q api 2>/dev/null | head -1)
  if [[ -z "$api_cid" ]]; then
    error "api container is not running. Start it first with './deploy.sh' or './deploy.sh update'."
    exit 1
  fi
  docker exec "$api_cid" node packages/db/dist/seed.js
  info "Seed complete."
}

cmd_backup() {
  info "Triggering manual backup..."
  local backup_cid
  backup_cid=$($COMPOSE ps -q pg-backup 2>/dev/null | head -1)
  if [[ -z "$backup_cid" ]]; then
    error "pg-backup container is not running."
    exit 1
  fi
  local filename="crm_manual_$(date +%Y%m%d_%H%M%S).dump"
  # source DB password from .env
  # shellcheck disable=SC1091
  source .env
  docker exec \
    -e PGPASSWORD="${POSTGRES_PASSWORD}" \
    "$backup_cid" \
    pg_dump -h postgres -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-crm}" -F c -f "/backups/$filename"
  info "Backup written to pg_backups volume: $filename"
}

cmd_logs() {
  $COMPOSE logs -f --tail=100
}

# ── entrypoint ────────────────────────────────────────────────────────────────
COMMAND="${1:-setup}"
case "$COMMAND" in
  setup)  cmd_setup  ;;
  update) cmd_update ;;
  status) cmd_status ;;
  seed)   cmd_seed   ;;
  backup) cmd_backup ;;
  logs)   cmd_logs   ;;
  *)
    error "Unknown command: $COMMAND"
    echo "Usage: $0 {setup|update|status|seed|backup|logs}"
    exit 1
    ;;
esac
