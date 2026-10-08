import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, serverReady, api, apiJson, d1, withBrowser, BASE } from './helpers.mjs';
import { abrirTurno, cerrarTurno } from './lock.mjs';

// T-8 — el cliente sigue su pedido (HU-6): C-20.
// GET /api/reservas/:codigo devuelve SU reserva y solo la suya; un código
// inexistente da 404 no_existe sin filtrar datos de ninguna otra reserva.
// Serialización obligatoria: turno exclusivo del puerto 8787 (lock.mjs).

before(() => abrirTurno('t8-mi-reserva.test.mjs'));
after(() => {
  stopServer();
  cerrarTurno();
});

// ---- helpers propios de T-8 (los helpers sellados no se tocan) ----

const ms = (min) => min * 60 * 1000;

function iso(desplazamientoMin) {
  return new Date(Date.now() + ms(desplazamientoMin)).toISOString();
}

async function cocineroNuevo(tag) {
  const nombre = `Horneador T8 ${tag} ${Date.now()}`;
  const sec = `sector-t8-${tag}-${Date.now()}`;
  const referencia = `Portón T8 ${tag}, calle del seguimiento ${Date.now()}`;
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
    pan: 'Marraquetas T8',
    desde: iso(90),
    hasta: iso(300),
    unidades: 20,
    precio: 1200,
    modalidades: ['retiro', 'despacho'],
    referencia_retiro: 'Portón T8, Calle del Seguimiento 1',
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
  const { res, body } = await apiJson(`/api/hornadas/${encodeURIComponent(hornadaId)}/reservas`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });
  assert.equal(res.status, 201, `precondición (reserva) · esperaba 201, llegó ${res.status}: ${JSON.stringify(body)}`);
  const r = body?.reserva ?? body;
  assert.ok(r?.codigo, 'precondición (reserva) · no vino codigo');
  return r;
}

// SQL en UNA sola línea: d1() es execSync+shell y no acepta multilínea.
function leerIdReserva(codigo) {
  const filas = d1(`SELECT id, estado FROM reservas WHERE codigo = '${codigo}'`);
  assert.equal(filas.length, 1, 'precondición · la reserva debe existir en D1 por su codigo');
  return filas[0];
}

async function consultar(codigo) {
  const { res, body } = await apiJson(`/api/reservas/${encodeURIComponent(codigo)}`);
  return { res, body };
}

// ---- tests ----

test('C-20 · el codigo devuelve SU reserva: estado, unidades, modalidad, donde y los datos de su hornada', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const coc = await cocineroNuevo('A');
  const hornada = await publicarHornada(coc.token, { pan: 'Pan de masa madre T8 A' });

  // Despacho: 'donde' debe ser la dirección que dejó el cliente (C-23/C-14).
  const direccion = 'Av. del Seguimiento 123, sector-t8-A';
  const r = await reservar(hornada.id, {
    nombre: 'Cliente que sigue T8',
    contacto: 'sigue@barrio.cl',
    unidades: 3,
    modalidad: 'despacho',
    direccion,
  });

  const otra = await reservar(hornada.id, {
    nombre: 'Otro cliente T8',
    contacto: 'otro@barrio.cl',
    unidades: 1,
    modalidad: 'retiro',
  });

  const { res, body } = await consultar(r.codigo);
  assert.equal(res.status, 200, `C-20 · el código real debía dar 200, llegó ${res.status}: ${JSON.stringify(body)}`);

  const reserva = body?.reserva ?? body;
  assert.ok(reserva, 'C-20 · la respuesta debe traer la reserva');
  assert.equal(reserva.estado, 'reservada', `C-20 · el estado inicial debe ser reservada, llegó ${reserva.estado}`);
  assert.equal(Number(reserva.unidades), 3, `C-20 · las unidades deben ser 3 (las de esa reserva), llegó ${JSON.stringify(reserva.unidades)}`);
  assert.equal(reserva.modalidad, 'despacho', `C-20 · la modalidad debe ser la elegida (despacho), llegó ${reserva.modalidad}`);
  assert.equal(reserva.donde, direccion, `C-20 · 'donde' de un despacho debe ser la dirección del cliente, llegó ${JSON.stringify(reserva.donde)}`);
  assert.equal(Number(reserva.total), 3 * 1200, `C-20 · el total debe ser unidades × precio (3600), llegó ${JSON.stringify(reserva.total)}`);

  const hornadaDatos = reserva.hornada ?? (typeof reserva.pan !== 'undefined' ? reserva : null);
  assert.ok(hornadaDatos, `C-20 · la respuesta debe traer los datos de su hornada, llegó: ${JSON.stringify(body)}`);
  assert.equal(hornadaDatos.pan, 'Pan de masa madre T8 A', `C-20 · el pan debe ser el de SU hornada, llegó ${JSON.stringify(hornadaDatos.pan)}`);
  assert.equal(hornadaDatos.desde, hornada.desde, `C-20 · 'desde' debe ser el de su hornada, llegó ${JSON.stringify(hornadaDatos.desde)}`);
  assert.equal(hornadaDatos.hasta, hornada.hasta, `C-20 · 'hasta' debe ser el de su hornada, llegó ${JSON.stringify(hornadaDatos.hasta)}`);

  // Un código inexistente: 404 no_existe y cero datos de NINGUNA otra reserva.
  const { res: res404, body: body404 } = await consultar(`codigo-inexistente-t8-${Date.now()}`);
  assert.equal(res404.status, 404, `C-20 · un código inexistente debía dar 404, llegó ${res404.status}`);
  assert.equal(body404?.error, 'no_existe', `C-20 · esperaba error no_existe, llegó ${JSON.stringify(body404)}`);
  const crudo = JSON.stringify(body404 ?? {});
  assert.ok(!crudo.includes('Cliente que sigue T8') && !crudo.includes(r.codigo) && !crudo.includes(otra.codigo),
    `C-20 · el 404 no debe filtrar datos de ninguna otra reserva: ${crudo}`);
});

test('C-20b · tras marcarla entregada (T-7), la relectura por codigo muestra estado entregada', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const coc = await cocineroNuevo('B');
  const hornada = await publicarHornada(coc.token, { pan: 'Hallullas T8 B' });
  const r = await reservar(hornada.id, {
    nombre: 'Cliente entregada T8',
    contacto: 'entregada@barrio.cl',
    unidades: 2,
    modalidad: 'retiro',
  });

  const antes = await consultar(r.codigo);
  assert.equal(antes.res.status, 200, 'C-20 · la lectura antes de entregar debía dar 200');
  assert.equal((antes.body?.reserva ?? antes.body)?.estado, 'reservada',
    `C-20 · antes de entregar debe estar reservada, llegó ${JSON.stringify(antes.body)}`);

  // T-7: el cocinero marca entregado (por id de reserva, con su token).
  const fila = leerIdReserva(r.codigo);
  const { res, body } = await apiJson(`/api/reservas/${encodeURIComponent(fila.id)}/entregado`, {
    method: 'POST',
    body: JSON.stringify({ cocinero_token: coc.token }),
  });
  assert.equal(res.status, 200, `C-20 · precondición (entregado) debía dar 200, llegó ${res.status}: ${JSON.stringify(body)}`);

  // Relectura por código: persistencia real vista por el cliente.
  const despues = await consultar(r.codigo);
  assert.equal(despues.res.status, 200, `C-20 · la relectura debía dar 200, llegó ${despues.res.status}`);
  const reserva = despues.body?.reserva ?? despues.body;
  assert.equal(reserva.estado, 'entregada',
    `C-20 · tras marcarla entregada, la relectura por codigo debe decir entregada, llegó ${JSON.stringify(despues.body)}`);
});

test('EX-T8 · la pantalla #mi-reserva se abre con el codigo y muestra estado, unidades, total, donde y la hornada', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const coc = await cocineroNuevo('C');
  const hornada = await publicarHornada(coc.token, { pan: 'Pan de campo T8 C' });
  const r = await reservar(hornada.id, {
    nombre: 'Cliente pantalla T8',
    contacto: 'pantalla@barrio.cl',
    unidades: 2,
    modalidad: 'retiro',
  });

  await withBrowser(`${BASE}/?codigo=${encodeURIComponent(r.codigo)}`, async ({ evaluate }) => {
    let estado = { seccion: 'ausente', texto: '' };
    for (let intento = 0; intento < 24; intento++) {
      estado = await evaluate(`(() => {
        const seccion = document.querySelector('#mi-reserva');
        if (!seccion) return { seccion: null };
        const visible = seccion.offsetParent !== null || seccion.style.display !== 'none';
        if (!visible) return { seccion: 'oculta' };
        const texto = Array.from(seccion.querySelectorAll('*')).map((n) => n.textContent || '').join(' ');
        return { seccion: 'visible', texto };
      })()`);
      if (estado?.seccion === 'visible') break;
      await new Promise((res_) => setTimeout(res_, 250));
    }

    assert.equal(estado.seccion, 'visible', 'EX-T8 · la pantalla debe exponer un estado visible #mi-reserva');
    assert.ok(estado.texto.includes('reservada'), `EX-T8 · #mi-reserva debe mostrar el estado (reservada), llegó: ${estado.texto}`);
    assert.ok(estado.texto.includes('2'), `EX-T8 · #mi-reserva debe mostrar las unidades (2), llegó: ${estado.texto}`);
    assert.ok(estado.texto.includes('2400'), `EX-T8 · #mi-reserva debe mostrar el total (2400), llegó: ${estado.texto}`);
    assert.ok(estado.texto.includes('Portón T8, Calle del Seguimiento 1'),
      `EX-T8 · #mi-reserva debe mostrar el punto de retiro (donde), llegó: ${estado.texto}`);
    assert.ok(estado.texto.includes('Pan de campo T8 C'),
      `EX-T8 · #mi-reserva debe mostrar el pan de su hornada, llegó: ${estado.texto}`);
  });
});
