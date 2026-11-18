/**
 * coach-test.mjs — 学习教练的端到端回归（CDP + 无头 Edge）
 * 覆盖：教练页空态 → 本地模板生成计划 → 计划卡渲染 → 数据版复盘 →
 *      Agent 工具（get_stats / get_plan / save_plan / save_report）→
 *      AI 路径（stub App.AI.chat：正常 JSON / 非 JSON / 没配密钥 / 目标写回）→
 *      今日页入口卡 → 我的页入口 → 窄屏与宽屏布局 → 无未捕获异常
 * 用法：node tools/coach-test.mjs [baseUrl]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://127.0.0.1:8123/';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9353;
const OUT = path.join(__dirname, '..', '..', '_probe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail !== undefined && detail !== '' ? '  ->  ' + detail : ''));
}

async function waitDevtools(t = 25000) {
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
  `--user-data-dir=${path.join(OUT, '_edge_coach')}`, '--no-first-run', '--disable-gpu',
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
  ws.addEventListener('message', (evt) => {
    const m = JSON.parse(evt.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      returnByValue: true, awaitPromise: true, includeCommandLineAPI: true
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: BASE });
  await sleep(2800);

  // 清掉 Service Worker 与旧缓存，保证测的是磁盘上的最新脚本
  await ev(`
    try {
      const rs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(rs.map((r) => r.unregister()));
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      return 'cleared';
    } catch (e) { return 'skip'; }
  `);
  await send('Page.reload', { ignoreCache: true });
  await sleep(2800);

  // 从干净状态开始
  await ev(`
    App.Store.commit((s) => {
      s.studyPlan = null;
      s.coachReports = [];
      s.agentMessages = [];
      s.settings.coach = { targetScore: 500, daysPerWeek: 6, weak: ['听力'], auto: true, every: 3 };
      s.settings.ai = { baseUrl: '', apiKey: '', model: '' };
      s.settings.dailyNewWords = 30;
      s.settings.dailyQuiz = 1;
      s.settings.dailyWriting = 1;
      s.settings.dailyListen = 1;
      s.settings.dailyMinutes = 60;
    });
    App.Store.flush();
    return 'reset';
  `);

  /* ---------- 1. 模块与工具是否挂上 ---------- */
  const boot = await ev(`
    return {
      coach: typeof App.Coach === 'object',
      keys: App.Coach ? Object.keys(App.Coach).length : 0,
      view: typeof App.Views.coach === 'function',
      tools: Object.keys(App.Agent.tools)
    };
  `);
  check('App.Coach 已挂载', boot.coach && boot.keys >= 20, boot.keys + ' 个导出');
  check('App.Views.coach 已注册', boot.view);
  check('Agent 新增 4 个教练工具',
    ['get_stats', 'get_plan', 'save_plan', 'save_report'].every((n) => boot.tools.indexOf(n) >= 0),
    boot.tools.join(','));

  /* ---------- 2. 教练页空态 ---------- */
  await ev(`App.Router.go('#/coach'); return 1;`);
  await sleep(650);
  const empty = await ev(`
    const v = document.querySelector('#view');
    return {
      hash: location.hash,
      emptyPlan: !!v.querySelector('.coach-empty'),
      aiHint: !!v.querySelector('.coach-ai-hint'),
      text: v.innerText.replace(/\\s+/g, ' ').slice(0, 100)
    };
  `);
  check('教练页可打开', empty.hash === '#/coach', empty.hash);
  check('未配 AI 时出现提示条', empty.aiHint);
  check('无计划时显示空态', empty.emptyPlan, empty.text);

  /* ---------- 3. 本地模板生成计划 ---------- */
  const localPlan = await ev(`
    App.Coach.makeLocalPlan({});
    const p = App.Coach.plan();
    return {
      title: p ? p.title : '',
      phases: p ? p.phases.length : 0,
      horizon: p ? p.horizonDays : 0,
      targets: p ? p.targets : null,
      settings: { nw: App.Store.state.settings.dailyNewWords, min: App.Store.state.settings.dailyMinutes }
    };
  `);
  check('本地模板能生成计划', !!localPlan.title && localPlan.phases >= 2,
    localPlan.title + ' / ' + localPlan.phases + ' 阶段 / ' + localPlan.horizon + ' 天');
  check('计划把目标写进每日目标', localPlan.settings.nw === localPlan.targets.dailyNewWords,
    '新词 ' + localPlan.settings.nw + '，分钟 ' + localPlan.settings.min);

  await ev(`App.Router.go('#/today'); return 1;`);
  await sleep(300);
  await ev(`App.Router.go('#/coach'); return 1;`);
  await sleep(650);
  const planDom = await ev(`
    const v = document.querySelector('#view');
    return {
      plan: !!v.querySelector('.coach-plan'),
      phases: v.querySelectorAll('.coach-phase').length,
      now: v.querySelectorAll('.coach-phase.is-now').length,
      goals: v.querySelectorAll('.coach-goal').length,
      focus: (v.querySelector('.coach-focus-text') || {}).textContent || '',
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  `);
  check('计划卡渲染出阶段条', planDom.plan && planDom.phases >= 2 && planDom.now === 1,
    planDom.phases + ' 段，高亮 ' + planDom.now);
  check('每日目标 chips 有 5 个', planDom.goals === 5, planDom.goals);
  check('显示当前阶段今日重点', !!planDom.focus, planDom.focus.slice(0, 40));
  check('教练页窄屏无横向溢出', planDom.overflowX <= 1, 'overflow=' + planDom.overflowX + 'px');

  /* ---------- 4. 本地数据版复盘 ---------- */
  const localRep = await ev(`
    App.Coach.makeLocalReport(7);
    const list = App.Coach.reports();
    const r = list[0] || {};
    return {
      count: list.length,
      headline: r.headline || '',
      score: r.score,
      problems: r.problems ? r.problems.length : 0,
      due: App.Coach.dueReport().due
    };
  `);
  check('本地能生成复盘', !!localRep.headline && localRep.count === 1,
    localRep.headline + '（' + localRep.score + ' 分，' + localRep.problems + ' 个问题）');
  check('刚复盘完不再催复盘', localRep.due === false);

  await ev(`App.Router.go('#/today'); return 1;`);
  await sleep(300);
  await ev(`App.Router.go('#/coach'); return 1;`);
  await sleep(650);
  const repDom = await ev(`
    const reps = document.querySelectorAll('#view .coach-rep');
    const first = reps[0];
    return {
      reps: reps.length,
      opened: first ? first.classList.contains('is-open') : false,
      sections: first ? first.querySelectorAll('.coach-sec').length : 0,
      score: first ? (first.querySelector('.coach-score') || {}).textContent || '' : ''
    };
  `);
  check('复盘时间线渲染', repDom.reps >= 1, repDom.reps + ' 条');
  check('最新一条默认展开', repDom.opened);
  check('复盘分区齐全', repDom.sections >= 2, repDom.sections + ' 个分区');
  check('复盘分数显示在徽标里', !!repDom.score, repDom.score);

  /* ---------- 5. Agent 工具链路 ---------- */
  const tools = await ev(`
    const out = {};
    out.stats = App.Agent.execute('get_stats', { days: 7 });
    out.plan = App.Agent.execute('get_plan', {});
    out.save = App.Agent.execute('save_plan', {
      json: '{"title":"AI 定制计划","summary":"先补词汇再练听力","horizonDays":30,' +
        '"phases":[{"name":"打底","days":12,"focus":"每天新词 40"},{"name":"强化","days":18,"focus":"听力精听"}],' +
        '"targets":{"dailyNewWords":40,"dailyQuiz":1,"dailyWriting":2,"dailyListen":2,"dailyMinutes":75},' +
        '"weekly":["第 1 周：适应节奏"],"rules":["单词必须在遗忘当天复习"],"todayFocus":"先背 40 个新词",}'
    });
    out.rep = App.Agent.execute('save_report', {
      json: '{"headline":"听力是短板","score":66,"highlights":["出勤稳定"],' +
        '"problems":[{"title":"精听太少","evidence":"近 7 天只做 1 段","fix":"每天 1 段"}],' +
        '"weakWords":[{"word":"abandon","meaning":"v. 放弃","why":"拼写漏字母","tip":"a+band+on"}],' +
        '"nextActions":["今天先精听一段"],"adjust":{"dailyListen":2}}',
      days: 7
    });
    out.after = {
      title: App.Coach.plan().title,
      applied: App.Store.state.settings.dailyNewWords,
      reports: App.Coach.reports().length
    };
    return out;
  `);
  check('get_stats 返回真实数据', tools.stats.ok && typeof tools.stats.data.words.total === 'number',
    tools.stats.summary);
  check('get_plan 能读到计划', tools.plan.ok, tools.plan.summary);
  check('save_plan 落库（容忍尾逗号）', tools.save.ok && tools.after.title === 'AI 定制计划', tools.save.summary);
  check('save_plan 同步每日目标', tools.after.applied === 40, 'dailyNewWords=' + tools.after.applied);
  check('save_report 落库', tools.rep.ok && tools.after.reports === 2, tools.rep.summary);

  await ev(`App.Router.go('#/today'); return 1;`);
  await sleep(300);
  await ev(`App.Router.go('#/coach'); return 1;`);
  await sleep(650);
  const aiRepDom = await ev(`
    const first = document.querySelector('#view .coach-rep');
    return {
      weaks: first ? first.querySelectorAll('.coach-w-item').length : 0,
      foot: first ? first.querySelectorAll('.coach-rep-foot .link-btn').length : 0,
      opened: first ? first.classList.contains('is-open') : false
    };
  `);
  check('AI 复盘的易错词正常渲染', aiRepDom.weaks >= 1, aiRepDom.weaks + ' 条');
  check('复盘底栏有「找助教细聊 / 删除」', aiRepDom.foot >= 2, aiRepDom.foot + ' 个');

  /* ---------- 6. 真·AI 路径（stub 掉 App.AI.chat，不联网） ---------- */
  const aiPath = await ev(`
    const out = {};
    out.noKey = await App.Coach.generatePlan({});

    const savedChat = App.AI.chat;
    const savedEnabled = App.AI.isEnabled;
    App.AI.isEnabled = () => true;
    App.Store.commit((s) => { s.settings.ai = { baseUrl: 'https://api.example.com', apiKey: 'sk-test', model: 'test-model' }; });
    const F = String.fromCharCode(96, 96, 96);

    App.AI.chat = async () => ({
      ok: true,
      text: F + 'json' + String.fromCharCode(10) + JSON.stringify({
        title: 'AI 冲刺计划', summary: '词汇优先，听力每天不断', horizonDays: 21,
        phases: [
          { name: '突击词汇', days: 9, focus: '每天 50 词，只求认得' },
          { name: '听力强化', days: 12, focus: '每天精听一段并听写' }
        ],
        targets: { dailyNewWords: 50, dailyQuiz: 2, dailyWriting: 1, dailyListen: 1, dailyMinutes: 80 },
        weekly: ['第 1 周：把高频词过一遍'],
        rules: ['复习优先于新词', '错题当天回看'],
        todayFocus: '先清复习，再背 50 个新词'
      }) + ',' + String.fromCharCode(10) + F
    });
    out.plan = await App.Coach.generatePlan({});
    out.planNow = App.Coach.plan() ? { title: App.Coach.plan().title, nw: App.Store.state.settings.dailyNewWords } : null;

    App.AI.chat = async () => ({ ok: true, text: '抱歉，我暂时没法给出计划。' });
    out.bad = await App.Coach.generatePlan({});
    out.stillOld = App.Coach.plan() ? App.Coach.plan().title : '';

    App.AI.chat = async () => ({
      ok: true,
      text: JSON.stringify({
        headline: '词汇在涨，听力拖后腿', score: 72,
        highlights: ['新词完成率 92%'],
        problems: [{ title: '精听断档', evidence: '近 7 天只有 1 天做了精听', fix: '每天固定 15 分钟' }],
        weakWords: [
          { word: 'abandon', meaning: 'v. 放弃', why: '和 abundant 混', tip: 'a-band-on：把乐队丢下' },
          { word: 'reluctant', meaning: 'adj. 不情愿的', why: '拼写常错', tip: 're + luct + ant' }
        ],
        nextActions: ['今晚先精听一段'],
        adjust: { dailyListen: 2, dailyNewWords: 45 }
      })
    });
    out.rep = await App.Coach.generateReport({ days: 7, applyAdjust: true });
    const top = App.Coach.reports()[0];
    out.repNow = top ? { headline: top.headline, weaks: top.weakWords.length, source: top.source } : null;
    out.afterAdjust = { listen: App.Store.state.settings.dailyListen, nw: App.Store.state.settings.dailyNewWords };

    App.AI.chat = savedChat;
    App.AI.isEnabled = savedEnabled;
    return out;
  `);
  check('没配密钥时生成计划报 no-key', aiPath.noKey.ok === false && aiPath.noKey.code === 'no-key', aiPath.noKey.code);
  check('AI 计划能解析并落库（含围栏与尾逗号）',
    aiPath.plan.ok && aiPath.planNow && aiPath.planNow.title === 'AI 冲刺计划',
    aiPath.planNow ? aiPath.planNow.title : '');
  check('AI 计划的目标写进设置', aiPath.planNow && aiPath.planNow.nw === 50, 'dailyNewWords=' + (aiPath.planNow || {}).nw);
  check('模型返回非 JSON 时报 parse 且不覆盖旧计划',
    aiPath.bad.ok === false && aiPath.bad.code === 'parse' && aiPath.stillOld === 'AI 冲刺计划',
    aiPath.bad.code + ' / 仍是「' + aiPath.stillOld + '」');
  check('AI 复盘能解析并落库', aiPath.rep.ok && aiPath.repNow && aiPath.repNow.weaks === 2,
    aiPath.repNow ? aiPath.repNow.headline + '（' + aiPath.repNow.weaks + ' 个易错词）' : '');
  check('复盘建议会写回每日目标', aiPath.afterAdjust.listen === 2 && aiPath.afterAdjust.nw === 45,
    '听力 ' + aiPath.afterAdjust.listen + ' 段 / 新词 ' + aiPath.afterAdjust.nw);

  /* ---------- 6.5 教练对话面板 ---------- */
  await ev(`
    App.Store.commit((s) => { s.settings.ai = { baseUrl: 'https://api.example.com', apiKey: 'sk-test', model: 'test-model' }; });
    window.__savedEnabled = App.AI.isEnabled;
    App.AI.isEnabled = () => true;
    App.Router.go('#/coach');
    return 1;
  `);
  await sleep(650);
  await ev(`document.querySelector('#view [aria-label="和教练对话"]').click(); return 1;`);
  await sleep(500);
  const chatOpen = await ev(`
    const sheet = document.querySelector('#sheet-root .sheet');
    const chat = sheet ? sheet.querySelector('.coach-chat') : null;
    return {
      open: !!chat,
      msgs: chat ? chat.querySelectorAll('.coach-msg').length : 0,
      seeds: chat ? chat.querySelectorAll('.coach-chat-seeds .chip').length : 0,
      input: !!chat && !!chat.querySelector('.coach-chat-input'),
      send: !!chat && !!chat.querySelector('.coach-chat-send')
    };
  `);
  check('教练对话面板能打开', chatOpen.open && chatOpen.input && chatOpen.send);
  check('面板有开场白与快捷问题', chatOpen.msgs >= 1 && chatOpen.seeds === 3,
    chatOpen.msgs + ' 条消息 / ' + chatOpen.seeds + ' 个快捷项');

  // 发一条，模型返回带 save_report 工具调用
  const chatRun = await ev(`
    const savedChat = App.AI.chat;
    let n = 0;
    App.AI.chat = async () => {
      n++;
      if (n === 1) {
        return { ok: true, text: '', toolCalls: [{ id: 't1', type: 'function',
          function: { name: 'save_report', arguments: JSON.stringify({
            json: JSON.stringify({
              headline: '对话里生成的复盘', score: 80, highlights: ['出勤好'],
              problems: [{ title: '词汇量不足', evidence: '近 14 天新学 120 词', fix: '每天加 10 个' }],
              weakWords: [], nextActions: ['明天加 10 个新词'], adjust: {}
            }),
            days: 14
          }) } }] };
      }
      return { ok: true, text: '已经把这份复盘存进时间线了，**明天再加 10 个新词**就行。' };
    };
    const input = document.querySelector('.coach-chat-input');
    input.value = '帮我复盘一下最近两周';
    document.querySelector('.coach-chat-send').click();
    await new Promise((r) => setTimeout(r, 1800));
    App.AI.chat = savedChat;
    if (window.__savedEnabled) { App.AI.isEnabled = window.__savedEnabled; delete window.__savedEnabled; }
    const chat = document.querySelector('.coach-chat');
    const me = chat.querySelectorAll('.coach-msg.is-me').length;
    const bots = chat.querySelectorAll('.coach-msg:not(.is-me)').length;
    const tools = chat.querySelectorAll('.coach-tool').length;
    const strong = chat.querySelectorAll('.coach-msg-body strong').length;
    return {
      me, bots, tools, strong,
      reports: App.Coach.reports().length,
      headline: App.Coach.reports()[0] ? App.Coach.reports()[0].headline : ''
    };
  `);
  check('对话里能发消息并拿到回复', chatRun.me >= 1 && chatRun.bots >= 2,
    chatRun.me + ' 条我的 / ' + chatRun.bots + ' 条教练的');
  check('工具调用痕迹可见', chatRun.tools >= 1, chatRun.tools + ' 个工具徽标');
  check('回复里的粗体被渲染', chatRun.strong >= 1, chatRun.strong + ' 处');
  check('对话中确实写入了复盘', chatRun.headline === '对话里生成的复盘', chatRun.headline);

  await ev(`App.Utils.closeSheet(); App.Router.go('#/today'); return 1;`);
  await sleep(400);

  /* ---------- 7. 今日页入口卡 ---------- */
  await ev(`App.Router.go('#/today'); return 1;`);
  await sleep(700);
  const todayDom = await ev(`
    const v = document.querySelector('#view');
    const card = v.querySelector('.coach-mini');
    const host = v.querySelector('.view-enter') || v;
    return {
      has: !!card,
      empty: card ? card.classList.contains('is-empty') : null,
      title: (card || {}).innerText || '',
      bars: v.querySelectorAll('.coach-mini-bar-fill').length,
      order: Array.from(host.children).map((n) => n.className).join('|'),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  `);
  check('今日页有教练入口卡', todayDom.has && todayDom.empty === false,
    (todayDom.title || '').replace(/\\s+/g, ' ').slice(0, 46));
  check('入口卡显示计划进度条', todayDom.bars === 1);
  check('入口卡排在进度环与任务卡之间', /ring-wrap.*coach-mini.*\\|card\\|/.test(todayDom.order) ||
    /ring-wrap.*card coach-mini.*\\|card/.test(todayDom.order), todayDom.order);
  check('今日页无横向溢出', todayDom.overflowX <= 1, 'overflow=' + todayDom.overflowX + 'px');

  /* ---------- 8. 我的页入口 ---------- */
  await ev(`App.Router.go('#/me'); return 1;`);
  await sleep(650);
  const meDom = await ev(`
    const rows = Array.from(document.querySelectorAll('#view .set-row'))
      .map((r) => r.innerText.replace(/\\s+/g, ' ').trim());
    return { hit: rows.filter((t) => t.indexOf('学习教练') === 0)[0] || '', count: rows.length };
  `);
  check('我的页有「学习教练」入口', !!meDom.hit, meDom.hit.slice(0, 60));

  /* ---------- 9. 宽屏约束 ---------- */
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await ev(`App.Router.go('#/coach'); return 1;`);
  await sleep(650);
  const wide = await ev(`
    const v = document.querySelector('#view');
    const plan = v.querySelector('.coach-plan');
    const rep = v.querySelector('.coach-rep');
    return {
      planW: plan ? Math.round(plan.getBoundingClientRect().width) : 0,
      repW: rep ? Math.round(rep.getBoundingClientRect().width) : 0,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  `);
  check('宽屏计划卡限制在 780 内', wide.planW > 0 && wide.planW <= 782, wide.planW + 'px');
  check('宽屏复盘卡限制在 780 内', wide.repW > 0 && wide.repW <= 782, wide.repW + 'px');
  check('宽屏无横向溢出', wide.overflowX <= 1, 'overflow=' + wide.overflowX + 'px');
  await send('Emulation.clearDeviceMetricsOverride');

  /* ---------- 9.5 每日首次打开的复盘提醒 ---------- */
  const nudgeSetup = await ev(`
    App.Utils.closeSheet();
    App.Store.commit((s) => {
      s.coachReports = [];
      s.settings.ai = { baseUrl: '', apiKey: '', model: '' };
      s.settings.coach.noticeAt = '';
      s.settings.coach.auto = true;
      s.settings.coach.every = 3;
    });
    App.Coach.savePlan({
      title: '测试计划', summary: '测提醒', horizonDays: 30,
      phases: [{ name: '打底', days: 30, focus: '背词' }],
      targets: { dailyNewWords: 30, dailyQuiz: 1, dailyWriting: 1, dailyListen: 1, dailyMinutes: 60 },
      rules: [], todayFocus: '先复习'
    }, { apply: false });
    App.Store.commit((s) => { s.studyPlan.startDate = App.Utils.addDays(App.Utils.today(), -4); });
    App.Store.flush();
    App.Router.go('#/today');
    await new Promise((r) => setTimeout(r, 400));
    return { notice: App.Coach.notice(), day: (App.Coach.planProgress() || {}).day };
  `);
  check('该复盘时 notice() 给出提醒', !!nudgeSetup.notice && nudgeSetup.notice.never === true,
    nudgeSetup.notice ? '计划第 ' + nudgeSetup.day + ' 天、从未复盘' : 'null');

  const nudgeUi = await ev(`
    const r = App.CoachNudge();
    const sheet = document.querySelector('#sheet-root .sheet');
    return {
      shown: !!r,
      title: sheet ? (sheet.querySelector('.sheet-title') || {}).textContent : '',
      hasDue: sheet ? !!sheet.querySelector('.coach-due') : false,
      rules: sheet ? sheet.querySelectorAll('.coach-rule').length : 0,
      btns: sheet ? Array.from(sheet.querySelectorAll('.sheet-foot button')).map((b) => b.textContent.trim()) : []
    };
  `);
  check('浮层能弹出来', nudgeUi.shown && nudgeUi.hasDue, '标题「' + nudgeUi.title + '」');
  check('浮层说明会看什么', nudgeUi.rules === 3, nudgeUi.rules + ' 条');
  check('浮层有「今天先不」和生成按钮',
    nudgeUi.btns.length === 2 && /先不/.test(nudgeUi.btns.join('|')), nudgeUi.btns.join(' / '));

  const dismissed = await ev(`
    const btns = Array.from(document.querySelectorAll('#sheet-root .sheet-foot button'));
    btns[0].click();
    await new Promise((r) => setTimeout(r, 400));
    return {
      sheetGone: !document.querySelector('#sheet-root .sheet.is-open'),
      again: App.Coach.notice(),
      noticeAt: App.Store.state.settings.coach.noticeAt,
      today: App.Utils.today()
    };
  `);
  check('点「今天先不」后浮层关闭', dismissed.sheetGone);
  check('当天不再重复提醒', dismissed.again === null && dismissed.noticeAt === dismissed.today, dismissed.noticeAt);

  const generated = await ev(`
    App.Store.commit((s) => { s.settings.coach.noticeAt = ''; });
    App.Store.flush();
    App.Router.go('#/today');
    await new Promise((r) => setTimeout(r, 400));
    App.CoachNudge();
    const btns = Array.from(document.querySelectorAll('#sheet-root .sheet-foot button'));
    btns[btns.length - 1].click();
    await new Promise((r) => setTimeout(r, 900));
    return {
      reports: App.Coach.reports().length,
      headline: App.Coach.reports()[0] ? App.Coach.reports()[0].headline : '',
      route: location.hash,
      again: App.Coach.notice(),
      sheetOpen: !!document.querySelector('#sheet-root .sheet.is-open')
    };
  `);
  check('从浮层一键生成复盘', generated.reports === 1 && !!generated.headline, generated.headline);
  check('生成后跳到学习教练页', generated.route === '#/coach', generated.route);
  check('生成后不再提醒', generated.again === null);
  check('生成完浮层自动收起', generated.sheetOpen === false);

  const offSwitch = await ev(`
    App.Store.commit((s) => {
      s.coachReports = []; s.settings.coach.noticeAt = ''; s.settings.coach.auto = false;
      s.studyPlan.startDate = App.Utils.addDays(App.Utils.today(), -9);
    });
    return App.Coach.notice();
  `);
  check('关掉提醒后就不再弹', offSwitch === null);

  const noPlan = await ev(`
    App.Store.commit((s) => { s.settings.coach.auto = true; s.settings.coach.noticeAt = ''; s.studyPlan = null; });
    return App.Coach.notice();
  `);
  check('没有计划时不打扰', noPlan === null);

  const firstDay = await ev(`
    App.Coach.savePlan({
      title: '刚建的计划', summary: 'x', horizonDays: 30,
      phases: [{ name: '打底', days: 30, focus: '背词' }],
      targets: { dailyNewWords: 30, dailyQuiz: 1, dailyWriting: 1, dailyListen: 1, dailyMinutes: 60 },
      rules: [], todayFocus: '先复习'
    }, { apply: false });
    App.Store.commit((s) => { s.coachReports = []; s.settings.coach.noticeAt = ''; });
    return { notice: App.Coach.notice(), day: (App.Coach.planProgress() || {}).day };
  `);
  check('刚建计划的头一天不催', firstDay.notice === null, '第 ' + firstDay.day + ' 天');

  /* ---------- 9.8 冷启动自动提醒（真的走 app.js 的启动流程） ---------- */
  await ev(`
    App.Store.commit((s) => {
      s.coachReports = [];
      s.settings.coach.noticeAt = '';
      s.settings.coach.auto = true;
      s.settings.coach.every = 3;
      s.settings.ai = { baseUrl: '', apiKey: '', model: '' };
    });
    App.Coach.savePlan({
      title: '冷启动测试计划', summary: 'x', horizonDays: 40,
      phases: [{ name: '打底', days: 40, focus: '背词' }],
      targets: { dailyNewWords: 30, dailyQuiz: 1, dailyWriting: 1, dailyListen: 1, dailyMinutes: 60 },
      rules: [], todayFocus: '先复习'
    }, { apply: false });
    App.Store.commit((s) => { s.studyPlan.startDate = App.Utils.addDays(App.Utils.today(), -6); });
    App.Store.flush();
    location.hash = '#/today';
    return 1;
  `);
  await sleep(300);
  await send('Page.reload', { ignoreCache: true });
  await sleep(4600);
  const autoNudge = await ev(`
    const sheet = document.querySelector('#sheet-root .sheet');
    return {
      open: !!sheet && sheet.classList.contains('is-open'),
      title: sheet ? (sheet.querySelector('.sheet-title') || {}).textContent || '' : '',
      noticeAt: App.Store.state.settings.coach.noticeAt,
      today: App.Utils.today()
    };
  `);
  check('打开应用后自动弹复盘提醒', autoNudge.open && autoNudge.title === '该复盘了', autoNudge.title);
  check('冷启动也记下今天已提醒', autoNudge.noticeAt === autoNudge.today, autoNudge.noticeAt);
  await ev(`App.Utils.closeSheet(); return 1;`);
  await sleep(400);

  /* ---------- 10. 异常 ---------- */
  const realErrors = errors.filter((e) => !/favicon|ResizeObserver/.test(e));
  check('无未捕获异常', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  const failed = results.filter((r) => !r.ok);
  console.log('\n=== ' + (results.length - failed.length) + '/' + results.length + ' PASS ===');
  if (failed.length) {
    console.log('失败项：');
    failed.forEach((f) => console.log('  - ' + f.name + '  ' + f.detail));
    process.exitCode = 2;
  }
  ws.close();
} finally {
  try { child.kill(); } catch { /* 忽略 */ }
}
