import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { startServer, stopServer, serverReady, apiJson, BASE } from './helpers.mjs';
import { abrirTurno, cerrarTurno } from './lock.mjs';

// T-4 · La forma del listado (C-10, C-11, C-12, C-13).
//
// Este archivo MIDE el DOM real por CDP (Chrome Headless DevTools Protocol):
// getBoundingClientRect() para la geometría (C-10, C-11, C-12) y la fórmula de
// luminancia relativa WCAG sobre colores COMPUTADOS para el umbral (C-13).
// Nunca lee el archivo CSS: lo que se mide es lo que el navegador disponía.
//
// Los valores de referencia del contrato son límites del criterio (±2 px,
// ≥ 44 px, ≥ 4,5:1). Los 13 px del mockup son la referencia congelada, no un
// literal exigido: acá se usa la tolerancia declarada (igualdad entre tarjetas).

const RAIZ = new URL('../', import.meta.url).pathname.replace(/\/+$/, '');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PUERTOS_CANDIDATOS = [9223, 9224, 9225];

let chrome = null;
let puertoCdp = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Chrome headless propio de T-4 (helpers.mjs está sellado y no se toca;
// el perfil propio .tmp/chrome-t4 evita pisar el de las suites de DOM) ----

async function cdpLibre(puerto) {
  try {
    const v = await fetch(`http://127.0.0.1:${puerto}/json/version`, { signal: AbortSignal.timeout(700) });
    return v.ok;
  } catch {
    return false;
  }
}

async function asegurarChrome() {
  if (chrome) return;
  for (const puerto of PUERTOS_CANDIDATOS) {
    if (!(await cdpLibre(puerto))) {
      puertoCdp = puerto;
      break;
    }
  }
  if (!puertoCdp) throw new Error(`no hay puerto de CDP libre entre ${PUERTOS_CANDIDATOS.join(', ')}`);
  mkdirSync(new URL('../.tmp/', import.meta.url).pathname, { recursive: true });
  chrome = spawn(
    CHROME,
    [
      '--headless',
      `--remote-debugging-port=${puertoCdp}`,
      '--user-data-dir=' + new URL('../.tmp/chrome-t4', import.meta.url).pathname,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore', detached: true },
  );
  const arriba = await (async () => {
    for (let i = 0; i < 40; i++) {
      if (await cdpLibre(puertoCdp)) return true;
      await sleep(500);
    }
    return false;
  })();
  if (!arriba) throw new Error('el Chrome headless de T-4 no levantó su puerto de CDP');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.handlers = new Map();
    this.events = new Map();
    const seq = { n: 1 };
    this.send = (method, params = {}) => {
      const id = seq.n++;
      const p = new Promise((resolve, reject) => {
        this.handlers.set(id, { resolve, reject });
      });
      this.ws.send(JSON.stringify({ id, method, params }));
      return p;
    };
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.handlers.has(msg.id)) {
        const { resolve, reject } = this.handlers.get(msg.id);
        this.handlers.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method && this.events.has(msg.method)) {
        this.events.get(msg.method)(msg.params);
      }
    });
  }
}

// Abre una página nueva en el viewport pedido (390 px: el del contrato C-10),
// navega, espera el render del listado y devuelve un evaluate.
async function abrirPagina(url, { ancho = 390, alto = 800, esperaMs = 1200 } = {}) {
  await asegurarChrome();
  const created = await fetch(
    `http://127.0.0.1:${puertoCdp}/json/new?${new URLSearchParams({ url: 'about:blank' })}`,
    { method: 'PUT' },
  ).then((r) => r.json());
  const ws = new WebSocket(created.webSocketDebuggerUrl);
  await once(ws, 'open');
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  const cargada = new Promise((resolve) => cdp.events.set('Page.loadEventFired', resolve));
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: ancho,
    height: alto,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp.send('Page.navigate', { url });
  await Promise.race([cargada, sleep(8000)]);
  await sleep(esperaMs); // deja correr el fetch del listado de app.js
  return {
    async evaluate(expression) {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
      if (r.exceptionDetails) {
        throw new Error('Runtime.evaluate falló: ' + JSON.stringify(r.exceptionDetails));
      }
      return r.result.value;
    },
    async cerrar() {
      try {
        ws.close();
      } catch {}
      try {
        await fetch(`http://127.0.0.1:${puertoCdp}/json/close/${created.id}`);
      } catch {}
      await sleep(200);
    },
  };
}

// ---- siembra: 2 hornadas abiertas de 2 cocineros en un sector propio ----

const ms = (min) => min * 60 * 1000;
const iso = (desplazamientoMin) => new Date(Date.now() + ms(desplazamientoMin)).toISOString();

let sectorSembrado = null;

async function cocineroNuevo(tag, sector) {
  const { res, body } = await apiJson('/api/cocineros', {
    method: 'POST',
    body: JSON.stringify({
      nombre: `Horneador ${tag} ${Date.now()}`,
      sector,
      referencia_retiro: `Portón ${tag}, calle de la forma ${Date.now()}`,
    }),
  });
  assert.equal(res.status, 201, `precondición (cocinero ${tag}) · esperaba 201, llegó ${res.status}`);
  const coc = body?.cocinero ?? body;
  assert.ok(coc?.token, `precondición (cocinero ${tag}) · no vino token`);
  return coc;
}

async function sembrarSector() {
  if (sectorSembrado) return sectorSembrado;
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo para sembrar el sector de T-4');
  const sector = `sector-forma-t4-${Date.now()}`;
  const cA = await cocineroNuevo('forma-a', sector);
  const cB = await cocineroNuevo('forma-b', sector);
  const hornadas = [];
  for (const [token, pan, desde, unidades] of [
    [cA.token, 'Marraquetas de la forma', iso(30), 12],
    [cB.token, 'Hallullas de la forma', iso(90), 8],
  ]) {
    const { res, body } = await apiJson('/api/hornadas', {
      method: 'POST',
      body: JSON.stringify({
        cocinero_token: token,
        pan,
        desde,
        hasta: iso(300),
        unidades,
        precio: 1200,
        modalidades: ['retiro', 'despacho'],
        referencia_retiro: 'Portón gris, Calle de la Forma 1',
      }),
    });
    assert.equal(res.status, 201, `precondición (hornada ${pan}) · esperaba 201, llegó ${res.status}`);
    const h = body?.hornada ?? body;
    assert.ok(h?.id, 'precondición (hornada) · no vino id');
    hornadas.push({ id: h.id, pan });
  }
  sectorSembrado = { sector, hornadas };
  return sectorSembrado;
}

// La medición completa de UNA pantalla: geometría de tarjetas, chip y botón,
// ancho interno, y contraste WCAG del texto secundario (colores computados).
async function medirPantalla() {
  const { sector } = await sembrarSector();
  const pagina = await abrirPagina(
    `${BASE}/?sector=${encodeURIComponent(sector)}&t4=${Math.random().toString(36).slice(2)}`,
  );
  try {
    return await pagina.evaluate(`(() => {
        const lum = ([r, g, b]) => {
          const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const rgb = (c) => {
          const m = String(c).match(/[\\d.]+/g) || [];
          return [Number(m[0]) || 0, Number(m[1]) || 0, Number(m[2]) || 0, m.length >= 4 ? Number(m[3]) : 1];
        };
        const fondoDe = (el) => {
          let n = el;
          while (n) {
            const [r, g, b, a] = rgb(getComputedStyle(n).backgroundColor);
            if ((r || g || b) && a > 0) return [r, g, b];
            n = n.parentElement;
          }
          return [255, 255, 255];
        };
        const contraste = (el) => {
          const cs = getComputedStyle(el);
          const color = rgb(cs.color).slice(0, 3);
          const propio = rgb(cs.backgroundColor);
          const fondoColor = (propio[0] || propio[1] || propio[2]) && propio[3] > 0
            ? propio.slice(0, 3)
            : fondoDe(el.parentElement);
          const l1 = lum(color), l2 = lum(fondoColor);
          const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
          return (a + 0.05) / (b + 0.05);
        };
        const tarjetas = [...document.querySelectorAll('#lista-hornadas [id^="card-hornada"]')];
        const datosTarjetas = tarjetas.map((t) => {
          const r = t.getBoundingClientRect();
          const cs = getComputedStyle(t);
          const interior = r.width
            - (parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight))
            - (parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth));
          const chip = t.querySelector('.chip-cupo');
          const chipR = chip && chip.getBoundingClientRect();
          const boton = t.querySelector('button');
          const botonR = boton && boton.getBoundingClientRect();
          return {
            id: t.id,
            left: r.left, right: r.right, top: r.top, bottom: r.bottom,
            width: r.width, height: r.height,
            chipTop: chipR ? chipR.top : null,
            chipRight: chipR ? chipR.right : null,
            chipExiste: !!chip,
            botonExiste: !!boton,
            botonAncho: botonR ? botonR.width : null,
            botonAlto: botonR ? botonR.height : null,
            botonBottom: botonR ? botonR.bottom : null,
            anchoInterno: interior,
          };
        });
        const secundarios = tarjetas.flatMap((t) => {
          const el = t.querySelector('.hornada-meta');
          const chip = t.querySelector('.chip-cupo');
          const salida = [];
          if (el) salida.push({ selector: '.hornada-meta', tarjeta: t.id, ratio: contraste(el) });
          if (chip) salida.push({ selector: '.chip-cupo', tarjeta: t.id, ratio: contraste(chip) });
          return salida;
        });
        return {
          nTarjetas: tarjetas.length,
          datosTarjetas,
          contraste: secundarios,
          scrollWidth: document.documentElement.scrollWidth,
        };
      })()`);
  } finally {
    await pagina.cerrar();
  }
}

// ==================================================================
// C-10 · forma: una sola columna a 390 px
// ==================================================================

test('C-10 · a 390 px de viewport las tarjetas se apilan en una sola columna: left iguales (±2 px) y top de cada una ≥ bottom de la anterior', async () => {
  const m = await medirPantalla();
  assert.ok(
    m.nTarjetas >= 2,
    `C-10 · se necesitan al menos 2 tarjetas en pantalla para la medición, hay ${m.nTarjetas}`,
  );
  const izqs = m.datosTarjetas.map((t) => t.left);
  const deltaIzq = Math.max(...izqs) - Math.min(...izqs);
  assert.ok(
    deltaIzq <= 2,
    `C-10 · los left de las tarjetas deben coincidir ±2 px: ${m.datosTarjetas.map((t) => `${t.id}:${t.left}`).join(', ')}`,
  );
  for (let i = 1; i < m.datosTarjetas.length; i++) {
    const previa = m.datosTarjetas[i - 1];
    const actual = m.datosTarjetas[i];
    assert.ok(
      actual.top >= previa.bottom,
      `C-10 · la tarjeta ${actual.id} (top ${actual.top}) debe estar bajo la anterior ${previa.id} (bottom ${previa.bottom})`,
    );
  }
});

test('EX-T4a · a 390 px el listado cabe en el viewport sin scroll horizontal (right de la tarjeta ≤ 390)', async () => {
  const m = await medirPantalla();
  assert.ok(m.nTarjetas >= 2, `EX-T4a · se necesitan al menos 2 tarjetas, hay ${m.nTarjetas}`);
  assert.ok(
    m.scrollWidth <= 390,
    `EX-T4a · scrollWidth del documento debe ser ≤ 390 px, fue ${m.scrollWidth}`,
  );
  for (const t of m.datosTarjetas) {
    assert.ok(t.right <= 392, `EX-T4a · el right de ${t.id} debe caber en el viewport, llegó ${t.right}`);
  }
});

// ==================================================================
// C-11 · forma: chip de cupo anclado al vértice superior derecho
// ==================================================================

test('C-11 · el chip de cupo queda anclado al vértice superior derecho de su tarjeta con el mismo margen en todas (±2 px)', async () => {
  const m = await medirPantalla();
  assert.ok(m.nTarjetas >= 2, `C-11 · se necesitan al menos 2 tarjetas, hay ${m.nTarjetas}`);
  for (const t of m.datosTarjetas) {
    assert.ok(t.chipExiste, `C-11 · ${t.id} debe tener su chip de cupo (.chip-cupo)`);
  }
  const deltaTop = m.datosTarjetas.map((t) => t.chipTop - t.top);
  const deltaRight = m.datosTarjetas.map((t) => t.right - t.chipRight);
  const rango = (xs) => Math.max(...xs) - Math.min(...xs);
  assert.ok(
    rango(deltaTop) <= 2,
    `C-11 · chip.top − tarjeta.top debe ser igual entre tarjetas ±2 px: ${deltaTop.join(', ')}`,
  );
  assert.ok(
    rango(deltaRight) <= 2,
    `C-11 · tarjeta.right − chip.right debe ser igual entre tarjetas ±2 px: ${deltaRight.join(', ')}`,
  );
});

// ==================================================================
// C-12 · forma: botón de reserva al ancho interno, margen inferior
// igual entre tarjetas y alto ≥ 44 px
// ==================================================================

test('C-12 · el botón de reserva ocupa el ancho interno de su tarjeta (±2 px), con el mismo margen inferior en todas (±2 px) y alto ≥ 44 px', async () => {
  const m = await medirPantalla();
  assert.ok(m.nTarjetas >= 2, `C-12 · se necesitan al menos 2 tarjetas, hay ${m.nTarjetas}`);
  for (const t of m.datosTarjetas) {
    assert.ok(t.botonExiste, `C-12 · ${t.id} debe tener su botón de reserva`);
    const desvio = Math.abs(t.anchoInterno - t.botonAncho);
    assert.ok(
      desvio <= 2,
      `C-12 · ${t.id}: |ancho interno (${t.anchoInterno}px) − ancho del botón (${t.botonAncho}px)| debe ser ≤ 2 px, fue ${desvio}`,
    );
    assert.ok(
      t.botonAlto >= 44,
      `C-12 · ${t.id}: el alto del botón (${t.botonAlto}px) debe ser ≥ 44 px`,
    );
  }
  const margenes = m.datosTarjetas.map((t) => t.bottom - t.botonBottom);
  const rango = Math.max(...margenes) - Math.min(...margenes);
  assert.ok(
    rango <= 2,
    `C-12 · el margen inferior (tarjeta.bottom − botón.bottom) debe ser igual entre tarjetas ±2 px: ${margenes.join(', ')}`,
  );
});

// ==================================================================
// C-13 · umbral: contraste ≥ 4,5:1 (luminancia relativa WCAG) del
// texto secundario (metadatos de tarjeta y avisos) contra su fondo
// ==================================================================

test('C-13 · el texto secundario del listado (metadatos y chip de cupo) sostiene contraste ≥ 4,5:1 por la fórmula de luminancia WCAG', async () => {
  const m = await medirPantalla();
  assert.ok(m.nTarjetas >= 2, `C-13 · se necesitan al menos 2 tarjetas, hay ${m.nTarjetas}`);
  assert.ok(m.contraste.length > 0, 'C-13 · debe haber texto secundario que medir (.hornada-meta y .chip-cupo)');
  for (const c of m.contraste) {
    assert.ok(
      c.ratio >= 4.5,
      `C-13 · ${c.selector} en ${c.tarjeta}: contraste medido ${c.ratio.toFixed(2)}:1, debe ser ≥ 4,5:1`,
    );
  }
});

before(async () => {
  await abrirTurno('t4-forma.test.mjs');
});

after(() => {
  if (chrome) {
    try {
      process.kill(-chrome.pid);
    } catch {
      try {
        chrome.kill();
      } catch {}
    }
  }
  cerrarTurno();
});
