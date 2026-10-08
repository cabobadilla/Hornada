import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, serverReady, api, apiJson, d1, withBrowser, BASE } from './helpers.mjs';
import { abrirTurno, cerrarTurno } from './lock.mjs';

// T-9 — la calidad: reseñas y suspensión (HU-9): C-25, C-26, C-27, C-28.
// POST /api/reservas/:codigo/resena (una sola vez por reserva, solo entregada),
// promedio y cantidad DERIVADOS en la lectura del listado (sin columnas en D1),
// la regla de suspensión (≥ 5 reseñas y promedio < 3,0 → desaparece del listado
// y no puede publicar hornadas nuevas) y el panel que conserva el pan prometido
// (C-28). Serialización obligatoria: turno exclusivo del puerto 8787 (lock.mjs).

before(() => abrirTurno('t9-resenas.test.mjs'));
after(() => {
  stopServer();
  cerrarTurno();
});

// ---- helpers propios de T-9 (los helpers sellados no se tocan) ----

const ms = (min) => min * 60 * 1000;

function iso(desplazamientoMin) {
  return new Date(Date.now() + ms(desplazamientoMin)).toISOString();
}

async function cocineroNuevo(tag) {
  const nombre = `Horneador T9 ${tag} ${Date.now()}`;
  const sec = `sector-t9-${tag}-${Date.now()}`;
  const referencia = `Portón T9 ${tag}, calle del panel ${Date.now()}`;
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
    pan: 'Marraquetas T9',
    desde: iso(90),
    hasta: iso(300),
    unidades: 40,
    precio: 1000,
    modalidades: ['retiro', 'despacho'],
    referencia_retiro: 'Portón T9, Calle del Panel 1',
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

async function listado(sector) {
  const { res, body } = await apiJson(`/api/hornadas?sector=${encodeURIComponent(sector)}`);
  assert.equal(res.status, 200, `precondición (listado) · esperaba 200, llegó ${res.status}`);
  return body?.hornadas ?? [];
}

// ---- tests ----

test('C-25 · solo reserva entregada, una sola vez: 409 no_entregada → 201 → 409 ya_calificada; estrellas fuera de 1..5 → 400 sin fila nueva', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const coc = await cocineroNuevo('A25');
  const hornada = await publicarHornada(coc.token, { pan: 'Pan de masa madre T9 A' });

  // Reserva aún no entregada: no se puede calificar el pan que no se recibió.
  const r1 = await reservar(hornada.id, {
    nombre: 'Cliente sin pan T9',
    contacto: 'sinpan@barrio.cl',
    unidades: 1,
    modalidad: 'retiro',
  });
  const { res: rNo, body: bNo } = await calificar(r1.codigo, { estrellas: 5, comentario: 'no llegó nada' });
  assert.equal(rNo.status, 409, `C-25 · calificar una reserva reservada debía dar 409, llegó ${rNo.status}: ${JSON.stringify(bNo)}`);
  assert.equal(bNo?.error, 'reserva_no_entregada', `C-25 · esperaba reserva_no_entregada, llegó ${JSON.stringify(bNo)}`);

  // Estrellas inválidas ANTES y DESPUÉS de entregar: 400 y sin fila nueva.
  for (const malo of [0, 6, 3.5, 'cinco']) {
    const { res: rMal, body: bMal } = await calificar(r1.codigo, { estrellas: malo });
    assert.equal(rMal.status, 400, `C-25 · estrellas ${JSON.stringify(malo)} debía dar 400, llegó ${rMal.status}: ${JSON.stringify(bMal)}`);
    assert.equal(bMal?.error, 'estrellas_invalidas', `C-25 · estrellas ${JSON.stringify(malo)} esperaba estrellas_invalidas, llegó ${JSON.stringify(bMal)}`);
  }
  assert.equal(d1(`SELECT COUNT(*) AS n FROM resenas WHERE reserva_id = (SELECT id FROM reservas WHERE codigo = '${r1.codigo}')`)[0].n, 0,
    'C-25 · ninguna calificación inválida ni de reserva no entregada debe dejar fila en resenas');

  // Se entrega y recién ahí se califica, UNA sola vez.
  await entregar(coc.token, r1.codigo);
  const { res: rOk, body: bOk } = await calificar(r1.codigo, { estrellas: 5, comentario: 'pan tibio y puntual' });
  assert.equal(rOk.status, 201, `C-25 · calificar una reserva entregada debía dar 201, llegó ${rOk.status}: ${JSON.stringify(bOk)}`);
  assert.equal((bOk?.resena ?? bOk)?.estrellas, 5, `C-25 · la respuesta debe traer la resena con sus estrellas, llegó ${JSON.stringify(bOk)}`);

  const { res: rRep, body: bRep } = await calificar(r1.codigo, { estrellas: 2, comentario: 'otra vez' });
  assert.equal(rRep.status, 409, `C-25 · repetir la calificación debía dar 409, llegó ${rRep.status}: ${JSON.stringify(bRep)}`);
  assert.equal(bRep?.error, 'ya_calificada', `C-25 · esperaba ya_calificada, llegó ${JSON.stringify(bRep)}`);
  const filas = d1(`SELECT estrellas, comentario, cocinero_id FROM resenas WHERE reserva_id = (SELECT id FROM reservas WHERE codigo = '${r1.codigo}')`);
  assert.equal(filas.length, 1, 'C-25 · una sola fila en resenas para esta reserva');
  assert.equal(filas[0].estrellas, 5, 'C-25 · la fila guardada es la PRIMERA (5 estrellas), no la repetida');
  assert.equal(filas[0].comentario, 'pan tibio y puntual', 'C-25 · la fila guarda el comentario de C-25');
  assert.equal(d1(`SELECT COUNT(*) AS n FROM resenas WHERE cocinero_id = (SELECT id FROM hornadas WHERE id = '${hornada.id}')`).find((f) => f.n)?.n, 1,
    'C-25 · la resena quedó asociada al cocinero de la hornada');
});

test('C-25b · un codigo de reserva inexistente da 404 no_existe', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const { res, body } = await calificar(`codigo-inexistente-t9-${Date.now()}`, { estrellas: 4 });
  assert.equal(res.status, 404, `C-25 · codigo inexistente debía dar 404, llegó ${res.status}`);
  assert.equal(body?.error, 'no_existe', `C-25 · esperaba no_existe, llegó ${JSON.stringify(body)}`);
});

test('C-26 · el promedio y la cantidad se derivan en la lectura: 2 reseñas (5 y 4) → promedio 4.5 y resenas 2, sin columnas de promedio en D1', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const coc = await cocineroNuevo('B26');
  const hornada = await publicarHornada(coc.token, { pan: 'Hallullas T9 B' });

  const r1 = await reservar(hornada.id, { nombre: 'Cliente 1 T9', contacto: 'c1@barrio.cl', unidades: 1, modalidad: 'retiro' });
  const r2 = await reservar(hornada.id, { nombre: 'Cliente 2 T9', contacto: 'c2@barrio.cl', unidades: 1, modalidad: 'retiro' });
  await entregar(coc.token, r1.codigo);
  await entregar(coc.token, r2.codigo);
  assert.equal((await calificar(r1.codigo, { estrellas: 5 })).res.status, 201, 'precondición · resena 1 debía ser 201');
  assert.equal((await calificar(r2.codigo, { estrellas: 4 })).res.status, 201, 'precondición · resena 2 debía ser 201');

  const tarjetas = await listado(coc.sector);
  const mia = tarjetas.find((h) => h.id === hornada.id);
  assert.ok(mia, `C-26 · la hornada con reseñas debía seguir listada, llegó: ${JSON.stringify(tarjetas.map((h) => h.id))}`);
  assert.ok(mia.cocinero?.promedio !== undefined && mia.cocinero?.promedio !== null,
    `C-26 · la tarjeta debe traer cocinero.promedio derivado, llegó: ${JSON.stringify(mia.cocinero)}`);
  assert.ok(Math.abs(Number(mia.cocinero.promedio) - 4.5) < 1e-9,
    `C-26 · promedio de 5 y 4 debía ser 4.5, llegó: ${JSON.stringify(mia.cocinero.promedio)}`);
  assert.equal(Number(mia.cocinero.resenas), 2, `C-26 · la cantidad derivada debía ser 2, llegó: ${JSON.stringify(mia.cocinero.resenas)}`);

  // El promedio se deriva en la lectura: NINGUNA tabla de D1 lleva columna de
  // promedio ni de suspensión (si tuviera una, se desincronizaría del promedio real).
  const columnasProhibidas = d1(`SELECT s.name AS tabla, p.name AS col FROM sqlite_master s, pragma_table_info(s.name) p WHERE s.type = 'table' AND s.name NOT LIKE 'sqlite_%' AND (p.name LIKE '%promedio%' OR p.name LIKE '%suspend%' OR p.name LIKE '%media%' OR p.name LIKE '%avg%')`);
  assert.deepEqual(columnasProhibidas, [],
    `C-26 · el promedio debe derivarse en la lectura, no estar en D1 como columna: ${JSON.stringify(columnasProhibidas)}`);
});

test('C-27a · 5 reseñas de 1 estrella → fuera del listado del sector y 403 cocinero_suspendido al publicar', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const coc = await cocineroNuevo('C27');
  const sector = coc.sector;
  const hornada = await publicarHornada(coc.token, { pan: 'Pan quemado T9 C' });

  // 5 clientes distintos, 5 reservas entregadas, 5 reseñas de 1 estrella.
  for (let i = 1; i <= 5; i++) {
    const r = await reservar(hornada.id, {
      nombre: `Cliente malo ${i} T9`,
      contacto: `malo${i}@barrio.cl`,
      unidades: 1,
      modalidad: 'retiro',
    });
    await entregar(coc.token, r.codigo);
    const { res, body } = await calificar(r.codigo, { estrellas: 1, comentario: `moho, la ${i}` });
    assert.equal(res.status, 201, `precondición (resena ${i}) · esperaba 201, llegó ${res.status}: ${JSON.stringify(body)}`);
  }

  // El listado del sector ya NO trae sus hornadas.
  const tarjetas = await listado(sector);
  assert.equal(tarjetas.find((h) => h.id === hornada.id), undefined,
    `C-27 · con 5 reseñas de 1 estrella la hornada debía desaparecer del listado, seguía: ${JSON.stringify(tarjetas.map((h) => h.id))}`);

  // Y no puede publicar hornadas nuevas: cocinero suspendido.
  const { res, body } = await apiJson('/api/hornadas', {
    method: 'POST',
    body: JSON.stringify({
      cocinero_token: coc.token,
      pan: 'Intento tras suspension T9',
      desde: iso(90),
      hasta: iso(300),
      unidades: 10,
      precio: 900,
      modalidades: ['retiro'],
      referencia_retiro: 'Portón T9',
    }),
  });
  assert.equal(res.status, 403, `C-27 · publicar suspendido debía dar 403, llegó ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(body?.error, 'cocinero_suspendido', `C-27 · esperaba cocinero_suspendido, llegó ${JSON.stringify(body)}`);

  // Sin reseñas nuevas que empujen el caso: la suspención es de lectura y estable.
  const tarjetas2 = await listado(sector);
  assert.equal(tarjetas2.find((h) => h.id === hornada.id), undefined, 'C-27 · la hornada sigue fuera del listado en la relectura');
});

test('C-27b · el borde del umbral: con 4 reseñas de 1 estrella el cocinero SIGUE visible (el umbral es 5, no 4)', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const coc = await cocineroNuevo('D27');
  const hornada = await publicarHornada(coc.token, { pan: 'Pan borde T9 D' });

  for (let i = 1; i <= 4; i++) {
    const r = await reservar(hornada.id, {
      nombre: `Cliente borde ${i} T9`,
      contacto: `borde${i}@barrio.cl`,
      unidades: 1,
      modalidad: 'retiro',
    });
    await entregar(coc.token, r.codigo);
    assert.equal((await calificar(r.codigo, { estrellas: 1 })).res.status, 201, `precondición (resena borde ${i})`);
  }

  // 4 < 5: el umbral NO se alcanza, la hornada sigue exactamente donde estaba.
  const tarjetas = await listado(coc.sector);
  const mia = tarjetas.find((h) => h.id === hornada.id);
  assert.ok(mia, `C-27 · con 4 reseñas de 1 estrella la hornada debe seguir listada (umbral ≥5), llegó: ${JSON.stringify(tarjetas.map((h) => h.id))}`);
  assert.ok(Math.abs(Number(mia.cocinero?.promedio) - 1) < 1e-9,
    `C-27 · y su promedio visible debía ser 1, llegó: ${JSON.stringify(mia.cocinero)}`);

  const { res, body } = await apiJson('/api/hornadas', {
    method: 'POST',
    body: JSON.stringify({
      cocinero_token: coc.token,
      pan: 'Segunda publicacion borde T9',
      desde: iso(90),
      hasta: iso(300),
      unidades: 5,
      precio: 900,
      modalidades: ['retiro'],
      referencia_retiro: 'Portón T9 borde',
    }),
  });
  assert.equal(res.status, 409, `C-27 · con 4 reseñas el cocinero NO está suspendido: publicar otra hornada solo puede chocar con ya_tiene_hornada_abierta, llegó ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(body?.error, 'ya_tiene_hornada_abierta', `C-27 · el bloqueo llegó por otra razón, no por suspensión: ${JSON.stringify(body)}`);
});

test('C-28 · suspendido: el panel sigue mostrando sus reservas vigentes y trae motivo_suspension', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const coc = await cocineroNuevo('E28');
  const hornada = await publicarHornada(coc.token, { pan: 'Pan prometido T9 E' });

  // Una reserva de despacho (con dirección) y una de retiro: pan YA prometido.
  const rDespacho = await reservar(hornada.id, {
    nombre: 'Cliente promesa T9',
    contacto: 'promesa@barrio.cl',
    unidades: 2,
    modalidad: 'despacho',
    direccion: 'Av. Del Pan Prometido 777, sector-t9-E28',
  });
  const rRetiro = await reservar(hornada.id, {
    nombre: 'Cliente retira T9',
    contacto: 'retira@barrio.cl',
    unidades: 1,
    modalidad: 'retiro',
  });

  // Suspendemos a propósito: 5 reseñas de 1 estrella.
  for (let i = 1; i <= 5; i++) {
    const r = await reservar(hornada.id, {
      nombre: `Cliente suspende ${i} T9`,
      contacto: `suspende${i}@barrio.cl`,
      unidades: 1,
      modalidad: 'retiro',
    });
    await entregar(coc.token, r.codigo);
    await calificar(r.codigo, { estrellas: 1 });
  }

  const panel = await apiJson(`/api/cocineros/mi-panel?token=${encodeURIComponent(coc.token)}`);
  assert.equal(panel.res.status, 200, `C-28 · el panel de un suspendido da 200 (no pierde su cuenta), llegó ${panel.res.status}: ${JSON.stringify(panel.body)}`);

  const cocinero = panel.body?.cocinero ?? {};
  assert.equal(cocinero.suspendido, true, `C-28 · el panel debe declarar suspendido: true, llegó: ${JSON.stringify(cocinero)}`);
  assert.ok(typeof cocinero.motivo_suspension === 'string' && cocinero.motivo_suspension.trim(),
    `C-28 · el panel debe traer motivo_suspension legible, llegó: ${JSON.stringify(cocinero)}`);

  // Las reservas vigentes siguen en el panel, con toda su data, dirección incluida.
  const salidas = (panel.body?.hornadas ?? []).flatMap((h) => (h?.reservas ?? []).map((r) => ({ r, hornada: h })));
  const promesa = salidas.find((s) => s.r?.nombre === 'Cliente promesa T9');
  const retira = salidas.find((s) => s.r?.nombre === 'Cliente retira T9');
  assert.ok(promesa, `C-28 · la reserva de despacho ya prometida debe seguir en el panel del suspendido: ${JSON.stringify(panel.body)}`);
  assert.ok(retira, `C-28 · la reserva de retiro ya prometida debe seguir en el panel del suspendido: ${JSON.stringify(panel.body)}`);
  assert.equal(promesa.r?.estado, 'reservada', `C-28 · la reserva sigue vigente (reservada), llegó: ${JSON.stringify(promesa)}`);
  assert.equal(promesa.r?.direccion, 'Av. Del Pan Prometido 777, sector-t9-E28',
    `C-28 · la dirección del despacho prometido se conserva en el panel, llegó: ${JSON.stringify(promesa.r)}`);
  assert.equal(promesa.hornada?.pan, 'Pan prometido T9 E', 'C-28 · la reserva sigue colgada de su hornada');
  assert.equal(salidas.length, 7, `C-28 · las 7 reservas (2 promesas + 5 suspende) siguen en el panel, llegó: ${salidas.length}`);

  // y por eficiencia del ciclo: el panel no fue mordido por la suspensión, solo la lectura pública
  assert.equal(d1(`SELECT COUNT(*) AS n FROM reservas WHERE codigo = '${rDespacho.codigo}' AND estado = 'reservada'`)[0].n, 1,
    'C-28 · en D1 la reserva prometida sigue reservada: suspender no borra el pan');
  assert.equal(d1(`SELECT COUNT(*) AS n FROM reservas WHERE codigo = '${rRetiro.codigo}' AND estado = 'reservada'`)[0].n, 1,
    'C-28 · en D1 la reserva de retiro sigue reservada también');
});

test('EX-T9 · el formulario de calificación aparece en #mi-reserva SOLO cuando puede_calificar', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');

  const coc = await cocineroNuevo('F29');
  const hornada = await publicarHornada(coc.token, { pan: 'Pan calificable T9' });
  const rNo = await reservar(hornada.id, { nombre: 'Cliente sin pan T9 F', contacto: 'f1@barrio.cl', unidades: 1, modalidad: 'retiro' });
  const rSi = await reservar(hornada.id, { nombre: 'Cliente con pan T9 F', contacto: 'f2@barrio.cl', unidades: 1, modalidad: 'retiro' });
  await entregar(coc.token, rSi.codigo);

  const leer = `
    (() => {
      const seccion = document.querySelector('#mi-reserva');
      const form = document.querySelector('#form-resena');
      if (!seccion) return { seccion: null };
      const visibles = seccion.offsetParent !== null || seccion.style.display !== 'none';
      return {
        seccion: visibles ? 'visible' : 'oculta',
        texto: visibles ? (Array.from(seccion.querySelectorAll('*')).map((n) => n.textContent || '').join(' ')) : '',
        form: form ? { presente: true, oculto: form.hidden || form.style.display === 'none' } : { presente: false },
      };
    })()`;

  await withBrowser(`${BASE}/?codigo=${encodeURIComponent(rNo.codigo)}`, async ({ evaluate }) => {
    let estado = { seccion: 'ausente' };
    for (let intento = 0; intento < 24; intento++) {
      estado = await evaluate(leer);
      if (estado?.seccion === 'visible') break;
      await new Promise((res_) => setTimeout(res_, 250));
    }
    assert.equal(estado.seccion, 'visible', 'EX-T9 · la pantalla #mi-reserva debe estar abierta con el codigo');
    assert.ok(estado.form.presente === false || estado.form.oculto === true,
      `EX-T9 · con una reserva SIN pan entregado el formulario de calificación NO debe estar disponible: ${JSON.stringify(estado.form)}`);
  });

  await withBrowser(`${BASE}/?codigo=${encodeURIComponent(rSi.codigo)}`, async ({ evaluate }) => {
    let estado = { seccion: 'ausente' };
    for (let intento = 0; intento < 24; intento++) {
      estado = await evaluate(leer);
      if (estado?.seccion === 'visible') break;
      await new Promise((res_) => setTimeout(res_, 250));
    }
    assert.equal(estado.seccion, 'visible', 'EX-T9 · la pantalla #mi-reserva debe estar abierta con el codigo');
    assert.ok(estado.form.presente === true && !estado.form.oculto,
      `EX-T9 · con la reserva ENTREGADA el formulario de calificación debe estar disponible: ${JSON.stringify(estado.form)}`);
    assert.ok(/calific/i.test(estado.texto), `EX-T9 · el formulario ha de hablarnos de calificar: ${estado.texto}`);
  });
});
