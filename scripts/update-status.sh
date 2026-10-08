#!/usr/bin/env bash
#
# update-status.sh — Refresca el tablero y lo publica.
#
# Uso:
#   ./scripts/update-status.sh <ruta-del-proyecto> [--push]
#
# Hace: render-status.mjs → progreso.html → (opcional) commit + push.
# Pensado para correrlo tras cada hito, mientras el Coder avanza.
#
# Requiere: repo PÚBLICO para que Pages publique (en privado con plan free, 422).

set -uo pipefail

PROJECT_DIR="${1:-}"
PUSH=0
[ "${2:-}" = "--push" ] && PUSH=1

[ -z "$PROJECT_DIR" ] && { echo "uso: update-status.sh <ruta-del-proyecto> [--push]" >&2; exit 1; }
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -f "$PROJECT_DIR/docs/estado.json" ] || {
  echo "Falta $PROJECT_DIR/docs/estado.json — el estado vive ahí, no en el HTML." >&2
  exit 1
}

node "$SCRIPT_DIR/render-status.mjs" "$PROJECT_DIR" || exit 1

if [ "$PUSH" -eq 1 ]; then
  cd "$PROJECT_DIR" || exit 1

  # El tablero y el estado se commitean en `main` (v0.24; SIMPLIFICADO en v0.36).
  #
  # Por qué existía todo el worktree: el ciclo vivía en `ciclo/<n>` y GitHub Pages
  # publica desde `main`, así que commitear el tablero donde estabas lo dejaba en una
  # rama que nadie sirve — el tablero público se congelaba mientras el ciclo avanzaba
  # (pasó: el local decía 1/8 y el publicado 0/8, sin ningún error).
  #
  # Con UNA SOLA LÍNEA (PROCESS.md, regla 12 → [L-05]) no hay otra rama que proteger: publicar
  # el tablero era una ceremonia de cuatro pasos —worktree, copiar el estado, render
  # allá, alinear la rama— solo porque el trabajo vivía en otro lado. Ahora va directo.
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$BRANCH" != "main" ]; then
    echo "  ⚠ estás en '$BRANCH', no en 'main': el tablero se publica desde main." >&2
    echo "    Con una sola línea (regla 12) esto no debería pasar." >&2
  fi

  git add progreso.html docs/estado.json docs/historial.json 2>/dev/null
  if git diff --cached --quiet; then
    echo "  (sin cambios que publicar)"
  else
    git -c user.name="Christian Bobadilla" \
        -c user.email="cabobadilla@users.noreply.github.com" \
        commit -q -m "tablero: actualizar avance"
    git push -q 2>&1 | tail -1
  fi

  REMOTE="$(git config --get remote.origin.url || true)"
  case "$REMOTE" in
    *github.com[:/]*)
      SLUG="$(printf '%s' "$REMOTE" | sed -E 's#.*github\.com[:/]##; s#\.git$##')"
      OWNER="${SLUG%%/*}"; REPO="${SLUG##*/}"
      echo "  publicado: https://${OWNER}.github.io/${REPO}/progreso.html"
      ;;
  esac
fi
