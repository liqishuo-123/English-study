/**
 * ui-test.mjs — 关键交互回归（听力精听播放器 + 写作详情 + AI 助教发送）
 * 用法：node tools/ui-test.mjs [baseUrl]
 * 只依赖 CDP，不需要额外包。结果逐条打印 PASS/FAIL。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://127.0.0.1:8123/';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9349;
const OUT = path.join(__dirname, '..', '..', '_probe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}

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
  `--user-data-dir=${path.join(OUT, '_edge_ui')}`, '--no-first-run', '--disable-gpu',
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
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: BASE });
  await sleep(2600);

  // 清掉 Service Worker，保证测最新代码
  await evalJs(`(async () => {
    try {
      const rs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(rs.map((r) => r.unregister()));
      const ks = await caches.keys();
      await Promise.all(ks.map((k) => caches.delete(k)));
      return 'cleared';
    } catch (e) { return 'skip'; }
  })()`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(2600);

  /* ---------- 1. 听力精听 ---------- */
  await evalJs(`location.hash = '#/listen'; true`);
  await sleep(900);
  check('听力页显示示例材料', await evalJs(`document.querySelectorAll('#view .mat-card').length >= 3`),
    await evalJs(`String(document.querySelectorAll('#view .mat-card').length)`));

  await evalJs(`document.querySelectorAll('#view .mat-card')[0].click(); true`);
  await sleep(900);
  check('点击示例进入播放器', await evalJs(`!!document.querySelector('#view .player')`));
  check('播放器有进度文本', await evalJs(`/第 1 \\//.test(document.querySelector('#view').innerText)`),
    await evalJs(`(document.querySelector('#view .player-time')||{}).innerText || ''`));

  const before = await evalJs(`document.querySelector('#view .player-name').innerText`);
  await evalJs(`document.querySelectorAll('#view .player-side')[1].click(); true`);
  await sleep(500);
  const after = await evalJs(`document.querySelector('#view .player-name').innerText`);
  check('下一句按钮能翻页', before !== after, before + ' -> ' + after);

  await evalJs(`Array.from(document.querySelectorAll('#view .chip')).filter(b=>/听写模式/.test(b.innerText))[0].click(); true`);
  await sleep(600);
  check('切换到听写模式后出现输入框', await evalJs(`!!document.querySelector('#view textarea')`));

  const typed = await evalJs(`(async () => {
    const ta = document.querySelector('#view textarea');
    if (!ta) return 'no-textarea';
    ta.value = 'hear';
    const btn = Array.from(document.querySelectorAll('#view .btn')).find(b => /对照答案/.test(b.innerText));
    if (!btn) return 'no-button';
    btn.click();
    await new Promise(r => setTimeout(r, 200));
    const ans = document.querySelector('#view .dict-answer');
    return ans ? ans.innerText : 'no-answer';
  })()`);
  check('听写提交后给出准确率', /准确率/.test(String(typed)), String(typed));

  /* ---------- 2. 写作详情 ---------- */
  await evalJs(`location.hash = '#/writing'; true`);
  await sleep(900);
  await evalJs(`document.querySelectorAll('#view .mat-card')[0].click(); true`);
  await sleep(700);
  check('写作素材能打开详情', await evalJs(`!!document.querySelector('#modal-root .detail-body, #modal-root .mat-title')`));
  await evalJs(`(function(){ var b=document.querySelector('#modal-root .modal-close, #modal-root [aria-label="关闭"]'); if(b){b.click();} return true; })()`);
  await sleep(400);

  /* ---------- 3. 单词卡「问助教」 ---------- */
  await evalJs(`App.Store.commit(function(s){ s.settings.ai = {baseUrl:'', apiKey:'', model:''}; }); App.Store.flush(); true`);
  await evalJs(`location.hash = '#/words'; true`);
  await sleep(900);
  await evalJs(`(function(){ var c=document.querySelector('#view .word-card'); if(c) c.click(); return !!c; })()`);
  await sleep(400);
  const seeded = await evalJs(`(function(){
    var b = document.querySelector('#view .link-btn');
    if (!b) return 'no-button';
    b.click();
    return 'clicked';
  })()`);
  await sleep(700);
  const seedState = await evalJs(`(function(){
    var inp = document.querySelector('#view .ag-input');
    return { route: location.hash, value: inp ? inp.value : '' };
  })()`);
  check('单词卡有「问助教」入口', seeded === 'clicked', seeded);
  check('点问助教跳到助教页并预填问题',
    seedState.route === '#/agent' && /词根|这个/.test(seedState.value), JSON.stringify(seedState).slice(0, 160));

  /* ---------- 4. AI 助教界面 ---------- */
  await evalJs(`App.Store.commit(function(s){ s.settings.ai = {baseUrl:'https://api.deepseek.com/v1', apiKey:'sk-test', model:'deepseek-chat'}; s.agentMessages = []; }); App.Store.flush(); true`);
  await evalJs(`location.hash = '#/today'; true`);
  await sleep(500);
  await evalJs(`location.hash = '#/agent'; true`);
  await sleep(1000);
  check('已配置后隐藏配置区', await evalJs(`(function(){ var z=document.getElementById('ag-config'); return !z || z.style.display === 'none'; })()`));
  check('有输入框与发送键', await evalJs(`!!document.querySelector('#view .ag-input') && !!document.querySelector('#view .ag-send')`));
  check('欢迎卡与快捷指令', await evalJs(`document.querySelectorAll('#view .ag-quick .chip').length >= 3`));

  // 把 AI 请求替换成假的，验证一次完整对话流程（含工具事件 UI）
  const chat = await evalJs(`(async () => {
    const saved = App.AI.chat;
    let n = 0;
    App.AI.chat = async () => {
      n++;
      if (n === 1) return { ok: true, text: '', toolCalls: [{ id: 'a1', type: 'function', function: { name: 'get_status', arguments: '{}' } }] };
      return { ok: true, text: '你有 4558 个词，今天先复习到期词。' };
    };
    const ta = document.querySelector('#view .ag-input');
    ta.value = '我该学什么';
    document.querySelector('#view .ag-send').click();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 120));
      if (document.querySelectorAll('#view .ag-row').length >= 2 && !document.querySelector('#view .ag-typing')) break;
    }
    const out = {
      rows: document.querySelectorAll('#view .ag-row').length,
      tools: document.querySelectorAll('#view .ag-tool').length,
      text: (document.querySelector('#view .ag-row:last-child .ag-bubble') || {}).innerText || '',
      stored: App.Store.state.agentMessages.length
    };
    App.AI.chat = saved;
    return out;
  })()`);
  check('对话产生用户+助手两条消息', chat && chat.rows >= 2, JSON.stringify(chat));
  check('工具调用痕迹可见', chat && chat.tools >= 1);
  check('回复文本渲染到气泡', chat && /4558/.test(chat.text || ''));
  check('对话记录已落库', chat && chat.stored >= 2);

  /* ---------- 4. 今日页布局 ---------- */
  await evalJs(`location.hash = '#/today'; true`);
  await sleep(800);
  const today = await evalJs(`(function(){
    var g = document.querySelector('#view .grid-mod');
    var cols = g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : -1;
    return {
      cells: document.querySelectorAll('#view .mod-cell').length,
      cols: cols,
      tasks: document.querySelectorAll('#view .task').length,
      hOverflow: document.documentElement.scrollWidth > window.innerWidth + 2
    };
  })()`);
  check('模块宫格 6 格', today && today.cells === 6, JSON.stringify(today));
  check('今日任务含听力行', today && today.tasks >= 4, 'tasks=' + (today && today.tasks));
  check('页面无横向溢出', today && today.hOverflow === false, 'overflow=' + (today && today.hOverflow));

  /* ---------- 4.5 底部导航：AI 助教在最左 ---------- */
  await evalJs(`location.hash = '#/today'; true`);
  await sleep(600);
  const nav = await evalJs(`(function(){
    var items = [].slice.call(document.querySelectorAll('#tabbar .tab-item'));
    var bar = document.getElementById('tabbar');
    return {
      count: items.length,
      keys: items.map(function(n){ return n.dataset.key; }),
      labels: items.map(function(n){ return (n.querySelector('.tab-label')||{}).textContent; }),
      widths: items.map(function(n){ return Math.round(n.getBoundingClientRect().width); }),
      clipped: items.filter(function(n){
        var l = n.querySelector('.tab-label');
        return l && l.scrollWidth > l.clientWidth + 1;
      }).length,
      overflow: bar ? bar.scrollWidth > bar.clientWidth + 1 : true,
      accent: items.filter(function(n){ return n.classList.contains('is-accent'); }).length,
      accentColor: (function(){
        var a = items.filter(function(n){ return n.classList.contains('is-accent'); })[0];
        return a ? getComputedStyle(a).color : '';
      })(),
      plainColor: (function(){
        var p = items.filter(function(n){ return !n.classList.contains('is-accent') && !n.classList.contains('is-active'); })[0];
        return p ? getComputedStyle(p).color : '';
      })()
    };
  })()`);
  check('底部导航共 6 个 Tab', nav && nav.count === 6, JSON.stringify(nav && nav.keys));
  check('最左边是 AI 助教', nav && nav.keys[0] === 'agent', nav && nav.labels.join('/'));
  check('Tab 文字没有被裁切', nav && nav.clipped === 0, 'clipped=' + (nav && nav.clipped));
  check('导航条无横向溢出', nav && nav.overflow === false);
  check('每个 Tab 宽度足够', nav && nav.widths.every(function(w){ return w >= 52; }), nav && nav.widths.join(','));
  check('AI 助教常驻强调色', nav && nav.accent === 1 && nav.accentColor !== nav.plainColor,
    nav && nav.accentColor + ' vs ' + nav.plainColor);

  // 320px 小屏（iPhone SE / 老机型）：6 个 Tab 仍然不裁切
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  const nav320 = await evalJs(`(function(){
    var items = [].slice.call(document.querySelectorAll('#tabbar .tab-item'));
    var bar = document.getElementById('tabbar');
    return {
      clipped: items.filter(function(n){
        var l = n.querySelector('.tab-label');
        return l && l.scrollWidth > l.clientWidth + 1;
      }).length,
      overflow: bar ? bar.scrollWidth > bar.clientWidth + 1 : true,
      minW: Math.min.apply(null, items.map(function(n){ return Math.round(n.getBoundingClientRect().width); })),
      iconH: Math.round(items[0].getBoundingClientRect().height)
    };
  })()`);
  check('320px 下 Tab 文字不裁切', nav320 && nav320.clipped === 0, JSON.stringify(nav320));
  check('320px 下导航条不溢出', nav320 && nav320.overflow === false);
  check('320px 下 Tab 仍可点（高度 ≥44）', nav320 && nav320.iconH >= 44, 'h=' + (nav320 && nav320.iconH) + ' w=' + (nav320 && nav320.minW));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);

  // 点最左边 → 进助教页；助教页时该 Tab 高亮
  await evalJs(`document.querySelector('#tabbar .tab-item[data-key="agent"]').click(); true`);
  await sleep(700);
  const agentTab = await evalJs(`(function(){
    var on = document.querySelector('#tabbar .tab-item.is-active');
    return { hash: location.hash, active: on ? on.dataset.key : '' , hasView: !!document.querySelector('#view .ag-composer') };
  })()`);
  check('点最左 Tab 进入 AI 助教页', agentTab && agentTab.hash === '#/agent' && agentTab.hasView, JSON.stringify(agentTab));
  check('助教页对应 Tab 高亮', agentTab && agentTab.active === 'agent');

  // 教练页（二级）高亮归到「今日」
  await evalJs(`location.hash = '#/coach'; true`);
  await sleep(700);
  const coachTab = await evalJs(`(function(){
    var on = document.querySelector('#tabbar .tab-item.is-active');
    var back = document.querySelector('#view .page-head .icon-btn');
    return { active: on ? on.dataset.key : '', back: !!back };
  })()`);
  check('学习教练页高亮「今日」', coachTab && coachTab.active === 'today', JSON.stringify(coachTab));
  check('学习教练页有返回键', coachTab && coachTab.back === true);
  await evalJs(`location.hash = '#/today'; true`);
  await sleep(500);

  /* ---------- 5. 宽屏布局 ---------- */
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await evalJs(`location.hash = '#/today'; true`);
  await sleep(700);
  const wide = await evalJs(`(function(){
    var g = document.querySelector('#view .grid-mod');
    return {
      cols: g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : -1,
      hOverflow: document.documentElement.scrollWidth > window.innerWidth + 2
    };
  })()`);
  check('宽屏今日页 6 列宫格', wide && wide.cols === 6, JSON.stringify(wide));
  check('宽屏无横向溢出', wide && wide.hOverflow === false);

  await evalJs(`location.hash = '#/agent'; true`);
  await sleep(700);
  const wideChat = await evalJs(`(function(){
    var c = document.querySelector('#view .ag-composer');
    var w = c ? c.getBoundingClientRect().width : -1;
    return { width: Math.round(w), overflow: document.documentElement.scrollWidth > window.innerWidth + 2 };
  })()`);
  check('宽屏聊天区限宽 780', wideChat && wideChat.width > 0 && wideChat.width <= 820, JSON.stringify(wideChat));
  check('宽屏聊天页无横向溢出', wideChat && wideChat.overflow === false);

  check('本次测试无未捕获异常', errors.length === 0, errors.join(' | ').slice(0, 300));

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length ? `❌ ${failed.length} 项失败 / ${results.length}` : `✅ 全部 ${results.length} 项通过`));
  if (failed.length) process.exitCode = 2;
  ws.close();
} finally {
  try { child.kill(); } catch { /* 忽略 */ }
}
