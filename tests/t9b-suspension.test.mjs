import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { stopServer, serverReady, apiJson, d1 } from './helpers.mjs';
import { abrirTurno, cerrarTurno } from './lock.mjs';

// T-9b — la suspensión también rechaza reservas (C-27 camino de la reserva):
// la fila C-27 de 04-DISENO.md dice "no aceptan reservas (403 cocinero_suspendido)"
// y el contrato de POST /api/hornadas/:id/reservas solo declara 409 para
// { sin_cupo | hornada_cerrada }: la suspensión NO es un asunto de cupo ni de
// ventana. Serialización obligatoria: turno exclusivo del puerto 8787 (lock.mjs).

before(() => abrirTurno('t9b-suspension.test.mjs'));
after(() => {
  stopServer();
  cerrarTurno();
});

// ---- helpers propios de T-9b (patrón de T-9, helpers sellados no se tocan) ----

const ms = (min) => min * 60 * 1000;

function iso(desplazamientoMin) {
  return new Date(Date.now() + ms(desplazamientoMin)).toISOString();
}

async function cocineroNuevo(tag) {
  const nombre = `Horneador T9b ${tag} ${Date.now()}`;
  const sec = `sector-t9b-${tag}-${Date.now()}`;
  const referencia = `Portón T9b ${tag}, calle de la suspensión ${Date.now()}`;
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
    pan: 'Marraquetas T9b',
    desde: iso(90),
    hasta: iso(300),
    unidades: 40,
    precio: 1000,
    modalidades: ['retiro', 'despacho'],
    referencia_retiro: 'Portón T9b, Calle de la Suspensión 1',
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

async function reservarCrudo(hornadaId, cuerpo) {
  const { res, body } = await apiJson(`/api/hornadas/${encodeURIComponent(hornadaId)}/reservas`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });
  return { res, body };
}

async function reservar(hornadaId, cuerpo) {
  const { res, body } = await reservarCrudo(hornadaId, cuerpo);
  assert.equal(res.status, 201, `precondición (reserva) · esperaba 201, llegó ${res.status}: ${JSON.stringify(body)}`);
  const r = body?.reserva ?? body;
  assert.ok(r?.codigo, 'precondición (reserva) · no vino codigo');
  return r;
}

async function entregar(token, codigo) {
  // SQL en UNA sola línea: d1() es execSync+shell y no acepta multilínea.
  const filas = d1(`SELECT id, estado FROM reservas WHERE codigo = '${codigo}'`);
  assert.equal(filas.length, 1, 'precondición · la reserva debe existir en D1 por su codigo');
  const id = filas[0].id;
  const { res, body } = await apiJson(`/api/reservas/${encodeURIComponent(id)}/entregado`, {
    method: 'POST',
    body: JSON.stringify({ cocinero_token: token }),
  });
  assert.equal(res.status, 200, `precondición (entregado) · esperaba 200, llegó ${res.status}: ${JSON.stringify(body)}`);
  return id;
}

async function calificar(codigo, cuerpo) {
  const { res, body } = await apiJson(`/api/reservas/${encodeURIComponent(codigo)}/resena`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });
  return { res, body };
}

async function cupoDisponible(hornadaId) {
  const filas = d1(`SELECT disponibles, estado FROM hornadas WHERE id = '${hornadaId}'`);
  assert.equal(filas.length, 1, 'precondición · la hornada debe existir en D1');
  return filas[0];
}

// ---- tests ----

test('C-27c · suspendido: POST /api/hornadas/:id/reservas sobre hornada abierta → 403 cocinero_suspendido y el cupo NO cambia', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const coc = await cocineroNuevo('G27c');
  const hornada = await publicarHornada(coc.token, { pan: 'Pan suspendido T9b C' });

  // 5 clientes distintos, 5 reservas entregadas, 5 reseñas de 1 estrella: suspendido.
  for (let i = 1; i <= 5; i++) {
    const r = await reservar(hornada.id, {
      nombre: `Cliente suspende ${i} T9b`,
      contacto: `suspende${i}@t9b.cl`,
      unidades: 1,
      modalidad: 'retiro',
    });
    await entregar(coc.token, r.codigo);
    const { res, body } = await calificar(r.codigo, { estrellas: 1, comentario: `la ${i}` });
    assert.equal(res.status, 201, `precondición (resena ${i}) · esperaba 201, llegó ${res.status}: ${JSON.stringify(body)}`);
  }

  // La hornada sigue ABIERTA y con cupo de sobra (40 usados 5, quedan 35): la
  // suspensión no es hornada_cerrada ni sin_cupo, es otra cosa y va a 403.
  const antes = await cupoDisponible(hornada.id);
  assert.equal(antes.estado, 'abierta', `precondición · la hornada debía seguir abierta, llegó: ${JSON.stringify(antes)}`);
  assert.equal(Number(antes.disponibles), 35, `precondición · cupo disponible debía ser 35, llegó: ${JSON.stringify(antes)}`);

  const { res, body } = await reservarCrudo(hornada.id, {
    nombre: 'Cliente rechazado T9b',
    contacto: 'rechazado@t9b.cl',
    unidades: 1,
    modalidad: 'retiro',
  });
  assert.equal(res.status, 403, `C-27c · reservar sobre suspendido debía dar 403 (no 409), llegó ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(body?.error, 'cocinero_suspendido', `C-27c · esperaba cocinero_suspendido, llegó ${JSON.stringify(body)}`);

  // El cupo no cambió: la reserva rechazada no consume pan.
  const despues = await cupoDisponible(hornada.id);
  assert.equal(Number(despues.disponibles), Number(antes.disponibles),
    `C-27c · el cupo no debe cambiar con la reserva rechazada, antes ${antes.disponibles} después ${despues.disponibles}`);
  assert.equal(despues.estado, 'abierta', `C-27c · la hornada debe seguir abierta, llegó: ${JSON.stringify(despues)}`);
  const filasRechazo = d1(`SELECT COUNT(*) AS n FROM reservas WHERE hornada_id = '${hornada.id}' AND contacto = 'rechazado@t9b.cl'`);
  assert.equal(filasRechazo[0].n, 0, `C-27c · la reserva rechazada no debe dejar fila en D1, llegó: ${JSON.stringify(filasRechazo)}`);
});

test('C-27d · el borde, del lado de la reserva: 4 reseñas de 1 estrella → reservar sigue dando 201', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const coc = await cocineroNuevo('H27d');
  const hornada = await publicarHornada(coc.token, { pan: 'Pan borde T9b D' });

  for (let i = 1; i <= 4; i++) {
    const r = await reservar(hornada.id, {
      nombre: `Cliente borde ${i} T9b`,
      contacto: `borde${i}@t9b.cl`,
      unidades: 1,
      modalidad: 'retiro',
    });
    await entregar(coc.token, r.codigo);
    assert.equal((await calificar(r.codigo, { estrellas: 1 })).res.status, 201, `precondición (resena borde ${i})`);
  }

  // 4 < 5: el umbral NO se alcanza y reservar sigue funcionando sin problema.
  const r5 = await reservarCrudo(hornada.id, {
    nombre: 'Cliente borde 5 T9b',
    contacto: 'borde5@t9b.cl',
    unidades: 2,
    modalidad: 'retiro',
  });
  assert.equal(r5.res.status, 201, `C-27d · con 4 reseñas de 1 estrella reservar debía dar 201, llegó ${r5.res.status}: ${JSON.stringify(r5.body)}`);
  const b = r5.body?.reserva ?? r5.body;
  assert.ok(b?.codigo, `C-27d · la reserva aceptada debe traer codigo, llegó: ${JSON.stringify(r5.body)}`);

  const despues = await cupoDisponible(hornada.id);
  assert.equal(Number(despues.disponibles), 34, `C-27d · el cupo debía bajar 40 → 34 (4 del borde + 2 nuevos), llegó: ${JSON.stringify(despues)}`);
  const filasNueva = d1(`SELECT COUNT(*) AS n FROM reservas WHERE hornada_id = '${hornada.id}' AND contacto = 'borde5@t9b.cl'`);
  assert.equal(filasNueva[0].n, 1, `C-27d · la reserva aceptada debe existir en D1, llegó: ${JSON.stringify(filasNueva)}`);
});
