# 04 — Diseño

> Fase 4. Dueño: **Arquitecto**. Decidir *cómo* se construye. Termina con
> trazabilidad completa hacia la definición.

- **Proyecto:**
- **Fecha:**
- **Basado en:** `03-DEFINICION.md`

## Arquitectura

### Componentes

| Componente | Responsabilidad | Límite |
|---|---|---|
| … | … | … |

### Flujo de datos

> Diagrama o descripción paso a paso.

### Diagrama

> Opcional: generar con la skill `architecture-diagram`.

## Contratos

> Lo bastante precisos para que el Coder no tenga que adivinar nada.

### API / Interfaces

```
<endpoint o firma>
Entrada: …
Salida: …
Errores: …
```

### Esquemas de datos

```
<estructura>
```

## Stack y dependencias

| Elección | Versión | Justificación |
|---|---|---|
| … | … | … |

## Despliegue  ⭐ OBLIGATORIA

> **El diseño no está terminado sin esto.** «Se despliega en Cloudflare» no es una
> respuesta: es el nombre de la plataforma. Ver la skill **`cloudflare-architecture`**
> para los límites reales, la elección de bindings y las trampas verificadas.
>
> **El despliegue se define para DOS entornos, no uno:** local y cloud. Un diseño
> que solo describe producción obliga a improvisar en la máquina de desarrollo —
> y ahí es donde aparece «en mi máquina funciona».

### Todo lo que se publica

> **«Despliegue» no es sinónimo de «el producto».** Declarar **todo** lo que queda
> publicado, con plataforma, dueño y comando. En el harness hay normalmente **dos**:

| Qué | Dónde | Quién | Cómo |
|---|---|---|---|
| **El producto** | … | el Orquestador | … |
| **El tablero** (`progreso.html`) | GitHub Pages (harness) | el Orquestador | `scripts/update-status.sh --push` |

Un diseño que menciona un solo destino deja creyendo que hay uno.

### Qué plataforma  ⭐ OBLIGATORIA

> **Decide el Arquitecto, no el gusto.** La pregunta no es «¿dónde me gusta
> desplegar?» sino **«¿qué tiene que hacer esto en runtime?»**.

| El artefacto es… | Plataforma | Por qué |
|---|---|---|
| **Solo HTML/CSS/JS estático** (sin código en el servidor) | **GitHub Pages** | Cero configuración, **cero token**, cero cuenta que administrar. El sitio ya existe: la URL aparece al hacer push. |
| **Con código en runtime** (Worker, API, bindings, estado, secretos) | **Cloudflare Workers** | Es la única que ejecuta. Pages no corre un script. |

**El corte suele ser de ETAPA, no de proyecto.** Un producto puede empezar estático y
volverse dinámico: la decisión se declara **con la etapa**, y se revisa cuando el
diseño cambia de etapa. «Ya veremos» no es una decisión.

⚠️ **Repos privados:** Pages gratis publica **solo repos públicos**. Si el repo es
privado, esa razón sola manda a Cloudflare.

⚠️ **Y el cruce con la vista previa por ciclo.** Pages sirve **una sola rama**, así que
no da una URL por rama gratis como Workers Builds. Para un artefacto estático **no hace
falta**: se publica el ciclo en una **ruta del mismo sitio**
(`https://<owner>.github.io/<repo>/preview/<ciclo>/`) — mismo origen que el tablero,
sin token y sin beta. Con Cloudflare, el equivalente es una **Preview URL**.
**La plataforma se elige por lo que corre; la vista previa se resuelve dentro de la
plataforma elegida.**

### Vista previa por ciclo  ⭐ OBLIGATORIA

> **Un ciclo no termina sin una URL que el humano pueda abrir.** El PO trabaja
> **remoto**: «corré esto en local» no es una instrucción, es un callejón sin salida.
> Un diseño que solo describe el despliegue de producción deja al PO sin forma de
> revisar nada hasta el final.

Declarar **cómo se ve el trabajo de cada ciclo antes de que exista producción**:

| | |
|---|---|
| **Mecanismo** | Cloudflare **Previews** (`npx wrangler preview`) o **Workers Builds** (Preview URL automática por rama). **NO** `--preview-alias`: Cloudflare lo desaconseja explícitamente — *«los Aliased Version URLs no crean recursos aislados por rama»*. |
| **Quién publica** | El **Orquestador**. El Coder **no despliega** y no tiene token. |
| **Cuándo** | Al cerrar cada ciclo, junto con el smoke. |
| **Dónde queda** | En el tablero y en el handoff: **la URL se entrega, no se describe**. |

⚠️ **Las Version URLs (`wrangler versions upload`) NO sirven para esto**: usan los
recursos de **producción**. Cloudflare: *«Do not use Version URLs for branch or pull
request testing.»*

⚠️ **Si el mecanismo está en beta o no se probó, decirlo.** Diseñar sobre una beta no
verificada es el mismo error que asumir que el PO está en la máquina.

### Forma del Worker

| Opción | Cuándo |
|---|---|
| **A · Solo assets** (sin `main`) | App estática. Requests de assets gratis e ilimitados |
| **B · Assets + Worker** | App estática **y** API. Solo se factura lo que toca el script |
| **C · Worker + bindings** | El caso B más almacenamiento |

**Elegida:** … **Por qué:** …

### Entornos

| | Local | Cloudflare |
|---|---|---|
| Comando | `npx wrangler dev` (¿qué puerto?) | `npx wrangler deploy` |
| Qué corre | … | … |
| **Qué NO corre igual** | … | — |

> **Paridad declarada, no supuesta.** El emulador local **no** aplica los límites del
> plan: algo que pasa en local puede fallar en producción.

### Dónde corren las pruebas  ⭐ OBLIGATORIA

> La pregunta «¿las pruebas corren en local o en Cloudflare?» **se responde acá**, no
> se deja abierta. Y la respuesta no es «una de las dos».

**Dos niveles, con propósitos distintos:**

| | **Suite** | **Smoke** |
|---|---|---|
| **Dónde** | **Local** (`wrangler dev` / Miniflare) | **Cloudflare** (la URL real) |
| **Cuándo** | Antes de cada merge, en cada ciclo | Después de cada deploy |
| **Qué prueba** | El **comportamiento** (la matriz de casos) | Que **lo desplegado es lo construido** y funciona en el edge |
| **Costo** | Cero cuota, cero red, determinista | Consume cuota real |
| **Quién la corre** | El **Coder** (y Hermes la verifica) | **Hermes**, el único que despliega |

**Por qué la suite NO corre en Cloudflare:** es determinista, no depende de la red ni
del plan, y no gasta la cuota diaria. Una suite que corre contra producción es lenta,
frágil, y **cambia el veredicto según el día**.

**Por qué el deploy SÍ necesita verificación en el edge:** el emulador local no aplica
los límites del plan (10 ms de CPU, cuotas, 429). **Un diseño que pasa en local puede
dar Error 1102 en producción.** El smoke test es chico y explícito: la URL responde,
los assets cargan, la versión desplegada es la construida, y nada sensible quedó
público.

> **El smoke no reemplaza la suite, y la suite no reemplaza el smoke.** Uno prueba que
> el producto hace lo que dice; el otro, que lo que está publicado es ese producto.

**Definir:** qué corre en la suite · qué corre en el smoke · quién despliega.

### Bindings

| Binding | Tipo (KV / D1 / R2 / DO / AI) | Para qué |
|---|---|---|
| … | … | … |

### Límite que puede romperlo

> ¿Cuál es el límite del plan que este diseño puede agotar, y **qué pasa** cuando se
> agota? (En Free, agotar requests con `run_worker_first` devuelve **429** y el sitio
> **no** cae de vuelta a los assets.)

- Límite: … → Consecuencia: …

### Presupuesto de CPU

> Qué hace el Worker **en el camino del request**. En Free el techo es **10 ms**:
> alcanza para headers, redirects, validar un token, proxear. No para parsear
> payloads grandes, plantillas pesadas o criptografía en bucle.

- …

### Secretos

> Dónde viven. Producción: `npx wrangler secret put <nombre>`. Local: `.dev.vars`
> (y en `.gitignore`). **Nunca en el repo, nunca en el directorio de assets.**

- …

### Rollback

- Comando: `npx wrangler rollback <version-id>` → **qué se restaura:** …

### ¿Hay algo en el directorio de assets que NO debe ser público?

> Todo lo que está ahí **se publica**. `.env`, source maps y `_worker.js` incluidos.

- …

## Decisiones (ADRs)

> Una decisión técnica no obvia = un ADR. Ver `templates/ADR.md`.

- `ADR-001-<tema>.md` — …
- `ADR-002-<tema>.md` — …

## Matriz de casos de prueba  ⭐ OBLIGATORIA

> **Los casos se identifican acá, en el diseño.** No son código: son el contrato de
> qué significa "terminado". El Coder los traduce a tests ejecutables y **puede
> agregar los que se le ocurran; no puede quitar ninguno.**
>
> **Por qué acá y no en el Coder.** El Coder es dueño de los tests, pero si además
> *inventa los casos*, decide qué significa "hecho" — y eso es alcance, con disfraz
> de test. `ROLES.md` ya dice que el Coder no decide alcance.

| ID | Caso | Criterio de origen | Tipo | Observable esperado |
|---|---|---|---|---|
| `C-01` | … | HU-1 / #1 | estructura / comportamiento / umbral / empaquetado | qué se mide y con qué límite |

**Reglas de la matriz:**

1. **Toda fila nace de un criterio de aceptación de la fase 3.** Un caso sin
   criterio de origen es alcance no pedido.
2. **El `ID` es el contrato.** El test que lo cubre **se nombra con ese ID**
   (`test('C-01 · …')`). Así la cobertura es **comprobable**:
   `scripts/check-coverage.sh <proyecto>` verifica que todo ID de la matriz tiene
   su test. Sin el ID en el nombre, la cobertura es una opinión.
3. **Todo criterio de aceptación tiene ≥1 caso.** Un criterio sin caso es un
   criterio que nadie va a verificar.
4. **`Observable esperado`: qué se mide.** No "funciona bien" — "el contador
   muestra `02/10` tras avanzar una piel". Si no se puede escribir el observable,
   el caso no está definido.
5. **Los casos de tipo `comportamiento` ejecutan el artefacto**, no lo leen. Un
   test que solo comprueba que existe el CSS que *haría* la transición no verifica
   la transición.
6. **Los umbrales se escriben numéricos y con su límite** (contraste ≥ 4.5:1,
   respuesta < 200 ms), nunca como "aceptable".

### Cobertura combinada

Si hay ejes que se multiplican (N variantes × M estados), **la matriz tiene una
fila por combinación o una fórmula explícita** (`C-40..C-59: 10 pieles × 2 modos`).
Una fórmula sin filas es donde se esconden los literales escritos en duro.

### Casos ocultos  (2–4 por ciclo)

> Además de esta matriz **visible**, el Arquitecto escribe **2–4 casos ocultos** del
> mismo ciclo, **mismo momento, distinto destino**: `oculto/<proyecto>/ciclo-<n>.test.mjs`
> en el harness, **fuera del alcance del Coder**. Se ejecutan en **G5** con
> `scripts/hidden-cases.sh run <proyecto> <ciclo>`, **solo después del commit final
> del Coder**. Un caso oculto rojo es un **hallazgo de QA** (la matriz visible era más
> angosta que el criterio), y al cierre **se promueve a esta matriz**.
>
> **Solo en perfiles `producto` y `cliente`** (ver `PROCESS.md` §2). El volumen importa:
> más de 4 es una segunda matriz en la sombra, y eso rompe que el contrato sea visible.

### Clase de criterio

> Cada fila declara la **clase** de su criterio de origen (de la fase 3):
> `existencia` | `comportamiento` | `forma`. Un caso de clase `forma` **mide geometría**
> (`getBoundingClientRect()` con tolerancia), no la describe. Es lo que evita el
> learning #46: seis casos en verde con la forma equivocada.

## Trazabilidad

> El eslabón completo: **criterio → caso → tarea → test**. Si falta un eslabón, algo
> se está colando sin verificar.

| Criterio (fase 3) | Casos | Tarea(s) | Test que lo cubre |
|---|---|---|---|
| HU-1 / #1 | `C-01`, `C-02` | T-1 | `C-01 · …` |

---

**Gate G2:** todo criterio tiene ≥1 caso **con observable esperado**, todo caso nace
de un criterio, toda tarea apunta a ≥1 caso, cada ADR tiene alternativas descartadas,
y **existe la sección de Despliegue** que distingue **local** de **cloud** y declara
el límite del plan que podría romper el diseño.
