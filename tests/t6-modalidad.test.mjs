import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, serverReady, apiJson, d1, withBrowser, BASE } from './helpers.mjs';
import { abrirTurno, cerrarTurno } from './lock.mjs';

// T-6 — retiro o despacho (HU-8): C-22, C-23, C-24.
// Serialización obligatoria: turno exclusivo del puerto 8787 (lock.mjs), igual
// que t5-reservas. Sin esto, este archivo pelea el puerto con las otras suites
// y la canónica se cae.

before(() => abrirTurno('t6-modalidad.test.mjs'));
after(() => {
  stopServer();
  cerrarTurno();
});

// ---- helpers propios de T-6 (los helpers sellados no se tocan) ----

const ms = (min) => min * 60 * 1000;

function iso(desplazamientoMin) {
  return new Date(Date.now() + ms(desplazamientoMin)).toISOString();
}

async function cocineroNuevo(tag, sector) {
  const nombre = `Horneador T6 ${tag} ${Date.now()}`;
  const sec = sector ?? `sector-t6-${tag}-${Date.now()}`;
  const referencia = `Portón T6 ${tag}, calle de la modalidad ${Date.now()}`;
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
    pan: 'Marraquetas T6',
    desde: iso(90),
    hasta: iso(300),
    unidades: 20,
    precio: 1200,
    modalidades: ['retiro', 'despacho'],
    referencia_retiro: 'Portón T6, Calle de la Modalidad 1',
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
  return { disponibles: h.disponibles, estado: h.estado };
}

function leerCupoD1(hornadaId) {
  const filas = d1(`SELECT disponibles, estado FROM hornadas WHERE id = '${hornadaId}'`);
  assert.equal(filas.length, 1, 'precondición · la hornada debe seguir existiendo en D1');
  return { disponibles: Number(filas[0].disponibles), estado: filas[0].estado };
}

// ============================================================
// C-22 · comportamiento: el cliente solo puede elegir entre las
// modalidades ofrecidas. Hornada que SOLO ofrece `retiro` + reserva
// con `modalidad: 'despacho'` → 400 `modalidad_no_ofrecida` y el
// cupo NO se toca (validación antes del descuento).
// ============================================================

test('C-22 · hornada solo retiro + reserva despacho da 400 modalidad_no_ofrecida y el cupo no se toca', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const c = await cocineroNuevo('c22');
  const h = await publicarHornada(c.token, {
    pan: 'Pan C-22, solo retiro',
    unidades: 8,
    precio: 500,
    modalidades: ['retiro'],
    referencia_retiro: 'Portón C-22, solo se retira',
  });

  const antesApi = await leerCupoApi(h.id);
  assert.equal(antesApi.disponibles, 8, 'precondición · el cupo inicial debe ser 8');
  const antesD1 = leerCupoD1(h.id);
  assert.equal(antesD1.disponibles, 8, 'precondición · el cupo inicial debe ser 8 (D1)');

  const { res, body } = await reservar(h.id, {
    nombre: 'Clia del C-22',
    contacto: 'c22@vecino.cl',
    unidades: 2,
    modalidad: 'despacho',
    direccion: 'Av. Imposible 999, C-22',
  });
  assert.equal(res.status, 400, `C-22 · esperaba 400, llegó ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(
    body?.error,
    'modalidad_no_ofrecida',
    `C-22 · error esperado modalidad_no_ofrecida, llegó ${JSON.stringify(body)}`,
  );

  // la hornada no se tocó: el rechazo fue ANTES del descuento de cupo
  const despuesApi = await leerCupoApi(h.id);
  assert.equal(
    despuesApi.disponibles,
    antesApi.disponibles,
    'C-22 · el cupo no debe cambiar tras el rechazo (API)',
  );
  assert.equal(despuesApi.estado, 'abierta', "C-22 · la hornada debe seguir 'abierta' (API)");
  const despuesD1 = leerCupoD1(h.id);
  assert.equal(
    despuesD1.disponibles,
    antesD1.disponibles,
    'C-22 · el cupo no debe cambiar tras el rechazo (D1)',
  );

  // y no debe haber quedado ninguna reserva de la hornada en D1
  const filas = d1(`SELECT id FROM reservas WHERE hornada_id = '${h.id}'`);
  assert.equal(filas.length, 0, `C-22 · no debe existir reserva para la hornada rechazada, hay ${filas.length}`);
});

// ============================================================
// C-23 · comportamiento: despacho exige dirección. Sin `direccion`
// → 400 `falta_direccion` (cupo intacto); con dirección → 201 y la
// dirección exacta quedó guardada: se relee de D1 (el observable es
// un dato guardado; `GET /api/reservas/:codigo` es superficie de T-8
// y un test no puede depender de una superficie de otra tarea).
// (Que el cocinero la VEA es de T-7.)
// ============================================================

test('C-23 · despacho sin direccion da 400 falta_direccion; con direccion 201 y guardada exacta en D1', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const c = await cocineroNuevo('c23');
  const h = await publicarHornada(c.token, {
    pan: 'Pan C-23, despacho con dirección',
    unidades: 6,
    precio: 1000,
    modalidades: ['retiro', 'despacho'],
  });

  const antesApi = await leerCupoApi(h.id);
  assert.equal(antesApi.disponibles, 6, 'precondición · el cupo inicial debe ser 6');

  // sin direccion → 400 falta_direccion
  const rSin = await reservar(h.id, {
    nombre: 'Clia sin puerta C-23',
    contacto: 'c23sin@vecino.cl',
    unidades: 1,
    modalidad: 'despacho',
  });
  assert.equal(
    rSin.res.status,
    400,
    `C-23 · despacho sin dirección esperaba 400, llegó ${rSin.res.status}: ${JSON.stringify(rSin.body)}`,
  );
  assert.equal(
    rSin.body?.error,
    'falta_direccion',
    `C-23 · error esperado falta_direccion, llegó ${JSON.stringify(rSin.body)}`,
  );
  const trasSin = leerCupoD1(h.id);
  assert.equal(trasSin.disponibles, 6, 'C-23 · el cupo no debe cambiar tras el rechazo sin dirección');

  // direccion vacía (solo espacios) también cuenta como falta_direccion
  const rVacia = await reservar(h.id, {
    nombre: 'Clia sin puerta C-23',
    contacto: 'c23sin@vecino.cl',
    unidades: 1,
    modalidad: 'despacho',
    direccion: '   ',
  });
  assert.equal(rVacia.res.status, 400, `C-23 · dirección en blanco esperaba 400, llegó ${rVacia.res.status}`);
  assert.equal(
    rVacia.body?.error,
    'falta_direccion',
    `C-23 · dirección en blanco esperaba falta_direccion, llegó ${JSON.stringify(rVacia.body)}`,
  );
  assert.equal(leerCupoD1(h.id).disponibles, 6, 'C-23 · el cupo sigue intacto tras el segundo rechazo');

  // con direccion → 201, y la dirección quedó GUARDADA: se relee por código
  const direccionExacta = 'Calle del Despacho C-23 #42, depto 3-B, Chicureo';
  const { res, body } = await reservar(h.id, {
    nombre: 'Clia con puerta C-23',
    contacto: 'c23@vecino.cl',
    unidades: 2,
    modalidad: 'despacho',
    direccion: direccionExacta,
  });
  assert.equal(res.status, 201, `C-23 · con dirección esperaba 201, llegó ${res.status}: ${JSON.stringify(body)}`);
  const reserva = body?.reserva ?? body;
  assert.ok(reserva?.codigo, 'C-23 · la respuesta 201 debe traer el codigo para releer la reserva');
  assert.equal(reserva.modalidad, 'despacho', 'C-23 · la respuesta debe declarar la modalidad despacho');
  assert.equal(
    reserva.donde,
    direccionExacta,
    `C-23 · con despacho, donde debe ser la dirección pedida, llegó ${JSON.stringify(reserva.donde)}`,
  );

  // el dato guardado se lee de D1: JOIN con hornadas porque `donde` es
  // derivado (modalidad despacho → direccion; retiro → referencia_retiro).
  // No se usa GET /api/reservas/:codigo: ese endpoint es de T-8.
  const fila = d1(
    `SELECT r.modalidad, r.direccion, COALESCE(r.direccion, h.referencia_retiro) AS donde
     FROM reservas r JOIN hornadas h ON h.id = r.hornada_id
     WHERE r.codigo = '${reserva.codigo}'`,
  );
  assert.equal(fila.length, 1, 'C-23 · la reserva debe existir en D1 por su código');
  assert.equal(fila[0].modalidad, 'despacho', "C-23 · la reserva releída debe traer modalidad despacho");
  assert.equal(
    fila[0].direccion,
    direccionExacta,
    `C-23 · la direccion guardada debe ser EXACTA: esperaba ${JSON.stringify(direccionExacta)}, salió ${JSON.stringify(fila[0].direccion)}`,
  );
  assert.equal(
    fila[0].donde,
    direccionExacta,
    `C-23 · con despacho, donde debe ser la dirección guardada, salió ${JSON.stringify(fila[0].donde)}`,
  );

  // el cupo bajó exactamente 2 (solo la reserva exitosa, no los rechazos)
  assert.equal(leerCupoD1(h.id).disponibles, 4, 'C-23 · el cupo debe bajar exactamente 2 (solo la reserva 201)');
});

// ============================================================
// C-24 · comportamiento: reserva `retiro` → 201 con
// `donde === referencia_retiro` de la hornada y SIN exigir
// `direccion` (no la manda y no se rechaza).
// ============================================================

test('C-24 · retiro sin direccion da 201 con donde === referencia_retiro de la hornada', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const c = await cocineroNuevo('c24');
  const referenciaRetiro = 'Portón C-24, Calle del Retiro 12';
  const h = await publicarHornada(c.token, {
    pan: 'Pan C-24, retiro en el portón',
    unidades: 5,
    precio: 800,
    modalidades: ['retiro', 'despacho'],
    referencia_retiro: referenciaRetiro,
  });

  const { res, body } = await reservar(h.id, {
    nombre: 'Clia del C-24',
    contacto: 'c24@vecino.cl',
    unidades: 1,
    modalidad: 'retiro',
    // sin campo `direccion` a propósito: el retiro NO la exige
  });
  assert.equal(res.status, 201, `C-24 · retiro sin dirección esperaba 201, llegó ${res.status}: ${JSON.stringify(body)}`);
  const reserva = body?.reserva ?? body;
  assert.equal(reserva.modalidad, 'retiro', 'C-24 · la respuesta debe declarar la modalidad retiro');
  assert.equal(
    reserva.donde,
    referenciaRetiro,
    `C-24 · donde debe ser la referencia_retiro (${referenciaRetiro}), llegó ${JSON.stringify(reserva.donde)}`,
  );

  // la relectura del dato guardado se hace en D1 (no por
  // GET /api/reservas/:codigo: ese endpoint es de T-8): retiro guarda
  // la referencia de retiro derivada y sin direccion.
  const fila = d1(
    `SELECT r.modalidad, r.direccion, COALESCE(r.direccion, h.referencia_retiro) AS donde
     FROM reservas r JOIN hornadas h ON h.id = r.hornada_id
     WHERE r.codigo = '${reserva.codigo}'`,
  );
  assert.equal(fila.length, 1, 'C-24 · la reserva debe existir en D1');
  assert.equal(fila[0].modalidad, 'retiro', "C-24 · la reserva releída debe traer modalidad retiro");
  assert.equal(
    fila[0].donde,
    referenciaRetiro,
    `C-24 · donde releído debe ser la referencia_retiro, salió ${JSON.stringify(fila[0].donde)}`,
  );
  assert.equal(fila[0].direccion, null, 'C-24 · una reserva de retiro no debe guardar direccion');
});

// ---- caso extra del Coder (valor agregado, piso de la matriz) ----

test('EX-22a · hornada que solo ofrece despacho + reserva retiro da 400 modalidad_no_ofrecida y el cupo queda intacto', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const c = await cocineroNuevo('ex22a');
  const h = await publicarHornada(c.token, {
    pan: 'Pan EX-22a, solo despacho',
    unidades: 4,
    precio: 300,
    modalidades: ['despacho'],
    referencia_retiro: 'Portón EX-22a (no se ofrece retiro)',
  });
  const antes = leerCupoD1(h.id);
  assert.equal(antes.disponibles, 4, 'precondición · el cupo inicial debe ser 4');

  const { res, body } = await reservar(h.id, {
    nombre: 'Clia EX-22a',
    contacto: 'ex22a@vecino.cl',
    unidades: 1,
    modalidad: 'retiro',
  });
  assert.equal(res.status, 400, `EX-22a · esperaba 400, llegó ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(
    body?.error,
    'modalidad_no_ofrecida',
    `EX-22a · error esperado modalidad_no_ofrecida, llegó ${JSON.stringify(body)}`,
  );
  const despues = leerCupoD1(h.id);
  assert.equal(despues.disponibles, antes.disponibles, 'EX-22a · el cupo no debe cambiar tras el rechazo');
});

test('EX-23a · la pantalla solo ofrece las modalidades de la hornada y el campo dirección aparece solo con despacho', async () => {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo');
  const c = await cocineroNuevo('ex23a');
  const h = await publicarHornada(c.token, {
    pan: 'Pan EX-23a, selector de modalidad',
    unidades: 6,
    precio: 500,
    modalidades: ['retiro', 'despacho'],
  });

  await withBrowser(`${BASE}/`, async ({ evaluate }) => {
    // elegir la hornada carga el selector con SOLO las modalidades ofrecidas
    const dom = await evaluate(`
      (() => {
        const form = document.querySelector('#form-reserva');
        if (!form) return { form: false };
        form.hornada_id.value = '${h.id}';
        form.dispatchEvent(new Event('change', { bubbles: true }));
        return { form: true, selector: !!form.querySelector('select[name="modalidad"]') };
      })()
    `);
    assert.ok(dom.form, 'EX-23a · debe existir #form-reserva en el DOM servido');
    assert.ok(
      dom.selector,
      'EX-23a · #form-reserva debe tener un selector <select name="modalidad">',
    );

    // poll: el fetch del detalle de la hornada puebla el selector (tope 8 s)
    const tope = Date.now() + 8000;
    let opciones = null;
    while (Date.now() < tope) {
      opciones = await evaluate(`
        (() => {
          const select = document.querySelector('#form-reserva select[name="modalidad"]');
          if (!select) return null;
          const direccion = document.querySelector('#form-reserva [name="direccion"]');
          return {
            valores: [...select.options].filter((o) => o.value).map((o) => o.value),
            direccionVisible: !!direccion && direccion.style.display !== 'none',
          };
        })()
      `);
      if (opciones && opciones.valores.length > 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(opciones, 'EX-23a · el selector de modalidad debe existir');
    assert.deepEqual(
      opciones.valores,
      ['retiro', 'despacho'],
      `EX-23a · con modalidades ['retiro','despacho'] el selector debe ofrecer exactamente esas dos, vió ${JSON.stringify(opciones.valores)}`,
    );
    assert.equal(
      opciones.direccionVisible,
      false,
      'EX-23a · con retiro marcado por defecto el campo dirección debe estar oculto',
    );

    // elegir despacho hace aparecer el campo dirección
    const conDespacho = await evaluate(`
      (() => {
        const form = document.querySelector('#form-reserva');
        const select = form.querySelector('select[name="modalidad"]');
        select.value = 'despacho';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const direccion = form.querySelector('[name="direccion"]');
        return { direccionVisible: !!direccion && direccion.style.display !== 'none' };
      })()
    `);
    assert.equal(
      conDespacho.direccionVisible,
      true,
      'EX-23a · al elegir despacho el campo dirección debe aparecer',
    );
  });
});
