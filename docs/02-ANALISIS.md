# 02 — Análisis

> Fase 2. Dueño: **Product Owner**. Entender el problema **antes** de proponer
> nada. Las dudas se resuelven por **benchmark rápido** —no se le devuelven al
> usuario como cuestionario— y lo que decide el PO queda como **supuesto escrito**.

- **Proyecto:** Hornada
- **Fecha:** 2026-10-08

## El problema en una frase

Conseguir **pan fresco del día** sin depender del horario de la panadería ni de la
logística de un delivery: el vecino que ya hornea en su casa puede vender su tanda
a la gente de su propio barrio, que la retira al lado.

## ¿Quién lo sufre y con qué frecuencia?

Dos lados, y el segundo es el que hace que esto exista:

- **Cliente (vecino):** quiere pan fresco, todos los días o varias veces por semana.
  La panadería tiene horario, cola y precio; el pan no justifica pagar el sobreprecio
  de un delivery.
- **Cocinero (vecino con horno):** ya hornea —para su casa, de hobby, o como ingreso
  informal— y no tiene canal para venderle a alguien fuera de su círculo directo.
  Frecuencia diaria o semanal.

## ¿Qué pasa si no hacemos nada?

**Para el cliente el costo es casi cero**: sigue comprando en la panadería. Este
proyecto **no es una necesidad insatisfecha**: es una apuesta de conveniencia
(pan casero, a la vuelta, sin cola) y de comunidad.

El costo de inacción **sí es real para el cocinero**: sigue sin canal, y su
producción queda limitada a quien lo conoce. Esa asimetría define el orden del
ciclo 1: **primero se resuelve el lado del que cocina.**

## Preguntas abiertas

> Cada duda se resuelve acá: por benchmark rápido o por decisión del PO.

1. **¿Cómo se construye la confianza en el cocinero?** (el usuario lo declaró como
   el modo de fracaso)
   → **Resuelto por benchmark.** DishDivvy (LA) verifica certificación sanitaria
   *más* inspección de cocina; Fooch (Chile, 970 cocineros, 2.200 usuarios) no
   verifica y compensa con volumen y sin comisiones; ViandaApp (Chile) se declara
   **medio de contacto** y descarga la responsabilidad sanitaria en el cocinero.
   La inspección de cocinas es **operación, no software**, y no cabe en un ciclo.
   → La confianza del ciclo 1 se construye con lo que la app sí puede hacer:
   **identidad del cocinero** (nombre y foto reales, no un alias), **evidencia de
   vecindad** (su sector), **historial visible** (cuántas hornadas ha entregado y qué
   dijo quien las recibió) y **retiro en persona en la puerta del cocinero** —la
   verificación más fuerte y la gratis—. Supuesto A4.
2. **¿Qué se ordena: un menú o una tanda?**
   → **Decidido: una tanda.** El cocinero publica una **hornada**: fecha, unidades
   disponibles, precio por unidad y ventana de retiro. Al agotarse las unidades se
   cierra sola. El pan es perecible y se produce por lotes; copiar el modelo de
   restaurante (menú permanente + carrito infinito) promete stock que el cocinero no
   tiene, y eso rompe la confianza más rápido que cualquier otra cosa.
3. **¿Cómo sabe el cliente dónde retirar sin exponer la casa del cocinero?**
   → **Decidido.** El cocinero declara su **sector** y una **referencia** (texto
   libre: "portón azul frente a la plaza"); el punto exacto se comparte al
   confirmarse el pedido. Un listado público de direcciones de casas es un problema
   de seguridad, no un dato de producto.
4. **¿Se cobra dentro de la app en el ciclo 1?**
   → **No.** Dicho por el usuario ("el pago a posterior"). El precio se muestra
   informativo y el pago se arregla en el retiro, fuera de la app.
5. **¿Cómo se prueba el valor sin masa crítica en dos lados?**
   → **Decidido.** Ciclo 1 = **un solo sector piloto**, y el estado vacío del cliente
   invita a registrarse como cocinero en vez de mostrar una lista muerta.

## Supuestos

> Lo que damos por cierto sin verificarlo. Si alguno cae, cae el diseño.

- **A1** — El pan **se retira** en la casa del cocinero. No hay delivery. (Dicho por
  el usuario; es el diferencial del producto.)
- **A2** — El **sector/barrio** es la unidad de descubrimiento: el cliente elige su
  sector al entrar y ve solo lo de su sector.
- **A3** — Ciclo 1 **sin pago in-app**: el precio es informativo y se paga al retirar.
- **A4** — **No hay verificación de identidad ni sanitaria** en ciclo 1; la app se
  declara **medio de contacto** (patrón ViandaApp) y la responsabilidad del alimento
  es del cocinero. *Contradice parcialmente el P3 del usuario, así que sube explícito
  a G1.*
- **A5** — Es una **web app responsive** (celular primero). No hay app nativa.
- **A6** — **Sin comisión** en ciclo 1: no hay cobro, así que no hay comisión.
- **A7** — Un cocinero puede publicar varias hornadas, pero no dos solapadas en el
  tiempo: no puede prometer más pan del que hornea.

## Alcance propuesto (ciclo 1)

1. **Registro de cocinero:** nombre, sector, foto, qué hornea, referencia de retiro.
2. **Publicar hornada:** fecha, unidades, precio por unidad, ventana de retiro.
3. **Descubrimiento por sector:** el cliente elige su sector y ve las hornadas con
   cupo, ordenadas por fecha.
4. **Pedido:** el cliente reserva unidades con su nombre y contacto; el sistema
   descuenta del cupo y **no permite sobreventa**.
5. **El cocinero ve sus pedidos** de cada hornada y los marca entregados.
6. **El cliente ve el estado de su pedido** y, al confirmarse, el punto de retiro.
7. **La hornada se cierra sola** al agotarse las unidades o al pasar la ventana.

## Anti-alcance (lo que NO entra)

- Pago, cobro, comisión, cualquier pasarela. (Usuario: "a posterior".)
- Delivery, reparto, cadetería, ruteo. (Es el diferencial: no se requiere.)
- Validación sanitaria, inspección de cocinas, verificación de identidad.
- Chat entre cliente y cocinero; notificaciones push o email.
- Mapas, geolocalización por GPS, distancias.
- App nativa, login con terceros, multi-idioma.
- Panel de administración, analítica, reportería.

## Riesgos

- **R1 · Confianza (el que el usuario declaró).** Sin verificación, un cocinero
  desconocido es una apuesta. Mitigación en ciclo 1: identidad con foto real,
  historial de hornadas entregadas, retiro en persona, lenguaje explícito de
  responsabilidad. *No se elimina: se acota y se mide.*
- **R2 · Sanitario/legal (Chile).** Elaborar y vender alimentos exige autorización
  sanitaria o patente de microempresa familiar. El software no puede otorgarla ni
  debe aparentar que lo hace; sí puede **inducir** a alguien a vender sin permiso. Se
  acepta como riesgo declarado y se mitiga con el texto de responsabilidad de A4.
- **R3 · Masa crítica por sector.** Dos lados del mercado en un radio chico. Si el
  sector piloto no tiene cocineros, el cliente no ve nada. Mitigación: un solo sector
  y un estado vacío que recluta cocineros.
- **R4 · Perecibilidad y sobreventa.** Prometer más pan del que se hornea mata la
  confianza más rápido que cualquier otra cosa. Mitigación: cupo por hornada, cierre
  automático, A7.
- **R5 · Notificación.** Sin push ni email, ¿cómo se entera el cocinero de que tiene
  pedidos? Mitigación de ciclo 1: la app le muestra los pedidos al abrir y el cliente
  recibe el punto de retiro al confirmar. Es limitación declarada, no olvido.

## Veredicto

- [x] **Vale la pena** — razón: hay al menos tres productos equivalentes con tracción
  real y reciente (Fooch: 970 cocineros y 2.200 usuarios en Chile; DishDivvy: USD
  1,3M levantados y 500 cocineros; ViandaApp) y **ninguno se especializa en pan por
  tandas**. El pan es la única categoría donde "no se requiere delivery" es
  literalmente cierto —el pan se retira al lado— y donde producir por lotes ya es la
  forma natural de trabajar del cocinero. El ciclo 1 prueba exactamente eso: **lado
  cocinero + pedido, sin pago y sin reparto.**
- [ ] No vale la pena
- [ ] Todavía no

**Lo que sube a G1 (decisión del usuario, no del PO):** **A4** — sin verificación de
identidad ni sanitaria en el ciclo 1, la app se declara medio de contacto. Es lo que
contradice parcialmente el P3 ("que los usuarios no confíen en los cocineros"), y es
caro de revertir si el usuario quiere que la verificación entre ahora.

---

**Gate G1a:** dudas resueltas (5), supuestos declarados (A1–A7), anti-alcance (11
puntos), veredicto con razón. **G1a ✅**
