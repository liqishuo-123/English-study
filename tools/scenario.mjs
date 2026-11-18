/**
 * scenario.mjs — 在真实页面里跑一段端到端场景，验证 Agent 的工具层与对话循环。
 * 用法：node tools/scenario.mjs [baseUrl]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://127.0.0.1:8123/';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9347;
const OUT = path.join(__dirname, '..', '..', '_probe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EXPR = `(async () => {
  const out = {};
  const A = App.Agent;
  const call = (name, args) => {
    try { const r = A.execute(name, args); return { ok: r.ok, summary: r.summary }; }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  };

  out.statusOk = A.execute('get_status', {}).ok;
  out.search = call('search_word', { q: 'abandon' });
  out.addWords = call('add_words', { words: [{ word: 'testword', meaning: '测试词', phonetic: '/test/', pos: 'n.' }] });
  out.listNew = call('list_words', { scope: 'new', limit: 3 });
  out.star = call('set_word_state', { word: 'testword', starred: true });
  out.plan = call('update_plan', { dailyNewWords: 45, dailyListen: 2 });
  out.mat = call('save_material', { title: '测试素材', content: 'This is a test material.', cat: 'pattern' });
  out.searchMat = call('search_material', { q: '测试素材' });
  out.quiz = call('add_quiz', { json: JSON.stringify({ type: 'reading', year: 2024, paper: '测试卷', title: 'Test Passage', passage: 'Hello world. This is a passage for testing.', subQuestions: [{ stem: 'Q1?', options: ['A', 'B', 'C', 'D'], answer: 'A', explanation: 'because' }] }) });

  // 模拟一次带 tool_calls 的对话（不真正联网）
  const savedChat = App.AI.chat;
  const savedEnabled = App.AI.isEnabled;
  let n = 0;
  App.AI.isEnabled = () => true;
  App.AI.chat = async () => {
    n++;
    if (n === 1) {
      return { ok: true, text: '', toolCalls: [{ id: 'x1', type: 'function', function: { name: 'update_plan', arguments: JSON.stringify({ dailyQuiz: 2 }) } }] };
    }
    return { ok: true, text: '已把每日阅读目标设为 2 篇。' };
  };
  const events = [];
  const run = await A.run({ text: '把阅读目标改成2篇', history: [], onEvent: (e) => events.push(e.type) });
  App.AI.chat = savedChat;
  App.AI.isEnabled = savedEnabled;

  out.run = { ok: run.ok, text: run.text, steps: run.steps };
  out.events = events;
  out.settings = {
    dailyNewWords: App.Store.state.settings.dailyNewWords,
    dailyQuiz: App.Store.state.settings.dailyQuiz,
    dailyListen: App.Store.state.settings.dailyListen
  };
  out.counts = {
    customWords: App.Store.state.customWords.length,
    materials: App.Store.state.materials.length,
    customQuestions: App.Store.state.customQuestions.length,
    agentMessages: App.Store.state.agentMessages.length
  };

  // 内嵌协议解析（不支持 function calling 的模型）
  out.inline = A.parseInlineCall('好的，我来看看。\\n\\u0060\\u0060\\u0060json\\n{"tool":"get_status","args":{}}\\n\\u0060\\u0060\\u0060\\n以上。');

  // 听写比对：把源码里的 diff 通过重新构造验证（listen 视图内部函数不可直接调用）
  out.hasTts = !!(App.TTS && App.TTS.supported && App.TTS.supported());

  return out;
})()`;

async function waitDevtools(t = 20000) {
  const end = Date.now() + t;
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return r.json();
    } catch { /* 继续等 */ }
    await sleep(200);
  }
  throw new Error('devtools timeout');
}

const child = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(OUT, '_edge_scn')}`, '--no-first-run', '--disable-gpu',
  '--window-size=430,932', 'about:blank'], { stdio: 'ignore' });

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
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push('[exception] ' + m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: BASE });
  await sleep(2600);

  // 开发期：摘掉 Service Worker 与旧缓存，保证测的是磁盘上的最新脚本
  await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const rs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(rs.map((r) => r.unregister()));
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        return 'cleared';
      } catch (e) { return 'skip'; }
    })()`,
    awaitPromise: true, returnByValue: true
  });
  await send('Page.reload', { ignoreCache: true });
  await sleep(2600);

  const r = await send('Runtime.evaluate', {
    expression: EXPR, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true
  });
  console.log('=== SCENARIO ===');
  console.log(JSON.stringify(r.result?.value ?? r.exceptionDetails, null, 2));
  if (logs.length) { console.log('=== LOGS ==='); console.log(logs.join('\n')); }
  ws.close();
} finally {
  try { child.kill(); } catch { /* 忽略 */ }
}
