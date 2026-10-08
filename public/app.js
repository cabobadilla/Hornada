let actualizarPrecioReserva = null;

async function cocinero() {  const form = document.getElementById('form-cocinero');
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

    const reservarBtn = document.createElement('button');
    reservarBtn.type = 'button';
    reservarBtn.textContent = 'Reservar esta hornada';
    reservarBtn.addEventListener('click', () => {
      const form = document.getElementById('form-reserva');
      if (!form) return;
      form.hornada_id.value = h.id;
      if (actualizarPrecioReserva) actualizarPrecioReserva();
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      form.unidades.focus();
    });

    card.appendChild(chip);
    card.appendChild(pan);
    card.appendChild(cocineroL);
    card.appendChild(meta);
    card.appendChild(precio);
    card.appendChild(reservarBtn);
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

async function reservar() {
  const form = document.getElementById('form-reserva');
  if (!form) return;

  const mensaje = document.getElementById('mensaje-reserva');
  const mensajeTotal = document.getElementById('mensaje-total-reserva');
  const confirmada = document.getElementById('reserva-confirmada');
  const campoHornada = form.hornada_id;
  const selectorModalidad = form.modalidad;
  const campoDireccion = form.direccion;
  const etiquetaDireccion = document.getElementById('etiqueta-reserva-direccion');
  let modalidadesOfrecidas = [];
  let precio = null;

  const pintaDireccion = () => {
    const visible = selectorModalidad.value === 'despacho' && modalidadesOfrecidas.includes('despacho');
    campoDireccion.style.display = visible ? '' : 'none';
    etiquetaDireccion.style.display = visible ? '' : 'none';
  };

  const pintaModalidades = (ofrecidas) => {
    selectorModalidad.textContent = '';
    modalidadesOfrecidas = Array.isArray(ofrecidas) ? ofrecidas.filter(Boolean) : [];
    for (const m of modalidadesOfrecidas) {
      const opcion = document.createElement('option');
      opcion.value = m;
      opcion.textContent = m === 'retiro' ? 'Retiro en la referencia' : 'Despacho en el barrio';
      selectorModalidad.appendChild(opcion);
    }
    selectorModalidad.value = modalidadesOfrecidas[0] ?? '';
    pintaDireccion();
  };

  const pintaTotal = () => {
    const unidades = Number(form.unidades.value);
    if (precio != null && Number.isInteger(unidades) && unidades > 0) {
      mensajeTotal.textContent = `Total estimado: $${unidades * precio} (${unidades} × $${precio}). El total final lo confirma la reserva.`;
    } else {
      mensajeTotal.textContent = '';
    }
  };

  async function mirarPrecio() {
    precio = null;
    pintaTotal();
    const id = campoHornada.value.trim();
    if (!id) return;
    try {
      const res = await fetch(`/api/hornadas/${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const body = await res.json();
      precio = body?.hornada?.precio ?? null;
      pintaModalidades(body?.hornada?.modalidades);
      pintaTotal();
    } catch {}
  }

  actualizarPrecioReserva = mirarPrecio;
  campoHornada.addEventListener('change', mirarPrecio);
  // los tests (y los usuarios) pueden lanzar el change sobre el form mismo:
  // también lo escuchamos en bubbling para poblar modalidad y precio.
  form.addEventListener('change', (ev) => {
    if (ev.target === campoHornada || ev.target === form) mirarPrecio();
  });
  selectorModalidad.addEventListener('change', pintaDireccion);
  form.unidades.addEventListener('input', pintaTotal);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    mensaje.textContent = '';
    confirmada.hidden = true;

    const id = campoHornada.value.trim();
    if (!id) {
      mensaje.textContent = 'Te falta la hornada: pegá el id de la que querés reservar.';
      campoHornada.focus();
      return;
    }

    const modalidad = selectorModalidad.value || 'retiro';
    const datos = {
      nombre: form.nombre.value.trim(),
      contacto: form.contacto.value.trim(),
      unidades: form.unidades.value === '' ? undefined : Number(form.unidades.value),
      modalidad,
    };
    if (modalidad === 'despacho' && campoDireccion.style.display !== 'none') {
      datos.direccion = campoDireccion.value.trim();
    }

    try {
      const res = await fetch(`/api/hornadas/${encodeURIComponent(id)}/reservas`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(datos),
      });
      const body = await res.json();

      if (res.status === 201 && body.reserva) {
        confirmada.hidden = false;
        document.getElementById('reserva-codigo').textContent = body.reserva.codigo;
        document.getElementById('reserva-donde').textContent = body.reserva.donde;
        document.getElementById('reserva-total').textContent = body.reserva.total;
        document.getElementById('reserva-unidades-confirmadas').textContent = body.reserva.unidades;
        mensaje.textContent = '';
        form.reset();
        pintaDireccion();
        mensajeTotal.textContent = '';
      } else if (body.error === 'falta_nombre') {
        mensaje.textContent = 'Te falta tu nombre.';
        form.nombre.focus();
      } else if (body.error === 'falta_contacto') {
        mensaje.textContent = 'Te falta tu contacto.';
        form.contacto.focus();
      } else if (body.error === 'unidades_invalidas') {
        mensaje.textContent = 'Las unidades deben ser un número entero mayor a 0.';
        form.unidades.focus();
      } else if (body.error === 'sin_cupo') {
        mensaje.textContent = 'No alcanzó el cupo: alguien reservó antes. Mirá cuántas quedan en la tarjeta.';
      } else if (body.error === 'hornada_cerrada') {
        mensaje.textContent = 'Esa hornada ya está cerrada: se agotó o pasó la hora de retiro.';
      } else if (body.error === 'modalidad_no_ofrecida') {
        mensaje.textContent = 'Esa hornada no ofrece la modalidad elegida.';
      } else if (body.error === 'falta_direccion') {
        mensaje.textContent = 'El despacho necesita tu dirección: dónde se entrega el pan.';
        campoDireccion.focus();
      } else if (body.error === 'no_existe') {
        mensaje.textContent = 'Ese id de hornada no existe: revisá la tarjeta de tu sector.';
        campoHornada.focus();
      } else {
        mensaje.textContent = 'No se pudo reservar — pruebe nuevamente.';
      }
    } catch {
      mensaje.textContent = 'No se pudo reservar — pruebe nuevamente.';
    }
  });
}

async function main() {
  await Promise.all([cocinero(), miHornada(), listado(), reservar()]);
  await panelCocinero();
}

// T-7 (HU-5): el panel del cocinero se abre con el token — por query string
// (`/?token=…`) o por el que quedó guardado al registrarse. Lista sus hornadas
// con sus reservas (C-18) y ofrece marcar entregado (C-19); un despacho muestra
// su dirección de entrega (C-23).
async function panelCocinero() {
  const seccion = document.getElementById('panel-cocinero');
  if (!seccion) return;

  const mensaje = document.getElementById('mensaje-panel');
  const contenido = document.getElementById('panel-cocinero-contenido');

  const obtenerToken = () => {
    const tokenUrl = new URLSearchParams(location.search).get('token');
    if (tokenUrl && tokenUrl.trim()) return tokenUrl.trim();
    return localStorage.getItem('hornada_token') || '';
  };

  const horario = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
  };

  const render = (body) => {
    contenido.textContent = '';
    const hornadas = body?.hornadas ?? [];
    hornadas.forEach((h) => {
      const card = document.createElement('div');
      card.className = 'panel-hornada';

      const pan = document.createElement('p');
      pan.className = 'hornada-pan';
      pan.textContent = `${h.pan} · hasta ${horario(h.hasta)} · ${h.disponibles} sin reservar`;
      card.appendChild(pan);

      (h.reservas ?? []).forEach((r) => {
        const fila = document.createElement('p');
        fila.className = 'panel-reserva';
        fila.textContent = `${r.nombre} · ${r.unidades} unid. · ${r.modalidad}${r.direccion ? ` · entrega: ${r.direccion}` : ''} · ${r.contacto} · ${r.estado}`;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'marcar-entregado';
        btn.dataset.reserva = r.id;
        btn.textContent = 'Marcar entregado';
        btn.hidden = r.estado === 'entregada';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const res = await fetch(`/api/reservas/${encodeURIComponent(r.id)}/entregado`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ cocinero_token: obtenerToken() }),
            });
            const bodyEntregado = await res.json();
            if (res.status === 200) {
              mensaje.textContent = 'Pedido entregado.';
              cargar(obtenerToken());
            } else if (bodyEntregado.error === 'token_invalido') {
              mensaje.textContent = 'Tu token no es válido.';
            } else if (bodyEntregado.error === 'no_es_tu_reserva') {
              mensaje.textContent = 'Ese pedido no es de tus hornadas.';
            } else {
              mensaje.textContent = 'No se pudo marcar entregado — pruebe nuevamente.';
            }
          } catch {
            mensaje.textContent = 'No se pudo marcar entregado — pruebe nuevamente.';
          } finally {
            btn.disabled = false;
          }
        });

        fila.appendChild(btn);
        card.appendChild(fila);
      });

      contenido.appendChild(card);
    });
    if (hornadas.length === 0) {
      mensaje.textContent = 'Aún no tienes hornadas publicadas.';
    }
  };

  const cargar = async (token) => {
    try {
      const res = await fetch(`/api/cocineros/mi-panel?token=${encodeURIComponent(token)}`);
      const body = await res.json();
      if (res.status === 200) {
        render(body);
      } else if (body?.error === 'token_invalido') {
        mensaje.textContent = 'Tu token no es válido: regístrate de nuevo como cocinero.';
      } else {
        mensaje.textContent = 'No se pudo cargar tu panel — pruebe nuevamente.';
      }
    } catch {
      mensaje.textContent = 'No se pudo cargar tu panel — pruebe nuevamente.';
    }
  };

  const token = obtenerToken();
  if (!token) return;
  seccion.style.display = '';
  await cargar(token);
}

main();
