#!/usr/bin/env bash
#
# review.sh — Revisión de Hermes tras cada despacho. Recoge evidencia VERIFICADA.
#
# Uso:
#   ./scripts/review.sh <proyecto> [--gate G3]
#
# Por qué existe:
#   El Coder NO actualiza el proceso — lo hace Hermes, verificando. Pero si la
#   revisión depende del criterio y la memoria de Hermes, se saltea cuando hay
#   prisa. Este script la vuelve mecánica: siempre las mismas preguntas.
#
# No actualiza el AVANCE. Solo RECOGE evidencia para que Hermes decida y registre.
# Con `--gate <G>` sí toca un solo campo: incrementa el CONTADOR de ese gate en
# `docs/estado.json` (`evaluado`, y `rechazo` si esta corrida encontró problemas).
# Ese contador es lo que vuelve ejecutable la poda de §6: un gate con cero rechazos
# en dos proyectos cerrados se elimina — y sin contador la poda depende de la memoria.
#
# Salida: informe compacto. Exit 0 = todo consistente; 1 = hay algo que revisar.

set -uo pipefail

GATE=""
if [ "${2:-}" = "--gate" ]; then GATE="${3:-}"; fi
P="${1:-}"
[ -z "$P" ] && { echo "uso: review.sh <proyecto> [--gate G3]" >&2; exit 1; }
P="$(cd "$P" && pwd)"
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PROBLEMAS=0
nota() { printf '   %s\n' "$1"; }

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  REVISIÓN — $(basename "$P")"
echo "╚══════════════════════════════════════════════════════════════╝"
echo "   $(date '+%Y-%m-%d %H:%M:%S')"
echo

# --- 1. Los tests ----------------------------------------------------------
echo "1. ESTADO REAL DE LOS TESTS"
if [ -d "$P/tests" ]; then
  # `env -u NODE_TEST_CONTEXT` es OBLIGATORIO: heredado, el runner anidado
  # devuelve código 0 y salida vacía AUNQUE LOS TESTS FALLEN → FALSO VERDE.
  OUT="$(cd "$P" && env -u NODE_TEST_CONTEXT node --test tests/ 2>&1)"; TEST_STATUS=$?
  TESTS=$(printf '%s' "$OUT" | grep -E '^ℹ tests'   | grep -oE '[0-9]+' | head -1)
  PASS=$(printf  '%s' "$OUT" | grep -E '^ℹ pass'    | grep -oE '[0-9]+' | head -1)
  FAIL=$(printf  '%s' "$OUT" | grep -E '^ℹ fail'    | grep -oE '[0-9]+' | head -1)
  nota "tests=${TESTS:-?}  pass=${PASS:-?}  fail=${FAIL:-?}"
  # La autoridad es el CÓDIGO DE SALIDA, no el conteo: el formato del reporter
  # depende del entorno, y parsearlo como verdad produce un veredicto falso.
  if [ "$TEST_STATUS" -ne 0 ]; then
    nota "→ FALLAN. Nombres de los tests que fallan:"
    printf '%s' "$OUT" | grep -E '^✖' | head -8 | sed 's/^/      /'
    PROBLEMAS=1
  elif [ -n "${FAIL:-}" ] && [ "$FAIL" != "0" ]; then
    nota "→ FALLAN (el conteo dice ${FAIL}, pero el código de salida fue 0)."
    PROBLEMAS=1
  else
    nota "→ todos pasan"
  fi
else
  nota "(sin tests/)"
fi
echo

# --- 2. El sello de tests --------------------------------------------------
echo "2. INTEGRIDAD DE LOS TESTS (¿el Coder tocó el contrato?)"
if [ -f "$P/.tmp/.tests-seal" ]; then
  if bash "$HARNESS/scripts/freeze-tests.sh" verify "$P" 2>&1 | grep -q 'INTACTOS'; then
    nota "✅ intactos"
  else
    nota "❌ MODIFICADOS — la corrida es inválida, revisar el diff"
    (cd "$P" && git diff --stat -- tests/ 2>/dev/null | sed 's/^/      /')
    PROBLEMAS=1
  fi
else
  nota "⚠ sin sello — no se puede verificar si los tests fueron tocados"
fi
echo

# --- 3. Frescura (¿está trabajando o colgado?) ----------------------------
echo "3. ACTIVIDAD"
RECIENTE="$(cd "$P" && find . -path ./.git -prune -o -path ./.tmp -prune -o \
           -type f -newermt '-4 minutes' -print 2>/dev/null | head -5)"
if [ -n "$RECIENTE" ]; then
  nota "archivos tocados en los últimos 4 min:"
  printf '%s\n' "$RECIENTE" | sed 's/^/      /'
else
  # shellcheck disable=SC2038  # nombres de archivo del proyecto, controlados
  ULTIMO="$(cd "$P" && find . -path ./.git -prune -o -path ./.tmp -prune -o \
            -type f -print 2>/dev/null | xargs stat -f '%m %Sm %N' -t '%H:%M:%S' 2>/dev/null \
            | sort -rn | head -1 | cut -d' ' -f2-)"
  nota "⚠ nada en 4 min (regla: corrida perdida) — último: $ULTIMO"
  PROBLEMAS=1
fi
echo

# --- 4. Commits ------------------------------------------------------------
echo "4. ÚLTIMOS COMMITS"
(cd "$P" && git log --oneline -5 2>/dev/null | sed 's/^/   /')
echo

# --- 5. Lo que el Coder reportó (NO es evidencia, es una afirmación) -------
echo "5. ARCHIVOS DE EVIDENCIA DEL CODER"
for f in RED.txt GREEN.txt js-syntax.txt; do
  if [ -f "$P/tests/evidence/$f" ]; then
    nota "$f — $(stat -f '%Sm' -t '%H:%M:%S' "$P/tests/evidence/$f") · $(stat -f '%z' "$P/tests/evidence/$f") bytes"
  fi
done
echo "   (los reportes del Coder son AFIRMACIONES hasta que se verifican arriba)"
echo

# --- 6. Marcadores de RED disfrazados de test ------------------------------
# Por qué existe (v0.35): un `assert.ok(false, 'RED: … (implementación pendiente)')`
# deja un test que SIEMPRE falla. Se ve idéntico a un RED legítimo —«falla por
# aserción»— y por eso pasó una verificación entera (Crisol, T-12, C-95): el caso
# no verificaba nada y ninguna implementación podía ponerlo en verde. El marcador
# de la fase RED hay que REEMPLAZARLO por la aserción real, no dejarlo.
echo "6. MARCADORES DE RED (¿hay tests que no verifican nada?)"
# Dos firmas, y solo dos — validar contra la suite ANTES de confiar en la guardia:
#   assert.ok(false …)  → un `false` hardcodeado SIEMPRE falla, nunca es legítimo.
#   assert.fail(…RED…)  → el marcador de la fase RED, por su convención de mensaje.
# `assert.fail(` a secas NO se marca: dentro de un `if` es una aserción legítima
# (p. ej. el test de despliegue que falla si un archivo versionado trae un token).
# Una guardia que grita en falso se termina ignorando — es peor que no tenerla.
MARCADORES="$(grep -rnE "assert\.ok\(false" "$P/tests" --include=*.mjs 2>/dev/null || true)"
MARCADORES="$MARCADORES$(grep -rnE "assert\.fail\(.*(RED:|pendiente|implementación pendiente)" "$P/tests" --include=*.mjs 2>/dev/null || true)"
if [ -n "$MARCADORES" ]; then
  printf '%s\n' "$MARCADORES" | while read -r l; do nota "❌ marcador, no test: $l"; done
  echo "   Un assert que siempre falla NO es un test en rojo: no verifica nada y"
  echo "   ninguna implementación puede ponerlo en verde. Reemplazalo por la"
  echo "   aserción real sobre el observable del caso."
  PROBLEMAS=$((PROBLEMAS + 1))
else
  nota "✅ sin marcadores: todo test que falla lo hace por una aserción real"
fi
echo

# --- 7. Contador de gates (habilita la poda de §6) -------------------------
if [ -n "$GATE" ]; then
  echo "7. CONTADOR DE GATE ($GATE)"
  if [ -f "$P/docs/estado.json" ]; then
    # shellcheck disable=SC2016  # JS entre comillas simples: la expansión la hace node
    node -e '
const fs = require("fs");
const [file, gate, prob] = process.argv.slice(1);
const s = JSON.parse(fs.readFileSync(file, "utf8"));
s.gates = s.gates || {};
s.gates[gate] = s.gates[gate] || { evaluado: 0, rechazo: 0 };
s.gates[gate].evaluado++;
if (Number(prob) > 0) s.gates[gate].rechazo++;
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
console.log(`   ${gate}: evaluado=${s.gates[gate].evaluado}  rechazo=${s.gates[gate].rechazo}`);
' "$P/docs/estado.json" "$GATE" "$PROBLEMAS"
  else
    nota "⚠ sin docs/estado.json — no hay dónde contar"
  fi
  echo
fi

# --- Veredicto -------------------------------------------------------------
echo "──────────────────────────────────────────────────────────────"
if [ "$PROBLEMAS" -eq 0 ]; then
  echo "✅ Todo consistente — Hermes puede registrar el avance en docs/estado.json"
else
  echo "⚠  Hay puntos que revisar ANTES de registrar avance."
  echo "   Recordatorio: estado.json lo escribe Hermes, con lo VERIFICADO."
fi
exit "$PROBLEMAS"
