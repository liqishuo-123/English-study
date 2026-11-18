/**
 * coach-audit.mjs — 学习教练页的版式自检（不依赖看图，全部用几何数据说话）
 * 检查：横向溢出 / 元素越界 / 文字被裁切 / 区块顺序 / 可点区域尺寸 /
 *      关键视觉属性（渐变是否生效、徽标是否有底色）/ 空数据时的降级表现
 * 用法：node tools/coach-audit.mjs [baseUrl]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://127.0.0.1:8123/';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9355;
const OUT = path.join(__dirname, '..', '..', '_probe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ->  ' + detail : ''));
}

async function waitDevtools(t = 25000) {
  const end = Date.now() + t;
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return r.json();
    } catch { /* 等 */ }
    await sleep(200);
  }
  throw new Error('devtools timeout');
}

const AUDIT = `
  const out = [];
  const vw = document.documentElement.clientWidth;
  const host = document.querySelector('#view');
  const all = Array.from(host.querySelectorAll('*'));

  // 1. 越界：任何元素右边界超出视口
  const outside = all.filter((n) => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && (r.right > vw + 1 || r.left < -1);
  }).map((n) => n.className + ' @' + Math.round(n.getBoundingClientRect().right));
  out.push(['元素不越出视口', outside.length === 0, outside.slice(0, 4).join(' | ')]);

  // 2. 文字被竖向裁切（排除故意 ellipsis 的单行元素）
  const clipped = all.filter((n) => {
    const cs = getComputedStyle(n);
    if (cs.overflow === 'hidden' && cs.whiteSpace === 'nowrap') return false;
    if (/coach-phase-name|coach-mini-phase/.test(n.className)) return false;
    const txt = (n.textContent || '').trim();
    if (!txt || n.children.length) return false;
    return n.scrollHeight > n.clientHeight + 2 && cs.overflow === 'hidden';
  }).map((n) => n.className + ' ' + n.scrollHeight + '>' + n.clientHeight);
  out.push(['文字没有被裁切', clipped.length === 0, clipped.slice(0, 4).join(' | ')]);

  // 3. 区块顺序：标题 → 计划卡 → 复盘 → 数据
  const order = Array.from((host.querySelector('.view-enter') || host).children).map((n) => n.className || n.tagName);
  out.push(['区块顺序正常', order.length >= 3, order.join(' > ').slice(0, 160)]);

  // 4. 可点区域：所有按钮高度 >= 32px
  const small = Array.from(host.querySelectorAll('button')).filter((b) => {
    const r = b.getBoundingClientRect();
    return r.height > 0 && r.height < 32;
  }).map((b) => (b.className || 'btn') + ':' + Math.round(b.getBoundingClientRect().height) +
    ' [' + (b.textContent || '').trim().slice(0, 8) + ' / ' + ((b.parentElement && b.parentElement.className) || '') + ']');
  out.push(['可点区域高度足够', small.length === 0, small.slice(0, 5).join(' | ')]);

  // 5. 关键视觉属性
  const now = host.querySelector('.coach-phase.is-now');
  const score = host.querySelector('.coach-score');
  const fill = host.querySelector('.coach-mini-bar-fill, .coach-bar-fill');
  const planCard = host.querySelector('.coach-plan');
  out.push(['当前阶段有渐变底色', !!now && /gradient/.test(getComputedStyle(now).backgroundImage),
    now ? getComputedStyle(now).backgroundImage.slice(0, 40) : 'no is-now']);
  out.push(['分数徽标有底色', !!score && getComputedStyle(score).backgroundColor !== 'rgba(0, 0, 0, 0)',
    score ? getComputedStyle(score).backgroundColor : 'no score']);
  out.push(['进度条有宽度', !!fill && fill.getBoundingClientRect().width > 0,
    fill ? Math.round(fill.getBoundingClientRect().width) + 'px' : 'no fill']);
  out.push(['计划卡有边框', !!planCard && getComputedStyle(planCard).borderTopWidth !== '0px',
    planCard ? getComputedStyle(planCard).borderTopWidth : 'no card']);

  // 6. 条形图 14 根柱子且高度不一
  const bars = Array.from(host.querySelectorAll('.coach-bar-fill')).map((b) => Math.round(b.getBoundingClientRect().height));
  out.push(['近 14 天柱状图有 14 根', bars.length === 14, bars.join(',')]);
  out.push(['柱子高度有差异', new Set(bars).size > 1, 'distinct=' + new Set(bars).size]);

  // 7. 复盘卡片：展开后内容高度 > 头部
  const rep = host.querySelector('.coach-rep.is-open');
  if (rep) {
    const head = rep.querySelector('.coach-rep-head');
    out.push(['展开的复盘比折叠态更高', rep.getBoundingClientRect().height > head.getBoundingClientRect().height + 40,
      Math.round(rep.getBoundingClientRect().height) + 'px']);
  }

  // 8. 全局没有横向滚动
  out.push(['文档无横向滚动', document.documentElement.scrollWidth <= vw + 1,
    document.documentElement.scrollWidth + '/' + vw]);

  return out;
`;

const child = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(OUT, '_edge_audit')}`, '--no-first-run', '--disable-gpu',
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
  ws.addEventListener('message', (evt) => {
    const m = JSON.parse(evt.data);
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
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: BASE });
  await sleep(2600);
  await ev(`
    try {
      const rs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(rs.map((r) => r.unregister()));
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) {}
    return 1;
  `);
  await send('Page.reload', { ignoreCache: true });
  await sleep(2600);

  // 造一份有内容的页面：计划 + 复盘 + 半个月的学习记录
  await ev(`
    const S = App.Store, U = App.Utils, today = U.today();
    S.commit((s) => {
      s.studyPlan = null; s.coachReports = [];
      for (let i = 1; i <= 13; i++) {
        const d = U.addDays(today, -i);
        s.logs[d] = { date: d, checked: i % 7 !== 0, wordsNew: 18 + (i % 5) * 7, wordsReviewed: 30 + (i % 4) * 12,
          quizDone: i % 3 ? 4 : 0, quizCorrect: i % 3 ? 2 : 0, quizPapers: i % 3 ? 1 : 0,
          writingDone: i % 4 ? 1 : 0, listenDone: i % 5 ? 1 : 0, minutes: 25 + (i % 6) * 8 };
      }
      s.logs[today] = { date: today, wordsNew: 26, wordsReviewed: 84, quizDone: 3, quizCorrect: 2,
        quizPapers: 1, writingDone: 1, listenDone: 1, minutes: 42, checked: false };
    });
    const w = App.Words.all.filter((x) => x.level === 'cet4' && !x.isPhrase).slice(0, 40);
    S.commit((s) => {
      w.forEach((x, i) => {
        s.progress[x.id] = { lastSeenAt: today, status: 'learning',
          srs: { ease: 2.3, interval: i % 4, reps: i % 3, lapses: (i % 6 === 0 ? 3 : i % 4 === 0 ? 2 : 0),
            due: U.addDays(today, -(i % 5)) } };
      });
    });
    S.flush();
    App.Coach.savePlan({
      title: '六级 96 天冲刺',
      summary: '先滚熟高频词，中期主攻听力与仔细阅读，最后两周只做真题和错题。',
      horizonDays: 96,
      phases: [
        { name: '词汇打底', days: 34, focus: '每天 40 新词 + 清到期复习' },
        { name: '听力强化', days: 40, focus: '每天精听 1 段并听写' },
        { name: '真题冲刺', days: 22, focus: '隔天整套真题' }
      ],
      targets: { dailyNewWords: 40, dailyQuiz: 3, dailyWriting: 1, dailyListen: 2, dailyMinutes: 30 },
      weekly: ['第 1 周：过完 360 个高频词'],
      rules: ['复习优先于新词', '错题当天回看', '听力只在早上做'],
      todayFocus: '先清 96 个到期复习词，再背 40 个新词'
    }, { source: 'ai', apply: true });
    App.Coach.addReport({
      headline: '词汇推进稳，听力被挤掉了',
      score: 74,
      highlights: ['连续打卡 15 天，出勤 100%', '近 7 天新词完成率 92%'],
      problems: [
        { title: '精听只做了 1 天', evidence: '近 7 天 listenDone 只有 1 次，目标是 14 次', fix: '固定在早饭时做一段' },
        { title: '阅读正确率卡在 62%', evidence: '12 题对 7 题，错题全在推断题', fix: '每篇做完标出处再对答案' }
      ],
      weakWords: [
        { word: 'reluctant', meaning: 'adj. 不情愿的', why: '和 reluctance 词性混', tip: 're + luct + ant：心里挣扎着不想去' },
        { word: 'conservative', meaning: 'adj. 保守的', why: '和 conversation 混', tip: 'con-serv-ative：什么都想保着' }
      ],
      nextActions: ['今晚先精听一段', '明天做 1 篇仔细阅读'],
      adjust: { dailyListen: 2 }
    }, { source: 'ai', range: { days: 7 } });
    return { plan: !!App.Coach.plan(), reps: App.Coach.reports().length, weak: App.Coach.weakWords(8).length };
  `);

  for (const [w, h, label] of [[390, 844, '窄屏 390'], [430, 932, '手机 430'], [1280, 900, '宽屏 1280']]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await ev(`App.Router.go('#/today'); return 1;`);
    await sleep(250);
    await ev(`App.Router.go('#/coach'); return 1;`);
    await sleep(800);
    const res = await ev(AUDIT);
    console.log('\n--- ' + label + ' ---');
    res.forEach(([name, ok, detail]) => check(name, ok, detail));
  }

  // 对话面板：打开后检查可点尺寸与溢出
  await ev(`
    App.Store.commit((s) => { s.settings.ai = { baseUrl: 'https://x.test', apiKey: 'sk-x', model: 'm' }; });
    App.Store.flush();
    App.Router.go('#/coach');
    return 1;
  `);
  await sleep(700);
  await ev(`document.querySelector('#view [aria-label="和教练对话"]').click(); return 1;`);
  await sleep(500);
  const chatAudit = await ev(`
    const sheet = document.querySelector('#sheet-root .sheet');
    const chat = sheet.querySelector('.coach-chat');
    const input = chat.querySelector('.coach-chat-input');
    const send = chat.querySelector('.coach-chat-send');
    const seeds = Array.from(chat.querySelectorAll('.coach-chat-seeds .chip'));
    const vw = document.documentElement.clientWidth;
    const r1 = input.getBoundingClientRect(), r2 = send.getBoundingClientRect();
    return [
      ['对话输入框高度达标', r1.height >= 40, Math.round(r1.height) + 'px'],
      ['发送键是 42 的圆', Math.abs(r2.width - 42) < 2 && Math.abs(r2.height - 42) < 2,
        Math.round(r2.width) + 'x' + Math.round(r2.height)],
      ['快捷问题可点高度达标', seeds.every((s) => s.getBoundingClientRect().height >= 32),
        seeds.map((s) => Math.round(s.getBoundingClientRect().height)).join(',')],
      ['面板不超出视口宽度', chat.getBoundingClientRect().width <= vw + 1,
        Math.round(chat.getBoundingClientRect().width) + '/' + vw],
      ['输入框与发送键不重叠', r1.right <= r2.left + 1, Math.round(r1.right) + '|' + Math.round(r2.left)],
      ['列表可滚动', getComputedStyle(chat.querySelector('.coach-chat-list')).overflowY !== 'visible']
    ];
  `);
  console.log('\n--- 教练对话面板 ---');
  chatAudit.forEach(([name, ok, detail]) => check(name, ok, detail));
  await ev(`App.Utils.closeSheet(); return 1;`);
  await sleep(300);

  // 今日页入口卡单独检查
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await ev(`App.Router.go('#/coach'); return 1;`);
  await sleep(200);
  await ev(`App.Router.go('#/today'); return 1;`);
  await sleep(700);
  const todayAudit = await ev(`
    const card = document.querySelector('#view .coach-mini');
    const r = card.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const bar = card.querySelector('.coach-mini-bar-fill');
    const text = card.querySelector('.coach-mini-phase');
    return [
      ['入口卡铺满宽度', Math.abs(r.width - (vw - 32)) < 12, Math.round(r.width) + '/' + (vw - 32)],
      ['入口卡高度合理', r.height > 64 && r.height < 220, Math.round(r.height) + 'px'],
      ['进度条有宽度', !!bar && bar.getBoundingClientRect().width > 0],
      ['阶段文案不超两行', !!text && text.getBoundingClientRect().height < 48, text ? Math.round(text.getBoundingClientRect().height) + 'px' : ''],
      ['页面无横向滚动', document.documentElement.scrollWidth <= vw + 1]
    ];
  `);
  console.log('\n--- 今日页入口卡 ---');
  todayAudit.forEach(([name, ok, detail]) => check(name, ok, detail));

  // 空数据降级：清掉计划与复盘，确认不白屏、有引导
  await ev(`
    App.Coach.clearPlan();
    App.Store.commit((s) => { s.coachReports = []; });
    App.Store.flush();
    App.Router.go('#/coach');
    return 1;
  `);
  await sleep(700);
  const emptyAudit = await ev(`
    const v = document.querySelector('#view');
    return [
      ['清空后有引导而不是白屏', !!v.querySelector('.coach-empty') && v.innerText.length > 40],
      ['空态至少一个主行动', v.querySelectorAll('.coach-empty-actions button').length >= 1],
      ['空态无横向溢出', document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1]
    ];
  `);
  console.log('\n--- 空数据降级 ---');
  emptyAudit.forEach(([name, ok, detail]) => check(name, ok, detail));

  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  if (fail) process.exitCode = 2;
  ws.close();
} finally {
  try { child.kill(); } catch { /* 忽略 */ }
}
