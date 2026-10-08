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

    return notFound();
  },
};

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
