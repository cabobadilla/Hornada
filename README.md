# Hornada

Proyecto construido con **HermesHarness**.

- **Harness:** https://github.com/cabobadilla/HermesHarness.git @ `67ab014`
- **Perfil:** `producto`
- **Proceso:** idea → análisis → definición → diseño → implementación y pruebas

## Artefactos

| Archivo | Fase | Dueño |
|---|---|---|
| `docs/01-IDEA.md` | Idea | usuario / PO |
| `docs/02-ANALISIS.md` | Análisis | PO |
| `docs/03-DEFINICION.md` | Definición | PO → **aprobación humana** |
| `docs/04-DISENO.md` + `docs/ADR-*.md` | Diseño | Arquitecto |
| `docs/05-TAREAS.md` | Diseño (salida) | Arquitecto |
| `docs/06-QA-REPORT.md` | Implementación y pruebas | QA |
| `docs/PROMPT-CODER.md` | Contrato del Coder | Arquitecto |
| `docs/estado.json` | Tablero (perfil + gates + avance) | Hermes |
| `docs/corridas/` | Registro por corrida | Hermes |

## Guardias (scripts/)

El proceso no es solo documentación: estas guardias lo hacen cumplir.

| Script | Para qué |
|---|---|
| `preflight-model.sh` | Canario de CAPACIDAD del modelo antes de despachar |
| `freeze-tests.sh seal-from-commit / verify / verify-red` | Sella los tests contra su commit y reproduce el RED |
| `check-coverage.sh` | Todo caso de la matriz tiene test, o hueco declarado |
| `review.sh` | Revisión mecánica: tests, sello, frescura, commits, marcadores, contador de gates |
| `hidden-cases.sh run <ciclo>` | Corre los casos OCULTOS (solo después del commit final del Coder) |
| `update-status.sh [--push]` | Regenera y publica el tablero (`progreso.html`) |

## Estado

- [ ] G0 Idea registrada (con las tres preguntas)
- [ ] G1a Análisis decidido
- [ ] G1 Definición aprobada (+ mockup)
- [ ] G2 Diseño trazable
- [ ] G3 Tests primero
- [ ] G4 Code review
- [ ] G5 QA con evidencia (+ casos ocultos)
