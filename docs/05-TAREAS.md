# 05 — Tareas

> Fase 4 (salida del Arquitecto). Descomposición en unidades ejecutables por el
> Coder. Una tarea = un ciclo TDD.

- **Proyecto:** Hornada
- **Fecha:** 2026-10-08
- **Basado en:** `04-DISENO.md` (G2 ✅) y `03-DEFINICION.md` (G1 ✅)

## Reglas

1. Cada tarea es ejecutable de forma **independiente**.
2. Cada tarea apunta a ≥1 criterio de aceptación de `03-DEFINICION.md`.
3. Cada tarea se implementa con **tests primero** (RED → GREEN → REFACTOR).
4. Una tarea a la vez, en el workdir del Coder.
5. **Cada tarea declara los IDs de caso de la matriz que debe cubrir.** El Coder
   **puede agregar casos**; no puede dejar de cubrir ninguno de los declarados.

**Orden de despacho:** T-1 → T-2 → T-3 → T-5 → T-6 → T-7 → T-8 → T-9 → T-4 → T-10.
T-4 (forma) va **al final del trabajo de código** a propósito: mide geometría de
pantallas que tienen que existir antes, y un test de forma sobre una pantalla a medio
construir da un rojo que no significa nada.

## Tareas

### T-1 — El cocinero se registra

- **Cubre:** HU-1 (C-01, C-02, C-03)
- **Casos que debe cubrir:** `C-01`, `C-02`, `C-03`
- **Entrada:** `04-DISENO.md` — contrato de `POST /api/cocineros` y esquema de `cocineros`
- **Salida:** `src/index.js`, `migrations/0001_init.sql`, `public/index.html`, `public/app.js`, `public/styles.css`
- **Test primero:** `POST /api/cocineros` con nombre y sector crea el cocinero y devuelve `token`; sin nombre o sin sector devuelve 400 con el error nombrado y **no** crea nada.
- **Criterio de terminado:** los 3 casos en verde contra `wrangler dev`, con el formulario existiendo en el DOM real.

- [ ] Test escrito y fallando (RED) — evidencia:
- [ ] Implementación mínima que lo pasa (GREEN)
- [ ] Refactor sin romper tests
- [ ] Commit

### T-2 — El cocinero publica su hornada

- **Cubre:** HU-2 (C-04, C-05, C-06, C-07)
- **Casos que debe cubrir:** `C-04`, `C-05`, `C-06`, `C-07`
- **Entrada:** el `token` que devuelve T-1; contrato de `POST /api/hornadas`
- **Salida:** pantalla "Mi hornada", endpoints de alta, validaciones
- **Test primero:** publicar crea la hornada abierta con `disponibles === unidades`; una segunda abierta del mismo cocinero da 409; `unidades: 0` y `precio: 0` dan 400.
- **Criterio de terminado:** los 4 casos en verde y **una sola** hornada abierta por cocinero, comprobado por consulta.

- [ ] Test escrito y fallando (RED) — evidencia:
- [ ] Implementación mínima que lo pasa (GREEN)
- [ ] Refactor sin romper tests
- [ ] Commit

### T-3 — El cliente descubre lo que se hornea en su sector

- **Cubre:** HU-3 (C-08, C-09, C-29)
- **Casos que debe cubrir:** `C-08`, `C-09`, `C-29`
- **Entrada:** hornadas creadas por T-2
- **Salida:** `GET /api/hornadas?sector=…` + pantalla del listado con estado vacío
- **Test primero:** con 2 abiertas en el sector y 1 en otro, el listado devuelve 2 y ordena por `desde`; una agotada no aparece; un sector sin hornadas deja `#estado-vacio`.
- **Criterio de terminado:** los 3 casos en verde; **el cupo que muestra el listado es el que devuelve la API**, no un cálculo del cliente.

- [ ] Test escrito y fallando (RED) — evidencia:
- [ ] Implementación mínima que lo pasa (GREEN)
- [ ] Refactor sin romper tests
- [ ] Commit

### T-4 — La forma del listado (medición)

- **Cubre:** HU-3 (C-10, C-11, C-12, C-13)
- **Casos que debe cubrir:** `C-10`, `C-11`, `C-12`, `C-13`
- **Entrada:** el listado ya funcionando (T-3); el mockup congelado como **PNG** (`docs/mockup/mockup-ciclo-1.png`)
- **Salida:** CSS/estructura que cumpla las 4 mediciones
- **Test primero:** con viewport de 390 px, `getBoundingClientRect()` de las tarjetas: `left` iguales ±2 px, apiladas, chip a 13 px de arriba y de la derecha, botón del ancho interno −2 px y ≥ 44 px de alto, y contraste ≥ 4,5:1 medido con la fórmula de luminancia WCAG.
- **Criterio de terminado:** los 4 casos en verde **midiendo el DOM real por CDP**, no leyendo el CSS.
- **Nota:** es la única tarea sin lógica nueva. Su valor es que la forma quede medida, no opinada.

- [ ] Test escrito y fallando (RED) — evidencia:
- [ ] Implementación mínima que lo pasa (GREEN)
- [ ] Refactor sin romper tests
- [ ] Commit

### T-5 — Reservar sin sobreventa

- **Cubre:** HU-4 (C-14, C-15, C-16, C-17) y HU-7 (C-21)
- **Casos que debe cubrir:** `C-14`, `C-15`, `C-16`, `C-17`, `C-21`
- **Entrada:** hornadas de T-2; contrato de `POST /api/hornadas/:id/reservas`
- **Salida:** el endpoint con el **UPDATE condicional** del diseño, y la pantalla de reserva
- **Test primero:** reservar N descuenta N y devuelve `donde`; pedir más que el cupo da 409 **y el cupo queda idéntico**; reservar el cupo exacto deja `disponibles = 0` y `estado = 'cerrada'`; sin nombre o contacto da 400; sobre una cerrada da 409.
- **Criterio de terminado:** los 5 casos en verde, con el cupo **releído desde la API** después de cada intento.

- [ ] Test escrito y fallando (RED) — evidencia:
- [ ] Implementación mínima que lo pasa (GREEN)
- [ ] Refactor sin romper tests
- [ ] Commit

### T-6 — Retiro o despacho

- **Cubre:** HU-8 (C-22, C-23, C-24)
- **Casos que debe cubrir:** `C-22`, `C-23`, `C-24`
- **Entrada:** T-5 (reserva funcionando) y las `modalidades` de la hornada
- **Salida:** selector de modalidad en la pantalla de reserva, validación y campo condicional de dirección
- **Test primero:** modalidad no ofrecida → 400 `modalidad_no_ofrecida`; despacho sin dirección → 400 `falta_direccion`; retiro → 201 con `donde === referencia_retiro`; el panel del cocinero muestra la dirección del despacho.
- **Criterio de terminado:** los 3 casos en verde; el formulario **no permite elegir** una modalidad que la hornada no ofrece.

- [ ] Test escrito y fallando (RED) — evidencia:
- [ ] Implementación mínima que lo pasa (GREEN)
- [ ] Refactor sin romper tests
- [ ] Commit

### T-7 — El panel del cocinero

- **Cubre:** HU-5 (C-18, C-19)
- **Casos que debe cubrir:** `C-18`, `C-19`
- **Entrada:** reservas de T-5/T-6 y el `token` del cocinero
- **Salida:** `GET /api/cocineros/mi-panel?token=…`, `POST /api/reservas/:id/entregado` y la pantalla del panel
- **Test primero:** el panel lista las reservas de sus hornadas y **con el token de otro devuelve 403**; marcar entregado persiste (se relee el panel y sigue `entregada`).
- **Criterio de terminado:** los 2 casos en verde; ningún dato de otro cocinero aparece en la respuesta.

- [ ] Test escrito y fallando (RED) — evidencia:
- [ ] Implementación mínima que lo pasa (GREEN)
- [ ] Refactor sin romper tests
- [ ] Commit

### T-8 — El cliente sigue su pedido

- **Cubre:** HU-6 (C-20)
- **Casos que debe cubrir:** `C-20`
- **Entrada:** el `codigo` que devuelve T-5
- **Salida:** `GET /api/reservas/:codigo` + pantalla de estado con `donde`
- **Test primero:** el código devuelve estado, unidades y `donde` de **esa** reserva; un código inexistente da 404 y no filtra datos de otras.
- **Criterio de terminado:** el caso en verde con el estado releído después de marcarla entregada (T-7).

- [ ] Test escrito y fallando (RED) — evidencia:
- [ ] Implementación mínima que lo pasa (GREEN)
- [ ] Refactor sin romper tests
- [ ] Commit

### T-9 — La calidad: reseñas y suspensión

- **Cubre:** HU-9 (C-25, C-26, C-27, C-28)
- **Casos que debe cubrir:** `C-25`, `C-26`, `C-27`, `C-28`
- **Entrada:** reservas entregadas (T-7)
- **Salida:** `POST /api/reservas/:codigo/resena`, promedio derivado en el listado y regla de suspensión
- **Test primero:** reserva no entregada → 409 `reserva_no_entregada`; entregada → 201; repetir → 409 `ya_calificada`; con 2 reseñas (5 y 4) el listado trae `promedio 4.5` y `resenas 2`; con 5 reseñas de 1 estrella el cocinero desaparece del listado, no acepta reservas nuevas y **su panel sigue mostrando las reservas vigentes** con el motivo.
- **Criterio de terminado:** los 4 casos en verde; el promedio se **deriva** en la lectura, sin job ni columna que se pueda desincronizar.

- [ ] Test escrito y fallando (RED) — evidencia:
- [ ] Implementación mínima que lo pasa (GREEN)
- [ ] Refactor sin romper tests
- [ ] Commit

### T-10 — Cierre: suite completa y smoke contra la URL publicada

- **Cubre:** la definición de "terminado" de `03-DEFINICION.md` (no agrega alcance)
- **Casos que debe cubrir:** los 29 — es la corrida completa de la suite en local
- **Entrada:** todo lo anterior
- **Salida:** `tests/evidence/GREEN-ciclo-1.txt` con la salida de la suite completa
- **Test primero:** no aplica: **es** la corrida de la suite.
- **Criterio de terminado:** la suite completa en verde **en local** y el `codigo de salida` de `node --test` en 0. El smoke contra la URL publicada lo corre **Hermes**, no el Coder.

- [ ] Suite completa en verde — evidencia:
- [ ] Commit

---

## Estado

| Tarea | Estado | Gate G3 (tests primero) | Notas |
|---|---|---|---|
| T-1 | pendiente | — | |
| T-2 | pendiente | — | |
| T-3 | pendiente | — | |
| T-4 | pendiente | — | va al final: mide pantallas ya construidas |
| T-5 | pendiente | — | la tarea crítica: sobreventa |
| T-6 | pendiente | — | |
| T-7 | pendiente | — | |
| T-8 | pendiente | — | |
| T-9 | pendiente | — | |
| T-10 | pendiente | — | no implementa nada: corre la suite completa |

---

**Gate G2 (salida de fase 4):** trazabilidad completa definición ↔ tareas. **G2 ✅**
