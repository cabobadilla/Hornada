#!/usr/bin/env bash
#
# freeze-tests.sh — Congela los tests antes de despachar y verifica después.
#
# Uso:
#   ./scripts/freeze-tests.sh seal   <proyecto>   # antes de despachar
#   ./scripts/freeze-tests.sh verify <proyecto>   # después de despachar
#
# Por qué existe:
#   Los Coder editan los tests. Se les dice que no lo hagan; lo hacen igual.
#   Las instrucciones reducen la frecuencia del fallo, no lo eliminan.
#   Este script lo hace DETECTABLE: si el hash cambió, la corrida es inválida.
#
# Salida 0 = tests intactos. Salida 1 = tests modificados (corrida inválida).

set -uo pipefail

MODE="${1:-}"
PROJECT_DIR="${2:-}"
[ -z "$MODE" ] || [ -z "$PROJECT_DIR" ] && {
  echo "uso: freeze-tests.sh {seal|verify} <proyecto>" >&2; exit 1
}
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
SEAL="$PROJECT_DIR/.tmp/.tests-seal"

hash_tests() {
  # Hash estable de todo el contenido de tests/ (archivos ordenados).
  cd "$PROJECT_DIR" || exit 1
  find tests -type f -name '*.mjs' 2>/dev/null | LC_ALL=C sort | while read -r f; do
    printf '%s  ' "$f"
    shasum -a 256 "$f" | awk '{print $1}'
  done
}

case "$MODE" in
  verify-red)
    # Verifica que el RED fue REAL, reproduciéndolo — no leyendo el archivo de evidencia.
    #
    # Por qué existe (v0.21): un Coder entregó un `RED-*.txt` con 6/6 PASS y un
    # commit de tests en el que `public/index.html` todavía no existía. La evidencia
    # era un archivo de texto: se regenera después de implementar y nadie lo nota.
    # Un archivo de evidencia es FABRICABLE. Correr la suite en el commit de tests,
    # no: git conserva ese estado y el resultado es el mismo para cualquiera.
    #
    # Un RED válido = la suite FALLA en el commit de tests.
    # Si PASA, o el RED es falso, o los tests no prueban nada que falte.
    #
    # El worktree va FUERA del proyecto (v0.38, aprendizaje #73): dentro de él, los
    # helpers con rutas relativas (`../../wrangler.jsonc`) escapan al árbol VIVO y la
    # suite "pasa" en el commit de tests — un falso verde que esta guardia imprimía
    # como "✅ RED válido". Una guardia que corre dentro de lo que verifica se
    # esquiva con cualquier ruta relativa.
    COMMIT="${3:-}"
    [ -z "$COMMIT" ] && { echo "uso: freeze-tests.sh verify-red <proyecto> <commit-de-tests>" >&2; exit 1; }
    cd "$PROJECT_DIR" || exit 1
    WT="$(mktemp -d "${TMPDIR:-/tmp}/red-check-XXXXXX")"
    rmdir "$WT" 2>/dev/null || true
    if ! git worktree add --detach "$WT" "$COMMIT" >/dev/null 2>&1; then
      echo "No se pudo preparar el worktree en $COMMIT" >&2; exit 1
    fi
    OUT="$( cd "$WT" && node --test tests/ 2>&1 )"; RED_RC=$?
    git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
    git worktree prune >/dev/null 2>&1
    echo "── RED REAL (reproducido en $COMMIT, fuera del proyecto) ──"
    if [ "$RED_RC" -eq 0 ]; then
      echo "❌ El RED es FALSO: la suite PASA en el commit de tests."
      echo "   Si los tests pasan sin implementación, no prueban la implementación."
      echo "   Corrida INVÁLIDA — rehacer los tests."
      exit 1
    fi
    # Fallar NO alcanza: la regla del harness es que falle PORQUE FALTA LA
    # IMPLEMENTACIÓN, no porque el test esté roto. Un `readFileSync` que revienta
    # da exit!=0 y no verifica NINGÚN caso: la suite no llega ni a evaluarlos.
    #
    # El detector cubre TAMBIÉN los errores de tiempo de ejecución (aprendizaje #74):
    # `ReferenceError` por un typo en un helper hacía fallar DOS casos por crash y
    # dejaba a los otros cinco fallando por aserción — el promedio parecía un RED
    # legítimo. Un caso que muere por un typo no verifica su observable.
    if printf '%s' "$OUT" | grep -qE 'ENOENT|Cannot find module|ERR_MODULE_NOT_FOUND|SyntaxError|ReferenceError|TypeError|RangeError'; then
      echo "❌ El RED es INVÁLIDO: hay casos que NO fallan por aserción, sino por error."
      if printf '%s' "$OUT" | grep -qE 'ENOENT'; then
        echo "   El artefacto no existe todavía y el test lo lee en el import: el"
        echo "   archivo entero falla de una. Eso no verifica los casos — los saltea."
      fi
      if printf '%s' "$OUT" | grep -qE 'ReferenceError|TypeError|RangeError'; then
        echo "   Hay un error de tiempo de ejecución en la suite (typo, variable sin"
        echo "   definir): ese caso NUNCA llegó a evaluar su observable."
      fi
      echo "   Un RED válido falla caso por caso, con la aserción en el mensaje."
      echo "   Corrida INVÁLIDA — rehacer los tests."
      printf '%s' "$OUT" | grep -E 'ReferenceError|TypeError|RangeError|ENOENT|Cannot find module' | head -3 | sed 's/^/      /'
      exit 1
    fi
    echo "✅ RED válido: falla por aserción en el commit de tests (exit $RED_RC)."
    ;;

  seal-from-commit)
    # Sella los tests TAL COMO ESTABAN en un commit dado.
    #
    # Por qué existe (v0.20): el Coder escribe los tests, así que ya no hay nada
    # que sellar ANTES de despachar. Pero el sello sigue haciendo falta: hay que
    # detectar que debilitó una aserción DESPUÉS de escribirla.
    # La solución no es sellar antes ni después, es sellar CONTRA el commit en
    # que los tests aparecieron. Si el Coder commitea los tests primero y la
    # implementación después, git conserva el estado intermedio — y Hermes puede
    # comparar el final contra ese estado, sin haber estado en el medio.
    COMMIT="${3:-}"
    [ -z "$COMMIT" ] && { echo "uso: freeze-tests.sh seal-from-commit <proyecto> <commit>" >&2; exit 1; }
    mkdir -p "$PROJECT_DIR/.tmp"
    cd "$PROJECT_DIR" || exit 1
    if ! git rev-parse --verify --quiet "$COMMIT^{commit}" >/dev/null 2>&1; then
      echo "No existe el commit: $COMMIT" >&2; exit 1
    fi
    git ls-tree -r --name-only "$COMMIT" -- tests 2>/dev/null \
      | grep '\.mjs$' | LC_ALL=C sort | while read -r f; do
          printf '%s  ' "$f"
          git show "$COMMIT:$f" | shasum -a 256 | awk '{print $1}'
        done > "$SEAL"
    n=$(wc -l < "$SEAL" | tr -d ' ')
    if [ "$n" -eq 0 ]; then
      echo "El commit $COMMIT no contiene tests/*.mjs — no se selló nada." >&2
      rm -f "$SEAL"; exit 1
    fi
    echo "🔒 Tests congelados contra el commit $COMMIT: $n archivo(s)"
    echo "   sello: $SEAL"
    echo
    echo "   Ahora corré 'verify' para confirmar que la implementación NO los tocó."
    ;;

  seal)
    [ -d "$PROJECT_DIR/tests" ] || { echo "No hay tests/ en $PROJECT_DIR" >&2; exit 1; }
    mkdir -p "$PROJECT_DIR/.tmp"
    hash_tests > "$SEAL"
    echo "🔒 Tests congelados: $(wc -l < "$SEAL" | tr -d ' ') archivos"
    echo "   sello: $SEAL"
    echo
    echo "   IMPORTANTE — verifica que la suite sea VÁLIDAMENTE ROJA antes de"
    echo "   despachar: debe fallar porque FALTA LA IMPLEMENTACIÓN, no porque el"
    echo "   test tenga un bug. Una suite rota produce evidencia RED sin sentido."
    ;;

  verify)
    [ -f "$SEAL" ] || { echo "No hay sello. Corre 'seal' antes de despachar." >&2; exit 1; }
    # El temporal va DENTRO del proyecto, no en el temp del sistema: es la misma
    # regla que le exigimos al Coder. El sandbox rechaza rutas externas, y un
    # script que predica una regla y la viola enseña la regla equivocada.
    CURRENT="$PROJECT_DIR/.tmp/.tests-current"
    hash_tests > "$CURRENT"

    if diff -q "$SEAL" "$CURRENT" >/dev/null 2>&1; then
      echo "✅ Tests INTACTOS — el Coder implementó contra el contrato."
      rm -f "$CURRENT"
      exit 0
    fi

    echo "❌ Tests MODIFICADOS desde el despacho — corrida INVÁLIDA."
    echo
    echo "Cambios:"
    diff "$SEAL" "$CURRENT" | grep -E '^[<>]' | sed 's/^/   /' || true
    echo
    echo "   El Coder tocó el contrato. Aunque el cambio parezca razonable (bugs"
    echo "   del test, imports faltantes), NO se puede distinguir un arreglo de una"
    echo "   aserción debilitada sin revisar. El trabajo NO se acepta así."
    echo
    echo "   Qué hacer: revisar el diff de tests/ y decidir."
    echo "   - Si son bugs legítimos: arreglarlos en el lado del diseño, RE-SELLAR,"
    echo "     y volver a despachar."
    echo "   - Si debilitan aserciones: descartar la corrida."
    rm -f "$CURRENT"
    exit 1
    ;;
  *)
    echo "uso: freeze-tests.sh {seal|verify} <proyecto>" >&2; exit 1 ;;
esac
