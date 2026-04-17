#!/bin/bash
# Provisions Grafana Cloud for the POV Success Criteria Tracker:
#   1. Installs the Infinity plugin on the stack
#   2. Registers a PDC (Private Data Source Connect) network and prints the agent run command
#   3. Creates the "pov-success" Infinity datasource
#   4. Provisions the dashboard from grafana-dashboard/pov-execution-landing-page.yaml

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✔]${NC}  $*"; }
info() { echo -e "${CYAN}[…]${NC}  $*"; }
warn() { echo -e "${YELLOW}[!]${NC}  $*"; }
die()  { echo -e "${RED}[✘]${NC}  $*" >&2; exit 1; }

# ── Load .env ─────────────────────────────────────────────────────────────────
if [ -f .env ]; then
  set -a; source .env; set +a
else
  die ".env not found — copy .env.example to .env and fill in the Grafana Cloud values"
fi

# ── Validate required variables ───────────────────────────────────────────────
for var in \
  GRAFANA_CLOUD_ACCESS_POLICY_TOKEN \
  GRAFANA_STACK_SLUG \
  GRAFANA_STACK_ID \
  GRAFANA_STACK_URL \
  GRAFANA_CLUSTER; do
  [ -z "${!var:-}" ] && die "Required variable \$$var is not set in .env"
done

CLOUD_API="https://grafana.com/api"
STACK_API="${GRAFANA_STACK_URL}/api"
PDC_NETWORK_NAME="${PDC_NETWORK_NAME:-pov-pdc}"
DATASOURCE_NAME="${DATASOURCE_NAME:-pov-success}"
GSHEETS_API_URL="${GSHEETS_API_URL:-http://172.17.0.1:8080}"
DASHBOARD_FILE="grafana-dashboard/pov-execution-landing-page.yaml"

# Helper: run curl, return "BODY\nHTTP_CODE"
gcloud_request() {
  local method="$1" path="$2"; shift 2
  curl -s -w "\n%{http_code}" -X "$method" \
    -H "Authorization: Bearer ${GRAFANA_CLOUD_ACCESS_POLICY_TOKEN}" \
    -H "Content-Type: application/json" \
    "${CLOUD_API}${path}" "$@"
}

stack_request() {
  local method="$1" path="$2"; shift 2
  curl -s -w "\n%{http_code}" -X "$method" \
    -H "Authorization: Bearer ${GRAFANA_CLOUD_ACCESS_POLICY_TOKEN}" \
    -H "Content-Type: application/json" \
    "${STACK_API}${path}" "$@"
}

split_response() {   # sets BODY and HTTP_CODE from "…\nHTTP_CODE"
  HTTP_CODE=$(printf '%s' "$1" | tail -1)
  BODY=$(printf '%s' "$1" | head -n -1)
}

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Grafana Cloud — POV Tracker Setup${NC}"
echo -e "${CYAN}  Stack: ${GRAFANA_STACK_URL}${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 1 — Install the Infinity plugin
# ═══════════════════════════════════════════════════════════════════════════════
info "Step 1/4 — Installing Infinity plugin on stack '${GRAFANA_STACK_SLUG}'…"

RESP=$(gcloud_request POST "/v1/stacks/${GRAFANA_STACK_SLUG}/plugins" \
  -d '{"pluginSlug":"yesoreyeram-infinity-datasource"}')
split_response "$RESP"

case "$HTTP_CODE" in
  200|201) log "Infinity plugin installed." ;;
  409)     log "Infinity plugin already installed." ;;
  *)       warn "Plugin install returned HTTP ${HTTP_CODE}: ${BODY}"
           warn "Make sure the plugin is installed manually if needed." ;;
esac

# ═══════════════════════════════════════════════════════════════════════════════
# Step 2 — Register PDC network and print agent run command
# ═══════════════════════════════════════════════════════════════════════════════
info "Step 2/4 — Registering PDC network '${PDC_NETWORK_NAME}'…"

RESP=$(gcloud_request POST "/v1/stacks/${GRAFANA_STACK_SLUG}/pdcconfigs" \
  -d "{\"name\":\"${PDC_NETWORK_NAME}\"}")
split_response "$RESP"

PDC_AGENT_TOKEN="$GRAFANA_CLOUD_ACCESS_POLICY_TOKEN"   # fallback

case "$HTTP_CODE" in
  200|201)
    log "PDC network '${PDC_NETWORK_NAME}' created."
    # The response may contain a dedicated HMAC/signing key for the agent
    CANDIDATE=$(echo "$BODY" | python3 -c \
      "import sys,json; d=json.load(sys.stdin); print(d.get('hmacKey', d.get('token', '')))" 2>/dev/null || true)
    [ -n "$CANDIDATE" ] && PDC_AGENT_TOKEN="$CANDIDATE"
    ;;
  409)
    log "PDC network '${PDC_NETWORK_NAME}' already exists."
    ;;
  *)
    warn "PDC API returned HTTP ${HTTP_CODE}: ${BODY}"
    warn "The PDC network may need to be created manually:"
    warn "  Grafana Cloud UI → Connections → Private data source connect"
    ;;
esac

echo ""
echo -e "${YELLOW}━━━ Run this on the same Docker host as the gsheets-api container ━━━${NC}"
echo -e "docker run -d --name grafana-pdc-agent --restart=unless-stopped \\"
echo -e "  grafana/pdc-agent:latest \\"
echo -e "  --cluster ${GRAFANA_CLUSTER} \\"
echo -e "  --gcloud-hosted-grafana-id ${GRAFANA_STACK_ID} \\"
echo -e "  --token ${PDC_AGENT_TOKEN}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 3 — Create the Infinity datasource
# ═══════════════════════════════════════════════════════════════════════════════
info "Step 3/4 — Creating Infinity datasource '${DATASOURCE_NAME}'…"

DS_PAYLOAD=$(cat <<JSON
{
  "name": "${DATASOURCE_NAME}",
  "type": "yesoreyeram-infinity-datasource",
  "access": "proxy",
  "url": "${GSHEETS_API_URL}",
  "basicAuth": false,
  "isDefault": false,
  "jsonData": {
    "network_name": "${PDC_NETWORK_NAME}",
    "allowedHosts": ["172.17.0.1:8080"]
  }
}
JSON
)

RESP=$(stack_request POST "/datasources" -d "$DS_PAYLOAD")
split_response "$RESP"

case "$HTTP_CODE" in
  200|201)
    DS_UID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['datasource']['uid'])" 2>/dev/null || echo "unknown")
    log "Datasource created (uid=${DS_UID})."
    ;;
  409)
    warn "Datasource '${DATASOURCE_NAME}' already exists — skipping creation."
    DS_UID=$(curl -s \
      -H "Authorization: Bearer ${GRAFANA_CLOUD_ACCESS_POLICY_TOKEN}" \
      "${STACK_API}/datasources/name/${DATASOURCE_NAME}" | \
      python3 -c "import sys,json; print(json.load(sys.stdin)['uid'])" 2>/dev/null || echo "unknown")
    log "Existing datasource uid=${DS_UID}."
    ;;
  *)
    die "Failed to create datasource (HTTP ${HTTP_CODE}): ${BODY}"
    ;;
esac

# ═══════════════════════════════════════════════════════════════════════════════
# Step 4 — Provision the dashboard
# ═══════════════════════════════════════════════════════════════════════════════
info "Step 4/4 — Provisioning dashboard from ${DASHBOARD_FILE}…"

[ -f "$DASHBOARD_FILE" ] || die "Dashboard file not found: ${DASHBOARD_FILE}"

# Extract metadata.name (the file is JSON-encoded YAML)
DASHBOARD_NAME=$(python3 -c "
import json, sys
with open('${DASHBOARD_FILE}') as f:
    d = json.load(f)
print(d['metadata']['name'])
")
log "Dashboard name: ${DASHBOARD_NAME}"

# Grafana Cloud k8s API namespace is 'stacks-<id>' (falls back to 'default')
NAMESPACE="stacks-${GRAFANA_STACK_ID}"

attempt_dashboard() {
  local method="$1" ns="$2" suffix="${3:-}"
  curl -s -w "\n%{http_code}" -X "$method" \
    -H "Authorization: Bearer ${GRAFANA_CLOUD_ACCESS_POLICY_TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary @"${DASHBOARD_FILE}" \
    "${GRAFANA_STACK_URL}/apis/dashboard.grafana.app/v2/namespaces/${ns}/dashboards${suffix}"
}

# Try POST (create) in stacks-<id>, then fall back to 'default' namespace
for NS in "${NAMESPACE}" "default"; do
  RESP=$(attempt_dashboard POST "$NS")
  split_response "$RESP"
  case "$HTTP_CODE" in
    200|201)
      log "Dashboard provisioned in namespace '${NS}'."
      DASHBOARD_NS="$NS"
      break
      ;;
    409)
      # Already exists — update via PUT
      RESP=$(attempt_dashboard PUT "$NS" "/${DASHBOARD_NAME}")
      split_response "$RESP"
      if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
        log "Dashboard updated in namespace '${NS}'."
        DASHBOARD_NS="$NS"
        break
      fi
      ;;
    404)
      [ "$NS" = "default" ] && die "Dashboard API not found (HTTP 404) — check GRAFANA_STACK_URL and token permissions."
      warn "Namespace '${NS}' not found, trying 'default'…"
      ;;
    *)
      [ "$NS" = "default" ] && die "Failed to provision dashboard (HTTP ${HTTP_CODE}): ${BODY}"
      warn "Namespace '${NS}' returned HTTP ${HTTP_CODE}, trying 'default'…"
      ;;
  esac
done

# ═══════════════════════════════════════════════════════════════════════════════
# Done
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Setup complete!${NC}"
echo -e "${GREEN}  Dashboard: ${GRAFANA_STACK_URL}/d/${DASHBOARD_NAME}${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
