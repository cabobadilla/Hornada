import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { startServer, stopServer, serverReady, api, apiJson, d1, withBrowser, BASE } from './helpers.mjs';

// --- serialización propia de este archivo (helpers.mjs sellado no se toca) ---
// `node --test tests/` corre cada archivo en un proceso hijo y todos en paralelo:
// comparten puerto 8787, perfil de Chrome y la misma D1; los tests sellados (C-03)
// cuentan filas globales y se romperían con escrituras concurrentes. Igual que
// t2-hornadas.test.mjs, este archivo espera: no arranca hasta que ningún otro
// .test.mjs de ESTE proyecto esté vivo (los hijos del runner terminan en
// `tests/<x>.test.mjs`).
const ESTE_ARCHIVO = 't3-listado.test.mjs';
const RAIZ = new globalThis.URL('..', import.meta.url).pathname;

function cwdDe(pid) {
  try {
    const out = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null || true`, { encoding: 'utf8' });
    const hit = out.split('\n').find((l) => l.startsWith('n'));
    return hit ? hit.slice(1) : '';
  } catch {
    return '';
  }
}

function otraSuiteViva() {
  for (const linea of execSync('ps -axo pid=,command=', { encoding: 'utf8' }).split('\n')) {
    const m = linea.match(/^ *\d+ +(.*)$/);
    if (!m) continue;
    const arch = m[1].match(/tests\/([A-Za-z0-9._-]+\.test\.mjs)\s*$/);
    if (!arch || arch[1] === ESTE_ARCHIVO) continue;
    const pid = Number(linea.match(/^ *\d+/)[0]);
    const cwd = cwdDe(pid);
    if (cwd && cwd.startsWith(RAIZ)) return arch[1];
  }
  return null;
}

before(async () => {
  // Serialización robusta (helpers.mjs sellado no se toca). Punto débil del
  // esquema "todos esperamos": al morir la suite no-esperadora, las suites
  // esperadoras despertamos JUNTAS y compartimos el workerd de quien gane el
  // puerto (el otro crée que el.server ajeno es el suyo; al terminarse aquel,
  // ECONNREFUSED). Acá el despertar es en tres fases:
  //   1. esperar a que no haya ninguna suite vecina viva (cap 20 min);
  //   2. gracia de 15 s sondeando cada 250 ms: si reaparece un vecino o el
  //      puerto 8787 pasa a estar ocupado, se vuelve a esperar;
  //   3. en estado callado, matar cualquier server huérfano en 8787
  //      (restos de una corrida interrumpida) y recién entonces arrancar.
  for (let ronda = 0; ronda < 2900; ronda++) {
    const vecina = otraSuiteViva();
    if (!vecina) {
      let callado = true;
      for (let i = 0; i < 60; i++) {
        if (otraSuiteViva()) { callado = false; break; }
        if (i % 4 === 0 && !(await puertoLibre())) { callado = false; break; }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (callado) break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  matarServerHuerfano();
  await startServer();
});
after(stopServer);

async function puertoLibre() {
  try {
    await fetch(`${BASE}/`, { signal: AbortSignal.timeout(800) });
    return false;
  } catch (e) {
    return e?.cause?.code === 'ECONNREFUSED';
  }
}

function matarServerHuerfano() {
  let out = '';
  try {
    out = execSync('lsof -t -iTCP:8787 -sTCP:LISTEN 2>/dev/null || true', { encoding: 'utf8' });
  } catch {
    return;
  }
  const pids = out.split('\n').map((s) => parseInt(s, 10)).filter(Boolean);
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
  // da 3 s a que se retiren; si siguen, SIGKILL
  const alive = () =>
    out.split('\n').map((s) => parseInt(s, 10)).filter(Boolean).filter((pid) => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    });
  for (let i = 0; i < 6 && alive().length > 0; i++) {
    execSync('sleep 0.5');
  }
  for (const pid of alive()) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
}

// ---- helpers propios de T-3 (los helpers sellados no se tocan) ----

const ms = (min) => min * 60 * 1000;

function iso(desplazamientoMin) {
  return new Date(Date.now() + ms(desplazamientoMin)).toISOString();
}

async function cocineroNuevo(tag, sector) {
  const nombre = `Horneador ${tag} ${Date.now()}`;
  const sec = sector ?? `sector-listado-${tag}-${Date.now()}`;
  const referencia = `Portón ${tag}, calle del listado ${Date.now()}`;
  const { res, body } = await apiJson('/api/cocineros', {
    method: 'POST',
    body: JSON.stringify({ nombre, sector: sec, referencia_retiro: referencia }),
  });
  assert.equal(res.status, 201, `precondición (cocinero ${tag}) · esperaba 201, llegó ${res.status}`);
  const coc = body?.cocinero ?? body;
  assert.ok(coc?.token, `precondición (cocinero ${tag}) · no vino token`);
  return { token: coc.token, sector: sec, nombre };
}

async function publicarHornada(token, extra = {}) {
  const base = {
    cocinero_token: token,
    pan: 'Marraquetas de masa madre',
    desde: iso(90),
    hasta: iso(300),
    unidades: 20,
    precio: 1200,
    modalidades: ['retiro', 'despacho'],
    referencia_retiro: 'Portón gris, Calle del Listado 1',
    ...extra,
  };
  const { res, body } = await apiJson('/api/hornadas', {
    method: 'POST',
    body: JSON.stringify(base),
  });
  assert.equal(res.status, 201, `precondición (hornada) · esperaba 201, llegó ${res.status}: ${JSON.stringify(body)}`);
  const h = body?.hornada ?? body;
  assert.ok(h?.id, 'precondición (hornada) · no vino id');
  return { id: h.id, ...base };
}

async function listar(sector) {
  return apiJson(`/api/hornadas?sector=${encodeURIComponent(sector)}`);
}

async function listarRaw(path) {
  return apiJson(path.startsWith('/api/hornadas') ? path : `/api/hornadas${path}`);
}

// `wrangler d1 execute --command …` admite UNA sola sentencia por invocación;
// para sembrar varias filas usa --file con múltiples INSERTs (esto NO toca
// helpers.mjs: es una helper propia de este archivo).
function d1Lote(stmts) {
  const archivoSql = new URL('../.tmp/t3-data.sql', import.meta.url).pathname;
  mkdirSync(new URL('../.tmp/', import.meta.url).pathname, { recursive: true });
  writeFileSync(archivoSql, stmts.join('\n'), 'utf8');
  const out = execSync(
    `npx wrangler d1 execute hornada --local --file "${archivoSql}" --json`,
    { cwd: RAIZ, encoding: 'utf8', timeout: 90_000 },
  );
  const parsed = JSON.parse(out);
  const filas = parsed.flatMap((r) => r.results ?? []);
  if (!filas[0] || !filas[0].error) return filas;
  throw new Error(`d1Lote falló: ${JSON.stringify(filas)}`);
}

// ============================================================
// C-08 · comportamiento: el listado trae solo las hornadas abiertas
// del sector, ordenadas por `desde` ascendente.
// ============================================================

test('C-08 · con 2 abiertas en el sector pedido y 1 en otro, devuelve exactamente esas 2 y sus desde vienen ascendentes', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const SECTOR = `sector-c08-${Date.now()}`;
  const OTRO = `otro-sector-c08-${Date.now()}`;

  const cA = await cocineroNuevo('c08a', SECTOR);
  const cB = await cocineroNuevo('c08b', SECTOR);
  const cC = await cocineroNuevo('c08c', OTRO);

  // tres ventanas distintas: la del medio en `desde` es la segunda en orden
  const h0 = await publicarHornada(cA.token, { pan: 'Hallullas', desde: iso(120) });
  const h1 = await publicarHornada(cB.token, { pan: 'Marraquetas tempranas', desde: iso(30) });
  const hOtra = await publicarHornada(cC.token, { pan: 'Pan del otro sector', desde: iso(10) });

  const { res, body } = await listar(SECTOR);
  assert.equal(res.status, 200, `C-08 · esperaba 200, llegó ${res.status}`);
  assert.ok(Array.isArray(body?.hornadas), 'C-08 · la respuesta debe traer hornadas como arreglo');

  const lista = body.hornadas;
  assert.equal(lista.length, 2, `C-08 · deben ser exactamente 2 hornadas del sector, llegaron ${lista.length}`);
  assert.deepEqual(
    lista.map((h) => h.id).sort(),
    [h0.id, h1.id].sort(),
    'C-08 · los ids deben ser los 2 del sector pedido',
  );
  assert.ok(
    !lista.some((h) => h.id === hOtra.id),
    'C-08 · la hornada de otro sector no debe aparecer',
  );

  const desde = lista.map((h) => new Date(h.desde).getTime());
  for (let i = 1; i < desde.length; i++) {
    assert.ok(desde[i - 1] < desde[i], `C-08 · desde debe venir ascendente: ${lista[i - 1].desde} debe ser < ${lista[i].desde}`);
  }
});

test('EX-08a · cada ítem del listado trae id, pan, desde, hasta, disponibles, precio, modalidades, referencia_retiro y cocinero {id, nombre, promedio, resenas}', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const SECTOR = `sector-ex08a-${Date.now()}`;
  const c = await cocineroNuevo('ex08a', SECTOR);
  const h = await publicarHornada(c.token, { pan: 'Pan de masa madre EX', precio: 999, unidades: 12 });

  const { res, body } = await listar(SECTOR);
  assert.equal(res.status, 200, `EX-08a · esperaba 200, llegó ${res.status}`);
  const lista = body?.hornadas ?? [];
  assert.equal(lista.length, 1, `EX-08a · debe traer 1 hornada, llegaron ${lista.length}`);
  const item = lista[0];
  assert.equal(item.id, h.id, 'EX-08a · el id debe ser el de la hornada creada');
  assert.equal(item.pan, 'Pan de masa madre EX', 'EX-08a · debe traer el pan');
  assert.ok(item.desde, 'EX-08a · debe traer desde');
  assert.ok(item.hasta, 'EX-08a · debe traer hasta');
  assert.equal(item.disponibles, 12, 'EX-08a · disponibles debe ser el cupo completo publicado');
  assert.equal(item.precio, 999, 'EX-08a · debe traer el precio en CLP');
  assert.deepEqual([...(item.modalidades ?? [])].sort(), ['despacho', 'retiro'], 'EX-08a · debe traer las modalidades');
  assert.ok(item.referencia_retiro, 'EX-08a · debe traer la referencia de retiro');
  assert.ok(item.cocinero && typeof item.cocinero === 'object', 'EX-08a · debe traer el cocinero anidado');
  assert.ok(item.cocinero.id, 'EX-08a · el cocinero debe traer su id');
  assert.equal(item.cocinero.nombre, c.nombre, 'EX-08a · el cocinero debe traer su nombre');
  assert.equal(item.cocinero.promedio, null, 'EX-08a · sin reseñas, promedio debe ser null (deriva de resenas, hoy vacía)');
  assert.equal(item.cocinero.resenas, 0, 'EX-08a · sin reseñas, resenas debe ser 0 (deriva de resenas, hoy vacía)');
});

test('EX-08b · el listado devuelve como máximo 50 filas (límite del presupuesto de CPU del diseño)', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const marca = `masa50-${Date.now()}`;
  // Inserta 55 hornadas abiertas del mismo sector directamente por D1 (para no
  // chocar con la regla de una hornada abierta por cocinero): INSERT condicional
  // idempotente (no hay UNIQUE sobre id aquí — usar WHERE NOT EXISTS).
  const c = await cocineroNuevo('ex08b', `sector-ex08b-${Date.now()}`);
  const cocineroId = d1(`SELECT id FROM cocineros WHERE token = '${c.token}'`)[0].id;
  const stmts = [];
  for (let i = 0; i < 55; i++) {
    const id = `ex08b-${marca}-${String(i).padStart(3, '0')}`;
    const ahora = new Date().toISOString();
    stmts.push(
      `INSERT INTO hornadas (id, cocinero_id, pan, desde, hasta, unidades, disponibles, precio, modalidades, referencia_retiro, estado, creada_en)\n` +
        `SELECT '${id}', '${cocineroId}', 'Pan límite ${i}', '${iso(600 + i)}', '${iso(1200 + i)}', 10, 10, 500, 'retiro', 'Ref ${i}', 'abierta', '${ahora}'\n` +
        `WHERE NOT EXISTS (SELECT 1 FROM hornadas WHERE id = '${id}');`,
    );
  }
  const resultados = d1Lote(stmts);
  const cambios = stmts.length - resultados.length;
  assert.equal(cambios, 55, `EX-08b · la siembra debe insertar 55 hornadas, cambió la cantidad: hay ${resultados.length} restantes de ${stmts.length}`);
  const sembradas = d1(`SELECT COUNT(*) AS n FROM hornadas WHERE id LIKE 'ex08b-${marca}-%';`);
  assert.equal(Number(sembradas[0].n), 55, `EX-08b · la siembra debe quedar en D1, hay ${Number(sembradas[0].n)}`);

  const { res, body } = await listar(c.sector);
  assert.equal(res.status, 200, `EX-08b · esperaba 200, llegó ${res.status}`);
  const lista = body?.hornadas ?? [];
  assert.equal(lista.length, 50, `EX-08b · con 55 abiertas el listado debe devolver máximo 50, devolvió ${lista.length}`);
  for (let i = 1; i < lista.length; i++) {
    assert.ok(
      new Date(lista[i - 1].desde).getTime() <= new Date(lista[i].desde).getTime(),
      'EX-08b · los primeros 50 deben seguir ordenados por desde ascendente',
    );
  }
  // Limpieza: el sector inventado no persiste en el listado de otros sectores.
  d1(`DELETE FROM hornadas WHERE cocinero_id = '${cocineroId}'`);
});

// ============================================================
// C-09 · comportamiento: una hornada agotada o vencida no se lista.
// ============================================================

test('C-09 · sin cupo (disponibles = 0), con hasta en el pasado o estado cerrada no aparece en el listado', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const SECTOR = `sector-c09-${Date.now()}`;
  const c = await cocineroNuevo('c09', SECTOR);

  // Esta hornada queda como única abierta VIVA del cocinero (no la toca nadie más).
  const viva = await publicarHornada(c.token, { pan: 'Pan vivo C-09', desde: iso(60) });

  // Las 3 candidatas a no aparecer se insertan por D1 (la regla de una abierta
  // por cocinero impide publicarlas por API; el observable sigue siendo HTTP).
  const idAgotada = `c09-agotada-${Date.now()}`;
  const idVencida = `c09-vencida-${Date.now()}`;
  const idCerrada = `c09-cerrada-${Date.now()}`;
  const cocineroId = d1(`SELECT id FROM cocineros WHERE token = '${c.token}'`)[0].id;
  const stmts = [];
  for (const [id, pan, desde, hasta, disponibles, estado] of [
    [idAgotada, 'Pan agotado', iso(-240), iso(240), 0, 'abierta'],
    [idVencida, 'Pan vencido', iso(-240), iso(-60), 20, 'abierta'],
    [idCerrada, 'Pan cerrado', iso(60), iso(240), 20, 'cerrada'],
  ]) {
    stmts.push(
      `INSERT INTO hornadas (id, cocinero_id, pan, desde, hasta, unidades, disponibles, precio, modalidades, referencia_retiro, estado, creada_en)\n` +
        `SELECT '${id}', '${cocineroId}', '${pan}', '${desde}', '${hasta}', 20, ${disponibles}, 1000, 'retiro,despacho', 'Ref ${pan}', '${estado}', '${new Date().toISOString()}'\n` +
        `WHERE NOT EXISTS (SELECT 1 FROM hornadas WHERE id = '${id}');`,
    );
  }
  const resultados = d1Lote(stmts);
  if (resultados.length !== 0) {
    throw new Error(`C-09 · la siembra no debe dejar filas, quedaron ${resultados.length}`);
  }
  const sembradas = d1(`SELECT id FROM hornadas WHERE id = '${idAgotada}' OR id = '${idVencida}' OR id = '${idCerrada}';`);
  assert.equal(sembradas.length, 3, `C-09 · las 3 hornadas sembradas deben estar en D1, hay ${sembradas.length}`);

  const { res, body } = await listar(SECTOR);
  assert.equal(res.status, 200, `C-09 · esperaba 200, llegó ${res.status}`);
  const lista = body?.hornadas ?? [];
  const ids = lista.map((h) => h.id);
  assert.ok(!ids.includes(idAgotada), 'C-09 · la hornada con disponibles = 0 NO debe aparecer');
  assert.ok(!ids.includes(idVencida), 'C-09 · la hornada con hasta en el pasado NO debe aparecer');
  assert.ok(!ids.includes(idCerrada), 'C-09 · la hornada con estado cerrada NO debe aparecer');
  assert.ok(ids.includes(viva.id), 'C-09 · la hornada viva del sector SÍ debe seguir apareciendo');
});

test('EX-09a · una hornada cuyo desde todavía no llega pero hasta es futuro SÍ aparece (ventana vigente)', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const SECTOR = `sector-ex09a-${Date.now()}`;
  const c = await cocineroNuevo('ex09a', SECTOR);
  const h = await publicarHornada(c.token, { pan: 'Pan futuro', desde: iso(45) });

  const { body } = await listar(SECTOR);
  const ids = (body?.hornadas ?? []).map((x) => x.id);
  assert.ok(ids.includes(h.id), 'EX-09a · una hornada futura y vigente debe seguir listada');
});

// ============================================================
// C-29 · estructura: sector sin hornadas → estado vacío con invitación a
// registrarse como cocinero; y sin sector → 400 falta_sector.
// ============================================================

test('C-29 · pantalla del listado: sector sin hornadas muestra #estado-vacio con la invitación a cocinar y NO existe la lista de tarjetas', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const SECTOR_VACIO = `sector-vacio-${Date.now()}`;
  await withBrowser(`${BASE}/?sector=${encodeURIComponent(SECTOR_VACIO)}`, async ({ evaluate }) => {
    await new Promise((r) => setTimeout(r, 700)); // deja correr el fetch del listado
    const info = await evaluate(`
      (() => {
        const vacio = document.querySelector('#estado-vacio');
        const lista = document.querySelector('#lista-hornadas');
        const tarjetas = document.querySelectorAll('[id^="card-hornada"]');
        const texto = vacio ? (vacio.textContent || '') : '';
        const enlaces = vacio ? [...vacio.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), texto: (a.textContent || '').trim() })) : [];
        return {
          vacioExiste: !!vacio,
          vacioVisible: vacio ? getComputedStyle(vacio).display !== 'none' : false,
          mencionaCocinar: /cocin/i.test(texto),
          enlaces,
          listaExiste: !!lista,
          nTarjetas: tarjetas.length,
        };
      })()
    `);
    assert.ok(info.vacioExiste, 'C-29 · debe existir #estado-vacio cuando el sector no tiene hornadas abiertas');
    assert.ok(info.vacioVisible, 'C-29 · #estado-vacio debe estar visible (display != none)');
    assert.ok(info.mencionaCocinar, 'C-29 · el estado vacío debe invitar a registrarse como cocinero');
    assert.ok(
      info.enlaces.some((a) => /cociner|registr/i.test(a.href + ' ' + a.texto)),
      'C-29 · el estado vacío debe traer el enlace a registrarse como cocinero',
    );
    assert.equal(info.nTarjetas, 0, 'C-29 · no debe haber tarjetas #card-hornada si no hay hornadas');
    assert.ok(!info.listaExiste || info.nTarjetas === 0, 'C-29 · no debe existir una lista de tarjetas sin salida');
  });
});

test('EX-29a · GET /api/hornadas sin sector → 400 falta_sector', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const { res, body } = await apiJson('/api/hornadas');
  assert.equal(res.status, 400, `EX-29a · esperaba 400, llegó ${res.status}`);
  assert.equal(body?.error, 'falta_sector', `EX-29a · error esperado falta_sector, llegó ${JSON.stringify(body)}`);
});

test('EX-29b · sector sin resultados → 200 { hornadas: [] } (el estado vacío es de la pantalla, no un error)', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const SECTOR = `sector-sin-nada-${Date.now()}`;
  const { res, body } = await listar(SECTOR);
  assert.equal(res.status, 200, `EX-29b · esperaba 200, llegó ${res.status}`);
  assert.deepEqual(body, { hornadas: [] }, `EX-29b · debe ser { hornadas: [] }, llegó ${JSON.stringify(body)}`);
});

test('EX-29c · el listado se pinta en el DOM real con tarjetas #card-hornada y el cupo mostrado es el de la API', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const SECTOR = `sector-ex29c-${Date.now()}`;
  const c = await cocineroNuevo('ex29c', SECTOR);
  const h1 = await publicarHornada(c.token, { pan: 'Pan pantalla 1', desde: iso(30) });

  // Cupo visto POR la API justo antes de abrir la pantalla (lo que la API dice).
  const { body: apiBody } = await listar(SECTOR);
  const disponiblesApi = apiBody?.hornadas?.[0]?.disponibles;
  assert.equal(disponiblesApi, h1.unidades, 'EX-29c · precondición: la API debe decir disponibles = unidades');

  await withBrowser(`${BASE}/?sector=${encodeURIComponent(SECTOR)}`, async ({ evaluate }) => {
    await new Promise((r) => setTimeout(r, 700)); // deja correr el fetch del listado
    const info = await evaluate(`
      (() => {
        const lista = document.querySelector('#lista-hornadas');
        const tarjetas = [...document.querySelectorAll('[id^="card-hornada"]')];
        return {
          listaExiste: !!lista,
          nTarjetas: tarjetas.length,
          textos: tarjetas.map((t) => t.textContent || ''),
        };
      })()
    `);
    assert.ok(info.listaExiste, 'EX-29c · debe existir #lista-hornadas cuando hay hornadas');
    assert.ok(info.nTarjetas >= 1, `EX-29c · debe haber al menos 1 tarjeta #card-hornada, hay ${info.nTarjetas}`);
    const page = info.textos.join(' ');
    assert.ok(/Pan pantalla 1/.test(page), 'EX-29c · la tarjeta debe mostrar el pan que devolvió la API');
    assert.ok(
      page.includes(String(disponiblesApi)),
      `EX-29c · la tarjeta debe mostrar el cupo que devuelve la API (${disponiblesApi}), no un recálculo del cliente`,
    );
    const vacio = await evaluate(`!!document.querySelector('#estado-vacio') && getComputedStyle(document.querySelector('#estado-vacio')).display !== 'none'`);
    assert.ok(!vacio, 'EX-29c · con hornadas, el estado vacío NO debe estar visible');
  });
});
