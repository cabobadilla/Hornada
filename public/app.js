async function main() {
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

main();
