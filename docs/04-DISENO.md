# 04 — Diseño

> Fase 4. Dueño: **Arquitecto**. Decidir *cómo* se construye. Termina con
> trazabilidad completa hacia la definición.

- **Proyecto:** Hornada
- **Fecha:** 2026-10-08
- **Basado en:** `03-DEFINICION.md` (G1 ✅ 2026-10-08, con 3 cambios)

## Arquitectura

Una sola aplicación. **Una página estática** que se sirve gratis desde el borde y
**una API chica** que es el único lugar donde hay estado. Nada de build, nada de
dependencias de runtime.

### Componentes

| Componente | Responsabilidad | Límite |
|---|---|---|
| `public/` (HTML + CSS + JS) | Las pantallas: listado del sector, reservar, panel del cocinero, resena | **No calcula cupo.** Muestra lo que la API dice; si calcula, miente |
| `src/index.js` (Worker) | Router de la API, validaciones, reglas de negocio | No renderiza HTML: solo JSON |
| D1 (`hornada`) | Estado: cocineros, hornadas, reservas, reseñas | Es la única fuente de verdad del cupo |
| Assets (binding `ASSETS`) | Sirve `public/` sin pasar por el Worker | Los requests de assets no se facturan ni consumen CPU del script |

### Flujo de datos

1. El cliente abre la app → los assets responden (el Worker **no** participa).
2. Elige sector → `GET /api/hornadas?sector=…` → el Worker consulta D1 y devuelve
   solo las hornadas **abiertas** del sector, con el promedio de reseñas del cocinero.
3. Reserva N unidades → `POST /api/hornadas/:id/reservas` → el Worker ejecuta un
   **UPDATE condicional** (`… AND disponibles >= N`); si `changes = 1` descontó y
   acepta; si no, responde `409` sin tocar el cupo. **Nunca hay sobreventa.**
4. Recibe un `codigo` de reserva (su llave, sin cuenta) para volver a mirarla.
5. El cocinero entra con **su token** → ve sus pedidos, marca entregado.
6. El cliente con reserva entregada califica → `POST /api/reservas/:codigo/resena`.
7. El promedio del cocinero se **deriva en la lectura**: si tiene ≥ 5 reseñas y
   promedio < 3,0, desaparece del listado (sus reservas vivas siguen vigentes).

### Diagrama

```
  navegador
     │  GET /                      │  /api/*
     ▼                             ▼
  ┌──────────────┐   no factura  ┌──────────────────┐
  │   ASSETS     │◄──────────────│  Worker (src)    │
  │  public/     │               │  router + reglas │
  └──────────────┘               └────────┬─────────┘
                                    UPDATE condicional
                                          ▼
                                   ┌─────────────┐
                                   │  D1 hornada │
                                   └─────────────┘
```

## Contratos

> Lo bastante precisos para que el Coder no tenga que adivinar. **Estos nombres son
> el contrato**: el test los nombra y el Coder los usa tal cual.

### API / Interfaces

```
POST /api/cocineros
Entrada: { nombre, sector, referencia_retiro, foto_url? }
Salida:  201 { cocinero: { id, nombre, sector, token } }
Errores: 400 { error: 'falta_nombre' | 'falta_sector' | 'falta_referencia_retiro' | 'json_invalido' }   ← C-03
         (los dos últimos los agregó la implementación de T-1 y el diseño los adopta: la
          columna `referencia_retiro` es NOT NULL, así que validarla es correcta)

GET /api/hornadas?sector=<texto>
Salida:  200 { hornadas: [ { id, pan, desde, hasta, disponibles, precio,
                            modalidades: ['retiro','despacho'],
                            referencia_retiro,
                            cocinero: { id, nombre, promedio, resenas } } ] }
         (solo ABIERTAS y no agotadas; orden: `desde` ascendente)   ← C-08, C-09, C-26, C-29
Errores: 400 { error: 'falta_sector' }

POST /api/hornadas
Entrada: { cocinero_token, pan, desde, hasta, unidades, precio, modalidades, referencia_retiro }
Salida:  201 { hornada: { id, unidades, disponibles: unidades, estado: 'abierta' } }
Errores: 403 { error: 'token_invalido' | 'cocinero_suspendido' }
         409 { error: 'ya_tiene_hornada_abierta' }   ← C-06
         400 { error: 'unidades_invalidas' | 'precio_invalido' | 'modalidades_invalidas' }  ← C-07

GET /api/hornadas/:id
Salida:  200 { hornada: { id, pan, desde, hasta, disponibles, precio, modalidades,
                          referencia_retiro, cocinero: { nombre, promedio, resenas } } }
Errores: 404 { error: 'no_existe' }

POST /api/hornadas/:id/reservas
Entrada: { nombre, contacto, unidades, modalidad, direccion? }
Salida:  201 { reserva: { codigo, unidades, total, modalidad,
                          donde } }        ← donde = referencia_retiro | direccion
Errores: 400 { error: 'falta_nombre' | 'falta_contacto' | 'falta_direccion' }  ← C-17, C-23
         400 { error: 'modalidad_no_ofrecida' }    ← C-22
         409 { error: 'sin_cupo' | 'hornada_cerrada' }  ← C-15, C-16, C-21
         404 { error: 'no_existe' }

GET /api/reservas/:codigo
Salida:  200 { reserva: { estado, unidades, modalidad, donde, hornada: { pan, desde, hasta },
                          puede_calificar: bool } }   ← C-20, C-25
Errores: 404 { error: 'no_existe' }

GET /api/cocineros/mi-panel?token=<token>
Salida:  200 { cocinero: { nombre, sector, promedio, resenas, suspendido, motivo_suspension },
               hornadas: [ { id, pan, desde, hasta, disponibles, estado,
                             reservas: [ { id, nombre, contacto, unidades, modalidad,
                                           direccion, estado } ] } ] }   ← C-18, C-28
Errores: 403 { error: 'token_invalido' }

POST /api/reservas/:id/entregado
Entrada: { cocinero_token }
Salida:  200 { reserva: { id, estado: 'entregada' } }   ← C-19
Errores: 403 { error: 'token_invalido' | 'no_es_tu_reserva' }
         404 { error: 'no_existe' }

POST /api/reservas/:codigo/resena
Entrada: { estrellas, comentario? }
Salida:  201 { resena: { estrellas } }
Errores: 400 { error: 'estrellas_invalidas' }          ← 1–5
         409 { error: 'ya_calificada' | 'reserva_no_entregada' }   ← C-25
         404 { error: 'no_existe' }
```

### Esquemas de datos

```sql
CREATE TABLE cocineros (
  id                 TEXT PRIMARY KEY,
  nombre             TEXT NOT NULL,
  sector             TEXT NOT NULL,
  referencia_retiro  TEXT NOT NULL,
  foto_url           TEXT,
  token              TEXT NOT NULL UNIQUE,
  creado_en          TEXT NOT NULL
);

CREATE TABLE hornadas (
  id                 TEXT PRIMARY KEY,
  cocinero_id        TEXT NOT NULL REFERENCES cocineros(id),
  pan                TEXT NOT NULL,
  desde              TEXT NOT NULL,   -- ISO
  hasta              TEXT NOT NULL,   -- ISO
  unidades           INTEGER NOT NULL CHECK (unidades > 0),
  disponibles        INTEGER NOT NULL CHECK (disponibles >= 0),
  precio             INTEGER NOT NULL CHECK (precio > 0),   -- CLP, entero
  modalidades        TEXT NOT NULL,   -- 'retiro,despacho'
  referencia_retiro  TEXT NOT NULL,
  estado             TEXT NOT NULL,   -- 'abierta' | 'cerrada'
  creada_en          TEXT NOT NULL
);

CREATE TABLE reservas (
  id          TEXT PRIMARY KEY,
  hornada_id  TEXT NOT NULL REFERENCES hornadas(id),
  codigo      TEXT NOT NULL UNIQUE,   -- llave del cliente, sin cuenta
  nombre      TEXT NOT NULL,
  contacto    TEXT NOT NULL,
  unidades    INTEGER NOT NULL CHECK (unidades > 0),
  modalidad   TEXT NOT NULL,          -- 'retiro' | 'despacho'
  direccion   TEXT,
  total       INTEGER NOT NULL,
  estado      TEXT NOT NULL,          -- 'reservada' | 'entregada'
  creada_en   TEXT NOT NULL
);

CREATE TABLE resenas (
  id           TEXT PRIMARY KEY,
  reserva_id   TEXT NOT NULL UNIQUE REFERENCES reservas(id),  -- una por reserva
  cocinero_id  TEXT NOT NULL REFERENCES cocineros(id),
  estrellas    INTEGER NOT NULL CHECK (estrellas BETWEEN 1 AND 5),
  comentario   TEXT,
  creada_en    TEXT NOT NULL
);
```

**La regla del cupo, que es todo el producto:**

```sql
UPDATE hornadas SET disponibles = disponibles - ?2, estado = CASE WHEN disponibles - ?2 = 0
  THEN 'cerrada' ELSE estado END
 WHERE id = ?1 AND estado = 'abierta' AND disponibles >= ?2;
```

Si `meta.changes !== 1` → `409 sin_cupo`. Es **una sola sentencia atómica**: no hay
ventana entre leer y escribir, y por eso C-15 y C-16 se sostienen bajo concurrencia.

### Contrato de la pantalla (rutas e ids)  ← agregado en T-3

> **Por qué existe (T-3).** El diseño fijaba los contratos de la **API** y dejaba la
> interfaz del navegador sin especificar. El Coder escribió un test contra `#sector`,
> después implementó `?sector=` y terminó **editando el test para que coincidiera**.
> El test no estaba mal: **faltaba el contrato**. Lo que no está especificado se
> negocia contra la implementación, y ahí el test deja de ser independiente.

| Qué | Contrato |
|---|---|
| Sector elegido | `/?sector=<texto>` — **query string**, no hash. La app lo lee al cargar y lo escribe al elegir |
| Listado | contenedor `#lista-hornadas` con tarjetas `[id^="card-hornada"]` (una por hornada) |
| Estado vacío | `#estado-vacio`, con un enlace a registrarse como cocinero |
| Registro de cocinero | `#form-cocinero` (C-01) |
| Publicar hornada | `#form-hornada` (C-04) |
| Estilo | una sola hoja `public/styles.css`; sin fuentes ni CDN externos |

Todo id que un caso de la matriz nombre es **contrato**, no un detalle de implementación.

## Stack y dependencias

| Elección | Versión | Justificación |
|---|---|---|
| Cloudflare Workers | runtime del borde | Es la única plataforma del set que ejecuta código propio con almacenamiento (ver ADR-003) |
| D1 (SQLite) | binding `DB` | Necesitamos una resta **atómica** contra la sobreventa (ver ADR-002) |
| HTML + CSS + JS nativos | — | El entregable corre sin `npm install`; sin build no hay paso que se rompa solo (ADR-004) |
| `node --test` | el que trae el Node del host | Los tests son parte del contrato, no del producto |
| `wrangler` | 4.x | Única herramienta de desarrollo y despliegue |

## Despliegue  ⭐ OBLIGATORIA

### Todo lo que se publica

| Qué | Dónde | Quién | Cómo |
|---|---|---|---|
| **El producto** | Cloudflare Worker `hornada` → `https://hornada.mkvs.workers.dev` | el Orquestador | `npx wrangler deploy` |
| **La vista previa del ciclo** | Cloudflare Worker `hornada-preview` | el Orquestador | `npx wrangler deploy --name hornada-preview` |
| **El tablero** (`progreso.html`) | GitHub Pages (repo público, rama `main`) | el Orquestador | `scripts/update-status.sh <dir> --push` |
| **El mockup congelado** | Cloudflare Worker `hornada-mockup` → `https://hornada-mockup.mkvs.workers.dev` | el Orquestador | `npx wrangler deploy` en `docs/mockup/` |

### Qué plataforma  ⭐ OBLIGATORIA

**Cloudflare Workers.** El artefacto **tiene código en runtime**: guarda reservas,
descuenta cupo y valida tokens. Estático puro no puede: si el cupo viviera en el
navegador, cada vecino vería su propia copia y dos vecinos reservarían la misma
docena. Ver `ADR-003-<plataforma>.md`.

- **Forma del Worker — C · Worker + bindings**: assets estáticos para las pantallas,
  un script para `/api/*` y **D1** para el estado. Los assets se sirven gratis y solo
  se factura lo que toca el script.
- **`run_worker_first: ["/api/*"]`** — el resto del tráfico nunca despierta al Worker.

### Vista previa por ciclo  ⭐ OBLIGATORIA

| | |
|---|---|
| **Mecanismo** | **Worker de vista previa dedicado** (`hornada-preview`), con su propia base D1 de prueba. **No se usa Workers Builds**: requiere integración Git y hoy está en beta, y el harness prohíbe diseñar sobre una beta sin verificar. **No se usan Version URLs** (`wrangler versions upload`): Cloudflare dice explícitamente que comparten recursos de producción. |
| **Quién publica** | El **Orquestador**. El Coder **no despliega** y no tiene token: `wrangler dev` corre sin credenciales. |
| **Cuándo** | Al cerrar cada ciclo, junto con el smoke contra la URL real. |
| **Dónde queda** | En el tablero y en el handoff: `docs/estado.json` → `urls.preview`. **La URL se entrega, no se describe.** |

### Entornos

| | Local | Cloudflare |
|---|---|---|
| Comando | `npx wrangler dev --port 8787` | `npx wrangler deploy` |
| Qué corre | El Worker real sobre **workerd** (Miniflare) + una **D1 local** | El Worker y la D1 remota |
| Migraciones | `npx wrangler d1 migrations apply hornada --local` | `… --remote` |
| Qué NO corre igual | **No aplica los límites del plan** (10 ms de CPU, cuotas diarias, 429) y no tiene el borde ni caché | — |

> **Paridad declarada, no supuesta.** Un test verde en local no dice nada sobre la
> cuota diaria de D1 ni sobre el CPU del plan Free: eso lo cubre el smoke.

### Dónde corren las pruebas  ⭐ OBLIGATORIA

| | **Suite** | **Smoke** |
|---|---|---|
| **Dónde** | **Local**: `wrangler dev` en `127.0.0.1:8787` | **Cloudflare**: la URL publicada |
| **Cuándo** | Antes de cada integración, en cada ciclo | Después de cada deploy |
| **Qué prueba** | Los 29 casos de la matriz + los casos que agregue el Coder | Que lo desplegado es lo construido y funciona en el borde |
| **Costo** | Cero cuota, cero red, determinista | Consume cuota real |
| **Quién** | El **Coder** (Hermes lo reproduce) | **Hermes**, el único que despliega |

La suite arranca el dev server y le habla por HTTP: es la misma app, en el mismo
runtime, sin credenciales y sin tocar producción.

### Bindings

| Binding | Tipo | Para qué |
|---|---|---|
| `DB` | **D1** | Cocineros, hornadas, reservas y reseñas. Es la fuente de la verdad del cupo |
| `ASSETS` | Assets | Sirve `public/` (HTML/CSS/JS) |

`wrangler.jsonc` de producción declara `name: hornada`, `main: src/index.js`,
`assets.directory: ./public`, `run_worker_first: ["/api/*"]` y el binding D1 con su
`database_id`.

### Límite que puede romperlo

- **Requests/día del plan Free (100.000)** → al agotarse, el Worker responde **429 y
  NO cae de vuelta a los assets**. En un piloto de un barrio está lejos, pero el
  diseño no depende de eso: las pantallas son assets y solo `/api/*` cuenta.
- **CPU por request (10 ms en Free)** → el riesgo real no es una consulta, es
  **serializar una lista larga**. Consecuencia: si el listado crece, el request
  empieza a fallar con Error 1102. **Mitigación en el ciclo 1: el listado devuelve
  como máximo 50 hornadas** y ordena por fecha.
- **Escrituras D1/día (100.000)** → una reserva es 1 escritura; una hornada de 10
  docenas consume 10. El techo está ~10.000 docenas de pan al día. No es el límite
  que va a romper un barrio.

### Presupuesto de CPU

Cada endpoint hace **≤ 3 consultas D1** y serializa **≤ 50 filas**. Los tokens se
generan **una vez por alta** con `crypto.randomUUID()`. Sin bucles sobre datos, sin
criptografía por request, sin plantillas del lado del servidor: todo dentro del techo
de 10 ms.

### Secretos

**El ciclo 1 no tiene secretos de aplicación**: no hay login, no hay pago, no hay
claves de terceros. La identidad son **tokens opacos en la URL**, que son datos, no
credenciales de plataforma.

- El token de Cloudflare vive en `~/.hermes/.env`, **fuera del repo**, y solo lo usa
  el Orquestador. **Nunca entra al entorno del Coder.**
- No hace falta `.dev.vars` en el ciclo 1.

### Rollback

- Comando: `npx wrangler rollback <version-id>` → **qué se restaura:** el código
  anterior del Worker. **No revierte las migraciones de D1.**
- Por eso la regla de migración del ciclo: **aditiva** (agregar columnas/tablas,
  nunca `DROP` ni `ALTER` destructivo). Un rollback de código sobre un esquema
  aditivo siempre es seguro.

### ¿Hay algo en el directorio de assets que NO debe ser público?

- **No.** `public/` contiene solo HTML, CSS y JS del navegador. El código de la API
  vive en `src/`, fuera de `public/`. No hay `.env`, ni source maps, ni claves.
- Regla para el Coder: **todo lo que se pone en `public/` se publica** — no va ahí
  ningún dato que no deba ser público, ni siquiera "de prueba".

## Decisiones (ADRs)

- `ADR-001-identidad-sin-cuentas.md` — tokens opacos en vez de cuentas con login
- `ADR-002-almacenamiento-d1.md` — D1 con UPDATE condicional en vez de KV o Durable Objects
- `ADR-003-plataforma.md` — Cloudflare Workers en vez de GitHub Pages o un BaaS
- `ADR-004-sin-build.md` — HTML/CSS/JS nativos en vez de framework con build

## Matriz de casos de prueba  ⭐ OBLIGATORIA

> Los casos se identifican **acá**. El Coder los traduce a tests **nombrados con su
> ID** (`test('C-01 · …')`) y **puede agregar los que se le ocurran; no puede quitar
> ninguno**. `scripts/check-coverage.sh` lo comprueba.

| ID | Caso | Criterio de origen | Tipo | Observable esperado |
|---|---|---|---|---|
| `C-01` | El formulario de registro existe con sus 4 campos | HU-1 / C-01 | estructura | `#form-cocinero` existe y contiene los inputs `nombre`, `sector`, `referencia_retiro`, `foto_url` |
| `C-02` | Registro válido crea el cocinero y lo lista en su sector | HU-1 / C-02 | comportamiento | `POST /api/cocineros` → 201 y `GET /api/hornadas?sector=…` lo asocia a ese sector |
| `C-03` | Registro sin nombre o sin sector se rechaza | HU-1 / C-03 | comportamiento | 400 con `error: 'falta_nombre'` / `'falta_sector'` y el cocinero **no** se crea (mismo listado antes y después) |
| `C-04` | El formulario de hornada existe con sus campos | HU-2 / C-04 | estructura | `#form-hornada` con `pan`, `desde`, `hasta`, `unidades`, `precio`, `modalidades`, `referencia_retiro` |
| `C-05` | Publicar hornada la crea abierta con el cupo completo | HU-2 / C-05 | comportamiento | 201 y `disponibles === unidades`, `estado === 'abierta'` |
| `C-06` | Una segunda hornada abierta del mismo cocinero se rechaza | HU-2 / C-06 | comportamiento | 409 `ya_tiene_hornada_abierta` y sigue habiendo **una** abierta |
| `C-07` | Unidades 0 o precio ≤ 0 se rechazan | HU-2 / C-07 | umbral | 400 `unidades_invalidas` con `unidades: 0`; 400 `precio_invalido` con `precio: 0` |
| `C-08` | El listado trae solo las hornadas abiertas del sector, por fecha | HU-3 / C-08 | comportamiento | con 2 abiertas en el sector y 1 en otro, devuelve 2 y sus `desde` son ascendentes |
| `C-09` | Una hornada agotada o vencida no se lista | HU-3 / C-09 | comportamiento | con `disponibles = 0` o `hasta` en el pasado, no aparece en `GET /api/hornadas` |
| `C-29` | Sector sin hornadas muestra el estado vacío | HU-3 / C-29 | estructura | existe `#estado-vacio` con el enlace a registrarse como cocinero; **no** existe la lista de tarjetas |
| `C-10` | El listado es una sola columna a 390 px | HU-3 / C-10 | forma | `getBoundingClientRect()` de las tarjetas: `left` iguales ±2 px y `top` de cada una ≥ `bottom` de la anterior |
| `C-11` | El chip de cupo va anclado al vértice superior derecho | HU-3 / C-11 | forma | `chip.top − tarjeta.top` y `tarjeta.right − chip.right` iguales entre tarjetas ±2 px |
| `C-12` | El botón de reserva ocupa el ancho interno de la tarjeta | HU-3 / C-12 | forma | `\|ancho_interno − ancho_botón\| ≤ 2 px`, margen inferior igual ±2 px entre tarjetas, alto ≥ 44 px |
| `C-13` | El texto secundario sostiene ≥ 4,5:1 de contraste | HU-3 / C-13 | umbral | luminancia relativa WCAG ≥ 4.5 en metadatos de tarjeta y avisos |
| `C-14` | Reservar descuenta el cupo y devuelve dónde obtener el pan | HU-4 / C-14 | comportamiento | 201, `disponibles` baja en N y la respuesta trae `donde` |
| `C-15` | Reservar más que el cupo se rechaza sin tocarlo | HU-4 / C-15 | comportamiento | 409 `sin_cupo` y `disponibles` idéntico antes y después |
| `C-16` | La última unidad cierra la hornada | HU-4 / C-16 | comportamiento | reservando el cupo exacto: `disponibles = 0` y `estado = 'cerrada'` |
| `C-17` | Reserva sin nombre o sin contacto se rechaza | HU-4 / C-17 | comportamiento | 400 `falta_nombre` / `falta_contacto` y el cupo no cambia |
| `C-18` | El panel del cocinero lista sus pedidos, y solo los suyos | HU-5 / C-18 | comportamiento | `GET /api/cocineros/mi-panel?token=…` trae las reservas de sus hornadas; con el token de otro, 403 |
| `C-19` | Marcar entregado persiste | HU-5 / C-19 | comportamiento | 200 y al volver a pedir el panel la reserva sigue `entregada` |
| `C-20` | El cliente ve su reserva y solo la suya | HU-6 / C-20 | comportamiento | `GET /api/reservas/:codigo` trae estado y `donde`; un código ajeno no devuelve esa reserva |
| `C-21` | Una hornada cerrada no acepta reservas | HU-7 / C-21 | comportamiento | 409 `hornada_cerrada` sobre una hornada agotada o con `hasta` pasado |
| `C-22` | El cliente solo elige modalidades ofrecidas | HU-8 / C-22 | comportamiento | hornada que solo ofrece `retiro` + reserva con `modalidad: 'despacho'` → 400 `modalidad_no_ofrecida` |
| `C-23` | Despacho exige dirección y la muestra al cocinero | HU-8 / C-23 | comportamiento | sin `direccion` → 400 `falta_direccion`; con ella, la reserva **guarda la dirección**, leída de **D1** (no por `GET /api/reservas/:codigo`: ese endpoint es de **T-8** y un test no puede depender de una superficie de otra tarea). La segunda mitad —que el cocinero la **vea**— se verifica en **T-7**, cuando exista el panel: es una superficie de T-7, no un observable de T-6 |
| `C-24` | Retiro devuelve la referencia y no pide dirección | HU-8 / C-24 | comportamiento | reserva `retiro` → 201 con `donde === referencia_retiro` (leído de D1) y sin exigir `direccion` |
| `C-25` | Se califica una sola vez y solo con el pan entregado | HU-9 / C-25 | comportamiento | reserva `reservada` → 409 `reserva_no_entregada`; entregada → 201; repetir → 409 `ya_calificada` |
| `C-26` | El promedio y la cantidad de reseñas salen en la tarjeta | HU-9 / C-26 | comportamiento | con 2 reseñas (5 y 4), la hornada trae `cocinero.promedio = 4.5` y `resenas = 2` |
| `C-27` | Con ≥5 reseñas y promedio < 3,0 el cocinero se suspende | HU-9 / C-27 | umbral | 5 reseñas de 1 estrella → sus hornadas **no** aparecen en el listado y no aceptan reservas (403 `cocinero_suspendido`) |
| `C-28` | La suspensión no borra las reservas ya hechas | HU-9 / C-28 | comportamiento | con el cocinero suspendido, su panel sigue mostrando las reservas vigentes y el `motivo_suspension` |

**Reglas de la matriz:** toda fila nace de un criterio de `03-DEFINICION.md`; el ID
es el contrato; todo criterio tiene ≥1 caso; los observables son medibles; los casos
de `comportamiento` **ejecutan la app** (HTTP real contra `wrangler dev` + DOM real
por CDP en los de `forma`), nunca leen el archivo; los umbrales van numéricos.

### Cobertura combinada

No aplica: el ciclo 1 no multiplica ejes. La modalidad (`retiro` | `despacho`) no
genera variantes visuales distintas, solo campos condicionales.

### Casos ocultos  (3)

> Viven en el harness (`oculto/Hornada/ciclo-1.test.mjs`), **fuera del alcance del
> Coder**, y se ejecutan en G5 **después de su commit final**. Mismo momento, otro
> destino: miden el criterio con más dureza que la matriz visible.

- **OC-1 · Concurrencia real sobre la última docena** — dos reservas de 1 unidad
  lanzadas **en paralelo** sobre una hornada con 1 disponible: exactamente una
  201 y una 409, y `disponibles` termina en 0. (La matriz visible prueba la
  secuencia; esta prueba el mismo instante.)
- **OC-2 · El agotado no desaparece para quien ya reservó** — una hornada agotada deja
  de listarse, pero el cliente que alcanzó a reservar **sigue viendo su reserva y su
  `donde`** con su código.
- **OC-3 · La suspensión es del listado, no del historial** — con 5 reseñas de 1
  estrella el cocinero desaparece del listado, y **su panel sigue mostrando** las
  reservas pendientes (incluida la dirección de un despacho).

### Casos superados

| Caso | Superado por | Por qué |
|---|---|---|
| `EX-404` de `tests/ciclo-1.test.mjs` (T-1, caso extra del Coder): "`GET /api/hornadas?sector=x` → 404 porque la ruta no existe" | **C-08** | El caso afirmaba la **ausencia** de una ruta que el diseño define dos tareas después. Un caso que afirma que algo *todavía no existe* es una mina: se vuelve falso por diseño, no por defecto. El Coder lo reportó como bloqueo (no podía tocarlo: sellado). **Se retira en el ciclo de tests de T-5**, en un commit propio de tests. |

**Reglas que salen de acá:**

1. Un caso extra **nunca** puede afirmar la ausencia de una funcionalidad declarada en
   la matriz del mismo ciclo. Que una ruta esté en el diseño y todavía no la implemente
   la tarea en curso no es un observable.
2. Un test de una tarea **no puede usar superficies de otra tarea**. Pasó dos veces en
   este ciclo: C-23 necesitaba el panel (T-7) y C-23/C-24 usaban `GET /api/reservas/:codigo`
   (T-8). Si el observable es un dato guardado, se lee de **D1**; si es una pantalla,
   la mide la tarea que la construye.

### Clase de criterio

Cada fila declara la clase de su criterio de origen. Las de clase `forma`
(`C-10` a `C-13`) **miden geometría** con `getBoundingClientRect()` y contraste con
la fórmula de luminancia WCAG — nunca "se ve bien". Los valores de referencia están
medidos sobre el mockup congelado: `left` = 45/45/45 · chip 13/13 px · ancho del
botón 274 sobre 276 internos · contraste 6,17:1 y 5,82:1.

## Trazabilidad

| Criterio (fase 3) | Casos | Tarea(s) | Test que lo cubre |
|---|---|---|---|
| HU-1 / C-01, C-02, C-03 | `C-01`, `C-02`, `C-03` | T-1 | `C-01 · …`, `C-02 · …`, `C-03 · …` |
| HU-2 / C-04, C-05, C-06, C-07 | `C-04`, `C-05`, `C-06`, `C-07` | T-2 | `C-04 · …` a `C-07 · …` |
| HU-3 / C-08, C-09, C-29, C-10, C-11, C-12, C-13 | `C-08`, `C-09`, `C-29`, `C-10`, `C-11`, `C-12`, `C-13` | T-3, T-4 | los mismos IDs |
| HU-4 / C-14, C-15, C-16, C-17, C-22, C-23, C-24 | `C-14`, `C-15`, `C-16`, `C-17`, `C-22`, `C-23`, `C-24` | T-5, T-6 | los mismos IDs |
| HU-5 / C-18, C-19 | `C-18`, `C-19` | T-7 | los mismos IDs |
| HU-6 / C-20 | `C-20` | T-8 | `C-20 · …` |
| HU-7 / C-21 | `C-21` | T-5 | `C-21 · …` |
| HU-9 / C-25, C-26, C-27, C-28 | `C-25`, `C-26`, `C-27`, `C-28` | T-9 | los mismos IDs |

---

**Gate G2:** todo criterio tiene ≥1 caso **con observable esperado**, todo caso nace
de un criterio, toda tarea apunta a ≥1 caso, cada ADR tiene alternativas descartadas,
y existe la sección de Despliegue que distingue **local** de **cloud** y declara el
límite del plan que podría romper el diseño. → **G2 ✅**