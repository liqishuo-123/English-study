/**
 * poster-shot.mjs — 把 poster.html 渲染成 A3 @300dpi 的海报 PNG
 *
 * 用法：
 *   node tools/poster-shot.mjs [htmlPath] [outPng]
 *
 * A3 竖版 297×420mm，300dpi 对应 3508×4961 px。
 * 做法：Edge 无头 + CDP，视口直接设成 3508×4961（deviceScaleFactor=1），
 * 截图前先做一轮几何自检（是否溢出、区块是否重叠），有问题会在报告里指出。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const HTML = path.resolve(process.argv[2] || 'E:\\deepseek\\_poster\\poster.html');
const OUT = path.resolve(process.argv[3] || 'E:\\deepseek\\_poster\\poster-a3-300dpi.png');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9361;

const W = 3508;
const H = 4961;
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
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
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
      }, 60000);
    });
  }
  async evalJs(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  }
}

/** 海报几何自检：溢出、区块顺序、文字换行是否合理 */
const AUDIT = `(() => {
  const out = { overflow: [], sections: {}, images: [], issues: [] };
  const doc = document.documentElement;
  out.doc = { scrollW: doc.scrollWidth, scrollH: doc.scrollHeight, clientW: doc.clientWidth, clientH: doc.clientHeight };

  const keys = ['.head', '.hero', '.phones', '.caps', '.feats', '.stats', '.foot'];
  keys.forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) { out.issues.push('缺少区块 ' + sel); return; }
    const r = el.getBoundingClientRect();
    out.sections[sel] = { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) };
  });

  document.querySelectorAll('.feat, .stat, .foot, .phone, .lede, h1, .cap').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.right > ${W + 1} || r.left < -1 || r.bottom > ${H + 1}) {
      out.overflow.push({ cls: el.className || el.tagName, right: Math.round(r.right), bottom: Math.round(r.bottom) });
    }
    if (el.scrollWidth > el.clientWidth + 2 && el.tagName !== 'BODY') {
      out.issues.push('横向溢出: ' + (el.className || el.tagName) + ' ' + el.scrollWidth + '>' + el.clientWidth);
    }
  });

  ['shots/words.png', 'shots/today.png', 'shots/agent.png', 'qr.png'].forEach((src) => {
    const img = Array.from(document.images).find((i) => i.src.endsWith(src));
    out.images.push({ src, found: !!img, complete: img ? img.complete : false,
      natural: img ? [img.naturalWidth, img.naturalHeight] : null });
  });

  // 内容是否被父级挤压/裁切（flex 收缩时 scrollHeight 会大于 clientHeight）
  ['.feat', '.foot', '.hero', '.lede', '.cap', '.stat'].forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 2) {
        out.issues.push('纵向被裁切: ' + sel + ' ' + el.scrollHeight + '>' + el.clientHeight);
      }
    });
  });

  // 区块顺序检查
  const order = keys.map((k) => out.sections[k]).filter(Boolean);
  for (let i = 1; i < order.length; i++) {
    if (order[i].top < order[i - 1].bottom - 4) out.issues.push('区块重叠: ' + keys[i]);
  }
  const last = order[order.length - 1];
  if (last && last.bottom > ${H}) out.issues.push('页脚被裁切: bottom=' + last.bottom);
  if (doc.scrollHeight > ${H} + 2) out.issues.push('内容超出画布: scrollH=' + doc.scrollHeight);
  return out;
})()`;

async function main() {
  const userDataDir = path.join(path.dirname(OUT), '_edge_poster');
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
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      '--force-device-scale-factor=1',
      `--window-size=${W},${H}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  let audit = null;
  try {
    await waitForDevtools();
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const cdp = new Cdp(ws);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: W, height: H, deviceScaleFactor: 1, mobile: false
    });

    const url = 'file:///' + HTML.replace(/\\/g, '/');
    await cdp.send('Page.navigate', { url });
    await sleep(2200);

    await cdp.evalJs(`(async () => {
      if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
      await Promise.all(Array.from(document.images).map((i) => (i.complete ? 1 : new Promise((r) => {
        i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true });
      }))));
      window.scrollTo(0, 0);
      return document.images.length;
    })()`);
    await sleep(500);

    audit = await cdp.evalJs(AUDIT);

    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: W, height: H, scale: 1 }
    });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    ws.close();
  } finally {
    try { child.kill(); } catch {}
  }

  const st = fs.statSync(OUT);
  console.log(JSON.stringify({ out: OUT, bytes: st.size, audit }, null, 2));
  if (audit && audit.issues.length) process.exitCode = 2;
}

main().catch((e) => {
  console.error('POSTER FAILED:', e.message);
  process.exit(1);
});
