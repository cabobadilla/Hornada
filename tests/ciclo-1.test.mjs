import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, serverReady, api, apiJson, d1, withBrowser, BASE } from './helpers.mjs';
import { abrirTurno, cerrarTurno } from './lock.mjs';

// T-5b: esta suite arranca wrangler dev en 8787 como las demás; el turno exclusivo
// (lock file en .tmp/, un solo dev server por vez) lo garantiza abrirTurno/cerrarTurno.
before(() => abrirTurno('ciclo-1.test.mjs'));
after(() => {
  stopServer();
  cerrarTurno();
});

let nombre1 = null;
let sector1 = null;
let referencia1 = null;

test('C-01 · el formulario de registro existe en el DOM real con sus 4 campos (nombre, sector, referencia_retiro, foto_url)', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  await withBrowser(`${BASE}/`, async ({ evaluate }) => {
    const info = await evaluate(`
      (() => {
        const form = document.querySelector('#form-cocinero');
        if (!form) return { form: false };
        const name = (sel) => {
          const el = form.querySelector(sel);
          return el ? el.name || el.id || null : null;
        };
        return {
          form: true,
          method: (form.getAttribute('method') || '').toLowerCase(),
          isForm: form.tagName === 'FORM',
          nombre: name('input[name="nombre"], [name="nombre"]'),
          sector: name('input[name="sector"], select[name="sector"], select[name="sector"], [name="sector"]'),
          referencia_retiro: name('[name="referencia_retiro"]'),
          foto_url: name('[name="foto_url"]'),
        };
      })()
    `);
    assert.ok(info.form, 'C-01 · debe existir #form-cocinero en el DOM servido, no lo hay');
    assert.equal(info.isForm, true, 'C-01 · #form-cocinero debe ser un <form> real');
    assert.equal(info.nombre, 'nombre', 'C-01 · falta el campo nombre');
    assert.equal(info.sector, 'sector', 'C-01 · falta el campo sector');
    assert.equal(info.referencia_retiro, 'referencia_retiro', 'C-01 · falta el campo referencia_retiro');
    assert.equal(info.foto_url, 'foto_url', 'C-01 · falta el campo foto_url');
  });
});

test('C-02 · alta válida responde 201 con cocinero.token y el cocinero queda asociado a su sector', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  nombre1 = `María Baker ${Date.now()}`;
  sector1 = `piloto-${Date.now()}`;
  referencia1 = 'Retiro en calle falsa 123, Cedar de aspecto cedar';
  const { res, body } = await apiJson('/api/cocineros', {
    method: 'POST',
    body: JSON.stringify({ nombre: nombre1, sector: sector1, referencia_retiro: referencia1 }),
  });
  assert.equal(res.status, 201, `C-02 · esperaia 201, llego ${res.status}`);
  assert.ok(body && typeof body === 'object', 'C-02 · la respuesta debe ser JSON');
  const coc = body.cocinero ?? body;
  assert.ok(coc.token && typeof coc.token === 'string' && coc.token.length >= 8, 'C-02 · faltó cocinero.token opaco');
  assert.ok(coc.id, 'C-02 · faltó cocinero.id');
  assert.equal(coc.nombre, nombre1, 'C-02 · el nombre devuelto no coincide');
  assert.equal(coc.sector, sector1, 'C-02 · el sector devuelto no coincide');
  const filas = d1(`SELECT nombre, sector, referencia_retiro, token FROM cocineros WHERE token = '${coc.token}'`);
  assert.equal(filas.length, 1, 'C-02 · el cocinero no quedó persistido');
  assert.equal(filas[0].sector, sector1, 'C-02 · el cocinero no quedó asociado a su sector en la base');
  assert.equal(filas[0].referencia_retiro, referencia1, 'C-02 · la referencia de retiro no se guardó');
});

test('C-03 · sin nombre → 400 falta_nombre; sin sector → 400 falta_sector; y el cocinero no se crea', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const antes = d1('SELECT COUNT(*) AS n FROM cocineros');
  const n0 = Number(antes[0]?.n ?? -1);
  assert.ok(n0 >= 0, 'no se pudo leer la base: la tabla cocineros debe existir');

  const { res: r1, body: b1 } = await apiJson('/api/cocineros', {
    method: 'POST',
    body: JSON.stringify({ sector: 'sector_alpha', referencia_retiro: 'calle_falsa' }),
  });
  assert.equal(r1.status, 400, `C-03 · sin nombre esperaia 400, llego ${r1.status}`);
  assert.equal(b1?.error, 'falta_nombre', `C-03 · error esperado falta_nombre, llego ${JSON.stringify(b1)}`);

  const { res: r2, body: b2 } = await apiJson('/api/cocineros', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Sin sector', referencia_retiro: 'calle_falsa' }),
  });
  assert.equal(r2.status, 400, `C-03 · sin sector esperaia 400, llego ${r2.status}`);
  assert.equal(b2?.error, 'falta_sector', `C-03 · error esperado falta_sector, llego ${JSON.stringify(b2)}`);

  const despues = d1('SELECT COUNT(*) AS n FROM cocineros');
  const n1 = Number(despues[0]?.n ?? -1);
  assert.equal(n1, n0, `C-03 · el cocinero NO debe crearse: filas antes=${n0} despues=${n1}`);
});

// ---- casos extra del Coder (valor agregado, piso de la matriz) ----

test('EX-02a · nombre vacío o solo espacios también es falta_nombre', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const { res, body } = await apiJson('/api/cocineros', {
    method: 'POST',
    body: JSON.stringify({ nombre: '   ', sector: 'sector_ex', referencia_retiro: 'a' }),
  });
  assert.equal(res.status, 400, `EX-02a · esperaia 400, llego ${res.status}`);
  assert.equal(body?.error, 'falta_nombre', 'EX-02a · nombre en blanco debe dar falta_nombre');
});

test('EX-02b · body no JSON o vacío se rechaza sin crear nada', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const res = await api('/api/cocineros', { method: 'POST', body: 'no-soy-json' });
  assert.ok(res.status >= 400 && res.status < 500, `EX-02b · body inválido debe dar 4xx, llego ${res.status}`);
});

test('EX-01a · la página "Quiero cocinar" se sirve como HTML y muestra el título del formulario', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(10000) });
  assert.equal(res.status, 200, `EX-01a · la raíz debe servir 200, llego ${res.status}`);
  assert.match(res.headers.get('content-type') || '', /text\/html/i, 'EX-01a · la raíz debe servir HTML');
  await withBrowser(`${BASE}/`, async ({ evaluate }) => {
    const info = await evaluate(
      `(() => {
        const form = document.querySelector('#form-cocinero');
        if (!form) return null;
        let texto = '';
        for (let el = form, i = 0; el && i < 2; el = el.parentElement, i++) {
          texto += (el.textContent || '').trim();
        }
        return { hayForm: !!form, texto };
      })()`,
    );
    assert.ok(info && info.hayForm, 'EX-01b · la página del DOM debe mostrar el formulario');
    assert.match(
      info.texto.toLowerCase(),
      /cocin|quiero/,
      'EX-01b · la página debe nombrar la oferta "Quiero cocinar" en su encabezado, no solo el id del nodo',
    );
  });
});
