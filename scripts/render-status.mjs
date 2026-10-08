#!/usr/bin/env node
/**
 * render-status.mjs — Tablero de avance del proyecto (progreso.html).
 *
 * Uso:  node scripts/render-status.mjs <ruta-del-proyecto>
 *
 * Lee   <proyecto>/docs/estado.json     (VIVO — se reinicia en cada ciclo)
 *       <proyecto>/docs/historial.json  (INMUTABLE — se acumula, nunca se borra)
 * Escribe <proyecto>/progreso.html
 *
 * El tablero tiene TRES capas, y cada una responde a una pregunta distinta:
 *   1. CICLO ACTUAL  — ¿en qué va lo que estamos haciendo?
 *   2. BIFURCACIÓN   — ¿qué quedó pendiente, y quién decide si se hace?
 *   3. HISTÓRICO     — ¿qué pasó realmente en las corridas anteriores?
 *
 * Lo pendiente NO se borra: se propone como ciclo siguiente, EN PAUSA, esperando
 * validación del usuario. Lo diferido sin lugar propio se pierde.
 *
 * Sin dependencias. Sin build. Un HTML estático, publicable en Pages.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const projectDir = resolve(process.argv[2] || '.');
const estadoPath = join(projectDir, 'docs', 'estado.json');
const histPath = join(projectDir, 'docs', 'historial.json');

if (!existsSync(estadoPath)) {
  console.error(`No existe ${estadoPath}`);
  process.exit(1);
}
const e = JSON.parse(readFileSync(estadoPath, 'utf8'));
const h = existsSync(histPath) ? JSON.parse(readFileSync(histPath, 'utf8')) : { corridas: [] };

const ESTADOS = {
  listo:       { t: 'Listo',      i: '✓', c: 'ok'   },
  'en-curso':  { t: 'En curso',   i: '◐', c: 'run'  },
  pendiente:   { t: 'Pendiente',  i: '○', c: 'wait' },
  diferido:    { t: 'Diferido',   i: '⤳', c: 'def'  },
  bloqueado:   { t: 'Bloqueado',  i: '!', c: 'blk'  },
  propuesto:   { t: 'Propuesto',  i: '◇', c: 'prop' },
  'en-pausa':  { t: 'En pausa',   i: '⏸', c: 'def'  },
  aprobado:    { t: 'Aprobado',   i: '▶', c: 'ok'   },
};
const est = (k) => ESTADOS[k] || ESTADOS.pendiente;

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fecha = (iso) => {
  try { return new Date(iso).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso || ''; }
};

const tareas = e.tareas || [];
// Vocabulario CERRADO, y se verifica (v0.23).
// Un estado fuera de la lista NO se ignora en silencio: mostrar "0%" es una métrica
// falsa con apariencia de dato. Un `'hecho'` donde el render espera `'listo'` daba
// 0/8 sin un solo mensaje — el fallo más caro es el que no se nota.
// La lista válida es la MISMA que usa `est()` para pintar: una sola fuente.
for (const t of tareas) {
  if (!Object.hasOwn(ESTADOS, t.estado)) {
    console.error(`✗ ${t.id}: estado «${t.estado}» no es válido.`);
    console.error(`  Válidos: ${Object.keys(ESTADOS).join(' · ')}`);
    console.error('  (Un estado desconocido se contaba como 0% y se pintaba');
    console.error('   como «Pendiente», en silencio.)');
    process.exit(1);
  }
}
const hechas = tareas.filter((t) => t.estado === 'listo').length;
const pct = tareas.length ? Math.round((hechas / tareas.length) * 100) : 0;

// ---- 1. fases del ciclo vivo ---------------------------------------------
const fases = (e.fases || []).map((f) => {
  const s = est(f.estado);
  const puntos = (f.puntos || []).map((p) => `<li>${esc(p)}</li>`).join('');
  const gate = f.gate
    ? `<span class="gate ${f.estado === 'listo' ? 'gate-ok' : 'gate-wait'}">${esc(f.gate)}</span>` : '';
  return `
    <section class="fase ${s.c}">
      <header><span class="chip ${s.c}">${s.i} ${s.t}</span>${gate}</header>
      <h3>${esc(f.nombre)}</h3>
      ${f.resumen ? `<p class="resumen">${esc(f.resumen)}</p>` : ''}
      ${puntos ? `<ul class="puntos">${puntos}</ul>` : ''}
    </section>`;
}).join('');

// ---- 2. bifurcación -------------------------------------------------------
const ciclos = e.siguientes_ciclos || [];

// ---- 3. histórico ---------------------------------------------------------
const RES = {
  verde:      { t: 'Verde',      c: 'ok'  },
  parcial:    { t: 'Parcial',    c: 'run' },
  muerta:     { t: 'Muerta',     c: 'blk' },
  descartada: { t: 'Descartada', c: 'blk' },
  ok:         { t: 'OK',         c: 'ok'  },
};
const corridas = (h.corridas || []).map((r) => {
  const rs = RES[r.resultado] || { t: r.resultado || '—', c: 'wait' };
  return `
    <tr>
      <td class="num">${esc(r.n)}</td>
      <td>${esc(r.ciclo || '')}</td>
      <td><code>${esc(r.modelo || '')}</code></td>
      <td class="num">${esc(r.duracion || '')}</td>
      <td><span class="chip ${rs.c}">${rs.t}</span></td>
      <td class="nota">${esc(r.nota || '')}</td>
    </tr>`;
}).join('');

const listaTareas = tareas.map((t) => {
  const s = est(t.estado);
  return `<li class="${s.c}">
      <span class="tk-estado">${s.i}</span>
      <span class="tk-id">${esc(t.id)}</span>
      <span class="tk-titulo">${esc(t.titulo)}</span>
      ${t.nota ? `<span class="tk-nota">${esc(t.nota)}</span>` : ''}
    </li>`;
}).join('');

const listaHistorias = (e.historias || []).map((x) => {
  const s = est(x.estado);
  return `<li class="${s.c}">
      <span class="tk-estado">${s.i}</span>
      <span class="tk-id">${esc(x.id)}</span>
      <span class="tk-titulo">${esc(x.titulo)}</span>
    </li>`;
}).join('');

const decisiones = (e.decisiones || []).map((d) =>
  `<li><strong>${esc(d.titulo)}</strong>${d.texto ? ` — ${esc(d.texto)}` : ''}</li>`).join('');

const ramasProx = ciclos.map((c) => {
  const s = est(c.estado);
  const incluye = (c.incluye || []).map((i) => `<li>${esc(i)}</li>`).join('');
  return `<div class="rama pausa">
        <span class="chip ${s.c}">${s.i} ${s.t}</span>
        ${c.tamano ? `<span class="tamano">${esc(c.tamano)}</span>` : ''}
        <h3>${esc(c.titulo)}</h3>
        ${c.motivo ? `<p class="resumen">${esc(c.motivo)}</p>` : ''}
        ${incluye ? `<ul class="puntos">${incluye}</ul>` : ''}
        ${c.validacion ? `<p class="validacion">→ ${esc(c.validacion)}</p>` : ''}
      </div>`;
}).join('');

const faseViva = (e.fases || [])[4] || { estado: 'en-curso' };
const sv = est(faseViva.estado);

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Avance · ${esc(e.proyecto)}</title>
<style>
  :root{
    --bg:#0d1117; --surface:#161b22; --surface2:#1c2128; --border:#30363d;
    --text:#e6edf3; --muted:#8b949e; --accent:#58a6ff;
    --ok:#3fb950; --run:#d29922; --wait:#6e7681; --def:#a371f7; --blk:#f85149; --prop:#58a6ff;
  }
  *{box-sizing:border-box}
  body{margin:0; background:var(--bg); color:var(--text);
    font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .wrap{max-width:1280px; margin:0 auto; padding:32px 24px 64px}
  header.top{border-bottom:1px solid var(--border); padding-bottom:24px; margin-bottom:32px}
  .eyebrow{color:var(--muted); font-size:12px; letter-spacing:.12em; text-transform:uppercase}
  h1{margin:8px 0 4px; font-size:32px; letter-spacing:-.02em}
  .sub{color:var(--muted); font-size:14px; margin:0}
  .meta{margin-top:18px; display:flex; flex-wrap:wrap; gap:26px; align-items:center}
  .kpi{display:flex; flex-direction:column}
  .kpi b{font-size:21px; font-weight:600}
  .kpi span{color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.08em}
  .barra{height:6px; background:var(--surface2); border-radius:99px; overflow:hidden; margin-top:18px}
  .barra i{display:block; height:100%; background:var(--accent); width:${pct}%}
  h2{font-size:13px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted);
     margin:44px 0 6px; font-weight:600}
  .h2sub{color:var(--muted); font-size:13px; margin:0 0 16px; max-width:70ch}
  .fases{display:grid; grid-template-columns:repeat(5,1fr); gap:14px}
  @media(max-width:1000px){.fases{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:620px){.fases{grid-template-columns:1fr}}
  .fase{background:var(--surface); border:1px solid var(--border); border-radius:10px;
        padding:16px; display:flex; flex-direction:column; gap:10px}
  .fase.ok{border-top:3px solid var(--ok)} .fase.run{border-top:3px solid var(--run)}
  .fase.wait{border-top:3px solid var(--wait)} .fase.def{border-top:3px solid var(--def)}
  .fase.blk{border-top:3px solid var(--blk)}
  .fase header{display:flex; justify-content:space-between; align-items:center; gap:8px}
  .fase h3{margin:0; font-size:16px; letter-spacing:-.01em}
  .resumen{margin:0; color:var(--muted); font-size:13px}
  .puntos{margin:0; padding-left:18px; color:var(--muted); font-size:13px}
  .puntos li{margin:4px 0}
  .chip{font-size:11px; font-weight:600; padding:3px 8px; border-radius:99px;
        text-transform:uppercase; letter-spacing:.06em; white-space:nowrap}
  .chip.ok{background:rgba(63,185,80,.15); color:var(--ok)}
  .chip.run{background:rgba(210,153,34,.15); color:var(--run)}
  .chip.wait{background:rgba(110,118,129,.15); color:var(--wait)}
  .chip.def{background:rgba(163,113,247,.15); color:var(--def)}
  .chip.blk{background:rgba(248,81,73,.15); color:var(--blk)}
  .chip.prop{background:rgba(88,166,255,.15); color:var(--prop)}
  .gate{font-size:11px; color:var(--muted); border:1px solid var(--border); padding:2px 7px; border-radius:5px}
  .gate-ok{color:var(--ok); border-color:rgba(63,185,80,.4)}

  .fork{display:grid; grid-template-columns:1fr 1fr; gap:0; align-items:stretch;
        border:1px solid var(--border); border-radius:12px; overflow:hidden; background:var(--surface)}
  @media(max-width:820px){.fork{grid-template-columns:1fr}}
  .rama{position:relative; padding:22px 22px 22px 46px}
  .rama + .rama{border-left:1px solid var(--border)}
  @media(max-width:820px){.rama + .rama{border-left:none; border-top:1px solid var(--border)}}
  .rama::before{content:''; position:absolute; left:18px; top:0; bottom:0; width:2px; background:var(--border)}
  .rama::after{content:''; position:absolute; left:18px; top:56px; width:20px; height:2px; background:var(--border)}
  .rama.activa::before{background:linear-gradient(var(--ok) 56px, var(--border) 56px)}
  .rama.pausa::before{background:linear-gradient(var(--def) 56px, var(--border) 56px)}
  .rama h3{margin:12px 0 6px; font-size:17px}
  .tamano{font-size:11px; color:var(--muted); border:1px solid var(--border);
          padding:2px 7px; border-radius:5px; margin-left:6px}
  .validacion{margin:12px 0 0; font-size:12px; color:var(--prop)}

  table{width:100%; border-collapse:collapse; font-size:13px}
  th{text-align:left; color:var(--muted); font-weight:600; font-size:11px;
     text-transform:uppercase; letter-spacing:.08em; padding:8px 10px;
     border-bottom:1px solid var(--border)}
  td{padding:10px; border-bottom:1px solid var(--surface2); vertical-align:top}
  td.num{font-variant-numeric:tabular-nums; color:var(--muted); white-space:nowrap}
  td.nota{color:var(--muted)}
  code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--accent);
       background:var(--surface2); padding:2px 6px; border-radius:4px; white-space:nowrap}

  ul.lista{list-style:none; margin:0; padding:0; display:grid; gap:6px}
  ul.lista li{display:grid; grid-template-columns:22px 52px 1fr auto; gap:10px;
              align-items:baseline; background:var(--surface); border:1px solid var(--border);
              border-radius:8px; padding:10px 14px; font-size:14px}
  @media(max-width:620px){ul.lista li{grid-template-columns:22px 1fr; gap:6px}}
  .tk-estado{color:var(--muted)}
  li.ok .tk-estado{color:var(--ok)} li.run .tk-estado{color:var(--run)}
  li.def .tk-estado{color:var(--def)} li.blk .tk-estado{color:var(--blk)}
  .tk-id{color:var(--muted); font-variant-numeric:tabular-nums; font-size:13px}
  li.ok .tk-titulo{color:var(--muted)}
  .tk-nota{color:var(--muted); font-size:12px}
  @media(max-width:620px){.tk-nota{grid-column:2}}
  .caja{background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px}
  .caja ul{margin:0; padding-left:18px; color:var(--muted); font-size:14px}
  .caja li{margin:6px 0}
  .caja li strong{color:var(--text)}
  footer{margin-top:48px; padding-top:20px; border-top:1px solid var(--border);
         color:var(--muted); font-size:13px}
  footer p{margin:6px 0}
</style>
</head>
<body>
<div class="wrap">

  <header class="top">
    <div class="eyebrow">Tablero de avance · proceso idea → pruebas</div>
    <h1>${esc(e.proyecto)}</h1>
    <p class="sub">${esc(e.resumen || '')}</p>
    <div class="meta">
      <div class="kpi"><b>${pct}%</b><span>Tareas del ciclo</span></div>
      <div class="kpi"><b>${hechas}/${tareas.length}</b><span>Completadas</span></div>
      ${e.ciclo ? `<div class="kpi"><b>${esc(e.ciclo)}</b><span>Ciclo activo</span></div>` : ''}
      ${e.etapa ? `<div class="kpi"><b>${esc(e.etapa)}</b><span>Alcance</span></div>` : ''}
      ${e.fase_actual ? `<div class="kpi"><b>${esc(e.fase_actual)}</b><span>Fase actual</span></div>` : ''}
    </div>
    <div class="barra"><i></i></div>
  </header>

  <h2>1 · El ciclo actual</h2>
  <p class="h2sub">Capa <strong>viva</strong>: se reinicia en cada ciclo. Responde «¿en qué va lo que estamos haciendo?».</p>
  <div class="fases">${fases}</div>

  ${listaTareas ? `<h2>Tareas del ciclo</h2><ul class="lista">${listaTareas}</ul>` : ''}
  ${listaHistorias ? `<h2>Historias de usuario</h2><ul class="lista">${listaHistorias}</ul>` : ''}

  ${ciclos.length ? `
  <h2>2 · La bifurcación — lo que queda pendiente</h2>
  <p class="h2sub">Lo diferido <strong>no se borra</strong>: se propone como ciclo siguiente. Ninguno arranca sin validación del usuario.</p>
  <div class="fork">
    <div class="rama activa">
      <span class="chip ${est('en-curso').c}">${est('en-curso').i} Activo</span>
      <h3>${esc(e.etapa || 'Ciclo actual')}</h3>
      <p class="resumen">Cerrar y verificar lo que ya está construido. Único ciclo en marcha.</p>
      <div class="fases" style="grid-template-columns:1fr; margin-top:14px">
        <section class="fase ${sv.c}" style="background:var(--surface2)">
          <header><span class="chip ${sv.c}">${sv.i} ${sv.t}</span><span class="gate">G5</span></header>
          <h3>Verificación independiente</h3>
          <p class="resumen">QA en contexto aislado, contra los criterios de la fase 3.</p>
        </section>
      </div>
    </div>
    ${ramasProx}
  </div>` : ''}

  ${decisiones ? `<h2>Decisiones</h2><div class="caja"><ul>${decisiones}</ul></div>` : ''}

  ${corridas ? `
  <h2>3 · Histórico de corridas</h2>
  <p class="h2sub">Capa <strong>inmutable</strong>: nunca se reinicia. Es el registro de lo que realmente pasó — modelo, duración y resultado de cada corrida.</p>
  <table>
    <thead><tr><th>#</th><th>Ciclo</th><th>Modelo</th><th>Dur.</th><th>Resultado</th><th>Qué pasó</th></tr></thead>
    <tbody>${corridas}</tbody>
  </table>` : ''}

  <footer>
    ${e.siguiente ? `<p><strong>Siguiente:</strong> ${esc(e.siguiente)}</p>` : ''}
    <p>Actualizado ${esc(fecha(e.actualizado))}${e.nota_de_proceso ? ` · ${esc(e.nota_de_proceso)}` : ''}</p>
  </footer>

</div>
</body>
</html>`;

const out = join(projectDir, 'progreso.html');
writeFileSync(out, html, 'utf8');
console.log(`✓ ${out} (${hechas}/${tareas.length} tareas, ${pct}%) · ${ciclos.length} ciclo(s) en bifurcación · ${(h.corridas || []).length} corrida(s)`);
