/* =========================================================
   core/coach.js — 学习教练（制定计划 + 定期复盘）
   依赖：core/utils.js, core/store.js, core/ai.js, core/wordsdb.js
   对外：window.App.Coach

   和 core/agent.js 的分工：
   - agent.js 是「能动手的助教」：一次对话里查数据、改设置、出题、加词；
   - coach.js 是「会做长期规划的老师」，只管两件慢功夫：
       1. 按考试日期 + 你自己的真实水平，排一张分阶段的计划表；
       2. 每隔几天翻一次真实数据，指出哪里在退步、哪些词总记不住。
   两者的数据来源完全一致（stats / weakWords），教练生成的计划与复盘会落库，
   助教也能读到（agent 的 get_plan / get_stats 工具）。

   没配 API 也能用：localPlan() / localReport() 用本地规则生成一份可用版本，
   配了 API 之后由大模型改写得更贴合个人情况。
   ========================================================= */
(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var U = App.Utils;

  var MAX_REPORTS = 24;      // 本地最多保留多少份复盘
  var REPORT_CHARS = 1400;   // 喂给模型的易错词/错题文本上限

  /* =========================================================
     一、小工具
     ========================================================= */
  function str(v, max) {
    var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return max && s.length > max ? s.slice(0, max) : s;
  }
  function arr(v, max) { return Array.isArray(v) ? v.slice(0, max || 99) : []; }
  function int(v, lo, hi, dft) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return dft;
    return U.clamp(n, lo, hi);
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function nowTime() {
    var d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function cnDate(key) {
    var p = String(key || '').split('-');
    if (p.length !== 3) return key || '';
    return (+p[1]) + ' 月 ' + (+p[2]) + ' 日';
  }

  /** 尽量从模型输出里抠出 JSON（容忍 ```json 围栏、前后寒暄、尾逗号） */
  function matchEnd(s, start) {
    var open = s.charAt(start);
    var close = open === '{' ? '}' : ']';
    var depth = 0, inStr = false, esc = false;
    for (var i = start; i < s.length; i++) {
      var c = s.charAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  function extractJSON(text) {
    var s = String(text || '');
    if (!s) return null;
    // 去掉 ```json ... ``` 围栏
    var fence = s.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
    if (fence && fence[1]) s = fence[1];
    // 整体先试一次
    var trimmed = s.trim().replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(trimmed); } catch (e) { /* 继续 */ }
    // 扫第一个能配对上的 { } / [ ]
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c !== '{' && c !== '[') continue;
      var end = matchEnd(s, i);
      if (end < 0) continue;
      var piece = s.slice(i, end + 1).replace(/,\s*([}\]])/g, '$1');
      try { return JSON.parse(piece); } catch (e2) { /* 继续找下一个 */ }
    }
    return null;
  }

  /* =========================================================
     二、真实数据：档案 / 区间统计 / 易错词 / 错题分布
     ========================================================= */

  /** 学生档案（做题计划时需要的静态信息） */
  function profile() {
    var s = App.Store.state.settings;
    var c = (s.coach && typeof s.coach === 'object') ? s.coach : {};
    return {
      examName: s.examName || '大学英语四级',
      examDate: s.examDate,
      daysLeft: U.diffDays(U.today(), s.examDate),
      minutes: int(s.dailyMinutes, 0, 600, 60),
      targetScore: int(c.targetScore, 0, 710, 0) || null,
      daysPerWeek: int(c.daysPerWeek, 1, 7, 6),
      weak: arr(c.weak, 4).map(function (x) { return str(x, 6); }).filter(Boolean),
      goals: {
        dailyNewWords: int(s.dailyNewWords, 0, 200, 30),
        dailyQuiz: int(s.dailyQuiz, 0, 20, 1),
        dailyWriting: int(s.dailyWriting, 0, 50, 1),
        dailyListen: int(s.dailyListen, 0, 20, 1)
      },
      autoReport: c.auto !== false,
      reportEvery: int(c.every, 1, 30, 3)
    };
  }

  /** 近 N 天的真实学习数据（教练与复盘的数据底座） */
  function stats(days) {
    days = int(days, 3, 90, 14);
    var st = App.Store.state;
    var today = U.today();
    var from = U.addDays(today, -(days - 1));

    var daily = [];
    var sum = {
      minutes: 0, newWords: 0, reviewed: 0, quizPapers: 0,
      quizDone: 0, quizCorrect: 0, writingDone: 0, listenDone: 0,
      activeDays: 0, checkedDays: 0, goalHit: 0
    };
    var s = st.settings;

    for (var i = 0; i < days; i++) {
      var d = U.addDays(from, i);
      var l = st.logs[d];
      var row = {
        date: d,
        minutes: 0, newWords: 0, reviewed: 0, quizPapers: 0,
        quizDone: 0, quizCorrect: 0, writingDone: 0, listenDone: 0,
        checked: false
      };
      if (l) {
        row.minutes = l.minutes || 0;
        row.newWords = l.wordsNew || 0;
        row.reviewed = l.wordsReviewed || 0;
        row.quizPapers = l.quizPapers || 0;
        row.quizDone = l.quizDone || 0;
        row.quizCorrect = l.quizCorrect || 0;
        row.writingDone = l.writingDone || 0;
        row.listenDone = l.listenDone || 0;
        row.checked = !!l.checked;
      }
      var touched = row.minutes || row.newWords || row.reviewed || row.quizPapers || row.writingDone || row.listenDone;
      if (touched) sum.activeDays++;
      if (row.checked) sum.checkedDays++;
      // 新词目标达成天数
      var goalNew = int(s.dailyNewWords, 0, 200, 30);
      if (goalNew > 0 && row.newWords >= goalNew) sum.goalHit++;
      sum.minutes += row.minutes;
      sum.newWords += row.newWords;
      sum.reviewed += row.reviewed;
      sum.quizPapers += row.quizPapers;
      sum.quizDone += row.quizDone;
      sum.quizCorrect += row.quizCorrect;
      sum.writingDone += row.writingDone;
      sum.listenDone += row.listenDone;
      daily.push(row);
    }

    // 词库现状
    var all = (App.Words && App.Words.all) || [];
    var w = { total: all.length, mastered: 0, learning: 0, dueToday: 0, weak: 0, starred: 0 };
    for (var j = 0; j < all.length; j++) {
      var it = all[j];
      if (it.mastered) w.mastered++;
      else if (it.status === 'learning') w.learning++;
      if (it.starred) w.starred++;
      if (!it.mastered && it.srs && it.srs.lapses > 0) w.weak++;
      if (!it.mastered && it.srs && it.srs.reps > 0 && U.diffDays(it.srs.due, today) >= 0) w.dueToday++;
    }

    var accuracy = sum.quizDone ? Math.round((sum.quizCorrect / sum.quizDone) * 100) : 0;
    var p = profile();

    return {
      days: days,
      from: from,
      to: today,
      daily: daily,
      sum: sum,
      accuracy: accuracy,
      avgNewWords: Math.round((sum.newWords / days) * 10) / 10,
      avgMinutes: Math.round((sum.minutes / Math.max(1, sum.activeDays))),
      goalHitRate: Math.round((sum.goalHit / days) * 100),
      words: w,
      streak: App.Store.streak(),
      plan: planBrief(),
      profile: p
    };
  }

  /**
   * 易错词排行：按「遗忘次数」排序，其次按「复习次数多但间隔短」，
   * 这是纯本地统计，不花一分钱，也是复盘最硬的证据。
   */
  function weakWords(limit) {
    limit = int(limit, 1, 40, 8);
    var all = (App.Words && App.Words.all) || [];
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var w = all[i];
      if (w.mastered || w.isPhrase) continue;
      if (!w.srs) continue;
      var lapses = w.srs.lapses || 0;
      var reps = w.srs.reps || 0;
      if (lapses === 0 && reps < 3) continue;   // 刚学的新词不算易错
      var score = lapses * 10 + Math.max(0, reps - (w.srs.interval || 0));
      out.push({
        word: w.word,
        phonetic: w.phonetic || '',
        meaning: w.meaning,
        pos: w.pos || '',
        lapses: lapses,
        reps: reps,
        interval: w.srs.interval || 0,
        due: w.srs.due || '',
        lastSeenAt: w.lastSeenAt || '',
        score: score
      });
    }
    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return b.lapses - a.lapses;
    });
    return out.slice(0, limit);
  }

  var TYPE_LABEL = { reading: '仔细阅读', 'select-fill': '选词填空', matching: '长篇匹配' };

  /** 错题分布：按题型聚合，附带最容易错的题干摘要 */
  function errorTags(limit) {
    limit = int(limit, 1, 12, 5);
    var wb = (App.Store.state.wrongbook || []);
    var map = Object.create(null);
    wb.forEach(function (it) {
      var k = it.type || 'reading';
      if (!map[k]) map[k] = { type: k, label: TYPE_LABEL[k] || k, count: 0, times: 0, samples: [] };
      map[k].count++;
      map[k].times += (it.wrongCount || 1);
      if (map[k].samples.length < 2) map[k].samples.push(str(it.stem, 60));
    });
    var list = Object.keys(map).map(function (k) { return map[k]; });
    list.sort(function (a, b) { return b.times - a.times; });
    return list.slice(0, limit);
  }

  /** 计划完成度：只算「计划开始以后」的天数，避免历史空窗拉低利用率 */
  function planProgress() {
    var p = plan();
    if (!p) return null;
    var today = U.today();
    var day = U.diffDays(p.startDate, today) + 1;
    if (day < 1) return { day: 0, total: p.horizonDays, rate: 0, hit: 0, elapsed: 0, phase: null };
    var elapsed = Math.min(day, p.horizonDays);
    var hit = 0;
    for (var i = 0; i < elapsed; i++) {
      var d = U.addDays(p.startDate, i);
      var l = App.Store.state.logs[d];
      if (!l) continue;
      var target = p.targets && p.targets.dailyNewWords || 0;
      if (target > 0 && (l.wordsNew || 0) >= target) hit++;
    }
    return {
      day: U.clamp(day, 0, p.horizonDays),
      total: p.horizonDays,
      rate: Math.round((U.clamp(day, 0, p.horizonDays) / p.horizonDays) * 100),
      hit: hit,
      elapsed: elapsed,
      phase: currentPhase(p)
    };
  }

  function currentPhase(p) {
    if (!p || !p.phases || !p.phases.length) return null;
    var day = Math.max(1, U.diffDays(p.startDate, U.today()) + 1);
    var acc = 0;
    for (var i = 0; i < p.phases.length; i++) {
      acc += p.phases[i].days || 0;
      if (day <= acc) {
        return { index: i, name: p.phases[i].name, focus: p.phases[i].focus, from: acc - p.phases[i].days + 1, to: acc };
      }
    }
    var last = p.phases[p.phases.length - 1];
    return { index: p.phases.length - 1, name: last.name, focus: last.focus, from: 0, to: 0, done: true };
  }

  /* =========================================================
     三、计划的存取
     ========================================================= */
  function plan() {
    var p = App.Store.state.studyPlan;
    return (p && typeof p === 'object' && p.phases) ? p : null;
  }

  function planBrief() {
    var p = plan();
    if (!p) return null;
    var pr = planProgress();
    var ph = pr && pr.phase;
    return {
      title: p.title,
      startDate: p.startDate,
      endDate: p.endDate,
      horizonDays: p.horizonDays,
      targets: p.targets,
      day: pr ? pr.day : 0,
      phase: ph ? { name: ph.name, focus: ph.focus, index: ph.index } : null,
      source: p.source
    };
  }

  /** 归一化模型/模板给的计划，任何脏字段都在这里被夹到安全范围 */
  function normalizePlan(raw, source) {
    var s = App.Store.state.settings;
    var today = U.today();
    var r = (raw && typeof raw === 'object') ? raw : {};
    var fallback = Math.max(1, U.diffDays(today, s.examDate) || 30);
    var horizon = int(r.horizonDays, 3, 400, Math.min(400, fallback));
    var t = r.targets && typeof r.targets === 'object' ? r.targets : {};

    var targets = {
      dailyNewWords: int(t.dailyNewWords, 5, 150, int(s.dailyNewWords, 5, 150, 30)),
      dailyQuiz: int(t.dailyQuiz, 0, 6, int(s.dailyQuiz, 0, 6, 1)),
      dailyWriting: int(t.dailyWriting, 0, 10, int(s.dailyWriting, 0, 10, 1)),
      dailyListen: int(t.dailyListen, 0, 10, int(s.dailyListen, 0, 10, 1)),
      dailyMinutes: int(t.dailyMinutes, 10, 480, int(s.dailyMinutes, 10, 480, 60))
    };

    var phases = arr(r.phases, 6).map(function (ph, i) {
      ph = ph || {};
      return {
        name: str(ph.name, 14) || ('第 ' + (i + 1) + ' 阶段'),
        days: int(ph.days, 1, horizon, Math.max(1, Math.round(horizon / 3))),
        focus: str(ph.focus, 90) || '按计划推进'
      };
    }).filter(function (ph) { return ph.days > 0; });

    if (!phases.length) {
      phases = [
        { name: '基础期', days: Math.max(1, Math.round(horizon * 0.4)), focus: '高频词打底 + 长难句拆解' },
        { name: '强化期', days: Math.max(1, Math.round(horizon * 0.4)), focus: '真题限时训练 + 错题回炉' },
        { name: '冲刺期', days: Math.max(1, Math.round(horizon * 0.2)), focus: '套卷模拟 + 作文模板成稿' }
      ];
    }
    // 阶段天数超过总天数时按比例压缩，保证进度条对得上
    var totalPhase = phases.reduce(function (a, b) { return a + b.days; }, 0);
    if (totalPhase > horizon) {
      phases.forEach(function (ph) { ph.days = Math.max(1, Math.round(ph.days * horizon / totalPhase)); });
    }

    return {
      id: str(r.id, 24) || U.uid('plan'),
      createdAt: r.createdAt || today,
      updatedAt: today,
      source: source || r.source || 'ai',
      title: str(r.title, 40) || (horizon + ' 天备考计划'),
      summary: str(r.summary, 160) || '按阶段推进，先把到期复习做完再加新词。',
      horizonDays: horizon,
      startDate: r.startDate || today,
      endDate: U.addDays(today, horizon),
      phases: phases,
      weekly: arr(r.weekly, 12).map(function (x) { return str(x, 80); }).filter(Boolean),
      rules: arr(r.rules, 8).map(function (x) { return str(x, 80); }).filter(Boolean),
      targets: targets,
      todayFocus: str(r.todayFocus, 100) || (phases[0].focus || ''),
      applied: !!r.applied,
      note: str(r.note, 200)
    };
  }

  /**
   * 保存计划
   * @param {Object} raw 计划对象
   * @param {{apply?:boolean, source?:string}} opt apply=true 时同步写入每日目标
   */
  function savePlan(raw, opt) {
    opt = opt || {};
    var p = normalizePlan(raw, opt.source);
    if (opt.apply !== false) {
      App.Store.commit(function (s) {
        s.settings.dailyNewWords = p.targets.dailyNewWords;
        s.settings.dailyQuiz = p.targets.dailyQuiz;
        s.settings.dailyWriting = p.targets.dailyWriting;
        s.settings.dailyListen = p.targets.dailyListen;
        s.settings.dailyMinutes = p.targets.dailyMinutes;
      });
      p.applied = true;
    }
    App.Store.commit(function (s) { s.studyPlan = p; });
    App.Store.flush();
    return p;
  }

  function clearPlan() {
    App.Store.commit(function (s) { s.studyPlan = null; });
    App.Store.flush();
  }

  /** 把计划里的每日目标写进设置（重新应用） */
  function applyTargets(p) {
    p = p || plan();
    if (!p) return false;
    var t = p.targets || {};
    App.Store.commit(function (s) {
      s.settings.dailyNewWords = int(t.dailyNewWords, 0, 200, s.settings.dailyNewWords);
      s.settings.dailyQuiz = int(t.dailyQuiz, 0, 20, s.settings.dailyQuiz);
      s.settings.dailyWriting = int(t.dailyWriting, 0, 50, s.settings.dailyWriting);
      s.settings.dailyListen = int(t.dailyListen, 0, 20, s.settings.dailyListen);
      s.settings.dailyMinutes = int(t.dailyMinutes, 0, 600, s.settings.dailyMinutes);
      if (s.studyPlan) s.studyPlan.applied = true;
    });
    App.Store.flush();
    return true;
  }

  /* =========================================================
     四、复盘报告的存取
     ========================================================= */
  function reports() {
    var a = App.Store.state.coachReports;
    return Array.isArray(a) ? a : [];
  }

  function normalizeReport(raw, source, range) {
    var r = (raw && typeof raw === 'object') ? raw : {};
    var problems = arr(r.problems, 5).map(function (x) {
      if (typeof x === 'string') return { title: str(x, 40), evidence: '', fix: '' };
      x = x || {};
      return { title: str(x.title, 40), evidence: str(x.evidence, 90), fix: str(x.fix, 90) };
    }).filter(function (x) { return x.title; });

    var weak = arr(r.weakWords, 8).map(function (x) {
      if (typeof x === 'string') return { word: str(x, 24), meaning: '', why: '', tip: '' };
      x = x || {};
      return {
        word: str(x.word, 24),
        meaning: str(x.meaning, 30),
        why: str(x.why, 40),
        tip: str(x.tip, 80)
      };
    }).filter(function (x) { return x.word; });

    var adjust = {};
    if (r.adjust && typeof r.adjust === 'object') {
      ['dailyNewWords', 'dailyQuiz', 'dailyWriting', 'dailyListen', 'dailyMinutes'].forEach(function (k) {
        if (r.adjust[k] !== undefined && r.adjust[k] !== null) {
          var n = parseInt(r.adjust[k], 10);
          if (!isNaN(n)) adjust[k] = n;
        }
      });
    }

    return {
      id: str(r.id, 24) || U.uid('rep'),
      at: r.at || U.today(),
      atTime: r.atTime || nowTime(),
      range: range || r.range || null,
      headline: str(r.headline, 60) || '本期复盘',
      score: int(r.score, 0, 100, 0),
      highlights: arr(r.highlights, 5).map(function (x) { return str(x, 60); }).filter(Boolean),
      problems: problems,
      weakWords: weak,
      nextActions: arr(r.nextActions, 6).map(function (x) { return str(x, 70); }).filter(Boolean),
      adjust: adjust,
      source: source || r.source || 'ai'
    };
  }

  function addReport(raw, opt) {
    opt = opt || {};
    var rep = normalizeReport(raw, opt.source, opt.range);
    App.Store.commit(function (s) {
      if (!Array.isArray(s.coachReports)) s.coachReports = [];
      s.coachReports.unshift(rep);
      if (s.coachReports.length > MAX_REPORTS) s.coachReports.length = MAX_REPORTS;
    });
    App.Store.flush();
    return rep;
  }

  function removeReport(id) {
    App.Store.commit(function (s) {
      s.coachReports = (s.coachReports || []).filter(function (r) { return r.id !== id; });
    });
    App.Store.flush();
  }

  /** 是否到了该复盘的时候（首页据此提醒，不自动请求接口，避免偷偷花钱） */
  function dueReport() {
    var p = profile();
    if (!p.autoReport) return { due: false, every: p.reportEvery };
    var list = reports();
    if (!list.length) {
      return { due: !!plan(), every: p.reportEvery, never: true, days: null, lastAt: '' };
    }
    var d = U.diffDays(list[0].at, U.today());
    return {
      due: d >= p.reportEvery,
      days: d,
      every: p.reportEvery,
      lastAt: list[0].at,
      never: false
    };
  }

  /* =========================================================
     四之二、每天首次打开时的「该复盘了」提醒
     只算「该不该提醒」，不碰网络；同一天只提醒一次
     ========================================================= */

  /** 今天第一次打开时要不要提醒复盘；不需要则返回 null */
  function notice() {
    var st = App.Store.state;
    var c = st.settings.coach || {};
    var today = U.today();

    if (c.auto === false) return null;
    if (c.noticeAt === today) return null;      // 今天已经提醒过（点过「先不」也算）
    var p = plan();
    if (!p) return null;                         // 还没计划，先别打扰

    var due = dueReport();
    if (!due.due) return null;

    var prog = planProgress() || { day: 0 };
    // 刚制定计划的头一天不催：此时什么都还没发生，复盘没有素材
    if (due.never && prog.day <= 1) return null;

    return {
      never: !!due.never,
      days: due.days,
      every: due.every,
      planDay: prog.day,
      total: p.horizonDays,
      phase: prog.phase ? prog.phase.name : '',
      ai: aiReady()
    };
  }

  /** 记下「今天提醒过了」，避免一天里反复弹 */
  function markNotice() {
    App.Store.commit(function (s) {
      if (!s.settings.coach || typeof s.settings.coach !== 'object') s.settings.coach = {};
      s.settings.coach.noticeAt = U.today();
    });
    App.Store.flush();
  }

  /* =========================================================
     五、喂给模型的材料（也是本地降级的依据）
     ========================================================= */
  function dataBlock(days) {
    var st = stats(days);
    var weak = weakWords(8);
    var tags = errorTags(4);

    var lines = [];
    lines.push('【档案】');
    lines.push('- 考试：' + st.profile.examName + '，' + st.profile.examDate + '，还剩 ' + st.profile.daysLeft + ' 天');
    lines.push('- 每天可学 ' + st.profile.minutes + ' 分钟，每周能学 ' + st.profile.daysPerWeek + ' 天' +
      (st.profile.targetScore ? '，目标 ' + st.profile.targetScore + ' 分' : ''));
    if (st.profile.weak.length) lines.push('- 自认薄弱：' + st.profile.weak.join('、'));
    lines.push('- 当前每日目标：新词 ' + st.profile.goals.dailyNewWords + ' / 阅读 ' + st.profile.goals.dailyQuiz +
      ' 篇 / 素材 ' + st.profile.goals.dailyWriting + ' 条 / 精听 ' + st.profile.goals.dailyListen + ' 段');

    lines.push('');
    lines.push('【词库与掌握】');
    lines.push('- 词库 ' + st.words.total + ' 词：已掌握 ' + st.words.mastered + '，学习中 ' + st.words.learning +
      '，收藏 ' + st.words.starred + '，今天到期复习 ' + st.words.dueToday + '，易错词 ' + st.words.weak);
    lines.push('- 连续打卡 ' + st.streak + ' 天');

    lines.push('');
    lines.push('【近 ' + st.days + ' 天（' + cnDate(st.from) + ' ~ ' + cnDate(st.to) + '）】');
    lines.push('- 有学习记录 ' + st.sum.activeDays + ' 天、打卡 ' + st.sum.checkedDays + ' 天，累计 ' + st.sum.minutes + ' 分钟');
    lines.push('- 新学 ' + st.sum.newWords + ' 词（日均 ' + st.avgNewWords + '），复习 ' + st.sum.reviewed + ' 次');
    lines.push('- 做阅读 ' + st.sum.quizPapers + ' 篇、' + st.sum.quizDone + ' 题，正确率 ' + st.accuracy + '%');
    lines.push('- 写作素材 ' + st.sum.writingDone + ' 条，精听 ' + st.sum.listenDone + ' 段');
    lines.push('- 每日新词目标达成率 ' + st.goalHitRate + '%');

    if (weak.length) {
      lines.push('');
      lines.push('【最记不住的词】');
      lines.push(weak.map(function (w) {
        return w.word + (w.meaning ? '(' + str(w.meaning, 16) + ')' : '') +
          ' 遗忘 ' + w.lapses + ' 次/复习 ' + w.reps + ' 次';
      }).join('\n'));
    }
    if (tags.length) {
      lines.push('');
      lines.push('【错题分布】');
      lines.push(tags.map(function (t) { return t.label + ' ' + t.count + ' 题（累计错 ' + t.times + ' 次）'; }).join('\n'));
    }
    var p = plan();
    if (p) {
      var pr = planProgress();
      lines.push('');
      lines.push('【现有计划】');
      lines.push('- ' + p.title + '：第 ' + (pr ? pr.day : 1) + '/' + p.horizonDays + ' 天，当前阶段「' +
        (pr && pr.phase ? pr.phase.name : '—') + '」');
    }
    var txt = lines.join('\n');
    return txt.length > REPORT_CHARS * 3 ? txt.slice(0, REPORT_CHARS * 3) : txt;
  }

  var PLAN_SYSTEM = '你是中国大学英语四六级备考的资深规划老师，带过大量基础薄弱的学生。' +
    '你只输出 JSON，不输出任何解释、寒暄或 Markdown 围栏。数字要符合一个真实学生的承受能力，不要喊口号。';

  function planPrompt(days) {
    return dataBlock(days || 14) + '\n\n' +
      '【任务】\n' +
      '根据上面的真实情况，为学生制定一张从今天到考试的分阶段备考计划。要求：\n' +
      '1. 阶段 2~4 个，加起来等于总天数；每天的任务量必须落在他能投入的分钟数内。\n' +
      '2. 如果到期复习量很大、或正确率明显偏低，就减少新词量、增加复习与真题比重，并在 summary 里说明为什么。\n' +
      '3. 目标数字要给具体的整数（新词 10~100、阅读 0~4 篇、素材 0~5 条、精听 0~4 段、时长 15~240 分钟）。\n' +
      '4. 中文表达，具体可执行，不要「努力学习」这种空话。\n\n' +
      '【输出格式】严格按这个 JSON 结构，字段名不要改，不要加注释：\n' +
      '{"title":"计划标题(≤20字)","summary":"整体策略一句话(≤80字)",' +
      '"horizonDays":从今天到考试的天数,' +
      '"phases":[{"name":"阶段名(≤6字)","days":该阶段天数,"focus":"这一阶段每天做什么(≤40字)"}],' +
      '"targets":{"dailyNewWords":40,"dailyQuiz":1,"dailyWriting":1,"dailyListen":1,"dailyMinutes":70},' +
      '"weekly":["第1周：……","第2周：……"],' +
      '"rules":["每天的执行规则，如先清到期复习再学新词"],' +
      '"todayFocus":"今天具体做的第一件事(≤40字)"}';
  }

  var REPORT_SYSTEM = '你是中国大学英语四六级备考的学习教练，擅长用数据说话。' +
    '你只输出 JSON，不输出任何解释、寒暄或 Markdown 围栏。指出问题时要给证据，给建议时要能今天就做。';

  function reportPrompt(days) {
    var d = int(days, 3, 90, 7);
    return dataBlock(d) + '\n\n' +
      '【任务】\n' +
      '基于以上真实数据，写一份近 ' + d + ' 天的学习复盘，面向学生本人。要求：\n' +
      '1. 结论先行：headline 一句话说清这期最该知道的事（好就说好，退步就直说）。\n' +
      '2. problems 每条都要带证据（引用上面的数字），不许空泛；最多 3 条，挑最影响分数的。\n' +
      '3. weakWords 从「最记不住的词」里挑 3~5 个，给一句记得住的记忆方法（词根、谐音、场景都行）。\n' +
      '4. nextActions 是明天就能执行的动作，最多 4 条，按优先级排。\n' +
      '5. 如果数据支持，用 adjust 给出每日目标的调整建议（只放需要改的字段）。\n' +
      '6. score 是本期综合执行分（0~100），按「出勤 + 目标达成率 + 正确率」估。\n\n' +
      '【输出格式】严格按这个 JSON 结构：\n' +
      '{"headline":"一句话结论(≤40字)","score":72,' +
      '"highlights":["做得好的地方，最多3条"],' +
      '"problems":[{"title":"问题(≤20字)","evidence":"数据证据(≤50字)","fix":"怎么改(≤50字)"}],' +
      '"weakWords":[{"word":"abandon","meaning":"放弃","why":"近两周错了3次","tip":"记忆方法(≤40字)"}],' +
      '"nextActions":["明天先做这个"],' +
      '"adjust":{"dailyNewWords":30}}';
  }

  /* =========================================================
     六、调用大模型
     ========================================================= */
  function aiReady() { return !!(App.AI && App.AI.isEnabled()); }

  function ask(system, prompt, maxTokens) {
    return App.AI.chat([
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ], { temperature: 0.45, maxTokens: maxTokens || 1200, timeout: 75000 });
  }

  /**
   * 让模型制定计划
   * @returns {Promise<{ok:boolean, plan?:Object, error?:string, code?:string}>}
   */
  function generatePlan(opt) {
    opt = opt || {};
    var onEvent = opt.onEvent || function () { };
    if (!aiReady()) return Promise.resolve({ ok: false, code: 'no-key', error: '还没有配置 AI 接口，可以先用本地模板生成计划。' });

    onEvent({ type: 'start', what: 'plan' });
    return ask(PLAN_SYSTEM, planPrompt(opt.days), 1400).then(function (r) {
      if (!r.ok) return { ok: false, code: r.code, error: r.error };
      var json = extractJSON(r.text);
      if (!json || (!json.phases && !json.targets)) {
        return { ok: false, code: 'parse', error: '模型返回的内容不是计划 JSON，可以重试一次，或直接用本地模板。', raw: r.text };
      }
      var p = savePlan(json, { source: 'ai', apply: opt.apply !== false });
      return { ok: true, plan: p };
    }).catch(function (e) {
      return { ok: false, code: 'exception', error: String(e && e.message || e) };
    });
  }

  /**
   * 让模型写复盘
   * @param {{days?:number, onEvent?:Function}} opt
   */
  function generateReport(opt) {
    opt = opt || {};
    var onEvent = opt.onEvent || function () { };
    var days = int(opt.days, 3, 90, 7);
    if (!aiReady()) return Promise.resolve({ ok: false, code: 'no-key', error: '还没有配置 AI 接口，可以先用本地统计生成复盘。' });

    onEvent({ type: 'start', what: 'report' });
    return ask(REPORT_SYSTEM, reportPrompt(days), 1200).then(function (r) {
      if (!r.ok) return { ok: false, code: r.code, error: r.error };
      var json = extractJSON(r.text);
      if (!json || (!json.headline && !json.problems)) {
        return { ok: false, code: 'parse', error: '模型返回的内容不是复盘 JSON，可以重试一次，或先用本地统计版。', raw: r.text };
      }
      var rep = addReport(json, { source: 'ai', range: { days: days } });
      if (opt.applyAdjust && rep.adjust && Object.keys(rep.adjust).length) applyAdjust(rep.adjust);
      return { ok: true, report: rep };
    }).catch(function (e) {
      return { ok: false, code: 'exception', error: String(e && e.message || e) };
    });
  }

  function applyAdjust(adj) {
    if (!adj || typeof adj !== 'object') return {};
    var applied = {};
    App.Store.commit(function (s) {
      function num(k, lo, hi) {
        if (adj[k] === undefined || adj[k] === null) return;
        var n = parseInt(adj[k], 10);
        if (isNaN(n)) return;
        s.settings[k] = U.clamp(n, lo, hi);
        applied[k] = s.settings[k];
      }
      num('dailyNewWords', 0, 200);
      num('dailyQuiz', 0, 20);
      num('dailyWriting', 0, 50);
      num('dailyListen', 0, 20);
      num('dailyMinutes', 0, 600);
    });
    App.Store.flush();
    return applied;
  }

  /* =========================================================
     七、本地降级（没配 API 也要能用）
     ========================================================= */

  /** 纯本地规则生成的计划：按剩余天数分 3 段，目标随水平浮动 */
  function localPlan() {
    var st = stats(14);
    var left = Math.max(7, st.profile.daysLeft);
    var horizon = Math.min(400, left);
    var minutes = int(st.profile.goals.dailyMinutes, 15, 480, 60);

    // 每天能塞多少新词：按分钟数估，再按正确率打折
    var perMinute = 0.55;                                  // 大约 1 分钟 0.55 个新词
    var base = Math.round((minutes * perMinute) / 5) * 5;
    var factor = st.accuracy && st.accuracy < 60 ? 0.75 : 1;
    var newWords = U.clamp(Math.round((base * factor) / 5) * 5, 10, 90);

    // 冲刺期（剩 10 天内）压新词、加真题
    var phase1 = Math.max(1, Math.round(horizon * 0.4));
    var phase2 = Math.max(1, Math.round(horizon * 0.4));
    var phase3 = Math.max(1, horizon - phase1 - phase2);
    if (horizon <= 10) {
      phase1 = Math.max(1, Math.round(horizon / 2));
      phase2 = Math.max(1, horizon - phase1);
      phase3 = 0;
    }

    var targets = {
      dailyNewWords: horizon <= 10 ? Math.max(10, Math.round(newWords * 0.6 / 5) * 5) : newWords,
      dailyQuiz: minutes >= 45 ? 1 : 0,
      dailyWriting: minutes >= 30 ? 1 : 0,
      dailyListen: minutes >= 40 ? 1 : 0,
      dailyMinutes: minutes
    };

    var weak = weakWords(5);
    var phases = [
      { name: '基础期', days: phase1, focus: '高频词优先，每天先清到期复习再学新词；每天精读 1 段长难句' }
    ];
    if (phase2 > 0) phases.push({ name: '强化期', days: phase2, focus: '真题限时训练为主，错题当天回炉；作文按题材各写 1 篇' });
    if (phase3 > 0) phases.push({ name: '冲刺期', days: phase3, focus: '整套模拟 + 作文模板成稿，新词减量，只保到期复习' });

    var rules = [
      '每次打开先做「今日任务」，到期复习没清完不加新词',
      '错题当天进错题本，隔天必须重做一次',
      '每天至少 1 段精听，听不懂的句子逐句跟读到能复述'
    ];
    if (weak.length) rules.push('易错词单独建一组：' + weak.slice(0, 4).map(function (w) { return w.word; }).join('、'));

    return normalizePlan({
      title: horizon + ' 天' + String(st.profile.examName || '备考').replace(/^大学英语/, '') + '计划',
      summary: '按 ' + minutes + ' 分钟/天排的稳态计划：先把到期复习清干净，再按阶段加真题比重。',
      horizonDays: horizon,
      phases: phases,
      targets: targets,
      weekly: [
        '第 1 周：把当前每日目标跑顺，记录真实的完成量',
        '第 2 周起：每周固定 2 次真题限时训练，错题写清错因',
        '考前一周：只做复习和套卷，不加新词'
      ],
      rules: rules,
      todayFocus: '先清掉今天到期的 ' + (stats(1).words.dueToday || 0) + ' 个复习词，再新学 ' + targets.dailyNewWords + ' 个'
    }, 'local');
  }

  /** 纯本地规则生成的复盘：只讲数据事实，不做文学加工 */
  function localReport(days) {
    var d = int(days, 3, 90, 7);
    var st = stats(d);
    var weak = weakWords(4);
    var tags = errorTags(3);

    var highlights = [];
    if (st.sum.checkedDays > 0) highlights.push('打卡 ' + st.sum.checkedDays + ' 天，连续 ' + st.streak + ' 天');
    if (st.sum.newWords > 0) highlights.push('新学 ' + st.sum.newWords + ' 词（日均 ' + st.avgNewWords + '）');
    if (st.sum.quizPapers > 0) highlights.push('做了 ' + st.sum.quizPapers + ' 篇阅读，正确率 ' + st.accuracy + '%');

    var problems = [];
    var expected = Math.round(d * st.profile.daysPerWeek / 7);
    if (st.sum.activeDays < expected) {
      problems.push({
        title: '出勤不够',
        evidence: '近 ' + d + ' 天只有 ' + st.sum.activeDays + ' 天有记录，按每周 ' + st.profile.daysPerWeek + ' 天算应该有 ' + expected + ' 天',
        fix: '把任务量砍到一半，先保证每天打开应用'
      });
    }
    if (st.goalHitRate < 60 && st.profile.goals.dailyNewWords > 0) {
      problems.push({
        title: '新词目标完不成',
        evidence: '达成率 ' + st.goalHitRate + '%，目标 ' + st.profile.goals.dailyNewWords + ' 词/天',
        fix: '把目标降到 ' + Math.max(10, Math.round(st.profile.goals.dailyNewWords * 0.6 / 5) * 5) + ' 词/天，先做到再说'
      });
    }
    if (st.words.dueToday > 40) {
      problems.push({
        title: '复习欠账太多',
        evidence: '今天到期 ' + st.words.dueToday + ' 个，超过 40 就很容易越滚越多',
        fix: '这两天暂停新词，只清复习，清完再加回来'
      });
    }
    if (st.accuracy && st.accuracy < 60 && st.sum.quizDone >= 5) {
      problems.push({
        title: '阅读正确率偏低',
        evidence: st.sum.quizDone + ' 题只对 ' + st.sum.quizCorrect + ' 题（' + st.accuracy + '%）',
        fix: '先做选词填空和长篇匹配，限时但求准，做完逐题写错因'
      });
    }
    if (tags.length && problems.length < 3) {
      problems.push({
        title: '错题集中在' + tags[0].label,
        evidence: tags[0].label + ' 累计错 ' + tags[0].times + ' 次',
        fix: '把这类题的错因归类（定位错 / 词不认识 / 选项理解错），只练这一类'
      });
    }

    var nextActions = [];
    if (st.words.dueToday > 0) nextActions.push('先清 ' + st.words.dueToday + ' 个到期复习词');
    if (weak.length) nextActions.push('重做易错词：' + weak.slice(0, 3).map(function (w) { return w.word; }).join('、'));
    if (st.profile.goals.dailyQuiz > 0) nextActions.push('限时做 1 篇阅读，做完立刻对答案写错因');
    nextActions.push('睡前 3 分钟把今天的错词过一遍');

    var score = U.clamp(
      Math.round(
        (st.sum.activeDays / Math.max(1, d)) * 45 +
        (st.goalHitRate / 100) * 35 +
        (st.accuracy ? st.accuracy / 100 : 0.5) * 20
      ), 0, 100);

    var headline = st.sum.activeDays === 0
      ? '近 ' + d + ' 天没有学习记录，先把节奏找回来'
      : '近 ' + d + ' 天学习 ' + st.sum.activeDays + ' 天、新学 ' + st.sum.newWords + ' 词' +
        (st.sum.quizPapers ? '，阅读正确率 ' + st.accuracy + '%' : '');

    return normalizeReport({
      headline: headline,
      score: score,
      highlights: highlights.slice(0, 3),
      problems: problems.slice(0, 3),
      weakWords: weak.map(function (w) {
        return {
          word: w.word,
          meaning: str(w.meaning, 16),
          why: '遗忘 ' + w.lapses + ' 次 / 复习 ' + w.reps + ' 次',
          tip: '拆成音节记，再各造一句自己的例句'
        };
      }),
      nextActions: nextActions.slice(0, 4),
      adjust: (st.goalHitRate < 60 && st.profile.goals.dailyNewWords > 20)
        ? { dailyNewWords: Math.max(10, Math.round(st.profile.goals.dailyNewWords * 0.7 / 5) * 5) }
        : {}
    }, 'local', { days: d });
  }

  /** 用本地规则立刻生成一份复盘并落库 */
  function makeLocalReport(days) {
    var r = localReport(days);
    return addReport(r, { source: 'local', range: { days: int(days, 3, 90, 7) } });
  }

  /** 用本地规则立刻生成计划并落库 */
  function makeLocalPlan(opt) {
    opt = opt || {};
    return savePlan(localPlan(), { source: 'local', apply: opt.apply !== false });
  }

  /* =========================================================
     八、给界面用的一行摘要
     ========================================================= */
  function summary() {
    var p = plan();
    var due = dueReport();
    if (!p) {
      if (!aiReady()) return '还没有计划 · 可先用本地模板生成一份';
      return '让 AI 按你的考试日期和水平定计划 · 点击进入';
    }
    var pr = planProgress();
    var parts = ['第 ' + (pr ? pr.day : 1) + '/' + p.horizonDays + ' 天'];
    if (pr && pr.phase) parts.push('「' + pr.phase.name + '」');
    if (due.due) parts.push(due.never ? '还没复盘过' : '该复盘了');
    else if (due.days !== null && due.days !== undefined) parts.push(due.days + ' 天前复盘过');
    return parts.join(' · ');
  }

  App.Coach = {
    // 数据
    profile: profile,
    stats: stats,
    weakWords: weakWords,
    errorTags: errorTags,
    planProgress: planProgress,
    currentPhase: currentPhase,
    dueReport: dueReport,
    notice: notice,
    markNotice: markNotice,
    // 计划
    plan: plan,
    planBrief: planBrief,
    savePlan: savePlan,
    clearPlan: clearPlan,
    applyTargets: applyTargets,
    localPlan: localPlan,
    makeLocalPlan: makeLocalPlan,
    generatePlan: generatePlan,
    // 复盘
    reports: reports,
    addReport: addReport,
    removeReport: removeReport,
    localReport: localReport,
    makeLocalReport: makeLocalReport,
    generateReport: generateReport,
    applyAdjust: applyAdjust,
    // 杂项
    summary: summary,
    aiReady: aiReady,
    extractJSON: extractJSON
  };
})(window);
