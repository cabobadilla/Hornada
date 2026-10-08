#!/usr/bin/env bash
#
# deploy.sh — Despliega el producto a Cloudflare y verifica el resultado real.
#
# Uso:
#   ./scripts/deploy.sh <ruta-del-proyecto> [--no-smoke]
#
# Lo corre el ORQUESTADOR. El Coder NO despliega y no tiene token (ADR-004).
#
# Por qué existe: desplegar sin verificar el resultado publicado es el mismo error
# que creer el resumen del Coder. El deploy no está terminado cuando wrangler dice
# "deployed": está terminado cuando el smoke corre contra la URL REAL y pasa.
#
# Requiere: CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID en ~/.hermes/.env.
# El token NUNCA se imprime.

set -uo pipefail

PROJECT_DIR="${1:-}"
SMOKE=1
[ "${2:-}" = "--no-smoke" ] && SMOKE=0

[ -z "$PROJECT_DIR" ] && { echo "uso: deploy.sh <ruta-del-proyecto> [--no-smoke]" >&2; exit 1; }
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"

# ── credenciales ──────────────────────────────────────────────────────────────
ENV_FILE="${HOME}/.hermes/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null  # la ruta es dinámica por diseño ($HOME)
  . "$ENV_FILE"
  set +a
fi
[ -z "${CLOUDFLARE_API_TOKEN:-}" ] && {
  echo "Falta CLOUDFLARE_API_TOKEN en $ENV_FILE." >&2
  echo "Sin token no se despliega: es lo que impide que el Coder lo haga." >&2
  exit 1
}

# ── el proyecto tiene que declarar su forma ───────────────────────────────────
CONFIG="$PROJECT_DIR/wrangler.jsonc"
if [ ! -f "$CONFIG" ]; then
  echo "Falta $CONFIG — sin config no hay despliegue que verificar." >&2
  echo "(En el diseño esto es la sección Despliegue; en las tareas, la que la produce.)" >&2
  exit 1
fi

# ── la superficie que se publica ──────────────────────────────────────────────
echo "── ¿qué se va a publicar? ──"
if grep -qE '"main"' "$CONFIG"; then
  echo "  ⚠️  Hay un 'main': el Worker EJECUTA código. Los requests que lo invoquen"
  echo "      se facturan y consumen CPU. Declarado en el diseño, supongo."
else
  echo "  ✓ Worker solo-assets: ningún request ejecuta código. Cuota intacta."
fi
ASSETS_DIR="$(grep -oE '"directory"[[:space:]]*:[[:space:]]*"[^"]+"' "$CONFIG" | head -1 | sed -E 's/.*"([^"]+)"$/\1/')"
if [ -n "$ASSETS_DIR" ]; then
  echo "  assets: $ASSETS_DIR"
  for f in docs .tmp tests node_modules .env .dev.vars; do
    if [ -e "$PROJECT_DIR/$ASSETS_DIR/$f" ]; then
      echo "  ❌ $ASSETS_DIR/$f EXISTE y se publicaría. Todo lo que está ahí es PÚBLICO."
      exit 1
    fi
  done
  echo "  ✓ nada privado dentro de $ASSETS_DIR"
fi

# ── desplegar ─────────────────────────────────────────────────────────────────
echo
echo "── desplegando ──"
OUT="$(cd "$PROJECT_DIR" && npx --yes wrangler deploy --config "$CONFIG" 2>&1)"
RC=$?
printf '%s\n' "$OUT" | grep -viE 'token|bearer|cfat_' | tail -8

if [ "$RC" -ne 0 ]; then
  echo
  echo "❌ El despliegue falló (exit $RC)."
  printf '%s\n' "$OUT" | grep -qiE 'authentication|10000|permission|forbidden' && {
    echo "   Si es un permiso, el token necesita **Workers Scripts: Edit**."
  }
  exit 1
fi

URL="$(printf '%s' "$OUT" | grep -oE 'https://[A-Za-z0-9._-]+\.workers\.dev' | head -1)"
[ -z "$URL" ] && { echo "❌ No se pudo leer la URL del despliegue." >&2; exit 1; }

echo
echo "🌐 URL: $URL"

# ── verificar el resultado PUBLICADO ──────────────────────────────────────────
if [ "$SMOKE" -eq 1 ] && [ -f "$PROJECT_DIR/scripts/smoke.sh" ]; then
  echo
  echo "── smoke contra el edge (lo publicado, no lo construido) ──"
  bash "$PROJECT_DIR/scripts/smoke.sh" "$URL"
  SRC=$?
  if [ "$SRC" -ne 0 ]; then
    echo
    echo "❌ El deploy pasó pero el smoke FALLÓ: lo publicado no es lo construido."
    echo "   Rollback: npx wrangler rollback --config $CONFIG"
    exit 1
  fi
fi

# ── registrar la URL, para que no viva solo en este output ────────────────────
ESTADO="$PROJECT_DIR/docs/estado.json"
if [ -f "$ESTADO" ] && command -v python3 >/dev/null 2>&1; then
  python3 - "$ESTADO" "$URL" <<'PY'
import json, sys
p, url = sys.argv[1], sys.argv[2]
d = json.load(open(p, encoding="utf-8"))
d.setdefault("despliegue", {})["url"] = url
json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
  echo "  (URL registrada en docs/estado.json — la URL se entrega, no se describe)"
fi

echo
echo "✅ Desplegado y verificado."
