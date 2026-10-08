import { spawn, execSync } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';

export const BASE = 'http://127.0.0.1:8787';
let server = null;
let serverUp = false;

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

export async function startServer() {
  try {
    execSync('npx wrangler d1 migrations apply hornada --local', {
      cwd: new globalThis.URL('..', import.meta.url).pathname,
      stdio: 'ignore',
      timeout: 90_000,
    });
  } catch {
    // si la migración falla, los tests fallarán caso por caso
  }
  try {
    server = spawn('npx', ['wrangler', 'dev', '--port', '8787', '--ip', '127.0.0.1'], {
      cwd: new globalThis.URL('..', import.meta.url).pathname,
      stdio: 'ignore',
      detached: true,
    });
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(1000) });
        if (res.status < 600) {
          serverUp = true;
          return;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch {}
}

export function serverReady() {
  return serverUp;
}

export function stopServer() {
  if (server) {
    try {
      process.kill(-server.pid);
    } catch {}
  }
}

export function d1(sql) {
  const out = execSync(
    `npx wrangler d1 execute hornada --local --json --command ${JSON.stringify(sql)}`,
    {
      cwd: new globalThis.URL('..', import.meta.url).pathname,
      encoding: 'utf8',
      timeout: 90_000,
    },
  );
  const parsed = JSON.parse(out);
  return parsed?.[0]?.results ?? [];
}

export async function api(path, opts = {}) {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(10_000),
  });
}

export async function apiJson(path, opts = {}) {
  const res = await api(path, opts);
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { res, body };
}

// ---- Chrome headless + CDP para el DOM real (C-01) ----
let chrome = null;
let cdpPort = null;
let wsSeq = 1;

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.handlers = new Map();
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

  send(method, params = {}) {
    const id = wsSeq++;
    const payload = JSON.stringify({ id, method, params });
    const p = new Promise((resolve, reject) => {
      this.handlers.set(id, { resolve, reject });
    });
    this.ws.send(payload);
    return p;
  }
}

Cdp.prototype.events = new Map();

export async function withBrowser(url, fn) {
  assert.ok(serverReady(), 'el dev server wrangler debe estar corriendo para leer el DOM real');
  if (!chrome) {
    cdpPort = await freePort();
    constuserData = new globalThis.URL('../.tmp/chrome-profile', import.meta.url).pathname;
    chrome = spawn(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      [
        '--headless',
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${userData}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ],
      { stdio: 'ignore', detached: true },
    );
    for (let i = 0; i < 40; i++) {
      try {
        const v = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(1000) });
        if (v.ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const created = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${new URLSearchParams({ url })}`, {
    method: 'PUT',
  }).then((r) => r.json());

  const ws = new WebSocket(created.webSocketDebuggerUrl);
  await once(ws, 'open');
  const cdp = new Cdp(ws);
  cdp.send('Page.enable');
  const loaded = new Promise((resolve) => cdp.events.set('Page.loadEventFired', resolve));
  try {
    await cdp.send('Page.navigate', { url });
    await Promise.race([loaded, new Promise((r) => setTimeout(r, 8000))]);
    await new Promise((r) => setTimeout(r, 500));
    return await fn({
      async evaluate(expression) {
        const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
        if (r.exceptionDetails) {
          throw new Error('Runtime.evaluate falló: ' + JSON.stringify(r.exceptionDetails));
        }
        return r.result.value;
      },
    });
  } finally {
    try {
      cdp.send('Target.closeTarget', { targetId: created.id });
      ws.close();
    } catch {}
  }
}
