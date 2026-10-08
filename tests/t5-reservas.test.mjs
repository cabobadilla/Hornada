import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { startServer, stopServer, serverReady, apiJson, d1, withBrowser, BASE } from './helpers.mjs';
import { abrirTurno, cerrarTurno } from './lock.mjs';

// T-5b: la serialización por ps/lsof de este archivo tenía dos defectos medidos
// (corrida-T5.log, BLOQUEOS): (1) el guard `cwd.startsWith(RAIZ)` era siempre
// falso (RAIZ terminaba en `/` y el cwd que devuelve lsof no), con lo que
// `suitesVivas()` veía siempre cero suites vecinas; (2) con esa lista vacía,
// `pidHuerfanoEn8787` consideraba huérfano a CUALQUIER listener de 8787 y
// `matarHuerfano` mataba el server de una suite viva (así murió su propia
// corrida). Se reemplaza ese mecanismo por el turno exclusivo común (lock file
// en .tmp/, tests/lock.mjs): un solo wrangler dev por vez; el server ajeno no se
// mira, no se adopta y no se mata. Sin tocar helpers.mjs (sellado) y sin
// cambiar una sola aserción.
// RAIZ (sin barra final) queda para d1Lote, que la usa como cwd de wrangler.
const RAIZ = new URL('../', import.meta.url).pathname.replace(/\/+$/, '');

before(() => abrirTurno('t5-reservas.test.mjs'));
after(() => {
  stopServer();
  cerrarTurno();
});

// ---- helpers propios de T-5 (los helpers sellados no se tocan) ----

const ms = (min) => min * 60 * 1000;

function iso(desplazamientoMin) {
  return new Date(Date.now() + ms(desplazamientoMin)).toISOString();
}

async function cocineroNuevo(tag, sector) {
  const nombre = `Horneador ${tag} ${Date.now()}`;
  const sec = sector ?? `sector-reserva-${tag}-${Date.now()}`;
  const referencia = `Portón ${tag}, calle del reservante ${Date.now()}`;
  const { res, body } = await apiJson('/api/cocineros', {
    method: 'POST',
    body: JSON.stringify({ nombre, sector: sec, referencia_retiro: referencia }),
  });
  assert.equal(res.status, 201, `precondición (cocinero ${tag}) · esperaba 201, llegó ${res.status}`);
  const coc = body?.cocinero ?? body;
  assert.ok(coc?.token, `precondición (cocinero ${tag}) · no vino token`);
  return { token: coc.token, sector: sec, nombre, referencia };
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
    referencia_retiro: 'Portón gris, Calle del Reservante 1',
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

async function reservar(hornadaId, cuerpo) {
  return apiJson(`/api/hornadas/${encodeURIComponent(hornadaId)}/reservas`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });
}

async function leerCupoApi(hornadaId) {
  const { res, body } = await apiJson(`/api/hornadas/${encodeURIComponent(hornadaId)}`);
  assert.equal(res.status, 200, `precondición · releer la hornada debía dar 200, llegó ${res.status}`);
  const h = body?.hornada ?? body;
  assert.ok(h, 'precondición · la relectura de la hornada no trajo datos');
  return { disponibles: h.disponibles, estado: h.estado, referencia_retiro: h.referencia_retiro };
}

function leerCupoD1(hornadaId) {
  const filas = d1(`SELECT disponibles, estado FROM hornadas WHERE id = '${hornadaId}'`);
  assert.equal(filas.length, 1, 'precondición · la hornada debe seguir existiendo en D1');
  return { disponibles: Number(filas[0].disponibles), estado: filas[0].estado };
}

// `wrangler d1 execute --command …` admite UNA sola sentencia por invocación;
// para sembrar filas usa --file con múltiples INSERTs (helper propia de este
// archivo, mismo patrón que t3; helpers.mjs sellado no se toca).
function d1Lote(stmts) {
  const archivoSql = new URL('../.tmp/t5-data.sql', import.meta.url).pathname;
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
// C-14 · comportamiento: reservar N unidades de una hornada abierta
// descuenta exactamente N del cupo y la respuesta trae `donde`.
// ============================================================

test('C-14 · reservar 3 de 10 descuenta exactamente 3 (releído de la API y de D1) y trae donde', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const c = await cocineroNuevo('c14');
  const referenciaRetiro = 'Portón verde C-14, Calle del Reservante 7';
  const h = await publicarHornada(c.token, {
    pan: 'Pan C-14, docena de marraquetas',
    unidades: 10,
    precio: 500,
    referencia_retiro: referenciaRetiro,
  });

  const antesApi = await leerCupoApi(h.id);
  assert.equal(antesApi.disponibles, 10, 'precondición · la hornada debe nacer con el cupo completo (API)');
  const antesD1 = leerCupoD1(h.id);
  assert.equal(antesD1.disponibles, 10, 'precondición · la hornada debe nacer con el cupo completo (D1)');

  const { res, body } = await reservar(h.id, {
    nombre: 'Clia del C-14',
    contacto: 'c14@vecino.cl',
    unidades: 3,
    modalidad: 'retiro',
  });
  assert.equal(res.status, 201, `C-14 · esperaba 201, llegó ${res.status}: ${JSON.stringify(body)}`);
  const reserva = body?.reserva ?? body;
  assert.ok(reserva?.codigo, 'C-14 · la respuesta debe traer el codigo de la reserva');
  assert.equal(reserva.unidades, 3, 'C-14 · la respuesta debe traer las unidades pedidas');
  assert.equal(reserva.total, 1500, 'C-14 · total debe ser unidades × precio (3 × 500)');
  assert.equal(reserva.modalidad, 'retiro', 'C-14 · la modalidad debe ser la pedida');
  assert.equal(reserva.donde, referenciaRetiro, 'C-14 · donde debe ser la referencia_retiro de la hornada');

  // El cupo se relee: de la API y de D1, y baja exactamente en N.
  const despuesApi = await leerCupoApi(h.id);
  assert.equal(despuesApi.disponibles, 7, 'C-14 · disponibles debe bajar exactamente en N (releído de la API)');
  const despuesD1 = leerCupoD1(h.id);
  assert.equal(despuesD1.disponibles, 7, 'C-14 · disponibles debe bajar exactamente en N (releído de D1)');
});

// ============================================================
// C-15 · comportamiento: pedir más unidades que las disponibles se
// rechaza con 409 sin_cupo y el cupo queda idéntico (número, no código).
// ============================================================

test('C-15 · pedir 6 de 5 da 409 sin_cupo y el cupo queda idéntico antes y después (API y D1)', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const c = await cocineroNuevo('c15');
  const h = await publicarHornada(c.token, {
    pan: 'Pan C-15, sin sobreventa',
    unidades: 5,
    precio: 1000,
  });

  const antesApi = await leerCupoApi(h.id);
  assert.equal(antesApi.disponibles, 5, 'precondición · el cupo inicial debe ser 5');
  const antesD1 = leerCupoD1(h.id);
  assert.equal(antesD1.disponibles, 5, 'precondición · el cupo inicial debe ser 5 (D1)');

  const { res, body } = await reservar(h.id, {
    nombre: 'Clia del C-15',
    contacto: 'c15@vecino.cl',
    unidades: 6,
    modalidad: 'retiro',
  });
  assert.equal(res.status, 409, `C-15 · esperaba 409, llegó ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(body?.error, 'sin_cupo', `C-15 · error esperado sin_cupo, llegó ${JSON.stringify(body)}`);

  // El cupo idéntico antes y después: comparación numérica, no de código.
  const despuesApi = await leerCupoApi(h.id);
  assert.equal(despuesApi.disponibles, antesApi.disponibles, 'C-15 · el cupo debe quedar idéntico después del rechazo (API)');
  const despuesD1 = leerCupoD1(h.id);
  assert.equal(despuesD1.disponibles, antesD1.disponibles, 'C-15 · el cupo debe quedar idéntico después del rechazo (D1)');
});

// ============================================================
// C-16 · comportamiento: reservar el cupo exacto deja disponibles = 0
// y estado = 'cerrada'.
// ============================================================

test('C-16 · reservar el cupo exacto deja disponibles = 0 y estado = cerrada (API y D1)', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const c = await cocineroNuevo('c16');
  const h = await publicarHornada(c.token, {
    pan: 'Pan C-16, la última unidad cierra',
    unidades: 2,
    precio: 800,
  });

  const antes = await leerCupoApi(h.id);
  assert.equal(antes.disponibles, 2, 'precondición · el cupo inicial debe ser 2');

  const { res, body } = await reservar(h.id, {
    nombre: 'Clia del C-16',
    contacto: 'c16@vecino.cl',
    unidades: 2,
    modalidad: 'retiro',
  });
  assert.equal(res.status, 201, `C-16 · esperaba 201, llegó ${res.status}: ${JSON.stringify(body)}`);

  const despuesApi = await leerCupoApi(h.id);
  assert.equal(despuesApi.disponibles, 0, 'C-16 · tras reservar el cupo exacto, disponibles debe ser 0 (API)');
  assert.equal(despuesApi.estado, 'cerrada', "C-16 · tras reservar el cupo exacto, estado debe ser 'cerrada' (API)");
  const despuesD1 = leerCupoD1(h.id);
  assert.equal(despuesD1.disponibles, 0, 'C-16 · tras reservar el cupo exacto, disponibles debe ser 0 (D1)');
  assert.equal(despuesD1.estado, 'cerrada', "C-16 · tras reservar el cupo exacto, estado debe ser 'cerrada' (D1)");
});

// ============================================================
// C-17 · comportamiento: sin nombre → 400 falta_nombre; sin contacto
// → 400 falta_contacto; y el cupo no cambia en ninguno de los dos.
// ============================================================

test('C-17 · sin nombre da 400 falta_nombre y sin contacto da 400 falta_contacto; el cupo no cambia', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const c = await cocineroNuevo('c17');
  const h = await publicarHornada(c.token, {
    pan: 'Pan C-17, con nombre y contacto',
    unidades: 4,
    precio: 600,
  });

  const antesApi = await leerCupoApi(h.id);
  assert.equal(antesApi.disponibles, 4, 'precondición · el cupo inicial debe ser 4');

  // sin nombre
  const r1 = await reservar(h.id, {
    contacto: 'c17@vecino.cl',
    unidades: 1,
    modalidad: 'retiro',
  });
  assert.equal(r1.res.status, 400, `C-17 · sin nombre esperaba 400, llegó ${r1.res.status}: ${JSON.stringify(r1.body)}`);
  assert.equal(r1.body?.error, 'falta_nombre', `C-17 · error esperado falta_nombre, llegó ${JSON.stringify(r1.body)}`);

  // sin contacto
  const r2 = await reservar(h.id, {
    nombre: 'Clia del C-17',
    unidades: 1,
    modalidad: 'retiro',
  });
  assert.equal(r2.res.status, 400, `C-17 · sin contacto esperaba 400, llegó ${r2.res.status}: ${JSON.stringify(r2.body)}`);
  assert.equal(r2.body?.error, 'falta_contacto', `C-17 · error esperado falta_contacto, llegó ${JSON.stringify(r2.body)}`);

  // el cupo no cambia en ninguno de los dos
  const despuesApi = await leerCupoApi(h.id);
  assert.equal(despuesApi.disponibles, antesApi.disponibles, 'C-17 · el cupo no debe cambiar tras los dos rechazos (API)');
  const despuesD1 = leerCupoD1(h.id);
  assert.equal(despuesD1.disponibles, 4, 'C-17 · el cupo no debe cambiar tras los dos rechazos (D1)');
});

// ============================================================
// C-21 · comportamiento: una hornada cerrada (agotada o con `hasta`
// en el pasado) rechaza cualquier reserva nueva con 409 hornada_cerrada.
// ============================================================

test('C-21 · agotada y vencida (hasta en el pasado) rechazan reservas con 409 hornada_cerrada', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  // agotada: reservar su única unidad la cierra y la deja sin cupo
  const cA = await cocineroNuevo('c21a');
  const hA = await publicarHornada(cA.token, {
    pan: 'Pan C-21, se agota sola',
    unidades: 1,
    precio: 900,
  });
  const primera = await reservar(hA.id, {
    nombre: 'Clia del C-21',
    contacto: 'c21@vecino.cl',
    unidades: 1,
    modalidad: 'retiro',
  });
  assert.equal(primera.res.status, 201, 'precondición · la primera reserva debe agotar la hornada');
  const rA = await reservar(hA.id, {
    nombre: 'Otra Clia del C-21',
    contacto: 'c21b@vecino.cl',
    unidades: 1,
    modalidad: 'retiro',
  });
  assert.equal(rA.res.status, 409, `C-21 · sobre la agotada esperaba 409, llegó ${rA.res.status}: ${JSON.stringify(rA.body)}`);
  assert.equal(rA.body?.error, 'hornada_cerrada', `C-21 · error esperado hornada_cerrada (agotada), llegó ${JSON.stringify(rA.body)}`);

  // vencida: `hasta` en el pasado, sembrada por D1 (la regla de una hornada
  // abierta por cocinero impide publicarla por API; el observable sigue
  // siendo el endpoint de reserva).
  const cB = await cocineroNuevo('c21b');
  const cocineroId = d1(`SELECT id FROM cocineros WHERE token = '${cB.token}'`)[0].id;
  const idVencida = `c21-vencida-${Date.now()}`;
  const stmts = [
    `INSERT INTO hornadas (id, cocinero_id, pan, desde, hasta, unidades, disponibles, precio, modalidades, referencia_retiro, estado, creada_en)\n` +
      `SELECT '${idVencida}', '${cocineroId}', 'Pan C-21, ventana vencida', '${iso(-240)}', '${iso(-60)}', 20, 20, 1000, 'retiro,despacho', 'Ref vencida', 'abierta', '${new Date().toISOString()}'\n` +
      `WHERE NOT EXISTS (SELECT 1 FROM hornadas WHERE id = '${idVencida}');`,
  ];
  const resultados = d1Lote(stmts);
  if (resultados.length !== 0) {
    throw new Error(`C-21 · la siembra no debe dejar filas, quedaron ${resultados.length}`);
  }
  const sembrada = leerCupoD1(idVencida);
  assert.equal(sembrada.disponibles, 20, 'precondición · la hornada vencida debe tener cupo disponible');
  assert.equal(sembrada.estado, 'abierta', 'precondición · la hornada vencida debe estar marcada abierta');

  const rB = await reservar(idVencida, {
    nombre: 'Clia de la vencida',
    contacto: 'c21v@vecino.cl',
    unidades: 1,
    modalidad: 'retiro',
  });
  assert.equal(rB.res.status, 409, `C-21 · sobre la vencida esperaba 409, llegó ${rB.res.status}: ${JSON.stringify(rB.body)}`);
  assert.equal(rB.body?.error, 'hornada_cerrada', `C-21 · error esperado hornada_cerrada (vencida), llegó ${JSON.stringify(rB.body)}`);
  const despuesVencida = leerCupoD1(idVencida);
  assert.equal(despuesVencida.disponibles, 20, 'C-21 · el cupo de la vencida no debe cambiar');
});

// ---- casos extra del Coder (valor agregado, piso de la matriz) ----

test('EX-14a · reservar sobre una hornada inexistente da 404 no_existe', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const fantasma = `no-existe-${crypto.randomUUID()}`;
  const { res, body } = await reservar(fantasma, {
    nombre: 'Clia fantasma',
    contacto: 'fantasma@vecino.cl',
    unidades: 1,
    modalidad: 'retiro',
  });
  assert.equal(res.status, 404, `EX-14a · esperaba 404, llegó ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(body?.error, 'no_existe', `EX-14a · error esperado no_existe, llegó ${JSON.stringify(body)}`);
});

test('EX-14b · dos reservas de la misma hornada tienen códigos distintos; cada una nace reservada con total = unidades × precio', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const c = await cocineroNuevo('ex14b');
  const h = await publicarHornada(c.token, {
    pan: 'Pan EX-14b, códigos opacos',
    unidades: 10,
    precio: 700,
  });
  const r1 = await reservar(h.id, { nombre: 'Clia 1', contacto: 'ex14b1@vecino.cl', unidades: 2, modalidad: 'retiro' });
  assert.equal(r1.res.status, 201, `EX-14b · la primera reserva debe dar 201, llegó ${r1.res.status}`);
  const r2 = await reservar(h.id, { nombre: 'Clia 2', contacto: 'ex14b2@vecino.cl', unidades: 3, modalidad: 'retiro' });
  assert.equal(r2.res.status, 201, `EX-14b · la segunda reserva debe dar 201, llegó ${r2.res.status}`);
  const codigo1 = (r1.body?.reserva ?? r1.body)?.codigo;
  const codigo2 = (r2.body?.reserva ?? r2.body)?.codigo;
  assert.ok(codigo1 && codigo1.length >= 8, 'EX-14b · el primer código debe ser opaco');
  assert.ok(codigo2 && codigo2.length >= 8, 'EX-14b · el segundo código debe ser opaco');
  assert.notEqual(codigo1, codigo2, 'EX-14b · los dos códigos deben ser distintos');

  const filas = d1(`SELECT codigo, unidades, total, estado FROM reservas WHERE hornada_id = '${h.id}' ORDER BY unidades`);
  assert.equal(filas.length, 2, `EX-14b · deben existir 2 reservas en D1, hay ${filas.length}`);
  assert.equal(filas[0].codigo, codigo1, 'EX-14b · el primer código debe estar en D1');
  assert.equal(filas[1].codigo, codigo2, 'EX-14b · el segundo código debe estar en D1');
  assert.equal(Number(filas[0].unidades), 2, 'EX-14b · la primera reserva debe tener sus unidades');
  assert.equal(Number(filas[0].total), 1400, 'EX-14b · total de la primera debe ser unidades × precio (2 × 700)');
  assert.equal(Number(filas[1].unidades), 3, 'EX-14b · la segunda reserva debe tener sus unidades');
  assert.equal(Number(filas[1].total), 2100, 'EX-14b · total de la segunda debe ser unidades × precio (3 × 700)');
  assert.equal(filas[0].estado, 'reservada', "EX-14b · la reserva debe nacer en estado 'reservada' (D1)");
  assert.equal(filas[1].estado, 'reservada', "EX-14b · la reserva debe nacer en estado 'reservada' (D1)");
  // y el descuento acumulado debe ser exacto: 10 − (2 + 3) = 5
  const cupo = leerCupoD1(h.id);
  assert.equal(cupo.disponibles, 5, 'EX-14b · el descuento acumulado debe ser exacto');
});

test('EX-17a · unidades 0, negativas o no enteras dan 400 unidades_invalidas y el cupo no cambia', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const c = await cocineroNuevo('ex17a');
  const h = await publicarHornada(c.token, {
    pan: 'Pan EX-17a, unidades ralladas',
    unidades: 8,
    precio: 300,
  });
  const antes = await leerCupoApi(h.id);
  assert.equal(antes.disponibles, 8, 'precondición · el cupo inicial debe ser 8');

  for (const [etiqueta, unidades] of [['cero', 0], ['negativa', -2], ['no entera', 1.5]]) {
    const { res, body } = await reservar(h.id, {
      nombre: 'Clia EX-17a',
      contacto: 'ex17a@vecino.cl',
      unidades,
      modalidad: 'retiro',
    });
    assert.equal(res.status, 400, `EX-17a · unidades ${etiqueta} esperaba 400, llegó ${res.status}: ${JSON.stringify(body)}`);
    assert.equal(body?.error, 'unidades_invalidas', `EX-17a · unidades ${etiqueta} esperaba unidades_invalidas, llegó ${JSON.stringify(body)}`);
  }
  const despuesD1 = leerCupoD1(h.id);
  assert.equal(despuesD1.disponibles, 8, 'EX-17a · el cupo no debe cambiar tras los rechazos');
});

test('EX-17b · la pantalla de reserva existe en el DOM real y al confirmar muestra el código y el donde', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const c = await cocineroNuevo('ex17b');
  const referenciaRetiro = 'Portón naranja EX-17b, Calle de la Pantalla 9';
  const h = await publicarHornada(c.token, {
    pan: 'Pan EX-17b, pantalla de reserva',
    unidades: 6,
    precio: 400,
    referencia_retiro: referenciaRetiro,
  });

  // el resultado del evaluate solo existe dentro del callback de withBrowser;
  // para la segunda parte (cross-check contra D1) se captura acá (fix del bug
  // de scope que dejaba `confirmada is not defined` en la corrida de T-5).
  let confirmada = null;
  await withBrowser(`${BASE}/`, async ({ evaluate }) => {
    const dom = await evaluate(`
      (() => {
        const form = document.querySelector('#form-reserva');
        if (!form) return { form: false };
        const campos = ['hornada_id', 'unidades', 'nombre', 'contacto'];
        return {
          form: true,
          isForm: form.tagName === 'FORM',
          campos: campos.map((n) => (form.querySelector('[name="' + n + '"]') ? n : null)),
          codigoNodo: !!document.querySelector('#reserva-codigo'),
          dondeNodo: !!document.querySelector('#reserva-donde'),
        };
      })()
    `);
    assert.ok(dom.form, 'EX-17b · debe existir #form-reserva en el DOM servido');
    assert.equal(dom.isForm, true, 'EX-17b · #form-reserva debe ser un <form> real');
    assert.deepEqual(
      dom.campos,
      ['hornada_id', 'unidades', 'nombre', 'contacto'],
      `EX-17b · el formulario debe tener los 4 campos del mockup, hay ${JSON.stringify(dom.campos)}`,
    );
    assert.ok(dom.codigoNodo, 'EX-17b · debe existir el nodo #reserva-codigo para el código al confirmar');
    assert.ok(dom.dondeNodo, 'EX-17b · debe existir el nodo #reserva-donde para el retiro al confirmar');

    await evaluate(`
      (() => {
        const form = document.querySelector('#form-reserva');
        form.hornada_id.value = '${h.id}';
        form.unidades.value = '2';
        form.nombre.value = 'Clia de la pantalla';
        form.contacto.value = 'pantalla@vecino.cl';
        form.requestSubmit();
        return true;
      })()
    `);
    // poll en vez del fijo de 1,5 s: deja correr el POST de la reserva hasta que
    // el bloque aparezca (tope 8 s). Si nunca aparece, `confirmada.visible` es
    // false y la aserción de abajo falla con su mensaje original — no hay
    // aserción cambiada ni debilitada.
    const tope = Date.now() + 8000;
    while (Date.now() < tope && !(confirmada = await evaluate(`
      (() => {
        const nodo = document.querySelector('#reserva-confirmada');
        return {
          visible: !!nodo && getComputedStyle(nodo).display !== 'none',
          codigo: document.querySelector('#reserva-codigo')?.textContent ?? null,
          donde: document.querySelector('#reserva-donde')?.textContent ?? null,
        };
      })()
    `)).visible) {
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(
      confirmada.visible,
      'EX-17b · al confirmar debe mostrarse el bloque #reserva-confirmada',
    );
    assert.ok(
      confirmada.codigo && confirmada.codigo.length >= 8,
      `EX-17b · debe mostrarse el código de la reserva, se vio ${JSON.stringify(confirmada.codigo)}`,
    );
    assert.equal(
      confirmada.donde,
      referenciaRetiro,
      `EX-17b · debe mostrarse el donde (${referenciaRetiro}), se vio ${JSON.stringify(confirmada.donde)}`,
    );
  });

  // lo que pintó la pantalla debe ser la reserva real de la base
  const fila = d1(`SELECT codigo, unidades, total FROM reservas WHERE hornada_id = '${h.id}'`);
  assert.equal(fila.length, 1, `EX-17b · la reserva confirmada debe quedar en D1, hay ${fila.length}`);
  assert.equal(fila[0].codigo, confirmada.codigo, 'EX-17b · el código mostrado debe ser el de la reserva real de D1');
  assert.equal(Number(fila[0].unidades), 2, 'EX-17b · la reserva de la pantalla debe ser de 2 unidades');
  const despues = await leerCupoApi(h.id);
  assert.equal(despues.disponibles, 4, 'EX-17b · la reserva hecha desde la pantalla debe descontar 2 de 6');
});
