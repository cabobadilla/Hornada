async function cocinero() {
  const form = document.getElementById('form-cocinero');
  if (!form) return;

  const mensaje = document.getElementById('mensaje-cocinero');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    mensaje.textContent = '';

    const datos = {
      nombre: form.nombre.value.trim(),
      sector: form.sector.value.trim(),
      referencia_retiro: form.referencia_retiro.value.trim(),
      foto_url: form.foto_url ? form.foto_url.value.trim() : undefined,
    };
    if (!datos.foto_url) delete datos.foto_url;

    try {
      const res = await fetch('/api/cocineros', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(datos),
      });
      const body = await res.json();

      if (res.status === 201 && body.cocinero) {
        mensaje.textContent = `Listo. Registrada como ${body.cocinero.nombre} de ${body.cocinero.sector}. Tu token es ${body.cocinero.token}`;
        localStorage.setItem('hornada_token', body.cocinero.token);
        form.reset();
      } else if (body.error === 'falta_nombre') {
        mensaje.textContent = 'Te falta tu nombre.';
      } else if (body.error === 'falta_sector') {
        mensaje.textContent = 'Te falta tu sector.';
        form.sector.focus();
      } else if (body.error === 'falta_referencia_retiro') {
        mensaje.textContent = 'Te falta la referencia de retiro.';
        form.referencia_retiro.focus();
      } else {
        mensaje.textContent = 'No se pudo registrar — pruebe nuevamente.';
      }
    } catch {
      mensaje.textContent = 'No se pudo registrar — pruebe nuevamente.';
    }
  });
}

async function miHornada() {
  const form = document.getElementById('form-hornada');
  if (!form) return;

  const mensaje = document.getElementById('mensaje-hornada');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    mensaje.textContent = '';

    const token = localStorage.getItem('hornada_token');
    if (!token) {
      mensaje.textContent = 'Primero regístrate en “Quiero cocinar”; tu token queda guardado ahí.';
      return;
    }

    const isoFecha = (v) => (v ? new Date(v).toISOString() : '');
    const datos = {
      cocinero_token: token,
      pan: form.pan.value.trim(),
      desde: isoFecha(form.desde.value),
      hasta: isoFecha(form.hasta.value),
      unidades: form.unidades.value === '' ? undefined : Number(form.unidades.value),
      precio: form.precio.value === '' ? undefined : Number(form.precio.value),
      modalidades: [...form.querySelectorAll('input[name="modalidades"]:checked')].map((c) => c.value),
      referencia_retiro: form.referencia_retiro.value.trim(),
    };

    try {
      const res = await fetch('/api/hornadas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(datos),
      });
      const body = await res.json();

      if (res.status === 201 && body.hornada) {
        mensaje.textContent = `Hornada abierta: ${body.hornada.disponibles} unidades disponibles. Los vecinos ya la pueden reservar.`;
        form.reset();
      } else if (body.error === 'ya_tiene_hornada_abierta') {
        mensaje.textContent = 'Ya tienes una hornada abierta: no se promete más pan del que se hornea.';
      } else if (body.error === 'token_invalido') {
        mensaje.textContent = 'Tu token no es válido: regístrate de nuevo como cocinero.';
      } else if (body.error === 'unidades_invalidas') {
        mensaje.textContent = 'Las unidades deben ser un número entero mayor a 0.';
        form.unidades.focus();
      } else if (body.error === 'precio_invalido') {
        mensaje.textContent = 'El precio debe ser un entero mayor a 0 (pesos chilenos por unidad).';
        form.precio.focus();
      } else if (body.error === 'modalidades_invalidas') {
        mensaje.textContent = 'Marca al menos una modalidad de entrega: retiro o despacho.';
      } else if (body.error === 'falta_pan') {
        mensaje.textContent = 'Decí qué hornea: te falta el pan.';
        form.pan.focus();
      } else if (body.error === 'falta_referencia_retiro') {
        mensaje.textContent = 'Te falta la referencia de retiro.';
        form.referencia_retiro.focus();
      } else if (body.error === 'falta_desde' || body.error === 'falta_hasta') {
        mensaje.textContent = body.error === 'falta_desde'
          ? 'Te falta la fecha desde: cuándo sacas el pan del horno.'
          : 'Te falta la fecha hasta: hasta cuándo se puede retirar.';
        (body.error === 'falta_desde' ? form.desde : form.hasta).focus();
      } else {
        mensaje.textContent = 'No se pudo publicar la hornada — pruebe nuevamente.';
      }
    } catch {
      mensaje.textContent = 'No se pudo publicar la hornada — pruebe nuevamente.';
    }
  });
}

async function listado() {
  const form = document.getElementById('form-listado');
  if (!form) return;

  const lista = document.getElementById('lista-hornadas');
  const vacio = document.getElementById('estado-vacio');
  const mensaje = document.getElementById('mensaje-listado');
  const campoSector = document.getElementById('campo-sector-listado');

  const horario = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
  };

  const tarjeta = (h) => {
    const card = document.createElement('li');
    card.id = `card-hornada-${h.id}`;
    card.className = 'card-hornada';

    const chip = document.createElement('span');
    chip.className = 'chip-cupo';
    chip.textContent = `${h.disponibles} disponibles`;

    const pan = document.createElement('h3');
    pan.className = 'hornada-pan';
    pan.textContent = h.pan;

    const cocineroL = document.createElement('p');
    cocineroL.className = 'hornada-cocinero';
    const calificacion = h.cocinero?.promedio != null ? ` · ★ ${h.cocinero.promedio} (${h.cocinero.resenas})` : '';
    cocineroL.textContent = h.cocinero ? `Pan por ${h.cocinero.nombre}${calificacion}` : '';

    const meta = document.createElement('p');
    meta.className = 'hornada-meta';
    meta.textContent = `Sale del horno ${horario(h.desde)} · retiro hasta ${horario(h.hasta)} · ${(h.modalidades || []).join(' y ')}: ${h.referencia_retiro}`;

    const precio = document.createElement('p');
    precio.className = 'hornada-precio';
    precio.textContent = `$${h.precio} por unidad`;

    card.appendChild(chip);
    card.appendChild(pan);
    card.appendChild(cocineroL);
    card.appendChild(meta);
    card.appendChild(precio);
    return card;
  };

  const pinta = (hornadas) => {
    lista.textContent = '';
    if (Array.isArray(hornadas) && hornadas.length > 0) {
      vacio.hidden = true;
      lista.hidden = false;
      for (const h of hornadas) lista.appendChild(tarjeta(h));
    } else {
      vacio.hidden = false;
      lista.hidden = true;
    }
  };

  async function buscar(sector) {
    try {
      const res = await fetch(`/api/hornadas?sector=${encodeURIComponent(sector)}`);
      const body = await res.json();
      mensaje.textContent = '';
      pinta(body?.hornadas);
    } catch {
      mensaje.textContent = 'No se pudo ver el listado de tu sector — pruebe nuevamente.';
    }
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const sector = campoSector.value.trim();
    if (!sector) {
      mensaje.textContent = 'Te falta tu sector: probé con tu barrio.';
      campoSector.focus();
      return;
    }
    buscar(sector);
  });

  const inicial = new URLSearchParams(location.search).get('sector');
  if (inicial) {
    campoSector.value = inicial;
    if (inicial.trim()) {
      await buscar(inicial.trim());
    }
  }
}

async function main() {
  await Promise.all([cocinero(), miHornada(), listado()]);
}

main();
