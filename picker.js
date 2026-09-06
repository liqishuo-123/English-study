/* =========================================================
   core/picker.js — 抽题引擎（单词视图与错题本共用）
   依赖：core/utils.js, core/store.js, core/srs.js, core/wordsdb.js
   对外：window.App.Picker

   四件事集中在这里，避免各视图各写一套导致行为不一致：
   1. 组合筛选：词书 / 频率 / 学段 / 状态 / 生词本 / 范围
   2. 排除规则：已掌握的词默认退出抽题池（除非开巩固模式）
   3. 优先级排序：频率降序 → 逾期天数降序 → 越久没见越优先
   4. 单轮去重：同一次练习内绝不重复抽到同一个词
   ========================================================= */
(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var U = App.Utils;
  var SRS = App.SRS;

  var FREQ_WEIGHT = { high: 3, mid: 2, low: 1 };

  /* 缓存：revision 随存档变更自增，保证标记掌握后抽题池立即刷新 */
  var revision = 0;
  var cache = Object.create(null);

  function bumpRevision() { revision++; cache = Object.create(null); }

  /**
   * 构建抽题池
   * @param {Object} o 筛选条件
   * @returns {{words:Array, empty:boolean, reason:string}}
   */
  function buildPool(o) {
    o = o || {};
    var level = o.level || 'cet4';
    var freq = o.freq && o.freq.length ? o.freq : ['high', 'mid', 'low'];
    var stage = o.stage && o.stage.length ? o.stage : ['hs', 'beyond'];
    var status = o.status && o.status.length ? o.status : ['new', 'learning', 'mastered'];
    var starredOnly = !!o.starredOnly;
    var consolidate = !!o.consolidate;
    var scope = o.scope || 'custom';

    var key = [revision, level, freq.join(','), stage.join(','), status.join(','),
      starredOnly ? 1 : 0, consolidate ? 1 : 0, scope, o.count || 0].join('|');
    if (cache[key]) return cache[key];

    var words = App.Words ? App.Words.all : [];
    var today = U.today();

    // 勾选了「已掌握」等同于打开巩固模式
    var allowMastered = consolidate || status.indexOf('mastered') >= 0;

    var freqSet = {}, stageSet = {}, statusSet = {};
    freq.forEach(function (x) { freqSet[x] = 1; });
    stage.forEach(function (x) { stageSet[x] = 1; });
    status.forEach(function (x) { statusSet[x] = 1; });

    var pool = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];

      // 1) 词书
      if (level !== 'all' && w.level !== level) continue;
      // 2) 频率（主维度）
      if (!freqSet[w.freq]) continue;
      // 3) 学段（次维度：高中课标内 / 高中外）
      if (!stageSet[w.stage]) continue;
      // 4) 已掌握默认排除
      if (w.mastered && !allowMastered) continue;
      // 5) 状态
      var st = w.mastered ? 'mastered' : SRS.statusFor(w.srs);
      if (!statusSet[st]) continue;
      // 6) 只看生词本
      if (starredOnly && !w.starred) continue;
      // 7) 范围
      if (scope === 'today-new' && st !== 'new') continue;
      if (scope === 'due') {
        if (!w.srs || !w.srs.due || U.diffDays(w.srs.due, today) < 0) continue;
      }
      if (scope === 'starred' && !w.starred) continue;

      pool.push(w);
    }

    // 优先级排序：频率降序 → 逾期天数降序 → 越久未见越优先
    pool.sort(function (a, b) {
      var fa = FREQ_WEIGHT[a.freq] || 1, fb = FREQ_WEIGHT[b.freq] || 1;
      if (fa !== fb) return fb - fa;
      var oa = SRS.overdueDays(a.srs, today), ob = SRS.overdueDays(b.srs, today);
      if (oa !== ob) return ob - oa;
      var la = a.lastSeenAt ? U.diffDays(a.lastSeenAt, today) : 999;
      var lb = b.lastSeenAt ? U.diffDays(b.lastSeenAt, today) : 999;
      if (la !== lb) return lb - la;
      return a.word < b.word ? -1 : 1;
    });

    // 自定义数量
    if (scope === 'custom' && o.count > 0) pool = pool.slice(0, o.count);

    var result = {
      words: pool,
      empty: pool.length === 0,
      reason: pool.length === 0 ? diagnose(o, words, allowMastered) : ''
    };
    cache[key] = result;
    return result;
  }

  /** 命中 0 词时，判断是哪个维度造成的，给出可执行的提示 */
  function diagnose(o, words, allowMastered) {
    var today = U.today();
    function countBy(fn) {
      var n = 0;
      for (var i = 0; i < words.length; i++) if (fn(words[i])) n++;
      return n;
    }
    var level = o.level || 'cet4';
    var inLevel = countBy(function (w) { return level === 'all' || w.level === level; });
    if (inLevel === 0) return 'level';

    var freq = o.freq && o.freq.length ? o.freq : ['high', 'mid', 'low'];
    var inFreq = countBy(function (w) {
      return (level === 'all' || w.level === level) && freq.indexOf(w.freq) >= 0;
    });
    if (inFreq === 0) return 'freq';

    var stage = o.stage && o.stage.length ? o.stage : ['hs', 'beyond'];
    var inStage = countBy(function (w) {
      return (level === 'all' || w.level === level) && freq.indexOf(w.freq) >= 0 && stage.indexOf(w.stage) >= 0;
    });
    if (inStage === 0) return 'stage';

    var status = o.status && o.status.length ? o.status : ['new', 'learning', 'mastered'];
    var inStatus = countBy(function (w) {
      if (w.mastered && !allowMastered) return false;
      var st = w.mastered ? 'mastered' : SRS.statusFor(w.srs);
      return (level === 'all' || w.level === level) && freq.indexOf(w.freq) >= 0 &&
        stage.indexOf(w.stage) >= 0 && status.indexOf(st) >= 0;
    });
    if (inStatus === 0) return allowMastered ? 'status' : 'mastered';

    if (o.scope === 'due') return 'due';
    if (o.scope === 'today-new') return 'today-new';
    return 'status';
  }

  var REASON_TEXT = {
    level: '当前词书里没有词，换一本词书试试',
    freq: '这个频率档暂时没有词，勾选其他频率试试',
    stage: '「高中 / 高中外」的组合下没有词，把两个都勾上试试',
    status: '当前状态筛选下没有词，勾选「未学」或「学习中」试试',
    mastered: '符合范围的词都被标记为「已掌握」了，打开「巩固模式」可以重新练它们',
    due: '今天没有到期需要复习的词，换个范围试试',
    'today-new': '这个范围里的新词已经学完了，换个范围或勾选其他频率'
  };

  function reasonText(reason) { return REASON_TEXT[reason] || '没有符合条件的词，试试放宽筛选条件'; }

  /**
   * 创建一次练习会话：内部维护 usedIds，保证单轮内不重复出同一个词
   * @param {Array} pool 词数组
   */
  function createSession(pool) {
    var used = Object.create(null);
    var queue = [];
    var total = pool.length;
    var seen = 0;

    function refill() {
      var rest = [];
      for (var i = 0; i < pool.length; i++) {
        if (!used[pool[i].id]) rest.push(pool[i]);
      }
      if (rest.length === 0) {
        // 本轮全部过完 → 清空记录，开始新一轮
        used = Object.create(null);
        rest = pool.slice();
        seen = 0;
      }
      queue = rest;
    }
    refill();

    return {
      total: total,
      /** 取下一个词；没有词时返回 null */
      next: function () {
        if (queue.length === 0) refill();
        if (queue.length === 0) return null;
        var w = queue.shift();
        used[w.id] = 1;
        seen++;
        return w;
      },
      /** 本轮还剩多少个没出过 */
      remaining: function () { return queue.length; },
      /** 本轮已出过多少个 */
      done: function () { return seen; },
      /** 丢弃当前词（标记为已掌握后调用，避免它再次出现） */
      drop: function (wordId) {
        used[wordId] = 1;
        queue = queue.filter(function (w) { return w.id !== wordId; });
      },
      reset: function () { used = Object.create(null); seen = 0; refill(); }
    };
  }

  /* ---------------- 已掌握词批量管理 ---------------- */
  function masteredWords() {
    if (!App.Words) return [];
    return App.Words.all.filter(function (w) { return w.mastered; });
  }
  function starredWords() {
    if (!App.Words) return [];
    return App.Words.all.filter(function (w) { return w.starred; });
  }

  /* 存档一变就失效缓存，保证「标记掌握后立刻退出抽题池」 */
  if (App.Store) App.Store.on('change', bumpRevision);

  App.Picker = {
    buildPool: buildPool,
    createSession: createSession,
    reasonText: reasonText,
    masteredWords: masteredWords,
    starredWords: starredWords,
    invalidate: bumpRevision,
    FREQ_WEIGHT: FREQ_WEIGHT
  };
})(window);
