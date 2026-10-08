#!/usr/bin/env bash
#
# preflight-model.sh — CANARIO DE CAPACIDAD antes de despachar.
#
# Uso:
#   ./scripts/preflight-model.sh                 # canario con el modelo por defecto
#   ./scripts/preflight-model.sh --model <id>    # canario con otro modelo
#
# Por qué existe (v0.37):
#   El preflight viejo preguntaba «¿el modelo contesta?». Con un modelo pago estable
#   esa pregunta casi siempre da sí, y una verificación que nunca rechaza nada es lo
#   que la regla de poda manda eliminar. La pregunta que importa —«¿este modelo puede
#   hacer la tarea?»— nunca tuvo verificación.
#
#   Medido: `big-pickle` pasó el smoke y después LEYÓ el contexto y escribió CERO
#   archivos (143 líneas de log, 0 artefactos, salida en 0). Eso no era un modelo
#   caído: era un modelo incapaz.
#
# El canario despacha una tarea real MÍNIMA y pasa SOLO si se cumplen las tres:
#   1. el archivo pedido EXISTE en disco            → contra la corrida vacía
#   2. la suite que escribió FALLA POR ASERCIÓN     → contra el RED falso por ENOENT
#   3. el reporte trae las secciones del formato    → contra el modelo que no lo respeta
# Si falta una, el canario RECHAZA y no se despacha.
#
# ESCRIBE: el preflight NO deja artefactos: el canario corre DENTRO del proyecto, en
# zsh usa rutas relativas. Ninguna redirección fuera de .tmp/. macOS no trae `timeout`.

set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT="${AGENT:-opencode}"
CANARY_TIMEOUT="${CANARY_TIMEOUT:-180}"
CANARY_MODEL="${CANARY_MODEL:-opencode-go/glm-5.3-flash}"

if [ "${1:-}" = "--model" ]; then
  CANARY_MODEL="${2:-}"
  [ -z "$CANARY_MODEL" ] && { echo "uso: preflight-model.sh [--model <id>]" >&2; exit 1; }
fi

# macOS no trae `timeout`; si existe lo usamos, si no, corre directo.
TIMEOUT_BIN="$(command -v timeout || command -v gtimeout || true)"
run_with_timeout() {
  if [ -n "$TIMEOUT_BIN" ]; then "$TIMEOUT_BIN" "$CANARY_TIMEOUT" "$@"; else "$@"; fi
}

command -v "$AGENT" >/dev/null 2>&1 || { echo "FALTA: $AGENT no está en PATH" >&2; exit 1; }
command -v node  >/dev/null 2>&1 || { echo "FALTA: node no está en PATH" >&2; exit 1; }

# La lista de modelos depende de las credenciales, no solo del binario.
AVAILABLE="$("$AGENT" models 2>/dev/null || true)"
if ! printf '%s\n' "$AVAILABLE" | grep -qx "$CANARY_MODEL"; then
  echo "❌ $CANARY_MODEL NO está en el catálogo de $AGENT (¿credencial faltante?)." >&2
  echo "   corriendo '$AGENT models' para ver qué hay disponible." >&2
  exit 1
fi

# Espacio del canario: DENTRO del harness, en .tmp/ (la misma regla que al Coder).
CANARY_DIR="$HARNESS_DIR/.tmp/canario"
rm -rf "$CANARY_DIR"; mkdir -p "$CANARY_DIR"

echo "→ Canario de capacidad · modelo: $CANARY_MODEL"

PROMPT="Eres un canario de capacidad. Trabajá SOLO dentro del directorio de trabajo, sin salir de él.
1) Creá el archivo canario.test.mjs: un test de node:test que importa node:test y node:assert/strict, define const saludo = 'ADIOS' y afirma assert.equal(saludo, 'HOLA'). El test DEBE fallar POR ASERCIÓN (no por error de carga ni import faltante).
2) Creá el archivo salida.txt con el texto CANARIO_OK.
3) Corré 'node --test .' y guardá la salida en evidencia.txt.
4) Reportá EXACTAMENTE estas secciones en este orden: RED, GREEN, TABLA, BLOQUEOS. Nada más."

OUT="$(cd "$CANARY_DIR" && run_with_timeout "$AGENT" run --model "$CANARY_MODEL" "$PROMPT" 2>&1)"
printf '%s\n' "$OUT" > "$CANARY_DIR/reporte.txt"

FALLOS=0

# --- Condición 1: el archivo pedido existe ---------------------------------
if [ -f "$CANARY_DIR/canario.test.mjs" ]; then
  echo "  ✓ 1/3 el archivo pedido existe (contra la corrida vacía)"
else
  echo "  ✗ 1/3 el archivo pedido NO existe — corrida vacía (leyó el contexto y no escribió nada)"
  FALLOS=$((FALLOS + 1))
fi

# --- Condición 2: la suite falla por ASERCIÓN, no por error de carga --------
if [ -f "$CANARY_DIR/canario.test.mjs" ]; then
  TEST_OUT="$(cd "$CANARY_DIR" && node --test . 2>&1)"; TEST_RC=$?
  if [ "$TEST_RC" -eq 0 ]; then
    echo "  ✗ 2/3 la suite del canario PASA — no hay RED por aserción (o el test no prueba nada)"
    FALLOS=$((FALLOS + 1))
  elif printf '%s' "$TEST_OUT" | grep -qE 'ENOENT|Cannot find module|ERR_MODULE_NOT_FOUND|SyntaxError'; then
    echo "  ✗ 2/3 la suite REVIENTA al cargar (ENOENT / import faltante) — no es un RED por aserción"
    FALLOS=$((FALLOS + 1))
  else
    echo "  ✓ 2/3 la suite falla por aserción (contra el RED falso)"
  fi
else
  echo "  ✗ 2/3 sin archivo de test no se puede evaluar el RED"
  FALLOS=$((FALLOS + 1))
fi

# --- Condición 3: el reporte trae las secciones del formato ----------------
# Las secciones obligatorias del formato son RED, GREEN y BLOQUEOS (TABLA es
# omitible si el trabajo no involucra umbrales).
if printf '%s' "$OUT" | grep -qi 'RED' && printf '%s' "$OUT" | grep -qi 'GREEN' && printf '%s' "$OUT" | grep -qi 'BLOQUEOS'; then
  echo "  ✓ 3/3 el reporte trae las secciones del formato (RED / GREEN / BLOQUEOS)"
else
  echo "  ✗ 3/3 el reporte NO respeta el formato (falta RED, GREEN o BLOQUEOS)"
  FALLOS=$((FALLOS + 1))
fi

echo
if [ "$FALLOS" -eq 0 ]; then
  echo "✅ CANARIO PASA: $CANARY_MODEL es capaz de la tarea mínima."
  echo "   despachar con: $AGENT run --model $CANARY_MODEL '...'"
  exit 0
fi

echo "❌ CANARIO RECHAZA: $CANARY_MODEL falló $FALLOS de 3 condiciones."
echo "   NO se despacha. Ver el detalle en $CANARY_DIR/reporte.txt"
echo "   Si el default falla dos veces, se sube a la fila de escalada (MODEL-ROUTING.md)."
exit 1
