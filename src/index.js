const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const notFound = () => json({ error: 'no_existe' }, 404);

const MODALIDADES = ['retiro', 'despacho'];

const parsearModalidades = (crudo) => {
  let lista = crudo;
  if (typeof crudo === 'string') {
    lista = crudo.split(',').map((v) => v.trim());
  }
  if (!Array.isArray(lista)) return null;
  const validas = [];
  for (const v of lista) {
    if (typeof v !== 'string') return null;
    const limpio = v.trim();
    if (!MODALIDADES.includes(limpio)) return null;
    if (!validas.includes(limpio)) validas.push(limpio);
  }
  if (validas.length === 0) return null;
  return validas;
};

const iso = (crudo) => {
  if (typeof crudo !== 'string' || !crudo.trim()) return null;
  const d = new Date(crudo.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'POST' && url.pathname === '/api/cocineros') {
      return registrarCocinero(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/hornadas') {
      return publicarHornada(request, env);
    }

    const detalle = url.pathname.match(/^\/api\/hornadas\/([^/]+)$/);
    if (request.method === 'GET' && detalle) {
      return detalleHornada(env, decodeURIComponent(detalle[1]));
    }

    const reserva = url.pathname.match(/^\/api\/hornadas\/([^/]+)\/reservas$/);
    if (request.method === 'POST' && reserva) {
      return reservar(request, env, decodeURIComponent(reserva[1]));
    }

    if (request.method === 'GET' && url.pathname === '/api/hornadas') {
      return listarHornadas(url, env);
    }

    return notFound();
  },
};

async function listarHornadas(url, env) {
  const sector = (url.searchParams.get('sector') ?? '').trim();
  if (!sector) return json({ error: 'falta_sector' }, 400);

  const ahoraISO = new Date().toISOString();
  const filas = await env.DB.prepare(
    `SELECT h.id, h.pan, h.desde, h.hasta, h.disponibles, h.precio,
            h.modalidades, h.referencia_retiro,
            c.id AS cocinero_id, c.nombre AS cocinero_nombre,
            (SELECT COUNT(*) FROM resenas r WHERE r.cocinero_id = c.id) AS resenas,
            (SELECT AVG(r.estrellas) FROM resenas r WHERE r.cocinero_id = c.id) AS promedio
     FROM hornadas h JOIN cocineros c ON c.id = h.cocinero_id
     WHERE c.sector = ?1 AND h.estado = 'abierta' AND h.disponibles > 0 AND h.hasta > ?2
     ORDER BY h.desde ASC
     LIMIT 50`,
  )
    .bind(sector, ahoraISO)
    .all();

  return json({
    hornadas: (filas.results ?? []).map((f) => ({
      id: f.id,
      pan: f.pan,
      desde: f.desde,
      hasta: f.hasta,
      disponibles: f.disponibles,
      precio: f.precio,
      modalidades: String(f.modalidades).split(',').filter(Boolean),
      referencia_retiro: f.referencia_retiro,
      cocinero: {
        id: f.cocinero_id,
        nombre: f.cocinero_nombre,
        promedio: f.promedio === null ? null : Number(f.promedio),
        resenas: f.resenas,
      },
    })),
  });
}

async function registrarCocinero(request, env) {
  let datos = null;
  try {
    datos = await request.json();
  } catch {
    return json({ error: 'json_invalido' }, 400);
  }

  if (!datos || typeof datos !== 'object') {
    return json({ error: 'json_invalido' }, 400);
  }

  const nombre = typeof datos.nombre === 'string' ? datos.nombre.trim() : '';
  const sector = typeof datos.sector === 'string' ? datos.sector.trim() : '';
  const referenciaRetiro = typeof datos.referencia_retiro === 'string' ? datos.referencia_retiro.trim() : '';

  if (!nombre) return json({ error: 'falta_nombre' }, 400);
  if (!sector) return json({ error: 'falta_sector' }, 400);
  if (!referenciaRetiro) return json({ error: 'falta_referencia_retiro' }, 400);

  const id = crypto.randomUUID();
  const token = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO cocineros (id, nombre, sector, referencia_retiro, foto_url, token, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      nombre,
      sector,
      referenciaRetiro,
      typeof datos.foto_url === 'string' ? datos.foto_url : null,
      token,
      new Date().toISOString(),
    )
    .run();

  return json({ cocinero: { id, nombre, sector, token } }, 201);
}

async function publicarHornada(request, env) {
  let datos = null;
  try {
    datos = await request.json();
  } catch {
    return json({ error: 'json_invalido' }, 400);
  }

  if (!datos || typeof datos !== 'object') {
    return json({ error: 'json_invalido' }, 400);
  }

  const token = typeof datos.cocinero_token === 'string' ? datos.cocinero_token.trim() : '';
  const cocinero = token
    ? (await env.DB.prepare('SELECT id FROM cocineros WHERE token = ?').bind(token).first())
    : null;
  if (!cocinero) return json({ error: 'token_invalido' }, 403);

  const abierta = await env.DB.prepare(
    `SELECT id FROM hornadas WHERE cocinero_id = ? AND estado = 'abierta' LIMIT 1`,
  )
    .bind(cocinero.id)
    .first();
  if (abierta) return json({ error: 'ya_tiene_hornada_abierta' }, 409);

  if (!Number.isInteger(datos.unidades) || datos.unidades <= 0) {
    return json({ error: 'unidades_invalidas' }, 400);
  }

  if (!Number.isInteger(datos.precio) || datos.precio <= 0) {
    return json({ error: 'precio_invalido' }, 400);
  }

  const modalidades = parsearModalidades(datos.modalidades);
  if (!modalidades) return json({ error: 'modalidades_invalidas' }, 400);

  const pan = typeof datos.pan === 'string' ? datos.pan.trim() : '';
  if (!pan) return json({ error: 'falta_pan' }, 400);

  const referenciaRetiro = typeof datos.referencia_retiro === 'string' ? datos.referencia_retiro.trim() : '';
  if (!referenciaRetiro) return json({ error: 'falta_referencia_retiro' }, 400);

  const desde = iso(datos.desde);
  if (!desde) return json({ error: 'falta_desde' }, 400);
  const hasta = iso(datos.hasta);
  if (!hasta) return json({ error: 'falta_hasta' }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO hornadas (id, cocinero_id, pan, desde, hasta, unidades, disponibles, precio, modalidades, referencia_retiro, estado, creada_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      cocinero.id,
      pan,
      desde,
      hasta,
      datos.unidades,
      datos.unidades,
      datos.precio,
      modalidades.join(','),
      referenciaRetiro,
      'abierta',
      new Date().toISOString(),
    )
    .run();

  return json(
    { hornada: { id, unidades: datos.unidades, disponibles: datos.unidades, estado: 'abierta' } },
    201,
  );
}

async function detalleHornada(env, id) {
  const fila = await env.DB.prepare(
    `SELECT h.id, h.pan, h.desde, h.hasta, h.unidades, h.disponibles, h.precio,
            h.modalidades, h.referencia_retiro, h.estado,
            c.id AS cocinero_id, c.nombre, c.sector,
            (SELECT COUNT(*) FROM resenas r WHERE r.cocinero_id = c.id) AS resenas,
            (SELECT AVG(r.estrellas) FROM resenas r WHERE r.cocinero_id = c.id) AS promedio
     FROM hornadas h JOIN cocineros c ON c.id = h.cocinero_id
     WHERE h.id = ?`,
  )
    .bind(id)
    .first();
  if (!fila) return notFound();

  return json({
    hornada: {
      id: fila.id,
      pan: fila.pan,
      desde: fila.desde,
      hasta: fila.hasta,
      unidades: fila.unidades,
      disponibles: fila.disponibles,
      precio: fila.precio,
      modalidades: String(fila.modalidades).split(',').filter(Boolean),
      referencia_retiro: fila.referencia_retiro,
      estado: fila.estado,
      cocinero: {
        id: fila.cocinero_id,
        nombre: fila.nombre,
        sector: fila.sector,
        promedio: fila.promedio === null ? null : Number(fila.promedio),
        resenas: fila.resenas,
      },
    },
  });
}

async function reservar(request, env, hornadaId) {
  let datos = null;
  try {
    datos = await request.json();
  } catch {
    return json({ error: 'json_invalido' }, 400);
  }
  if (!datos || typeof datos !== 'object') {
    return json({ error: 'json_invalido' }, 400);
  }

  const nombre = typeof datos.nombre === 'string' ? datos.nombre.trim() : '';
  if (!nombre) return json({ error: 'falta_nombre' }, 400);

  const contacto = typeof datos.contacto === 'string' ? datos.contacto.trim() : '';
  if (!contacto) return json({ error: 'falta_contacto' }, 400);

  if (!Number.isInteger(datos.unidades) || datos.unidades <= 0) {
    return json({ error: 'unidades_invalidas' }, 400);
  }

  // T-6 (HU-8): la modalidad la ofrece la hornada, no el cliente. Se valida
  // contra su columna `modalidades` ANTES de tocar el cupo (C-22).
  let modalidad =
    typeof datos.modalidad === 'string' && datos.modalidad.trim() ? datos.modalidad.trim() : 'retiro';

  const direccion =
    typeof datos.direccion === 'string' && datos.direccion.trim() ? datos.direccion.trim() : null;

  const hornada = await env.DB.prepare(
    'SELECT id, estado, hasta, precio, modalidades, referencia_retiro FROM hornadas WHERE id = ?1',
  )
    .bind(hornadaId)
    .first();
  if (!hornada) return notFound();

  const ahora = new Date().toISOString();
  if (hornada.estado !== 'abierta' || hornada.hasta <= ahora) {
    return json({ error: 'hornada_cerrada' }, 409);
  }

  const ofrecidas = String(hornada.modalidades).split(',').filter(Boolean);
  if (!ofrecidas.includes(modalidad)) {
    return json({ error: 'modalidad_no_ofrecida' }, 400);
  }

  // C-23: el despacho exige dirección; el retiro no la pide.
  if (modalidad === 'despacho' && !direccion) {
    return json({ error: 'falta_direccion' }, 400);
  }

  // donde = referencia_retiro del cocinero | la dirección del despacho (C-24, C-23).
  const donde = modalidad === 'despacho' ? direccion : hornada.referencia_retiro;

  // La regla del cupo, que es todo el producto (04-DISENO): una sola sentencia
  // atómica. La base decide, no el Worker: si meta.changes !== 1 → 409 sin_cupo.
  const cupo = await env.DB.prepare(
    `UPDATE hornadas SET disponibles = disponibles - ?2, estado = CASE WHEN disponibles - ?2 = 0
      THEN 'cerrada' ELSE estado END
     WHERE id = ?1 AND estado = 'abierta' AND disponibles >= ?2`,
  )
    .bind(hornadaId, datos.unidades)
    .run();
  if (cupo.meta.changes !== 1) return json({ error: 'sin_cupo' }, 409);

  const id = crypto.randomUUID();
  const codigo = crypto.randomUUID();
  const total = datos.unidades * hornada.precio;
  await env.DB.prepare(
    `INSERT INTO reservas (id, hornada_id, codigo, nombre, contacto, unidades, modalidad, direccion, total, estado, creada_en)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'reservada', ?10)`,
  )
    .bind(
      id,
      hornadaId,
      codigo,
      nombre,
      contacto,
      datos.unidades,
      modalidad,
      direccion,
      total,
      ahora,
    )
    .run();

  return json(
    {
      reserva: {
        codigo,
        unidades: datos.unidades,
        total,
        modalidad,
        donde,
      },
    },
    201,
  );
}
