# ADR-004 — Sin build: HTML, CSS y JS nativos

- **Fecha:** 2026-10-08
- **Estado:** aceptado
- **Decisor:** Arquitecto (Hornada, ciclo 1)

## Contexto

El contrato del Coder dice, desde el harness, **"no agregues dependencias de
runtime: el entregable corre sin `npm install`"**. Ese límite no es un capricho: un
build es un paso más que puede romperse, una versión más que puede cambiar sola, y
una razón por la que "en mi máquina funciona".

El producto, además, es chico: cinco pantallas, una API de nueve endpoints.

## Decisión

`public/index.html` + `public/app.js` + `public/styles.css`, **JS nativo**: `fetch`,
manipulación del DOM directa, ruteo por hash (`#/`, `#/hornada/:id`,
`#/reserva/:codigo`, `#/cocina`). Sin framework, sin bundler, sin transpilador, sin
dependencias.

## Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| **React / Vue con Vite** | Trae `node_modules`, un paso de build, un artefacto intermedio y una superficie de dependencias que hay que mantener. Para cinco pantallas, el framework cuesta más de lo que ahorra |
| **Alpine.js o htmx por CDN** | Menos peso, pero sigue siendo una dependencia **externa cargada en runtime**: si el CDN no responde, la app no funciona. Y agrega un modo de fallar que no controlamos |
| **Web Components con lit** | El mismo argumento que React, con menos comunidad: se paga la ceremonia sin la red de seguridad |
| **Sin JS: formularios HTML que devuelven HTML** | Sería el camino más simple, pero deja al Worker renderizando plantillas (más CPU por request) y pierde la vista previa del cupo sin recargar |

## Consecuencias

**Positivas:**
- La suite de tests no depende de un build: se levanta la app y se prueba.
- El Coder no puede introducir una dependencia sin violar el contrato de forma
  **verificable**: si aparece `node_modules/` o un `import` de un paquete, la
  revisión lo ve.
- Los assets se sirven tal cual, sin huella de build ni source maps publicados.

**Negativas / costo asumido:**
- El DOM se maneja a mano: hay que ser disciplinado con el render (una función que
  pinta, no veinte que mutan).
- Sin tipos ni componentes reutilizables: a partir de ~10 pantallas esto empieza a
  costar, y ahí se reevalúa.

**Qué se vuelve difícil después de esto:**
- Estado complejo en el cliente (carrito, flujos largos). Cuando aparezca, la
  discusión de un framework vuelve — con el producto ya validado, que es el momento
  correcto para pagarla.
