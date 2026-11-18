/**
 * probe.mjs — 用 Edge 无头浏览器 + CDP 打开页面，收集控制台错误并截图
 *
 * 用法：
 *   node tools/probe.mjs [baseUrl] [outDir]
 *
 * 依赖：Node 22+（内置全局 WebSocket），Edge 浏览器。无需 npm install。
 * 输出：outDir 下的 PNG 截图 + 打印 JSON 报告（含 JS 异常、console.error、关键 DOM 断言）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BASE = process.argv[2] || 'http://127.0.0.1:8123/';
const OUT = path.resolve(process.argv[3] || path.join(ROOT, '..', '_probe'));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333 + (Number(process.env.PROBE_PORT_OFFSET) || 0);

const ROUTES = [
  ['today', '#/today'],
  ['words', '#/words'],
  ['quiz', '#/quiz'],
  ['writing', '#/writing'],
  ['wrongbook', '#/wrongbook'],
  ['listen', '#/listen'],
  ['coach', '#/coach'],
  ['agent', '#/agent'],
  ['me', '#/me']
];

fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error('DevTools 端口未就绪');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }
  async evalJs(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (r.exceptionDetails) {
      return { error: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
    }
    return { value: r.result?.value };
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return r.data.length;
  }
}

async function main() {
  const userDataDir = path.join(OUT, '_edgeprofile');
  fs.rmSync(userDataDir, { recursive: true, force: true });

  const child = spawn(
    EDGE,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
      '--hide-scrollbars',
      '--window-size=430,932',
      '--force-device-scale-factor=1',
      'about:blank'
    ],
    { stdio: 'ignore', detached: false }
  );

  const report = { base: BASE, routes: {}, errors: [], screenshots: [] };

  try {
    await waitForDevtools();
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('没有可用的 page target');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const cdp = new Cdp(ws);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 430, height: 932, deviceScaleFactor: 1, mobile: true
    });

    // ---- 首屏 ----
    await cdp.send('Page.navigate', { url: BASE });
    await sleep(2500);

    // 开发期：先摘掉 Service Worker 和旧缓存，避免测到上一版脚本
    await cdp.evalJs(`(async () => {
      try {
        const rs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(rs.map((r) => r.unregister()));
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        return 'cleared';
      } catch (e) { return 'skip'; }
    })()`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await sleep(2500);

    const boot = await cdp.evalJs(`(() => ({
      hasApp: typeof window.App === 'object',
      modules: Object.keys(window.App || {}).sort(),
      views: Object.keys((window.App && window.App.Views) || {}).sort(),
      words: (window.App && window.App.Words && window.App.Words.all) ? window.App.Words.all.length : -1,
      phrases: (window.App && window.App.Words && window.App.Words.all) ? window.App.Words.all.filter(w=>w.isPhrase).length : -1,
      quizzes: (window.App && window.App.Quizzes) ? (window.App.Quizzes.all||[]).length : -1,
      writingCount: (window.App && window.App.Writing) ? (window.App.Writing.all||[]).length : (window.App && window.App.WRITING_BUILTIN ? window.App.WRITING_BUILTIN.length : -1),
      html: document.documentElement.outerHTML.length,
      viewChildren: document.querySelector('#view') ? document.querySelector('#view').children.length : -1,
      tabs: document.querySelectorAll('#tabbar .tab-item').length,
      bodyText: document.body.innerText.slice(0, 300)
    }))()`);
    report.boot = boot;

    // ---- 逐个路由 ----
    for (const [name, hash] of ROUTES) {
      const before = cdp.events.length;
      await cdp.evalJs(`location.hash = ${JSON.stringify(hash)}; true`);
      await sleep(1100);
      const info = await cdp.evalJs(`(() => {
        const v = document.querySelector('#view');
        const txt = v ? v.innerText : '';
        return {
          len: v ? v.children.length : -1,
          textLen: txt.length,
          head: txt.slice(0, 240).replace(/\\n+/g, ' | '),
          empty: !!document.querySelector('.empty-title'),
          route: location.hash
        };
      })()`);
      const file = path.join(OUT, `${name}.png`);
      await cdp.shot(file);
      report.screenshots.push(file);
      report.routes[name] = { ...info.value, ...(info.error ? { error: info.error } : {}) };

      // 该路由期间新产生的 console 错误 / 异常
      const newEvents = cdp.events.slice(before);
      for (const e of newEvents) {
        if (e.method === 'Runtime.exceptionThrown') {
          const d = e.params.exceptionDetails;
          report.errors.push({ route: name, type: 'exception', text: d.text + ' ' + (d.exception?.description || ''), url: d.url, line: d.lineNumber });
        }
        if (e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'warning')) {
          report.errors.push({ route: name, type: 'console.' + e.params.type, text: e.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
        }
        if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
          report.errors.push({ route: name, type: 'log', text: e.params.entry.text, url: e.params.entry.url });
        }
      }
    }

    ws.close();
  } finally {
    try { child.kill(); } catch {}
  }

  const outFile = path.join(OUT, 'report.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ boot: report.boot, routes: report.routes, errorCount: report.errors.length, errors: report.errors.slice(0, 25) }, null, 2));
}

main().catch((e) => {
  console.error('PROBE FAILED:', e.message);
  process.exit(1);
});
