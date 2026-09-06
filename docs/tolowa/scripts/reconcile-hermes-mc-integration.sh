#!/bin/bash
# reconcile-hermes-mc-integration.sh
#
# Idempotent reconciliation for the Mission Control <-> Hermes A2A integration.
# Everything here lives in plain files with NO version control (~/.hermes/.env,
# ~/.hermes/config.yaml, mission-control-poc/.env are all gitignored/untracked) —
# a `hermes update` (currently 4406 commits behind upstream) or any disk event
# can silently drop these with no warning. Run this any time after such an
# event to detect and restore the known-good state.
#
# Does NOT restart services itself — restarts are disruptive to Hermes's other
# live personas (legal-specialist, ops-monitor, etc.) and should be a deliberate
# choice, not something a reconcile script does silently. It reports whether a
# restart is needed.
#
# Established and verified live 2026-09-06 (Stash /projects/mission-control-poc,
# entries 22732, 22735). Safe to re-run repeatedly — every check is idempotent.

set -euo pipefail

MC_DIR="$HOME/services/mission-control-poc"
HERMES_ENV="$HOME/.hermes/.env"
HERMES_CONFIG="$HOME/.hermes/config.yaml"
MC_ENV="$MC_DIR/.env"
GCP_PROJECT="tolowa-studio"
CHANGED=0

log() { echo "[reconcile] $*"; }

set_env_var() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    current=$(grep "^${key}=" "$file" | head -1 | cut -d= -f2-)
    if [ "$current" = "$value" ]; then
      log "OK   $key already correct in $file"
      return
    fi
    cp "$file" "$file.bak-reconcile-$(date +%Y%m%d%H%M%S)"
    sed -i '' "s|^${key}=.*|${key}=${value}|" "$file"
    log "FIX  $key was wrong in $file, corrected (backup saved)"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
    log "FIX  $key was missing from $file, added"
  fi
  CHANGED=1
}

# --- 1. MC's own A2A dispatch config ---------------------------------------
set_env_var "$MC_ENV" "HERMES_A2A_URL" "http://127.0.0.1:9900/"
set_env_var "$MC_ENV" "HERMES_A2A_TIMEOUT_MS" "600000"

# --- 2. Hermes's hook target + credential -----------------------------------
set_env_var "$HERMES_ENV" "MC_URL" "http://100.67.55.81:3000"

CURRENT_MC_KEY=$(grep "^MC_API_KEY=" "$HERMES_ENV" 2>/dev/null | cut -d= -f2- || true)
LIVE_KEY=$(gcloud secrets versions access latest --secret=mission-control-poc-cli-api-key --project="$GCP_PROJECT" 2>/dev/null || true)
if [ -z "$LIVE_KEY" ]; then
  log "WARN could not fetch mission-control-poc-cli-api-key from GCP -- skipping MC_API_KEY check"
elif [ "$CURRENT_MC_KEY" = "$LIVE_KEY" ]; then
  log "OK   MC_API_KEY already matches the live GCP secret"
else
  set_env_var "$HERMES_ENV" "MC_API_KEY" "$LIVE_KEY"
fi

# --- 3. Hermes's A2A root toolset (grants file/terminal to the root endpoint) -
if python3 -c "
import sys
sys.path.insert(0, '$HOME/.hermes/hermes-agent/venv/lib/python3.11/site-packages')
import yaml
d = yaml.safe_load(open('$HERMES_CONFIG'))
toolsets = (d.get('platform_toolsets') or {}).get('a2a') or []
sys.exit(0 if 'hermes-cli' in toolsets else 1)
" 2>/dev/null; then
  log "OK   hermes-cli already present in platform_toolsets.a2a"
else
  cp "$HERMES_CONFIG" "$HERMES_CONFIG.bak-reconcile-$(date +%Y%m%d%H%M%S)"
  "$HOME/.hermes/hermes-agent/venv/bin/python" -c "
import re
path = '$HERMES_CONFIG'
with open(path) as f:
    lines = f.readlines()
in_pt = in_a2a = False
for i, line in enumerate(lines):
    if line.rstrip() == 'platform_toolsets:':
        in_pt = True; continue
    if in_pt and re.match(r'^\S', line):
        in_pt = False
    if in_pt and line.rstrip() == '  a2a:':
        in_a2a = True; continue
    if in_a2a and line.strip() == '- a2a':
        lines.insert(i, '    - hermes-cli\n')
        break
    if in_a2a and re.match(r'^  \S', line):
        in_a2a = False
with open(path, 'w') as f:
    f.writelines(lines)
"
  "$HOME/.hermes/hermes-agent/venv/bin/python" -c "import yaml; yaml.safe_load(open('$HERMES_CONFIG'))" || {
    log "ERROR YAML invalid after edit -- restoring backup"
    cp "$HERMES_CONFIG.bak-reconcile-"*.yaml 2>/dev/null "$HERMES_CONFIG" || true
    exit 1
  }
  log "FIX  added hermes-cli to platform_toolsets.a2a (backup saved)"
  CHANGED=1
fi

echo
if [ "$CHANGED" = "1" ]; then
  echo "[reconcile] Config changed. A restart is needed for these to take effect:"
  echo "[reconcile]   MC:     launchctl bootout gui/\$(id -u)/com.tolowa.mission-control; launchctl enable gui/\$(id -u)/com.tolowa.mission-control; launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/com.tolowa.mission-control.plist"
  echo "[reconcile]   Hermes: hermes gateway restart"
else
  echo "[reconcile] Everything already correct. No restart needed."
fi
