import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, serverReady, api, apiJson, d1, withBrowser, BASE } from './helpers.mjs';
import { abrirTurno, cerrarTurno } from './lock.mjs';

// T-7 — el panel del cocinero (HU-5): C-18, C-19 + segunda mitad de C-23
// (el cocinero ve la dirección de un despacho, porque el panel es su superficie).
// Serialización obligatoria: turno exclusivo del puerto 8787 (lock.mjs), como
// t5-reservas y t6-modalidad. Sin esto, las suites se pelean el puerto.

before(() => abrirTurno('t7-panel.test.mjs'));
after(() => {
  stopServer();
  cerrarTurno();
});

// ---- helpers propios de T-7 (los helpers sellados no se tocan) ----

const ms = (min) => min * 60 * 1000;

function iso(desplazamientoMin) {
  return new Date(Date.now() + ms(desplazamientoMin)).toISOString();
}

async function cocineroNuevo(tag) {
  const nombre = `Horneador T7 ${tag} ${Date.now()}`;
  const sec = `sector-t7-${tag}-${Date.now()}`;
  const referencia = `Portón T7 ${tag}, calle del panel ${Date.now()}`;
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
    pan: 'Marraquetas T7',
    desde: iso(90),
    hasta: iso(300),
    unidades: 20,
    precio: 1000,
    modalidades: ['retiro', 'despacho'],
    referencia_retiro: 'Portón T7, Calle del Panel 1',
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

// La API pública de la reserva habla por `codigo` (llave del cliente); el panel
// y el entregado hablan por `id`. El id se lee de D1: es el schema del diseño
// (reservas.id TEXT PRIMARY KEY). SQL en UNA sola línea: d1() es execSync+shell.
function leerIdReserva(codigo) {
  const filas = d1(`SELECT id, estado, modalidad, direccion, nombre FROM reservas WHERE codigo = '${codigo}'`);
  assert.equal(filas.length, 1, 'precondición · la reserva debe existir en D1 por su codigo');
  return filas[0];
}

// Aplanar el panel: [{ hornada, ...reserva }] — tolerante a la forma horneada
// (hornadas[].reservas[]) o plana que pueda devolver la implementación.
function aplanarReservas(bodyPanel) {
  const salidas = [];
  const hornadas = bodyPanel?.hornadas ?? bodyPanel?.panel?.hornadas ?? [];
  assert.ok(Array.isArray(hornadas), 'el panel debe traer un arreglo de hornadas');
  for (const h of hornadas) {
    const reservas = Array.isArray(h?.reservas)
      ? h.reservas
      : (h?.reservas ? [h.reservas] : []);
    for (const r of reservas) {
      assert.ok(h?.pan, 'cada reserva del panel debe venir con el pan de su hornada');
      salidas.push({ reserva: r, hornada: h });
    }
  }
  return salidas;
}

async function pedirPanel(token) {
  const { res, body } = await apiJson(
    `/api/cocineros/mi-panel?token=${encodeURIComponent(token)}`,
  );
  return { res, body };
}

// ---- tests ----

test('C-18 · el panel lista las reservas de las hornadas del cocinero y solo las suyas', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const cocA = await cocineroNuevo('A');
  const cocB = await cocineroNuevo('B');
  const hornadaA = await publicarHornada(cocA.token);
  const hornadaB = await publicarHornada(cocB.token, { pan: 'Bagettes T7 B' });

  const resA = await reservar(hornadaA.id, {
    nombre: 'Cliente de A',
    contacto: 'a@barrio.cl',
    unidades: 2,
    modalidad: 'retiro',
  });
  const resB = await reservar(hornadaB.id, {
    nombre: 'Cliente de B',
    contacto: 'b@barrio.cl',
    unidades: 3,
    modalidad: 'retiro',
  });

  // El panel del cocinero A.
  const { res, body } = await pedirPanel(cocA.token);
  assert.equal(res.status, 200, `C-18 · panel del dueño debía dar 200, llegó ${res.status}: ${JSON.stringify(body)}`);

  const filas = aplanarReservas(body);
  assert.ok(filas.length >= 1, 'C-18 · el panel del cocinero A debe listar su reserva');
  // Su reserva aparece, con los datos que nombra HU-5.
  const suya = filas.find(
    (f) => f.reserva?.nombre === 'Cliente de A' || f.reserva?.codigo === resA.codigo,
  );
  assert.ok(suya, `C-18 · la reserva de A (${resA.codigo}) no apareció en su panel: ${JSON.stringify(body)}`);
  assert.ok(suya.reserva?.nombre === 'Cliente de A' || suya.reserva?.codigo === resA.codigo,
    'C-18 · la fila correspondiente debe ser la reserva de A');
  assert.ok(suya.reserva?.contacto, 'C-18 · la fila debe traer el contacto del cliente');
  assert.equal(Number(suya.reserva?.unidades ?? 0), 2, 'C-18 · la fila debe traer las unidades (2)');

  // Cero datos ajenos: verificamos explícitamente que ninguna reserva de B aparece.
  const ajeno = filas.find(
    (f) => f.reserva?.nombre === 'Cliente de B' || f.reserva?.codigo === resB.codigo,
  );
  assert.equal(ajeno, undefined, `C-18 · el panel de A filtró datos de otro cocinero: ${JSON.stringify(ajeno)}`);
});

test('C-18b · con un token que no es de ningún cocinero el panel devuelve 403 token_invalido', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const { res, body } = await pedirPanel(`token-que-no-existe-t7-${Date.now()}`);
  assert.equal(res.status, 403, `C-18 · token foráneo debía dar 403, llegó ${res.status}`);
  assert.equal(body?.error, 'token_invalido', `C-18 · esperaba error token_invalido, llegó ${JSON.stringify(body)}`);
  assert.ok(!body?.hornadas, 'C-18 · con 403 no debe filtrar ninguna hornada');
});

test('C-19 · marcar entregado persiste: se relee el panel y la reserva sigue entregada', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const coc = await cocineroNuevo('C');
  const hornada = await publicarHornada(coc.token, { pan: 'Pan Amasado T7 C' });
  const r = await reservar(hornada.id, {
    nombre: 'Cliente de C',
    contacto: 'c@barrio.cl',
    unidades: 4,
    modalidad: 'retiro',
  });
  const fila = leerIdReserva(r.codigo);
  assert.equal(fila.estado, 'reservada', 'precondición · la reserva nace reservada');

  const { res, body } = await apiJson(`/api/reservas/${encodeURIComponent(fila.id)}/entregado`, {
    method: 'POST',
    body: JSON.stringify({ cocinero_token: coc.token }),
  });
  assert.equal(res.status, 200, `C-19 · entregado debía dar 200, llegó ${res.status}: ${JSON.stringify(body)}`);
  assert.equal((body?.reserva ?? body)?.estado, 'entregada', 'C-19 · la respuesta debe decir entregada');

  // Persistencia REAL (no de la respuesta): se vuelve a pedir el panel.
  const panel = await pedirPanel(coc.token);
  assert.equal(panel.res.status, 200, `C-19 · la releitura del panel debía dar 200, llegó ${panel.res.status}`);
  const filas = aplanarReservas(panel.body);
  const marcada = filas.find((f) => f.reserva?.nombre === 'Cliente de C');
  assert.ok(marcada, 'C-19 · la reserva debe seguir listada tras releer el panel');
  assert.equal(marcada.reserva?.estado, 'entregada',
    `C-19 · al releer el panel la reserva debe seguir entregada (persistencia real), llegó: ${JSON.stringify(marcada)}`);

  const fila2 = leerIdReserva(r.codigo);
  assert.equal(fila2.estado, 'entregada', 'C-19 · en D1 la reserva también debe seguir entregada');
});

test('C-19b · la reserva de otro cocinero no se puede marcar: 403 no_es_tu_reserva', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const cocD = await cocineroNuevo('D');
  const cocE = await cocineroNuevo('E');
  const hornadaD = await publicarHornada(cocD.token, { pan: 'Pan T7 D' });
  const r = await reservar(hornadaD.id, {
    nombre: 'Cliente de D',
    contacto: 'd@barrio.cl',
    unidades: 1,
    modalidad: 'retiro',
  });
  const fila = leerIdReserva(r.codigo);

  const { res, body } = await apiJson(`/api/reservas/${encodeURIComponent(fila.id)}/entregado`, {
    method: 'POST',
    body: JSON.stringify({ cocinero_token: cocE.token }),
  });
  assert.equal(res.status, 403, `C-19 · reserva ajena debía dar 403, llegó ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(body?.error, 'no_es_tu_reserva', `C-19 · esperaba no_es_tu_reserva, llegó ${JSON.stringify(body)}`);

  const fila2 = leerIdReserva(r.codigo);
  assert.equal(fila2.estado, 'reservada', 'C-19 · la reserva ajena debe seguir reservada (no se marcó)');
});

test('C-23b · una reserva de despacho aparece en el panel con su dirección de entrega', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const coc = await cocineroNuevo('F');
  const hornada = await publicarHornada(coc.token, { pan: 'Hallullas T7 F' });
  const direccion = 'Av. Siempre Viva 742, sector-t7-F';
  const r = await reservar(hornada.id, {
    nombre: 'Cliente despacho F',
    contacto: 'f@barrio.cl',
    unidades: 1,
    modalidad: 'despacho',
    direccion,
  });

  const panel = await pedirPanel(coc.token);
  assert.equal(panel.res.status, 200, `C-23 · el panel debía dar 200, llegó ${panel.res.status}`);
  const filas = aplanarReservas(panel.body);
  const despachada = filas.find((f) => f.reserva?.nombre === 'Cliente despacho F' || f.reserva?.codigo === r.codigo);
  assert.ok(despachada, `C-23 · la reserva de despacho no apareció en el panel: ${JSON.stringify(panel.body)}`);
  assert.equal(despachada.reserva?.modalidad, 'despacho', 'C-23 · la fila debe declarar modalidad despacho');
  assert.equal(despachada.reserva?.direccion, direccion,
    `C-23 · el cocinero debe ver la dirección de entrega del despacho, llegó: ${JSON.stringify(despachada.reserva)}`);
});

test('EX-T7 · sin id de reserva existente, entregado da 404 no_existe', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const coc = await cocineroNuevo('G');
  const { res, body } = await apiJson(`/api/reservas/no-existe-t7-${Date.now()}/entregado`, {
    method: 'POST',
    body: JSON.stringify({ cocinero_token: coc.token }),
  });
  assert.equal(res.status, 404, `EX-T7 · reserva inexistente debía dar 404, llegó ${res.status}`);
  assert.equal(body?.error, 'no_existe', `EX-T7 · esperaba no_existe, llegó ${JSON.stringify(body)}`);
});

test('EX-T7 · la pantalla del panel (#panel-cocinero) se abre con el token y muestra sus reservas con botón entregado', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const coc = await cocineroNuevo('H');
  const hornada = await publicarHornada(coc.token, { pan: 'Pan de H T7' });
  const r = await reservar(hornada.id, {
    nombre: 'Cliente pantalla T7',
    contacto: 'h@barrio.cl',
    unidades: 2,
    modalidad: 'retiro',
  });

  await withBrowser(`${BASE}/?token=${encodeURIComponent(coc.token)}`, async ({ evaluate }) => {
    // el panel se puebla con fetch: poll hasta que aparezca (o tras 8 s falla igual)
    let estado = { seccion: 'ausente', nombre: null, boton: false };
    for (let intento = 0; intento < 24; intento++) {
      estado = await evaluate(`(() => {
        const seccion = document.querySelector('#panel-cocinero');
        if (!seccion) return { seccion: null };
        const visible = seccion.offsetParent !== null || seccion.style.display !== 'none';
        if (!visible) return { seccion: 'oculta' };
        const nombres = Array.from(seccion.querySelectorAll('*')).map((n) => n.textContent || '').join(' ');
        const hayNombre = nombres.includes('Cliente pantalla T7');
        const boton = Array.from(seccion.querySelectorAll('button')).find((b) => /entreg/i.test(b.textContent || ''));
        return { seccion: 'visible', nombre: hayNombre ? 'ok' : null, boton: Boolean(boton) };
      })()`);
      if (estado?.seccion === 'visible' && estado?.boton !== false) break;
      await new Promise((res_) => setTimeout(res_, 250));
    }

    assert.equal(estado.seccion, 'visible', 'EX-T7 · la pantalla debe exponer un estado visible #panel-cocinero');
    assert.ok(estado.nombre === 'ok', 'EX-T7 · el panel abierto con el token debe mostrar la reserva (Cliente pantalla T7)');
    assert.ok(estado.boton, 'EX-T7 · cada reserva del panel debe ofrecer un botón para marcar entregado');
  });
});
