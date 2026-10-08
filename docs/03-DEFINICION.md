# 03 — Definición

> Fase 3. Dueño: **Product Owner**. Convertir el problema en una spec
> **verificable**. Termina con el gate humano.

- **Proyecto:** Hornada
- **Fecha:** 2026-10-08
- **Iteración:** Ciclo 1 — registro de cocineros + pedido de clientes (sin pago, sin delivery)
- **Basado en:** `01-IDEA.md` (G0), `02-ANALISIS.md` (G1a)

## Historias de usuario

### HU-1 · El cocinero se registra
**Como** vecino que hornea en su casa
**quiero** registrarme como cocinero de mi sector
**para** que la gente de mi barrio me encuentre y me compre el pan

**Criterios de aceptación (EARS + clase):**

- **C-01** · clase `existencia`
  CUANDO un vecino abre "Quiero cocinar" EL SISTEMA DEBE mostrar el formulario de
  registro con nombre, foto, sector y referencia de retiro.
- **C-02** · clase `comportamiento`
  CUANDO el vecino envía el formulario completo EL SISTEMA DEBE crear su perfil de
  cocinero y listarlo en su sector.
- **C-03** · clase `comportamiento`
  SI falta el nombre o el sector ENTONCES EL SISTEMA DEBE rechazar el registro,
  señalar el campo faltante y no crear el perfil.

### HU-2 · El cocinero publica su hornada
**Como** cocinero registrado
**quiero** publicar la hornada que voy a sacar del horno
**para** que los vecinos reserven antes de que se enfríe

**Criterios de aceptación (EARS + clase):**

- **C-04** · clase `existencia`
  CUANDO el cocinero abre "Mi hornada" EL SISTEMA DEBE mostrar el formulario con qué
  hornea, cuándo, cuántas unidades, precio por unidad y referencia de retiro.
- **C-05** · clase `comportamiento`
  CUANDO el cocinero publica una hornada EL SISTEMA DEBE crearla **abierta**, con el
  cupo disponible igual a las unidades declaradas.
- **C-06** · clase `comportamiento`
  SI el cocinero ya tiene una hornada abierta ENTONCES EL SISTEMA DEBE rechazar la
  segunda y decir por qué. (Supuesto A7: no se promete más pan del que se hornea.)
- **C-07** · clase `comportamiento`
  SI el cocinero declara 0 unidades o un precio ≤ 0 ENTONCES EL SISTEMA DEBE rechazar
  la publicación.

### HU-3 · El cliente descubre lo que se hornea en su sector
**Como** vecino del sector
**quiero** ver las hornadas abiertas cerca de mi casa
**para** decidir a quién comprarle el pan

**Criterios de aceptación (EARS + clase):**

- **C-08** · clase `comportamiento`
  CUANDO el cliente elige su sector EL SISTEMA DEBE listar **solo** las hornadas
  abiertas de ese sector, ordenadas por fecha de retiro ascendente.
- **C-09** · clase `comportamiento`
  SI una hornada está agotada o su ventana ya pasó ENTONCES EL SISTEMA NO DEBE
  mostrarla en el listado.
- **C-29** · clase `existencia`
  SI el sector elegido no tiene ninguna hornada abierta ENTONCES EL SISTEMA DEBE
  mostrar el **estado vacío** con la invitación a registrarse como cocinero, y no una
  lista vacía sin salida.
- **C-10** · clase `forma`
  MIENTRAS el cliente ve el listado en una pantalla de 390 px de ancho, EL SISTEMA
  DEBE disponer las tarjetas en **una sola columna**: los `left` de las tarjetas
  coinciden (±2 px) y el `top` de cada una es **≥** el `bottom` de la anterior.
  → **Medición:** `getBoundingClientRect()` sobre las tarjetas (medido en el mockup
  congelado: `left` = 45/45/45).
- **C-11** · clase `forma`
  MIENTRAS el listado muestra tarjetas, EL SISTEMA DEBE anclar el **chip de cupo**
  dentro del vértice superior derecho de su tarjeta, con el mismo margen en todas:
  `cupo.top − tarjeta.top` y `tarjeta.right − cupo.right` iguales entre tarjetas
  (±2 px).
  → **Medición:** `getBoundingClientRect()` (medido en el mockup: 13 px / 13 px en las
  tres tarjetas).
- **C-12** · clase `forma`
  CUANDO una tarjeta muestra su botón de reserva EL SISTEMA DEBE hacerlo ocupar el
  **ancho interno completo** de la tarjeta —`|ancho_interno − ancho_botón| ≤ 2 px`—,
  con el mismo margen al borde inferior de la tarjeta en todas (±2 px) y un alto
  ≥ 44 px.
  → **Medición:** `getBoundingClientRect()` (medido en el mockup: 276 − 274 = 2 px,
  13 px al fondo, 44 px de alto).
- **C-13** · clase `forma`
  MIENTRAS la app muestra texto secundario (metadatos de la tarjeta y avisos), EL
  SISTEMA DEBE sostener un **contraste ≥ 4,5:1** entre el texto y su fondo.
  → **Medición:** fórmula de luminancia relativa WCAG sobre el color computado
  (medido en el mockup: 6,17:1 y 5,82:1).

### HU-4 · El cliente reserva unidades
**Como** cliente
**quiero** reservar las unidades que necesito, para retirarlas o para que me las lleven
**para** asegurarme el pan antes de que se agote

**Criterios de aceptación (EARS + clase):**

- **C-14** · clase `comportamiento`
  CUANDO el cliente reserva N unidades de una hornada abierta EL SISTEMA DEBE
  descontar N del cupo disponible y devolverle **dónde y cómo obtiene su pan** (la
  referencia de retiro si eligió retiro; la dirección que dejó, si eligió despacho).
  (Ampliado en G1: la reserva incluye la **modalidad**.)
- **C-15** · clase `comportamiento`
  SI el cliente pide más unidades que las disponibles ENTONCES EL SISTEMA DEBE
  rechazar la reserva y dejar el cupo **intacto**. (No hay sobreventa: riesgo R4.)
- **C-16** · clase `comportamiento`
  SI el cliente reserva la última unidad disponible ENTONCES EL SISTEMA DEBE dejar el
  cupo en 0 y cerrar la hornada.
- **C-17** · clase `comportamiento`
  SI el cliente no deja nombre o contacto ENTONCES EL SISTEMA DEBE rechazar la
  reserva.

### HU-5 · El cocinero ve quién retira su pan
**Como** cocinero
**quiero** ver la lista de reservas de mi hornada
**para** saber cuánto pan entregar y a quién

**Criterios de aceptación (EARS + clase):**

- **C-18** · clase `comportamiento`
  CUANDO el cocinero abre "mis pedidos" EL SISTEMA DEBE listar los pedidos de su
  hornada con nombre, unidades y contacto del cliente, y **solo** los suyos.
- **C-19** · clase `comportamiento`
  CUANDO el cocinero marca un pedido como entregado EL SISTEMA DEBE persistir ese
  estado y reflejarlo al volver a abrir la lista.

### HU-6 · El cliente sigue su pedido
**Como** cliente
**quiero** ver el estado de mi reserva
**para** saber si el pan me espera y dónde retirarlo

**Criterios de aceptación (EARS + clase):**

- **C-20** · clase `comportamiento`
  CUANDO el cliente consulta su reserva EL SISTEMA DEBE mostrar su estado
  (`reservada` | `entregada`) y su punto de retiro, y **no** los de otros clientes.

### HU-7 · La hornada se cierra sola
**Como** cocinero
**quiero** que mi hornada deje de aceptar reservas cuando se agota o se pasa la hora
**para** no quedar debiendo pan

**Criterios de aceptación (EARS + clase):**

- **C-21** · clase `comportamiento`
  MIENTRAS una hornada está agotada o pasó su ventana de retiro, EL SISTEMA DEBE
  marcarla **cerrada** y rechazar cualquier reserva nueva.

### HU-8 · El cocinero declara cómo entrega  *(agregada en G1)*
**Como** cocinero
**quiero** decidir si el pan se retira en mi casa o si yo lo llevo
**para** ofrecer lo que puedo cumplir según mi tiempo y mi sector

**Criterios de aceptación (EARS + clase):**

- **C-22** · clase `comportamiento`
  CUANDO el cocinero publica su hornada EL SISTEMA DEBE registrar qué modalidades
  ofrece (**retiro**, **despacho**), y el cliente solo puede elegir entre las ofrecidas.
- **C-23** · clase `comportamiento`
  SI el cliente elige **despacho** ENTONCES EL SISTEMA DEBE exigirle una dirección y
  mostrársela al cocinero junto a su pedido.
- **C-24** · clase `comportamiento`
  SI el cliente elige **retiro** ENTONCES EL SISTEMA DEBE mostrarle la referencia de
  retiro del cocinero y **no** pedirle dirección.

### HU-9 · El cliente califica la hornada  *(agregada en G1 — es el mecanismo de calidad)*
**Como** cliente que ya recibió su pan
**quiero** dejar mi opinión sobre el cocinero
**para** que el resto del barrio sepa con quién está tratando

**Criterios de aceptación (EARS + clase):**

- **C-25** · clase `comportamiento`
  CUANDO un cliente con una reserva **entregada** califica EL SISTEMA DEBE guardar su
  puntaje (1–5) y su comentario, **una sola vez por reserva**.
- **C-26** · clase `comportamiento`
  MIENTRAS un cocinero tiene reseñas, EL SISTEMA DEBE mostrar su **promedio y su
  cantidad** en su tarjeta del listado.
- **C-27** · clase `comportamiento`
  SI un cocinero acumula **≥ 5 reseñas** y su promedio es **< 3,0** ENTONCES EL
  SISTEMA DEBE **suspenderlo**: sus hornadas dejan de aparecer y de aceptar reservas.
  *(Regla pedida por el usuario en G1: "un cocinero con malos reviews sale de la
  plataforma". El umbral 5 / 3,0 es supuesto del PO y se confirma con el usuario.)*
- **C-28** · clase `comportamiento`
  SI un cocinero está suspendido ENTONCES EL SISTEMA DEBE mantener vigentes las
  reservas ya hechas y decirle al cocinero el motivo de la suspensión.
  *(Protege al cliente de quedarse sin el pan que ya reservó.)*

## Etapas

**No aplica.** El ciclo 1 tiene un solo eje (el flujo cocinero→cliente). G1 agregó dos
superficies —modalidad de entrega y calificación— pero **no se multiplican entre sí**:
la modalidad es una elección de dos valores en un mismo formulario, y la calificación
es un paso posterior. No hay N × M que cortar.

`Retiro|Despacho × ...` no es complejidad combinada: no hay variantes visuales
distintas por modalidad, solo campos condicionales. El corte de etapas se revisará en
G2 si el diseño introduce variantes.

## Mockup (cierre de la fase 3)

> Lo construyó el **Arquitecto** —no el Coder— y quedó congelado. Al Coder le llega
> como **PNG**, nunca como HTML. Su entregable **son los criterios de `forma`**, no
> una aprobación.

- **URL del mockup:** https://hornada-mockup.mkvs.workers.dev
- **Captura congelada:** `docs/mockup/mockup-ciclo-1.png`
- **Pantallas:** 1 · cliente descubre · 2 · cliente reserva · 3 · cocinero publica ·
  4 · cocinero entrega.
- **Criterios de clase `forma` extraídos:** **C-10, C-11, C-12, C-13** — cada uno con
  su medición tomada del mockup real y no de una impresión.
- **Superficies agregadas en G1 (modalidad de entrega y calificación):** el mockup
  **no generó criterios de `forma` nuevos** para ellas, y se declara por qué: son
  campos dentro de las mismas tarjetas y formularios ya congelados, así que heredan el
  sistema medido en C-11/C-12 (chip anclado, control a ancho interno, alto ≥ 44 px) en
  vez de introducir geometría nueva. Rehacer el mockup obligaría a reabrir G1 por
  atrás.

## Casos borde y de error

| Caso | Comportamiento esperado |
|---|---|
| El sector no tiene ninguna hornada abierta | Estado vacío que invita a **registrarse como cocinero**, no una lista muerta |
| Se agota la última unidad mientras alguien está reservando | La reserva que llega después se rechaza; nunca hay cupo negativo (C-15) |
| Dos reservas simultáneas por la última unidad | Solo una gana; la otra recibe el rechazo (C-15) |
| El cocinero publica con 0 unidades o precio 0 | Rechazo con razón (C-07) |
| La ventana de retiro ya pasó y nadie reservó | La hornada se cierra y desaparece del listado (C-09, C-21) |
| Reserva sin nombre o sin contacto | Rechazo con el campo señalado (C-17) |
| El cocinero quiere publicar una segunda hornada | Rechazo con razón (C-06) |
| El cliente pide despacho en una hornada que solo ofrece retiro | No puede elegirlo; solo ve las modalidades ofrecidas (C-22) |
| El cliente elige despacho y no deja dirección | Rechazo con el campo señalado (C-23) |
| El cliente intenta calificar dos veces la misma reserva | La segunda calificación se rechaza (C-25) |
| El cliente intenta calificar sin haber recibido el pan | No puede: la calificación exige reserva **entregada** (C-25) |
| El cocinero cae por debajo del umbral con reservas vivas | Se suspende para lo nuevo y **conserva** las reservas ya hechas (C-27, C-28) |
| El cliente abre el listado de un sector sin cocineros | Estado vacío que recluta cocineros, no una lista muerta |

## Definición de "terminado" para esta iteración

- [ ] Las 9 historias funcionan **ejecutando la app**, no leyendo el código.
- [ ] Los 29 criterios tienen su test, nombrado con su ID (`test('C-01 · …')`).
- [ ] La suite corre **verde en local** (`wrangler dev`) y el smoke corre contra la
      **URL publicada**.
- [ ] El cliente puede recorrer el camino completo (elegir sector → reservar, con
      retiro o despacho → calificar) **sin pago**, con un solo sector piloto.
- [ ] Ningún dato sensible en el repo; ningún secreto en el directorio publicado.

## Fuera de esta iteración

- Pago, cobro y comisión · **red de reparto o cadetería de terceros** (el despacho lo
  hace el propio cocinero, dentro de su sector) · chat · notificaciones push o email ·
  verificación de identidad y sanitaria · mapas y geolocalización · app nativa · panel
  de administración · costo o tarifa de despacho (el precio sigue siendo informativo y
  se paga al recibir). (Detalle y razón: `02-ANALISIS.md`, anti-alcance.)

---

## Aprobación

- [x] **Aprobado por el usuario** — fecha: **2026-10-08** (Telegram), con **3 cambios**.
- [ ] Cambios solicitados:

**Cambios pedidos en G1 y cómo se incorporaron:**

| # | Lo que dijo | Dónde quedó | Efecto |
|---|---|---|---|
| 1 | "la calidad se verifica por los **reviews** de los clientes; un cocinero con malos reviews **sale de la plataforma**" | **HU-9**, C-25 a C-28 | Nuevo mecanismo de calidad: calificación por reserva, promedio visible y **suspensión** bajo umbral. Reemplaza a la verificación sanitaria como mitigación de R1. |
| 2 | "el cliente puede escoger **retiro o despacho**" | **HU-8**, C-22 a C-24 | Se retira el supuesto A1 ("no hay delivery") y se reemplaza por modalidad elegible. El despacho lo hace **el cocinero**, dentro de su sector — no hay red de reparto. |
| 3 | sector **Chicureo – Piedra Roja**; producto **pan de varios tipos** | Mockup y `estado.json`; el listado admite cualquier tipo de pan | El mockup usa marraqueta / masa madre / hallullas como ejemplo; el tipo de pan es texto libre del cocinero. |

**Lo que queda como supuesto del PO y el usuario puede corregir en cualquier momento:**
el umbral de suspensión (**≥ 5 reseñas y promedio < 3,0**, C-27) y que el despacho no
tenga costo declarado en el ciclo 1.

---

**Gate G1 ⭐ (humano):** cada criterio está en EARS, declara su clase y se puede
convertir en un test; los de clase `forma` traen su medición (C-10 a C-13, medidas
sobre el mockup publicado). **Aprobado el 2026-10-08 con los 3 cambios de arriba.**
→ **G1 ✅**
