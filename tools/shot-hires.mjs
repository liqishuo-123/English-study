/**
 * shot-hires.mjs — 生成「高分辨率演示截图」（3 倍像素密度，用于海报/宣传图）
 *
 * 用法：
 *   node tools/shot-hires.mjs [baseUrl] [outDir]
 *
 * 与 probe.mjs 的区别：
 * - deviceScaleFactor = 3，430×932 的视口输出 1290×2796 的 PNG，放大后仍清晰
 * - 截图前会写入一份「演示数据」（进度、今日日志、连续打卡、一段 AI 对话），
 *   避免截图里全是 0/30 的空状态
 *
 * 输出：outDir 下 today.png / words.png / agent.png / listen.png / quiz.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BASE = process.argv[2] || 'http://127.0.0.1:8123/';
const OUT = path.resolve(process.argv[3] || path.join(ROOT, '..', '_poster', 'shots'));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9351;

const W = 430;
const H = 932;
const DSF = 3;

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
      }, 40000);
    });
  }
  async evalJs(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return fs.statSync(file).size;
  }
}

/** 演示数据：让截图看起来像一个用了两个月的真实账号 */
const SEED = `(async () => {
  const S = App.Store, U = App.Utils, today = U.today();
  const st = S.state;
  Object.assign(st.settings, {
    dailyNewWords: 40, dailyQuiz: 3, dailyWriting: 1, dailyListen: 2, dailyMinutes: 30,
    examDate: U.addDays(today, 96), examName: 'CET-6 笔试'
  });

  const all = App.Words.all.filter((w) => w.level === 'cet4' && !w.isPhrase);
  all.slice(0, 360).forEach((w, i) => {
    const p = (st.progress[w.id] = st.progress[w.id] || {});
    p.lastSeenAt = today;
    if (i % 9 === 4) {
      p.mastered = true; p.status = 'mastered'; p.masteredAt = U.addDays(today, -((i % 25) + 1));
      p.srs = { ease: 2.7, interval: 32, reps: 6, lapses: 0, due: U.addDays(today, 12) };
    } else if (i % 3 === 0) {
      p.status = 'learning';
      p.srs = { ease: 2.4, interval: 5, reps: 3, lapses: i % 8 === 0 ? 1 : 0, due: U.addDays(today, i % 4 ? -1 : 3) };
    } else if (i % 3 === 1) {
      p.status = 'learning';
      p.srs = { ease: 2.35, interval: 1, reps: 1, lapses: 0, due: today };
    }
    if (i % 10 === 7) p.starred = true;
  });

  const log = st.logs[today] = st.logs[today] || { date: today };
  Object.assign(log, {
    date: today, minutes: 42, wordsNew: 26, wordsReviewed: 84,
    quizDone: 3, quizCorrect: 2, quizPapers: 1, writingDone: 1, listenDone: 1,
    checked: false, planDone: ['writing'], writingSeen: [], customDone: {}
  });
  (App.WRITING_BUILTIN || []).slice(0, 2).forEach((m) => log.writingSeen.push(m.id));

  for (let i = 1; i <= 15; i++) {
    const d = U.addDays(today, -i);
    const l = st.logs[d] = st.logs[d] || { date: d };
    l.checked = true; l.minutes = 18 + ((i * 7) % 5) * 5;
    l.wordsNew = 20 + (i % 4) * 6;
  }

  const now = Date.now();
  st.agentMessages = [
    { id: 'a1', role: 'user', text: '我下周有六级模拟考，帮我看看现在的进度，再把每天新词调到 50。', at: now - 240000 },
    {
      id: 'a2', role: 'assistant', at: now - 200000,
      tools: [
        { name: 'get_status', ok: true, summary: '已掌握 40 词 · 今日待复习 96 词' },
        { name: 'update_plan', ok: true, summary: '每日新词 40 → 50' }
      ],
      text: '已把每日新词从 40 调到 50，按你现在的节奏，考前能多滚两轮。\\n\\n**眼下最该做的三件事**\\n- 今天还有 **96 个词**到期，先清复习再背新词\\n- 阅读真题只剩 1 篇没做，今晚补上\\n- 写作练过的 2 篇里，「现象说明型」开头还没背熟'
    },
    { id: 'a3', role: 'user', text: '再给我挑 5 个容易混的词，配例句。', at: now - 90000 }
  ];

  // 学习教练：一份进行中的计划 + 一条 AI 复盘
  App.Coach.savePlan({
    title: '六级 96 天冲刺',
    summary: '先把高频词滚熟，中期主攻听力精听与仔细阅读，最后两周只做真题和错题。',
    horizonDays: 96,
    phases: [
      { name: '词汇打底', days: 34, focus: '每天 40 新词 + 清到期复习，阅读每天 1 篇' },
      { name: '听力强化', days: 40, focus: '每天精听 1 段并听写出错句，每周 3 篇真题' },
      { name: '真题冲刺', days: 22, focus: '隔天整套真题，错题当天回看，写作背 6 个开头' }
    ],
    targets: { dailyNewWords: 40, dailyQuiz: 3, dailyWriting: 1, dailyListen: 2, dailyMinutes: 30 },
    weekly: ['第 1 周：把 360 个 CET-4 高频词过完第一轮', '第 2 周：开始听力精听，每天 1 段'],
    rules: ['复习永远优先于新词', '错题当天回看一遍，不拖到第二天', '听力只在早上做，晚上只背词'],
    todayFocus: '先清掉 96 个到期复习词，再背 40 个新词，晚上精听一段校园新闻'
  }, { source: 'ai', apply: true });

  App.Coach.addReport({
    headline: '词汇推进稳，听力被挤掉了',
    score: 74,
    highlights: [
      '连续打卡 15 天，出勤 100%',
      '近 7 天新词完成率 92%，比上周多 11 个/天'
    ],
    problems: [
      { title: '精听只做了 1 天', evidence: '近 7 天 listenDone 只有 1 次，目标是 14 次', fix: '固定在早饭时做一段，做完立刻听写' },
      { title: '阅读正确率卡在 62%', evidence: '12 题对 7 题，错题全在推断题', fix: '每篇做完单独标出处推断句，再对答案' }
    ],
    weakWords: [
      { word: 'reluctant', meaning: 'adj. 不情愿的', why: '和 reluctant/reluctance 词性混，拼写常漏 t', tip: 're + luct（挣扎）+ ant：心里挣扎着不想去' },
      { word: 'conservative', meaning: 'adj. 保守的', why: '和 conversation 混，靠首字母记不住', tip: 'con-serv（保存）+ ative：什么都想保着 = 保守' },
      { word: 'abandon', meaning: 'v. 放弃；抛弃', why: '和 abundant 混，拼写只差一个字母', tip: 'a-band-on：把乐队丢在路边 = 抛弃' }
    ],
    nextActions: [
      '今晚先精听一段，听写完再把错句抄一遍',
      '明天做 1 篇仔细阅读，只练推断题'
    ],
    adjust: { dailyListen: 2, dailyNewWords: 40 }
  }, { source: 'ai', range: { days: 7 } });

  S.commit(() => {});
  S.flush();
  return { words: App.Words.counts() };
})()`;

const SHOTS = [
  ['today', '#/today', 1400],
  ['coach', '#/coach', 1500],
  ['words', '#/words', 1200],
  ['agent', '#/agent', 1400],
  ['listen', '#/listen', 1200],
  ['quiz', '#/quiz', 1200]
];

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
      `--window-size=${W},${H}`,
      '--force-device-scale-factor=1',
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  const sizes = {};
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
      width: W, height: H, deviceScaleFactor: DSF, mobile: true
    });

    await cdp.send('Page.navigate', { url: BASE });
    await sleep(2200);
    await cdp.evalJs(`(async () => {
      try {
        const rs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(rs.map((r) => r.unregister()));
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) {}
      return 1;
    })()`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await sleep(2400);

    const seeded = await cdp.evalJs(SEED);
    console.log('seeded', JSON.stringify(seeded));

    for (const [name, hash, wait] of SHOTS) {
      await cdp.evalJs(`(() => { location.hash = ${JSON.stringify(hash)}; return 1; })()`);
      await sleep(wait);
      await cdp.evalJs('window.scrollTo(0, 0); 1');
      const file = path.join(OUT, `${name}.png`);
      sizes[name] = await cdp.shot(file);
    }

    ws.close();
  } finally {
    try { child.kill(); } catch {}
  }

  console.log(JSON.stringify({ out: OUT, sizes }, null, 2));
}

main().catch((e) => {
  console.error('SHOT FAILED:', e.message);
  process.exit(1);
});
