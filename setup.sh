#!/usr/bin/env bash
# =============================================================================
#  Smart Timetable System - one-shot setup (Linux, macOS, Windows Git Bash/WSL)
#
#    ./setup.sh               install everything and verify it boots
#    ./setup.sh --run         ...then start server + client (http://localhost:5173)
#    ./setup.sh --run --ml    ...and also the optional ML service (port 8000)
#    ./setup.sh --test        ...and run the full test suites afterwards
#    ./setup.sh --skip-smoke  skip the boot check (faster)
#
#  Safe to re-run. It never installs Python packages globally: they go into ./.venv,
#  and .env is pointed at that interpreter (PYTHON_BIN) so the solver always finds them.
#  You must already have: Node.js >= 22.13 (with npm) and Python 3.9 - 3.13.
# =============================================================================
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
ROOT="$(pwd)"
LOG="$ROOT/.setup.log"
: > "$LOG"

RUN=0; ML=0; TEST=0; SMOKE=1
for arg in "$@"; do
  case "$arg" in
    --run) RUN=1 ;;
    --ml) ML=1 ;;
    --test) TEST=1 ;;
    --skip-smoke) SMOKE=0 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)"; exit 2 ;;
  esac
done

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; N=$'\033[0m'; else B=; G=; Y=; R=; C=; N=; fi
step() { printf '\n%s==> %s%s\n' "$C$B" "$1" "$N"; }
ok()   { printf '  %s[ok]%s %s\n' "$G" "$N" "$1"; }
warn() { printf '  %s[warn]%s %s\n' "$Y" "$N" "$1"; }
die()  { printf '\n%s[error]%s %s\n' "$R$B" "$N" "$1" >&2; [ -s "$LOG" ] && printf '        (full log: %s)\n' "$LOG" >&2; exit 1; }
trap 'die "Unexpected failure near line $LINENO. Re-run with: bash -x ./setup.sh"' ERR

# Run a command quietly; on failure show the tail of its output.
run() {
  local desc="$1"; shift
  printf '  ... %s\n' "$desc"
  if ! "$@" >>"$LOG" 2>&1; then
    printf '\n--- last output ---\n' >&2; tail -n 25 "$LOG" >&2; printf -- '-------------------\n' >&2
    die "$desc failed."
  fi
}

case "$(uname -s 2>/dev/null)" in
  Linux*) OS=linux ;; Darwin*) OS=mac ;; MINGW*|MSYS*|CYGWIN*) OS=windows ;; *) OS=other ;;
esac
printf '%sSmart Timetable System - setup%s (%s)\n' "$B" "$N" "$OS"

# ---------------------------------------------------------------- Node.js
step "Checking Node.js"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  case "$OS" in
    mac) hint="brew install node@22   (or https://nodejs.org)" ;;
    windows) hint="winget install OpenJS.NodeJS.LTS   (or https://nodejs.org)" ;;
    *) hint="install via nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install 22" ;;
  esac
  die "Node.js and npm are required. Install Node 22.13+ then re-run.  $hint"
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || die "Node $(node -v) is too old. This project uses the built-in node:sqlite and needs Node 22.13 or newer (nvm install 22)."
ok "Node $(node -v), npm $(npm -v)"

# ---------------------------------------------------------------- Python
step "Checking Python"
PYCMD=()
for c in python3.12 python3.11 python3.10 python3.13 python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if (3,9)<=sys.version_info[:2]<=(3,13) else 1)' >/dev/null 2>&1; then PYCMD=("$c"); break; fi
done
if [ ${#PYCMD[@]} -eq 0 ] && command -v py >/dev/null 2>&1 && py -3 -c 'import sys; sys.exit(0 if (3,9)<=sys.version_info[:2]<=(3,13) else 1)' >/dev/null 2>&1; then PYCMD=(py -3); fi
if [ ${#PYCMD[@]} -eq 0 ]; then
  case "$OS" in
    mac) hint="brew install python@3.12" ;;
    windows) hint="winget install Python.Python.3.12  (tick 'Add to PATH')" ;;
    *) hint="sudo apt install python3 python3-venv python3-pip   (or your distro's equivalent)" ;;
  esac
  die "Python 3.9 - 3.13 not found. $hint"
fi
ok "$("${PYCMD[@]}" --version 2>&1) via '${PYCMD[*]}'"

venv_python() {
  if [ -x "$ROOT/.venv/Scripts/python.exe" ]; then echo "$ROOT/.venv/Scripts/python.exe"
  elif [ -x "$ROOT/.venv/bin/python" ]; then echo "$ROOT/.venv/bin/python"; fi
}
VPY="$(venv_python || true)"
if [ -n "$VPY" ] && ! "$VPY" -c 'import sys' >/dev/null 2>&1; then
  warn "Existing .venv is broken (moved from another machine?) - recreating"
  rm -rf "$ROOT/.venv"; VPY=""
fi
if [ -z "$VPY" ]; then
  if ! "${PYCMD[@]}" -m venv "$ROOT/.venv" >>"$LOG" 2>&1; then
    rm -rf "$ROOT/.venv"
    die "Could not create a virtual environment. On Debian/Ubuntu run: sudo apt install python3-venv python3-pip   then re-run."
  fi
  VPY="$(venv_python)"
fi
ok "virtualenv: .venv"

step "Installing Python packages (OR-Tools solver + ML service)"
run "upgrading pip" "$VPY" -m pip install --disable-pip-version-check --upgrade pip wheel
attempt=1
until "$VPY" -m pip install --disable-pip-version-check -r requirements.txt -r server/engine/requirements.txt >>"$LOG" 2>&1; do
  if [ "$attempt" -ge 3 ]; then
    tail -n 25 "$LOG" >&2
    die "pip could not install the Python packages (3 attempts). Check your internet connection / proxy and the output above."
  fi
  attempt=$((attempt + 1)); warn "pip install failed - retrying ($attempt/3)"; sleep 3
done
if ! "$VPY" - >>"$LOG" 2>&1 <<'PYEOF'
import importlib
for m in ("ortools", "fastapi", "uvicorn", "xgboost", "sklearn", "pandas", "numpy", "joblib", "openpyxl", "pydantic", "pytest", "httpx"):
    importlib.import_module(m)
PYEOF
then
  tail -n 8 "$LOG" >&2
  [ "$OS" = mac ] && warn "On macOS xgboost needs OpenMP:  brew install libomp   then re-run."
  die "A Python package installed but cannot be imported (see above)."
fi
ok "Python packages installed and importable"

# ---------------------------------------------------------------- Node packages
step "Installing Node packages (server + client)"
run "npm install" npm install --no-audit --no-fund
ok "node_modules ready"

# ---------------------------------------------------------------- .env
step "Configuring .env"
[ -f .env ] || { cp .env.example .env; ok "created .env from .env.example"; }
if command -v cygpath >/dev/null 2>&1; then VPY_ENV="$(cygpath -m "$VPY")"; else VPY_ENV="$VPY"; fi
set_env() { # KEY VALUE - replace or append, portable (no sed -i)
  { grep -v "^$1=" .env || true; printf '%s=%s\n' "$1" "$2"; } > .env.tmp && mv .env.tmp .env
}
set_env PYTHON_BIN "$VPY_ENV"
grep -q '^PORT=' .env || set_env PORT 4000
ok "PYTHON_BIN -> $VPY_ENV"

# ---------------------------------------------------------------- ML model
step "Checking the ML class-size model"
if ! "$VPY" -c "import joblib; joblib.load('backend/ml/models/class_size_model.joblib')" >>"$LOG" 2>&1; then
  warn "model file missing or built with a different scikit-learn - retraining on the synthetic dataset"
  run "training class-size model" "$VPY" -c "from backend.ml.class_size import train_class_size_models; train_class_size_models()"
fi
ok "class-size model loads"

# ---------------------------------------------------------------- verify
step "Type-checking server and client"
run "tsc (server + client)" npm run lint
ok "no type errors"

if [ "$SMOKE" -eq 1 ]; then
  step "Boot check (fresh temporary database)"
  SMOKE_DIR="$(mktemp -d)"
  SMOKE_PORT="$(node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})')"
  APP_DATA_DIR="$SMOKE_DIR" PORT="$SMOKE_PORT" node --import tsx server/src/index.ts >"$SMOKE_DIR/server.log" 2>&1 &
  SPID=$!
  cleanup_smoke() { kill "$SPID" >/dev/null 2>&1 || true; wait "$SPID" >/dev/null 2>&1 || true; rm -rf "$SMOKE_DIR"; }
  up=0
  for _ in $(seq 1 45); do
    if node -e 'fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' "http://127.0.0.1:$SMOKE_PORT/api/health" >/dev/null 2>&1; then up=1; break; fi
    kill -0 "$SPID" >/dev/null 2>&1 || break
    sleep 1
  done
  if [ "$up" -ne 1 ]; then tail -n 25 "$SMOKE_DIR/server.log" >&2; cleanup_smoke; die "The server did not start (output above)."; fi
  ok "server starts and migrations apply on a fresh database"
  if node -e 'fetch(process.argv[1]).then(r=>r.json()).then(j=>process.exit(j.environment&&j.environment.python_ready?0:1)).catch(()=>process.exit(1))' "http://127.0.0.1:$SMOKE_PORT/api/engine/status" >/dev/null 2>&1; then
    ok "server can run the OR-Tools solver (Python + ortools found)"
  else
    cleanup_smoke; die "The server cannot find Python/OR-Tools. Check PYTHON_BIN in .env ($VPY_ENV)."
  fi
  cleanup_smoke
fi

if [ "$TEST" -eq 1 ]; then
  step "Running test suites (this takes a few minutes)"
  run "TypeScript tests (vitest)" npm test
  run "Python tests (pytest)" "$VPY" -m pytest -q
  ok "all tests passed"
fi

# ---------------------------------------------------------------- done
printf '\n%s%sSetup complete.%s\n' "$G" "$B" "$N"
if [ "$RUN" -eq 0 ]; then
  cat <<EOF

  Start the app:      ./setup.sh --run          (or: npm run dev)
  With ML service:    ./setup.sh --run --ml
  App:                http://localhost:5173      API: http://localhost:4000

  Chrome/Edge is only needed for PDF export. Everything else works without it.
EOF
  exit 0
fi

step "Starting"
ML_PID=""
stop_all() { [ -n "$ML_PID" ] && kill "$ML_PID" >/dev/null 2>&1 || true; }
trap stop_all EXIT INT TERM
if [ "$ML" -eq 1 ]; then
  "$VPY" -m uvicorn backend.ml.main:app --host 127.0.0.1 --port "${ML_PORT:-8000}" &
  ML_PID=$!
  ok "ML service on http://127.0.0.1:${ML_PORT:-8000}"
fi
printf '  Open %shttp://localhost:5173%s  (Ctrl+C stops everything)\n\n' "$B" "$N"
npm run dev
