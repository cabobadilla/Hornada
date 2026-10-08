const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const notFound = () => json({ error: 'no_existe' }, 404);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'POST' && url.pathname === '/api/cocineros') {
      return registrarCocinero(request, env);
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
