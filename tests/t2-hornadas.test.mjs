import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, serverReady, api, apiJson, d1, withBrowser, BASE } from './helpers.mjs';
import { abrirTurno, cerrarTurno } from './lock.mjs';

// T-5b: la serialización por ps/lsof de este archivo era inerte (el guard
// `cwd.startsWith(RAIZ)` era siempre falso: RAIZ termina en `/` y el cwd que
// devuelve lsof no — corrida-T5.log, BLOQUEOS). Se reemplaza por el turno
// exclusivo común (lock file en .tmp/): un solo wrangler dev por vez, sin tocar
// tests/helpers.mjs (sellado) ni una sola aserción.
before(() => abrirTurno('t2-hornadas.test.mjs'));
after(() => {
  stopServer();
  cerrarTurno();
});

// ---- casos: la hornada válida de referencia ----
const HORNO = `mariposa-${Date.now()}`;
const DESDE = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // en 1 hora
const HASTA = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // en 4 horas

// Helper propio de T-2 (los helpers sellados no se tocan): uno por test
// para no chocar con la regla de que un cocinero solo tiene UNA hornada abierta.
async function cocineroNuevo(tag) {
  const nombre = `Horneador ${tag} ${Date.now()}`;
  const sector = `horno-${tag}-${Date.now()}`;
  const referencia = `Portón ${tag}, calle del horno ${Date.now()}`;
  const { res, body } = await apiJson('/api/cocineros', {
    method: 'POST',
    body: JSON.stringify({ nombre, sector, referencia_retiro: referencia }),
  });
  assert.equal(res.status, 201, `precondición (cocinero ${tag}) · esperaba 201, llegó ${res.status}`);
  const coc = body?.cocinero ?? body;
  assert.ok(coc?.token, `precondición (cocinero ${tag}) · no vino token`);
  return { token: coc.token, sector, referencia };
}

function hornadaValida(token, extra = {}) {
  return JSON.stringify({
    cocinero_token: token,
    pan: 'Marraquetas de masa madre',
    desde: DESDE,
    hasta: HASTA,
    unidades: 30,
    precio: 1500,
    modalidades: ['retiro', 'despacho'],
    referencia_retiro: 'Portón gris, Calle del Horno 1',
    ...extra,
  });
}

test('C-04 · la pantalla "Mi hornada" existe en el DOM real con sus campos (pan, desde, hasta, unidades, precio, modalidades, referencia_retiro)', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  await withBrowser(`${BASE}/`, async ({ evaluate }) => {
    const info = await evaluate(`
      (() => {
        const form = document.querySelector('#form-hornada');
        if (!form) return { form: false };
        const name = (sel) => {
          const el = form.querySelector(sel);
          return el ? (el.name || el.id || null) : null;
        };
        const checks = [...form.querySelectorAll('[name="modalidades"]')].map(el => el.type || el.tagName.toLowerCase());
        return {
          form: true,
          isForm: form.tagName === 'FORM',
          pan: name('input[name="pan"]'),
          desde: name('input[name="desde"]'),
          hasta: name('input[name="hasta"]'),
          unidades: name('input[name="unidades"]'),
          precio: name('input[name="precio"]'),
          modalidades: checks,
          referencia_retiro: name('input[name="referencia_retiro"]'),
        };
      })()
    `);
    assert.ok(info.form, 'C-04 · debe existir #form-hornada en el DOM servido, no lo hay');
    assert.equal(info.isForm, true, 'C-04 · #form-hornada debe ser un <form> real');
    assert.equal(info.pan, 'pan', 'C-04 · falta el campo pan');
    assert.equal(info.desde, 'desde', 'C-04 · falta el campo desde');
    assert.equal(info.hasta, 'hasta', 'C-04 · falta el campo hasta');
    assert.equal(info.unidades, 'unidades', 'C-04 · falta el campo unidades');
    assert.equal(info.precio, 'precio', 'C-04 · falta el campo precio');
    assert.ok(
      Array.isArray(info.modalidades) && info.modalidades.length >= 1,
      'C-04 · falta el campo modalidades',
    );
    assert.equal(info.referencia_retiro, 'referencia_retiro', 'C-04 · falta el campo referencia_retiro');
  });
});

test('C-05 · publicar con token válido → 201, disponibles === unidades y estado abierta (API y D1)', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const coc = await cocineroNuevo('c05');
  const unidades = 24;

  const { res, body } = await apiJson('/api/hornadas', { method: 'POST', body: hornadaValida(coc.token, { unidades }) });
  assert.equal(res.status, 201, `C-05 · esperaba 201, llegó ${res.status}`);
  const hornada = body?.hornada ?? body;
  assert.ok(hornada, 'C-05 · la respuesta debe traer la hornada');
  assert.ok(hornada.id, 'C-05 · la hornada creada debe tener id');
  assert.equal(hornada.unidades, unidades, 'C-05 · la hornada debe declarar sus unidades');
  assert.equal(hornada.disponibles, unidades, 'C-05 · disponibles debe ser igual a unidades');
  assert.equal(hornada.estado, 'abierta', 'C-05 · la hornada debe nacer abierta');

  // relectura por la API
  const { res: r2, body: b2 } = await apiJson(`/api/hornadas/${hornada.id}`);
  assert.equal(r2.status, 200, `C-05 · la hornada debe poder re-leerse, llegó ${r2.status}`);
  const releida = b2?.hornada ?? b2;
  assert.equal(releida.disponibles, unidades, 'C-05 · la relectura por API debe dar disponibles === unidades');
  assert.equal(releida.estado, 'abierta', 'C-05 · la relectura por API debe dar estado abierta');
  const sec = Array.isArray(releida.modalidades ?? releida.modalidades) ? releida.modalidades : null;
  if (sec) {
    assert.deepEqual(
      [...sec].sort(),
      ['despacho', 'retiro'],
      'C-05 · la hornada debe conservar sus modalidades',
    );
  }

  // relectura por D1 (fuente de la verdad del cupo)
  const filas = d1(`SELECT unidades, disponibles, estado FROM hornadas WHERE id = '${hornada.id}'`);
  assert.equal(filas.length, 1, 'C-05 · la hornada debe estar persistida en D1');
  assert.equal(Number(filas[0].unidades), unidades, 'C-05 · D1 debe guardar las unidades declaradas');
  assert.equal(
    Number(filas[0].disponibles),
    unidades,
    'C-05 · D1 debe guardar disponibles === unidades',
  );
  assert.equal(filas[0].estado, 'abierta', 'C-05 · D1 debe guardar estado abierta');
});

test('C-06 · una segunda hornada abierta del mismo cocinero → 409 ya_tiene_hornada_abierta y sigue habiendo una sola abierta', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const coc = await cocineroNuevo('c06');

  const { res: r1, body: b1 } = await apiJson('/api/hornadas', { method: 'POST', body: hornadaValida(coc.token) });
  assert.equal(r1.status, 201, `C-06 · la primera hornada debe publicarse, llegó ${r1.status}`);
  const primera = b1?.hornada ?? b1;
  assert.ok(primera?.id, 'C-06 · falta el id de la primera hornada');

  const { res: r2, body: b2 } = await apiJson('/api/hornadas', { method: 'POST', body: hornadaValida(coc.token) });
  assert.equal(r2.status, 409, `C-06 · la segunda debe dar 409, llegó ${r2.status}`);
  assert.equal(b2?.error, 'ya_tiene_hornada_abierta', `C-06 · error esperado ya_tiene_hornada_abierta, llegó ${JSON.stringify(b2)}`);

  const filas = d1(`SELECT id, estado FROM hornadas WHERE cocinero_id = (SELECT id FROM cocineros WHERE token = '${coc.token}')`);
  const abiertas = filas.filter((f) => f.estado === 'abierta');
  assert.equal(abiertas.length, 1, `C-06 · debe seguir habiendo UNA sola abierta, hay ${abiertas.length}`);
  assert.equal(abiertas[0].id, primera.id, 'C-06 · la abierta que queda debe ser la primera');
});

test('C-07 · unidades 0 → 400 unidades_invalidas y precio 0 → 400 precio_invalido; ninguna crea hornada', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const coc = await cocineroNuevo('c07');

  const antes = d1('SELECT COUNT(*) AS n FROM hornadas');
  const n0 = Number(antes[0]?.n ?? -1);
  assert.ok(n0 >= 0, 'C-07 · la tabla hornadas debe existir');

  const { res: r1, body: b1 } = await apiJson('/api/hornadas', { method: 'POST', body: hornadaValida(coc.token, { unidades: 0 }) });
  assert.equal(r1.status, 400, `C-07 · unidades 0 esperaba 400, llegó ${r1.status}`);
  assert.equal(b1?.error, 'unidades_invalidas', `C-07 · error esperado unidades_invalidas, llegó ${JSON.stringify(b1)}`);

  const { res: r2, body: b2 } = await apiJson('/api/hornadas', { method: 'POST', body: hornadaValida(coc.token, { precio: 0 }) });
  assert.equal(r2.status, 400, `C-07 · precio 0 esperaba 400, llegó ${r2.status}`);
  assert.equal(b2?.error, 'precio_invalido', `C-07 · error esperado precio_invalido, llegó ${JSON.stringify(b2)}`);

  const despues = d1('SELECT COUNT(*) AS n FROM hornadas');
  const n1 = Number(despues[0]?.n ?? -1);
  assert.equal(n1, n0, `C-07 · ninguna publicación debe crear filas: antes=${n0} después=${n1}`);
});

// ---- casos extra del Coder (valor agregado, piso de la matriz) ----

test('EX-05a · token inválido → 403 token_invalido (con d1 sin hornadas nuevas)', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const antes = d1('SELECT COUNT(*) AS n FROM hornadas');
  const { res, body } = await apiJson('/api/hornadas', { method: 'POST', body: hornadaValida('token-que-no-existe') });
  assert.equal(res.status, 403, `EX-05a · esperaba 403, llegó ${res.status}`);
  assert.equal(body?.error, 'token_invalido', `EX-05a · error esperado token_invalido, llegó ${JSON.stringify(body)}`);
  const despues = d1('SELECT COUNT(*) AS n FROM hornadas');
  assert.equal(Number(despues[0]?.n), Number(antes[0]?.n), 'EX-05a · un token inválido no debe crear nada');
});

test('EX-05b · sin pan o sin referencia_retiro → 400 con el campo señalado y nada creado', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const coc = await cocineroNuevo('ex05b');
  const antes = d1('SELECT COUNT(*) AS n FROM hornadas');

  const sinPan = JSON.parse(hornadaValida(coc.token));
  delete sinPan.pan;
  const { res: r1, body: b1 } = await apiJson('/api/hornadas', { method: 'POST', body: JSON.stringify(sinPan) });
  assert.equal(r1.status, 400, `EX-05b · sin pan esperaba 400, llegó ${r1.status}`);
  assert.ok(b1?.error === 'falta_pan' || b1?.error === 'pan_invalido', `EX-05b · sin pan debe nombrar el campo, llegó ${JSON.stringify(b1)}`);

  const sinRef = JSON.parse(hornadaValida(coc.token));
  delete sinRef.referencia_retiro;
  const { res: r2, body: b2 } = await apiJson('/api/hornadas', { method: 'POST', body: JSON.stringify(sinRef) });
  assert.equal(r2.status, 400, `EX-05b · sin referencia_retiro esperaba 400, llegó ${r2.status}`);
  assert.equal(b2?.error, 'falta_referencia_retiro', `EX-05b · sin referencia_retiro debe dar falta_referencia_retiro, llegó ${JSON.stringify(b2)}`);

  const despues = d1('SELECT COUNT(*) AS n FROM hornadas');
  assert.equal(Number(despues[0]?.n), Number(antes[0]?.n), 'EX-05b · ninguna publicación inválida debe crear hornadas');
});

test('EX-05c · modalidades vacía o con valores fuera de retiro|despacho → 400 modalidades_invalidas', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const coc = await cocineroNuevo('ex05c');
  const antes = d1('SELECT COUNT(*) AS n FROM hornadas');

  const vacia = JSON.parse(hornadaValida(coc.token));
  vacia.modalidades = [];
  const { res: r1, body: b1 } = await apiJson('/api/hornadas', { method: 'POST', body: JSON.stringify(vacia) });
  assert.equal(r1.status, 400, `EX-05c · modalidades [] esperaba 400, llegó ${r1.status}`);
  assert.equal(b1?.error, 'modalidades_invalidas', `EX-05c · error esperado modalidades_invalidas, llegó ${JSON.stringify(b1)}`);

  const rara = JSON.parse(hornadaValida(coc.token));
  rara.modalidades = ['retiro', 'drones'];
  const { res: r2, body: b2 } = await apiJson('/api/hornadas', { method: 'POST', body: JSON.stringify(rara) });
  assert.equal(r2.status, 400, `EX-05c · modalidades raras esperaba 400, llegó ${r2.status}`);
  assert.equal(b2?.error, 'modalidades_invalidas', `EX-05c · error esperado modalidades_invalidas, llegó ${JSON.stringify(b2)}`);

  const despues = d1('SELECT COUNT(*) AS n FROM hornadas');
  assert.equal(Number(despues[0]?.n), Number(antes[0]?.n), 'EX-05c · modalidades inválidas no deben crear hornadas');
});

test('EX-06a · la segunda hornada rechazada no deja filas: el cocinero de C-05 sigue exactamente con su única abierta', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const coc = await cocineroNuevo('ex06a');
  const { body: b1 } = await apiJson('/api/hornadas', { method: 'POST', body: hornadaValida(coc.token) });
  const primera = b1?.hornada ?? b1;
  assert.ok(primera?.id, 'EX-06a · precondición: publicar la primera hornada');

  // dos intentos seguidos: ambos 409 y nada nuevo
  for (let i = 0; i < 2; i++) {
    const { res, body } = await apiJson('/api/hornadas', { method: 'POST', body: hornadaValida(coc.token) });
    assert.equal(res.status, 409, `EX-06a · intento ${i + 1} esperaba 409, llegó ${res.status}`);
    assert.equal(body?.error, 'ya_tiene_hornada_abierta', 'EX-06a · el rechazo debe ser ya_tiene_hornada_abierta');
  }
  const filas = d1(`SELECT id, estado FROM hornadas WHERE cocinero_id = (SELECT id FROM cocineros WHERE token = '${coc.token}')`);
  assert.equal(filas.length, 1, `EX-06a · debe haber exactamente 1 hornada del cocinero, hay ${filas.length}`);
  assert.equal(filas[0].estado, 'abierta', 'EX-06a · la única hornada debe seguir abierta');
});

test('EX-07a · precio no entero (1500.5) o unidades no entera (10.5) → 400 unidad/precio_invalidos', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const coc = await cocineroNuevo('ex07a');
  const antes = d1('SELECT COUNT(*) AS n FROM hornadas');

  const { res: r1, body: b1 } = await apiJson('/api/hornadas', { method: 'POST', body: hornadaValida(coc.token, { precio: 1500.5 }) });
  assert.equal(r1.status, 400, `EX-07a · precio 1500.5 esperaba 400, llegó ${r1.status}`);
  assert.ok(
    ['precio_invalido', 'unidades_invalidas', 'json_invalido'].includes(b1?.error),
    `EX-07a · error esperado precio_invalido, llegó ${JSON.stringify(b1)}`,
  );

  const { res: r2, body: b2 } = await apiJson('/api/hornadas', { method: 'POST', body: hornadaValida(coc.token, { unidades: 10.5 }) });
  assert.equal(r2.status, 400, `EX-07a · unidades 10.5 esperaba 400, llegó ${r2.status}`);
  assert.equal(b2?.error, 'unidades_invalidas', `EX-07a · error esperado unidades_invalidas, llegó ${JSON.stringify(b2)}`);

  const despues = d1('SELECT COUNT(*) AS n FROM hornadas');
  assert.equal(Number(despues[0]?.n), Number(antes[0]?.n), 'EX-07a · nada de esto debe crear hornadas');
});

test('EX-404a · GET /api/hornadas/:id inexistente → 404 no_existe (JSON)', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const { res, body } = await apiJson('/api/hornadas/no-existe-esta-id');
  assert.equal(res.status, 404, `EX-404a · esperaba 404, llegó ${res.status}`);
  assert.ok(body && typeof body === 'object', 'EX-404a · el 404 debe ser JSON');
  assert.equal(body?.error, 'no_existe', `EX-404a · error esperado no_existe, llegó ${JSON.stringify(body)}`);
});
