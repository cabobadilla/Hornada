#!/usr/bin/env bash
#
# check-coverage.sh — Verifica que todo caso de la matriz de diseño tenga su test.
#
# Uso:
#   ./scripts/check-coverage.sh <proyecto>
#
# Salida 0 = cobertura completa. Salida 1 = hay casos sin test (no se integra).
#
# Por qué existe:
#   El sello (`freeze-tests.sh`) impide que el Coder EDITE los tests. No impide
#   que los OMITA: podía escribir 3 tests para 20 combinaciones y quedar verde.
#   La omisión no estaba protegida de ninguna forma.
#
#   Con la matriz de casos en el diseño y el ID en el nombre del test, la
#   cobertura deja de ser una opinión y pasa a ser un grep. Es lo que convierte
#   "los casos se identifican en el diseño" en algo que se puede EXIGIR.
#
# Regla: un ID de la matriz sin test que lo nombre es un criterio que nadie
#        verifica. Puede terminar en test, o en hueco EXPLÍCITO — nunca en nada.

set -uo pipefail

PROJECT_DIR="${1:-}"
[ -z "$PROJECT_DIR" ] && { echo "uso: check-coverage.sh <proyecto>" >&2; exit 1; }
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"

DISENO="$PROJECT_DIR/docs/04-DISENO.md"
TESTS_DIR="$PROJECT_DIR/tests"

[ -f "$DISENO" ] || { echo "No existe $DISENO" >&2; exit 1; }
[ -d "$TESTS_DIR" ] || { echo "No existe $TESTS_DIR" >&2; exit 1; }

# --- 1. Extraer los IDs de caso de la matriz -------------------------------
# Formato: C-01, C-12, … y rangos explícitos C-40..C-59 (una fórmula debe poder
# enumerarse, si no es donde se esconden los literales escritos en duro).
IDS_FILE="$PROJECT_DIR/.tmp/.coverage-ids"
mkdir -p "$PROJECT_DIR/.tmp"

: > "$IDS_FILE"

# Rangos primero: C-40..C-59 → C-40 … C-59
grep -oE 'C-[0-9]+\.\.C-[0-9]+' "$DISENO" 2>/dev/null | sort -u | while read -r rango; do
  ini="$(printf '%s' "$rango" | sed 's/.*C-\([0-9]*\)\.\.C-.*/\1/')"
  fin="$(printf '%s' "$rango" | sed 's/.*\.\.C-\([0-9]*\)/\1/')"
  i="$ini"
  while [ "$i" -le "$fin" ]; do
    printf 'C-%02d\n' "$((10#$i))"
    i=$((i + 1))
  done
done >> "$IDS_FILE"

# IDs sueltos (los de las filas de la tabla)
grep -oE 'C-[0-9]+' "$DISENO" 2>/dev/null | sort -u >> "$IDS_FILE"

sort -u "$IDS_FILE" -o "$IDS_FILE"
TOTAL="$(grep -c '' "$IDS_FILE" | tr -d ' ')"

if [ "$TOTAL" -eq 0 ]; then
  echo "⚠ No hay IDs de caso (C-xx) en $DISENO" >&2
  echo "   La matriz de casos de prueba es OBLIGATORIA desde v0.13." >&2
  echo "   Sin matriz, la cobertura no se puede verificar." >&2
  exit 1
fi

echo "📋 Matriz: $TOTAL casos declarados"
echo

# --- 2. Verificar que cada ID aparezca nombrado en algún test --------------
SIN_TEST=0
FALTANTES="$PROJECT_DIR/.tmp/.coverage-faltantes"
: > "$FALTANTES"

while read -r id; do
  [ -z "$id" ] && continue
  # El test debe NOMBRAR el caso: test('C-01 · …')
  if grep -rqE "['\"\`]${id}\b" "$TESTS_DIR" 2>/dev/null; then
    :
  else
    printf '   ✗ %s — ningún test lo cubre\n' "$id"
    printf '%s\n' "$id" >> "$FALTANTES"
    SIN_TEST=$((SIN_TEST + 1))
  fi
done < "$IDS_FILE"

# --- 3. Huecos declarados explícitamente ----------------------------------
# Un caso puede terminar en test O en un hueco nombrado. Nunca en nada.
if [ -f "$PROJECT_DIR/docs/06-QA-REPORT.md" ]; then
  while read -r id; do
    [ -z "$id" ] && continue
    if grep -q "$id" "$PROJECT_DIR/docs/06-QA-REPORT.md" 2>/dev/null; then
      printf '   ~ %s — declarado como hueco en 06-QA-REPORT.md\n' "$id"
      SIN_TEST=$((SIN_TEST - 1))
    fi
  done < "$FALTANTES"
fi

echo
if [ "$SIN_TEST" -gt 0 ]; then
  echo "❌ COBERTURA INCOMPLETA — $SIN_TEST caso(s) sin test y sin declarar como hueco."
  echo
  echo "   Un ID de la matriz sin test es un criterio que nadie verifica."
  echo "   Dos salidas legítimas:"
  echo "     - escribir el test que lo nombra (\"C-01 · …\"), o"
  echo "     - declararlo como hueco EXPLÍCITO en docs/06-QA-REPORT.md."
  echo "   Lo que no vale es que no pase nada."
  exit 1
fi

echo "✅ COBERTURA COMPLETA — todo caso de la matriz tiene test o hueco declarado."
exit 0
