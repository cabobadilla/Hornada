#!/usr/bin/env bash
#
# hidden-cases.sh — Corre los CASOS OCULTOS de un ciclo.
#
# Uso:
#   ./scripts/hidden-cases.sh run <proyecto> <ciclo>
#
# Qué hace:
#   1. Exige que el Coder haya TERMINADO y commiteado (árbol limpio). Si hay
#      cambios sin commitear, RECHAZA: correr antes del commit final deja de hacer
#      el ejercicio, el caso deja de ser oculto y la muestra no sirve.
#   2. Copia `oculto/<proyecto>/ciclo-<n>.test.mjs` a `<proyecto>/tests/oculto/`
#      (directorio GITIGNORED — no vive en el repo del Coder).
#   3. Corre la suite oculta y reporta.
#
# Por qué viven en el harness: el Coder ve TODO el repo del proyecto. Un caso que
# vive en el proyecto es un caso que el Coder puede leer, y un test que el
# implementador conoce de antemano mide menos de lo que parece. Fuera de su alcance,
# vuelve a medir.
#
# Quién los escribe: el Arquitecto, junto con la matriz visible, en la fase 4.
# Dónde se evalúan: gate G5 (QA). Un caso oculto rojo es un HALLAZGO DE QA
#   —la matriz visible era más angosta que el criterio—, no un fallo del Coder.
# Al cierre: todo caso oculto se PROMUEVE a la matriz visible del ciclo siguiente
#   (2–4 por ciclo). No es una trampa permanente: es un muestreo de una sola vez.

set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODE="${1:-}"; P="${2:-}"; CICLO="${3:-}"

if [ "$MODE" != "run" ] || [ -z "$P" ] || [ -z "$CICLO" ]; then
  echo "uso: hidden-cases.sh run <proyecto> <ciclo>" >&2; exit 1
fi
P="$(cd "$P" && pwd)"
PROY="$(basename "$P")"
SRC="$HARNESS_DIR/oculto/$PROY/ciclo-$CICLO.test.mjs"
DEST="$P/tests/oculto"

# --- 1. El Coder tiene que haber terminado --------------------------------
command -v git >/dev/null 2>&1 || { echo "FALTA: git" >&2; exit 1; }
if ! git -C "$P" rev-parse --git-dir >/dev/null 2>&1; then
  echo "❌ $P no es un repo git." >&2; exit 1
fi
DIRTY="$(git -C "$P" status --porcelain 2>/dev/null)"
if [ -n "$DIRTY" ]; then
  echo "❌ El árbol de $PROY tiene cambios SIN COMMITEAR." >&2
  echo "   Los casos ocultos se corren SOLO después del commit final del Coder." >&2
  echo "   Correrlos antes deja de hacer el ejercicio: el caso deja de ser oculto." >&2
  exit 1
fi

# --- 2. Copiar la muestra (directorio gitignored) --------------------------
if [ ! -f "$SRC" ]; then
  echo "❌ No hay casos ocultos para $PROY ciclo $CICLO ($SRC)." >&2
  echo "   Los escribe el Arquitecto en la fase 4, junto con la matriz visible." >&2
  exit 1
fi
mkdir -p "$DEST"
cp "$SRC" "$DEST/ciclo-$CICLO.test.mjs"
echo "→ Casos ocultos de $PROY · ciclo $CICLO"

# --- 3. Correr la suite oculta --------------------------------------------
# `env -u NODE_TEST_CONTEXT` es OBLIGATORIO: heredado, el runner anidado devuelve
# código 0 y salida vacía AUNQUE LOS TESTS FALLEN → falso verde.
OUT="$(cd "$P" && env -u NODE_TEST_CONTEXT node --test tests/oculto/ 2>&1)"; RC=$?
printf '%s\n' "$OUT" > "$P/.tmp/hidden-ciclo$CICLO.txt"

# Limpiar la copia: tests/oculto/ no debe quedar poblado entre corridas.
rm -rf "$DEST"

echo
if [ "$RC" -eq 0 ]; then
  echo "✅ Casos ocultos VERDES — la matriz visible cubría el criterio."
  exit 0
fi
echo "❌ Caso oculto ROJO — HALLAZGO DE QA."
echo "   Significa que la matriz VISIBLE era más angosta que el criterio, no que el"
echo "   Coder haya fallado. Detalle: $P/.tmp/hidden-ciclo$CICLO.txt"
printf '%s' "$OUT" | grep -E '^✖|not ok' | head -10 | sed 's/^/      /'
exit 1
