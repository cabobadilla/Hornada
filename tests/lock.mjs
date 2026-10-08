// T-5b · infraestructura de la suite (no hay aserciones acá ni observables nuevos).
//
// Problema medido (corrida-T5.log, sección BLOQUEOS): los cuatro archivos de test
// arrancan `wrangler dev` en el puerto 8787 y la serialización por ps/lsof era
// inerte — el guard `cwd.startsWith(RAIZ)` era siempre falso porque RAIZ termina
// en `/` y el cwd que devuelve lsof no —, con lo que las suites se pisaban el
// puerto y se mataban el server entre sí.
//
// Solución elegida (los archivos siguen hablando HTTP real contra un server real,
// en el mismo puerto y con el mismo helpers.mjs sellado): un LOCK FILE en .tmp/
// que garantiza UN SOLO `wrangler dev` por vez. Cada archivo toma el turno en su
// before() y lo suelta en su after(), tras matar su server.
//
// - El acquire es atómico: openSync(…, 'wx') crea el archivo solo si no existe.
// - Un lock con dueño MUERTO (corrida interrumpida) es rancio: se roba.
// - Un lock con más de 25 min es rancio (dueño colgado): se roba.
// - Con el turno tomado, cualquier listener de 8787 pertenece a una suite MUERTA
//   (huérfano de una corrida interrumpida): se mata el GRUPO de procesos, nunca
//   el server de una suite viva (se verifica por ancestría de PIDs).
// - El health-probe de helpers.mjs da el server por arriba con cualquier
//   respuesta del puerto; con el turno tomado el único listener posible es el
//   propio, y se verifica al final del arranque: si alguien responde en 8787
//   cuya ancestría no incluye ESTE proceso, se falla el before() (rojo honesto)
//   en vez de correr la suite contra el server ajeno.
import { execSync } from 'node:child_process';
import { openSync, writeSync, closeSync, readFileSync, unlinkSync, mkdirSync, statSync } from 'node:fs';
import { BASE, startServer, stopServer } from './helpers.mjs';

const RAIZ = new URL('../', import.meta.url).pathname.replace(/\/+$/, '');
const TMP = new URL('../.tmp/', import.meta.url).pathname;
const LOCK = new URL('../.tmp/turno-dev-8787.lock', import.meta.url).pathname;
const RANCIO_MS = 25 * 60 * 1000;
const TOPE_MIN = 20 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cwdDe(pid) {
  try {
    const out = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null || true`, { encoding: 'utf8' });
    const hit = out.split('\n').find((l) => l.startsWith('n'));
    return hit ? hit.slice(1) : '';
  } catch {
    return '';
  }
}

// Suites vivas de ESTE proyecto: procesos cuyo argv termina en `tests/<x>.test.mjs`
// y cuyo cwd es la raíz del proyecto (sin barra final: mismo guard corrigiendo
// la causa 1, la barra final de RAIZ).
function suitesVivas() {
  const vivas = [];
  let out = '';
  try {
    out = execSync('ps -axo pid=,command=', { encoding: 'utf8' });
  } catch {
    return vivas;
  }
  for (const linea of out.split('\n')) {
    const m = linea.match(/^ *\d+ +(.*)$/);
    if (!m) continue;
    const arch = m[1].match(/tests\/([A-Za-z0-9._-]+\.test\.mjs)\s*$/);
    if (!arch) continue;
    const pid = Number(linea.match(/^ *\d+/)[0]);
    const cwd = cwdDe(pid);
    if (cwd && cwd.startsWith(RAIZ)) vivas.push({ pid, archivo: arch[1] });
  }
  return vivas;
}

function ancestriaIncluye(pid, buscado) {
  let actual = pid;
  for (let i = 0; i < 10 && actual; i++) {
    if (actual === buscado) return true;
    let out = '';
    try {
      out = execSync(`ps -o ppid= -p ${actual}`, { encoding: 'utf8' }).trim();
    } catch {
      return false;
    }
    const ppid = parseInt(out, 10);
    if (!ppid || ppid <= 1) return false;
    actual = ppid;
  }
  return false;
}

// Un pid es vivo si kill(pid, 0) no lo niega; se confirma que SIGA siendo un
// proceso de test de este proyecto para blindarse contra reuso de pid.
function viveComoTest(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  let vivo = false;
  try {
    process.kill(pid, 0);
    vivo = true;
  } catch (e) {
    vivo = e?.code === 'EPERM';
  }
  if (!vivo) return false;
  if (pid === process.pid) return true;
  const linea = execSync('ps -axo pid=,command=', { encoding: 'utf8' })
    .split('\n')
    .find((l) => l.match(new RegExp(`^ *${pid} +`)));
  return Boolean(linea?.match(/tests\/[A-Za-z0-9._-]+\.test\.mjs/));
}

function dueñoDelTurno() {
  // retorno: {kind: 'libre' | 'dueño' | 'fresco-ilegible' | 'rancio'}
  let crudo = null;
  try {
    crudo = readFileSync(LOCK, 'utf8');
  } catch {
    return { kind: 'libre' };
  }
  let lock = null;
  try {
    lock = JSON.parse(crudo);
  } catch {
    // vacío o truncado: o el dueño está en medio de la escritura (recién
    // creado) o murió escribiendo. Se distingue por edad del archivo.
    let edadMs = Infinity;
    try {
      edadMs = Date.now() - statSync(LOCK).mtimeMs;
    } catch {}
    if (edadMs <= 5_000) return { kind: 'fresco-ilegible' };
    return { kind: 'rancio' };
  }
  if (!lock || !viveComoTest(lock.pid)) return { kind: 'rancio' };
  return { kind: 'dueño', lock };
}

function edadDeLock() {
  try {
    return Date.now() - statSync(LOCK).mtimeMs;
  } catch {
    return Infinity;
  }
}

async function puertoLibre() {
  try {
    await fetch(`${BASE}/`, { signal: AbortSignal.timeout(800) });
    return false;
  } catch (e) {
    return e?.cause?.code === 'ECONNREFUSED';
  }
}

async function esperarPuertoLibre(ms) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await puertoLibre()) return true;
    await sleep(500);
  }
  return false;
}

// Con el turno tomado: todo listener de 8787 cuya ancestría no incluya una suite
// viva de este proyecto es un huérfano de una corrida interrumpida. Se mata su
// GRUPO de procesos (el árbol npx→wrangler→workerd completo) y se espera a que
// el puerto quede real y verdaderamente libre antes de terminar.
async function limpiarHuérfanos() {
  const pids = _ids8787();
  if (pids.length === 0) return;
  const vivas = suitesVivas();
  for (const pid of pids) {
    if (vivas.some(({ pid: suite }) => ancestriaIncluye(pid, suite))) continue;
    let pgid = 0;
    try {
      pgid = parseInt(execSync(`ps -o pgid= -p ${pid}`, { encoding: 'utf8' }).trim(), 10) || 0;
    } catch {}
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
    if (pgid && pgid > 1) {
      try {
        process.kill(-pgid, 'SIGTERM');
      } catch {}
    }
  }
  // gracia de 3 s: si algo sigue vivo, SIGKILL al grupo
  await sleep(3000);
  const rezagados = _ids8787();
  for (const pid of rezagados) {
    let pgid = 0;
    try {
      pgid = parseInt(execSync(`ps -o pgid= -p ${pid}`, { encoding: 'utf8' }).trim(), 10) || 0;
    } catch {}
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
    if (pgid && pgid > 1) {
      try {
        process.kill(-pgid, 'SIGKILL');
      } catch {}
    }
  }
}

function _ids8787() {
  try {
    return execSync('lsof -t -iTCP:8787 -sTCP:LISTEN 2>/dev/null || true', { encoding: 'utf8' })
      .split('\n')
      .map((s) => parseInt(s, 10))
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ============================================================
// abrirTurno(archivo):
//   1. toma el turno exclusivo (lock file en .tmp/) — espera a que exista
//   (tope 20 min; si el dueño está muerto o el lock rancio, lo roba);
//   2. limpia 8787 de restos vivos que no pertenezcan a ninguna suite viva;
//   3. espera a que el puerto esté íntegramente libre;
//   4. arranca el dev server (migrations + wrangler dev, todo via helpers.mjs
//   sellado, sin cambios) y verifica por ancestría que el server respondido
//   sea EL DE ESTA SUITE (cierra la causa 3 del probe sin tocar helpers).
// ============================================================

export async function abrirTurno(archivo) {
  mkdirSync(TMP, { recursive: true });
  const limite = Date.now() + TOPE_MIN;
  let tomado = false;
  while (Date.now() < limite) {
    let fd = null;
    try {
      fd = openSync(LOCK, 'wx');
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, archivo, en: new Date().toISOString() }));
      } finally {
        closeSync(fd);
      }
      tomado = true;
      break;
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      // turno tomado: solo robo si el dueño está muerto o el lock es rancio
      // (rancio = >25 min de edad, o ilegible y viejo: dueño muerto a medio
      // escribir). Un lock recién creado pero aún ilegible NO se roba: el
      // dueño puede estar a medio escribir (robo ahí reproduce el bug de
      // doble propiedad que se midió en las corridas T5b-run1/run2).
      const estado = dueñoDelTurno();
      const rancio = estado.kind === 'rancio' || edadDeLock() > RANCIO_MS;
      if (estado.kind === 'dueño' && !rancio) {
        await sleep(500);
        continue;
      }
      if (estado.kind === 'fresco-ilegible') {
        await sleep(250);
        continue;
      }
      try {
        unlinkSync(LOCK);
      } catch {}
      continue; // reintentar el acquire sin espera (otro robador puede ganar)
    }
  }
  if (!tomado) {
    throw new Error(
      `abrirTurno(${archivo}) · no se consiguió el turno de 8787 en 20 min (hay otro wrangler dev en .tmp/${LOCK.split('/').pop()})`,
    );
  }
  await limpiarHuérfanos();
  const libre = await esperarPuertoLibre(15_000);
  if (!libre) {
    throw new Error(`abrirTurno(${archivo}) · 8787 quedó ocupado tras limpiar huérfanos`);
  }
  await startServer();
  await verificarMio(archivo);
}

async function verificarMio(archivo) {
  const limite = Date.now() + 15_000;
  while (Date.now() < limite) {
    const pids = _ids8787();
    if (pids.length > 0) {
      const ajeno = pids.find((pid) => pid !== process.pid && !ancestriaIncluye(pid, process.pid));
      if (ajeno) {
        throw new Error(
          `abrirTurno(${archivo}) · el server que responde en 8787 (pid ${ajeno}) no es el que esta suite arrancó: turnos roto`,
        );
      }
      return;
    }
    await sleep(500);
  }
  throw new Error(`abrirTurno(${archivo}) · 8787 responde pero no hay listener visible (lsof), turnos roto`);
}

// ============================================================
// cerrarTurno(): matar el dev server (y el Chrome, si esta suite lo abrió)
// y recién entonces soltar el lock — el orden importa, para que el siguiente
// en la fila no arranque mientras el server de este suite está muriendo.
// ============================================================

export function cerrarTurno() {
  stopServer();
  // Solo suelto el lock si todavía me nombra este proceso: si mi lock fue robado
  // por rancio mientras este suite seguía vivo, no debo borrar el del nuevo dueño
  // (caso raro: un suite colgado que libera tarde).
  try {
    const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
    if (lock?.pid === process.pid) unlinkSync(LOCK);
  } catch {}
}
