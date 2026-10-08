# ADR-003 — Plataforma: Cloudflare Workers

- **Fecha:** 2026-10-08
- **Estado:** aceptado
- **Decisor:** Arquitecto (Hornada, ciclo 1)

## Contexto

El ciclo 1 tiene pantallas (HTML/CSS/JS) y una API con estado compartido: cupo de
cada hornada, reservas de todos los vecinos, reseñas y promedios. La decisión no se
toma por gusto sino por **lo que el artefacto hace en runtime**: acá hay código que
corre en el servidor y datos que dos personas distintas tienen que ver iguales.

El usuario revisa **en remoto**: cualquier cosa que tenga que probar tiene que estar
en una URL pública.

## Decisión

**Cloudflare Workers** con **Static Assets** y un binding **D1** (forma C del
harness). Las pantallas se sirven como assets gratis y el Worker solo se despierta
para `/api/*` (`run_worker_first: ["/api/*"]`).

## Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| **GitHub Pages** (estático puro) | No ejecuta código en el servidor. El cupo viviría en el navegador de cada vecino y dos podrían reservar la misma docena: rompe C-15 en su definición, no en su implementación |
| **Pages + un BaaS de terceros** (Firebase, Supabase) | Agrega una cuenta, un SDK y un proveedor más que administrar para un piloto de un barrio. Y la identidad/permisos del BaaS volverían a abrir el problema de A4 |
| **Pages + Cloudflare Functions** | Es una forma antigua de la misma plataforma; hoy Cloudflare recomienda Workers con Static Assets, no Pages. Elegir Pages sería elegir la ruta en retirada |
| **Servidor en la máquina del usuario** | El usuario revisa remoto: "levantá esto en tu Mac" no es una instrucción, es un callejón sin salida |
| **Plataforma con contenedores** (Fly, Render) | Sobredimensionado para un Worker de ~300 líneas y una D1. Arranque en frío, facturación por instancia y nada que el borde no resuelva mejor |

## Consecuencias

**Positivas:**
- Los assets no se facturan ni consumen CPU del script: el 95% del tráfico del
  producto es gratis e instantáneo.
- Un solo comando despliega todo (`npx wrangler deploy`) y `wrangler dev` corre el
  **mismo runtime** en local, sin credenciales: el Coder puede trabajar sin el token.
- Vista previa por ciclo sin depender de una beta: un Worker de vista previa.

**Negativas / costo asumido:**
- El plan Free tiene techo de CPU por request (10 ms) y de requests/día. Se mitigó
  acotando el listado a 50 filas y dejando las pantallas fuera del Worker.
- Al agotar la cuota de requests con `run_worker_first`, Cloudflare responde **429** y
  **no** cae de vuelta a los assets. Es un límite declarado en `04-DISENO.md`.
- El emulador local **no aplica los límites del plan**: hace falta el smoke contra la
  URL real para saber si lo desplegado es lo construido.

**Qué se vuelve difícil después de esto:**
- Procesos largos (informes, envíos masivos): el modelo es por request, no por
  trabajo en background. Llegado el caso se resuelve con Queues o Cron Triggers, sin
  cambiar de plataforma.
