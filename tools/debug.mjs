/** debug.mjs — 在页面里执行任意表达式并打印结果（复用 probe 的 CDP 引导逻辑） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://127.0.0.1:8123/';
const EXPR = process.argv[3] || 'document.title';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9345;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(__dirname, '..', '..', '_probe');

async function waitDevtools(t = 20000) {
  const end = Date.now() + t;
  while (Date.now() < end) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return r.json(); } catch {}
    await sleep(200);
  }
  throw new Error('devtools timeout');
}

const child = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(OUT, '_edge_dbg')}`, '--no-first-run', '--disable-gpu',
  '--window-size=430,932', 'about:blank'], { stdio: 'ignore' });

try {
  await waitDevtools();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });

  let id = 0; const pending = new Map(); const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method === 'Runtime.consoleAPICalled') logs.push('[console.' + m.params.type + '] ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    else if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: BASE });
  await sleep(3000);

  const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true });
  console.log('=== RESULT ===');
  console.log(JSON.stringify(r.result?.value ?? r.exceptionDetails, null, 2));
  console.log('=== LOGS ===');
  console.log(logs.join('\n') || '(none)');
  ws.close();
} finally { try { child.kill(); } catch {} }
