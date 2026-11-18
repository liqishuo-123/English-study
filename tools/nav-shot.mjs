/**
 * nav-shot.mjs — 抓一张「底部导航」现状截图，用来肉眼确认 Tab 顺序与配色。
 *
 * 用法：node tools/nav-shot.mjs [baseUrl] [outFile]
 * 输出：默认 ../../_probe/nav.png（390×844 视口，3 倍密度 = 1170×2532）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://127.0.0.1:8123/';
const OUT = path.resolve(process.argv[3] || path.join(__dirname, '..', '..', '_probe', 'nav.png'));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9357;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.dirname(OUT), { recursive: true });

async function waitDevtools(t = 20000) {
  const end = Date.now() + t;
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return true;
    } catch {}
    await sleep(250);
  }
  throw new Error('DevTools 端口未就绪');
}

const userDir = path.join(__dirname, '..', '..', '_probe', '_edge_navshot');
const child = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDir}`,
  '--no-first-run',
  '--hide-scrollbars',
  'about:blank'
], { stdio: 'ignore' });

try {
  await waitDevtools();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true
  });

  // 先清掉 service worker 缓存，确保看到磁盘上的最新 nav/css
  await send('Page.navigate', { url: BASE });
  await sleep(1500);
  await send('Runtime.evaluate', {
    expression: `(async () => { try { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); await caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))); } catch(e){} return 1; })()`,
    awaitPromise: true
  });
  await send('Page.reload', { ignoreCache: true });
  await sleep(2600);

  await send('Runtime.evaluate', { expression: `location.hash = '#/today'; true` });
  await sleep(1200);

  const info = await send('Runtime.evaluate', {
    expression: `(() => {
      const items = [...document.querySelectorAll('#tabbar .tab-item')];
      return items.map(n => n.dataset.key + ':' + n.querySelector('.tab-label').textContent).join(' / ');
    })()`,
    returnByValue: true
  });

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('tabs:', info.result.value);
  console.log('out:', OUT, Math.round(fs.statSync(OUT).size / 1024) + ' KB');
  ws.close();
} finally {
  child.kill();
  await sleep(300);
}