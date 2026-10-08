# 01 — Idea

> Fase 1. **No decidir nada aquí.** Capturar el requerimiento crudo, tal como se
> dijo. Si ya suena a solución, se anota igual y la crítica va en la fase 2.

- **Proyecto:** Hornada
- **Fecha:** 2026-10-08
- **Origen:** mensaje del usuario (Telegram)

## Requerimiento (verbatim)

> tengo una idea, quiero construir una web app para ordenar delivery de pan el cual
> puede ser cocinado por vecinos del sector donde vive la gente (por barrios o
> sectores), la idea es que los usuarios puean ordenar y pagar en la app (primero
> crear la app para que los cocinetos se registren y para que los clientes ordenen
> (el pago a posterior). Crea un nuevo repo para este proyecto (usa un nombre
> creativo), jala el Hermess Harnes e iniciemos el proceso

## Respuestas a las tres preguntas

> Se anexan acá, **nunca fusionadas con el verbatim**: G0 necesita la línea base.
> En esta ronda las tres tienen **respuesta del usuario**; no hay supuesto del PO.

**P1 — ¿Quién lo usa, y en qué momento concreto?**
- Vecinos de un barrio, para pedir pan a domicilio a un cocinero cercano.

**P2 — ¿Cómo sabremos que funcionó?** (resultado observable o métrica)
- Por los pedidos y el feedback de los usuarios.

**P3 — ¿Qué haría que esto sea un fracaso? ¿Qué queda explícitamente afuera?**
- Que los usuarios no confíen en los cocineros.
- Diferencial declarado: **no se requiere delivery**.

## Contexto adicional

- El pago va **a posterior**: el primer entregable es registro de cocineros +
  pedido de clientes.
- Repo: https://github.com/cabobadilla/Hornada (público, perfil `producto`).
- Nombre elegido por el PO: **Hornada** — la tanda de pan que sale del horno de una
  vez; es la unidad de producción del panadero de barrio.

## Lo que explícitamente se pidió

- [x] Web app para ordenar pan
- [x] El pan lo cocinan **vecinos del mismo barrio/sector**
- [x] Registro de cocineros
- [x] Pedido de clientes
- [ ] Pago en la app → **a posterior** (dicho por el usuario)
- [x] Repo nuevo con nombre creativo + harness aplicado

---

**Gate G0:** existe esta idea, sin interpretación agregada; **las tres preguntas
están formuladas y cada una tiene respuesta del usuario o supuesto escrito del PO.**
→ P1, P2 y P3 con **respuesta del usuario**. **G0 ✅**
