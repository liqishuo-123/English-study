/* =========================================================
   core/store.js — 全局状态与本地存档（localStorage）
   依赖：core/utils.js
   对外：window.App.Store

   存档策略：
   1. 内存 state 常驻，任何变更调 commit() 打脏标记
   2. 300ms 防抖批量落盘，避免高频答题时卡顿
   3. pagehide + visibilitychange 双保险强制落盘（iOS Safari 上 beforeunload 不可靠）
   4. 写入失败（隐私模式 / 配额满）自动降级为内存态并顶部横幅告警，绝不崩溃
   ========================================================= */
(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var U = App.Utils;

  var STORAGE_KEY = 'cet-workbench';
  var SCHEMA_VERSION = 1;
  var SAVE_DELAY = 300;

  /* ---------------- 默认状态 ---------------- */
  function defaultState() {
    var today = U.today();
    return {
      settings: {
        schemaVersion: SCHEMA_VERSION,
        theme: 'light',            // light | dark
        sound: true,               // 答题音效开关
        examName: '大学英语四级',
        examDate: defaultExamDate(),
        dailyMinutes: 60,          // 每日可用学习时长（分钟）
        dailyNewWords: 30,         // 每天新学单词量
        dailyQuiz: 1,              // 每天做几篇阅读 / 真题训练
        dailyListen: 1,            // 每天精听几段（听力精听已上线）
        dailyWriting: 1,           // 每天积累几条写作素材
        wordBook: 'cet4',          // cet4 | cet6 | all
        firstDay: today,           // 首次使用日期，用于进度条
        customPlan: [],            // 保留兼容字段（不再使用，见上方 daily* 每日目标）
        filter: {
          level: 'cet4',
          freq: ['high'],          // 主维度：默认只背高频
          stage: ['hs', 'beyond'], // 次维度：默认全选（不按学段过滤）
          status: ['new', 'learning'], // 默认排除已掌握
          starredOnly: false,
          consolidate: false,      // 巩固模式：关
          scope: 'today-new',      // today-new | due | starred | custom
          count: 20
        },
        ai: { baseUrl: '', apiKey: '', model: '' },
        ttsVoice: '',              // 听力朗读使用的语音（空 = 自动挑一个）
        ttsRate: 0.9,              // 听力默认语速
        quizType: 'reading',
        coach: {                   // 学习教练的档案（计划里会用）
          targetScore: 500,        // 目标分数（710 分制）
          daysPerWeek: 6,          // 每周能学几天
          weak: [],                // 自认薄弱模块：单词 / 阅读 / 写作 / 听力
          auto: true,              // 是否到点提醒复盘
          every: 3                 // 每几天复盘一次
        }
      },
      progress: {},      // wordId -> { srs, status, mastered, masteredAt, starred, lastSeenAt }
      customWords: [],   // 用户导入的词
      customQuestions: [], // 用户录入的真题
      wrongbook: [],     // 错题
      materials: [],     // 自建写作素材
      listenTasks: [],   // 听力任务
      agentMessages: [], // AI 助教对话记录（只存对话，不存密钥）
      studyPlan: null,   // 学习教练制定的分阶段计划
      coachReports: [],  // 学习教练的复盘记录（最新的在前）
      logs: {},          // 'YYYY-MM-DD' -> { date, minutes, wordsNew, wordsReviewed, quizDone, quizCorrect, planDone, checked }
      mastery: {},       // 'YYYY-MM-DD' -> 累计掌握词数（用于掌握率曲线）
      streak: { best: 0 }
    };
  }

  /** 默认考试日期：当年 12 月第二个周六（若已过则取次年 6 月） */
  function defaultExamDate() {
    var now = new Date();
    var y = now.getFullYear();
    function secondSaturday(year, month) { // month: 0-11
      var d = new Date(year, month, 1);
      var firstSat = 1 + ((6 - d.getDay()) + 7) % 7;
      return new Date(year, month, firstSat + 7);
    }
    var dec = secondSaturday(y, 11);
    if (dec - now > 0) return U.toKey(dec);
    var jun = secondSaturday(y + 1, 5);
    return U.toKey(jun);
  }

  /* ---------------- 内部 ---------------- */
  var state = null;
  var saveTimer = null;
  var dirty = false;
  var storageOK = true;
  var listeners = {};

  function emit(evt, payload) {
    var arr = listeners[evt];
    if (!arr) return;
    for (var i = 0; i < arr.length; i++) {
      try { arr[i](payload); } catch (e) { console.error('[Store] 订阅回调出错', e); }
    }
  }

  /** 深拷贝（数据均为纯 JSON 结构，够用且比 structuredClone 兼容性好） */
  function clone(v) {
    try { return JSON.parse(JSON.stringify(v)); }
    catch (e) { return v; }
  }

  /** 用默认值补齐缺失字段，保证老版本存档升级后不白屏 */
  function migrate(raw) {
    var def = defaultState();
    if (!raw || typeof raw !== 'object') return def;

    var out = def;
    // settings 逐字段补齐
    if (raw.settings && typeof raw.settings === 'object') {
      for (var k in def.settings) {
        if (!Object.prototype.hasOwnProperty.call(def.settings, k)) continue;
        var dv = def.settings[k], rv = raw.settings[k];
        if (rv === undefined || rv === null) continue;
        if (dv && typeof dv === 'object' && !Array.isArray(dv) && typeof rv === 'object' && !Array.isArray(rv)) {
          out.settings[k] = {};
          for (var kk in dv) out.settings[k][kk] = (rv[kk] === undefined) ? dv[kk] : rv[kk];
        } else {
          out.settings[k] = rv;
        }
      }
    }
    ['progress', 'logs', 'mastery'].forEach(function (k) {
      if (raw[k] && typeof raw[k] === 'object') out[k] = raw[k];
    });
    ['customWords', 'customQuestions', 'wrongbook', 'materials', 'listenTasks', 'agentMessages', 'coachReports'].forEach(function (k) {
      if (Array.isArray(raw[k])) out[k] = raw[k];
    });
    if (raw.studyPlan && typeof raw.studyPlan === 'object' && !Array.isArray(raw.studyPlan)) out.studyPlan = raw.studyPlan;
    if (raw.streak && typeof raw.streak === 'object') out.streak.best = raw.streak.best || 0;

    // 补齐 progress 中缺失的子字段（如后期新增 mastered / freq 相关标记）
    for (var id in out.progress) {
      var p = out.progress[id];
      if (!p || typeof p !== 'object') { delete out.progress[id]; continue; }
      if (typeof p.mastered !== 'boolean') p.mastered = false;
      if (typeof p.starred !== 'boolean') p.starred = false;
      if (!p.srs || typeof p.srs !== 'object') p.srs = { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: U.today() };
      var s = p.srs;
      if (typeof s.ease !== 'number') s.ease = 2.5;
      if (typeof s.interval !== 'number') s.interval = 0;
      if (typeof s.reps !== 'number') s.reps = 0;
      if (typeof s.lapses !== 'number') s.lapses = 0;
      if (!s.due) s.due = U.today();
      if (!p.status) p.status = 'new';
    }

    out.settings.schemaVersion = SCHEMA_VERSION;
    return out;
  }

  function load() {
    var raw = null;
    try {
      var txt = localStorage.getItem(STORAGE_KEY);
      if (txt) raw = JSON.parse(txt);
    } catch (e) {
      console.warn('[Store] 读取存档失败，将以空白状态启动', e);
      raw = null;
    }
    return migrate(raw);
  }

  function persist() {
    if (!state) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (!storageOK) { storageOK = true; emit('storage', true); }
      dirty = false;
      emit('saved', Date.now());
    } catch (e) {
      // 隐私模式或配额满：降级为内存态，保证当前会话仍能正常使用
      console.error('[Store] 存档写入失败', e);
      if (storageOK) { storageOK = false; emit('storage', false); }
    }
  }

  var scheduleSave = U.debounce(persist, SAVE_DELAY);

  /* ---------------- 对外 API ---------------- */

  var Store = {
    /** 初始化（app.js 启动时调用一次） */
    init: function () {
      state = load();
      // 强制落盘：pagehide 在 iOS Safari 上比 beforeunload 可靠
      window.addEventListener('pagehide', function () { Store.flush(); });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') Store.flush();
      });
      // 每天首次进入时记录一次掌握数，供掌握率曲线使用
      Store.recordMasterySnapshot();
      return state;
    },

    get state() { return state; },
    get storageOK() { return storageOK; },

    /** 订阅事件：saved / storage / change */
    on: function (evt, fn) {
      (listeners[evt] = listeners[evt] || []).push(fn);
      return function off() {
        var arr = listeners[evt] || [];
        var i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      };
    },

    /** 修改状态后调用：打脏标记并安排落盘 */
    commit: function (fn) {
      if (typeof fn === 'function') fn(state);
      dirty = true;
      scheduleSave();
      emit('change', state);
    },

    /** 立即落盘（切后台 / 关页面 / 重要操作后调用） */
    flush: function () {
      if (!dirty) return;
      if (saveTimer) clearTimeout(saveTimer);
      persist();
    },

    /** 便捷读写 */
    get settings() { return state.settings; },
    setSetting: function (key, value) {
      Store.commit(function (s) { s.settings[key] = value; });
    },

    /* ---------------- 单词进度 ---------------- */
    /** 取单词进度，不存在则返回默认（不写入，避免污染存档） */
    prog: function (wordId) {
      return state.progress[wordId] || null;
    },
    /** 取（或懒创建）单词进度对象 */
    ensureProg: function (wordId) {
      var p = state.progress[wordId];
      if (!p) {
        p = state.progress[wordId] = {
          srs: { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: U.today() },
          status: 'new',
          mastered: false,
          masteredAt: null,
          starred: false,
          lastSeenAt: null
        };
        dirty = true;
      }
      return p;
    },
    setProg: function (wordId, patch) {
      Store.commit(function (s) {
        var p = s.progress[wordId];
        if (!p) {
          p = s.progress[wordId] = {
            srs: { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: U.today() },
            status: 'new', mastered: false, masteredAt: null, starred: false, lastSeenAt: null
          };
        }
        for (var k in patch) {
          if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
          if (k === 'srs' && patch.srs && typeof patch.srs === 'object') {
            for (var sk in patch.srs) p.srs[sk] = patch.srs[sk];
          } else {
            p[k] = patch[k];
          }
        }
      });
    },

    /* ---------------- 每日日志 ---------------- */
    log: function (date) {
      var d = date || U.today();
      var l = state.logs[d];
      if (!l) {
        l = state.logs[d] = {
          date: d, minutes: 0, wordsNew: 0, wordsReviewed: 0,
          quizDone: 0, quizCorrect: 0, quizPapers: 0,
          listenDone: 0, writingDone: 0, writingSeen: [],
          planDone: [], checked: false, customDone: {}
        };
        dirty = true;
      }
      if (!l.customDone) { l.customDone = {}; dirty = true; }
      if (!Array.isArray(l.writingSeen)) { l.writingSeen = []; dirty = true; }
      if (typeof l.quizPapers !== 'number') { l.quizPapers = 0; dirty = true; }
      return l;
    },
    /** 在今日日志上累加数值并落盘（customDone/writingSeen 走对象合并，其余数字累加） */
    addLog: function (patch, date) {
      Store.commit(function (s) {
        var d = date || U.today();
        var l = s.logs[d];
        if (!l) {
          l = s.logs[d] = {
            date: d, minutes: 0, wordsNew: 0, wordsReviewed: 0,
            quizDone: 0, quizCorrect: 0, quizPapers: 0,
            listenDone: 0, writingDone: 0, writingSeen: [],
            planDone: [], checked: false, customDone: {}
          };
        }
        if (!l.customDone) l.customDone = {};
        if (!Array.isArray(l.writingSeen)) l.writingSeen = [];
        if (typeof l.quizPapers !== 'number') l.quizPapers = 0;
        for (var k in patch) {
          if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
          if (k === 'customDone' && patch[k] && typeof patch[k] === 'object') {
            for (var cid in patch[k]) l.customDone[cid] = patch[k][cid];
          } else if (k === 'writingSeen' && Array.isArray(patch[k])) {
            patch[k].forEach(function (id) {
              if (l.writingSeen.indexOf(id) < 0) l.writingSeen.push(id);
            });
            l.writingDone = l.writingSeen.length;
          } else if (typeof patch[k] === 'number' && typeof l[k] === 'number') {
            l[k] += patch[k];
          } else {
            l[k] = patch[k];
          }
        }
      });
    },
    /** 切换某个自定义任务的完成状态，返回切换后是否已完成 */
    toggleCustomDone: function (taskId) {
      var l = Store.log();
      var cur = l.customDone[taskId] || 0;
      var next = cur >= 1 ? 0 : 1;
      Store.addLog({ customDone: (function (o) { o[taskId] = next; return o; })({}) });
      return next >= 1;
    },

    /** 记录当天的累计掌握词数（供掌握率折线图） */
    recordMasterySnapshot: function () {
      var key = U.today();
      if (state.mastery[key] !== undefined) return;
      Store.commit(function (s) {
        var n = 0;
        for (var id in s.progress) if (s.progress[id].mastered) n++;
        s.mastery[key] = n;
      });
    },

    /* ---------------- 连续打卡 ---------------- */
    streak: function () {
      var n = 0;
      var d = U.today();
      // 今天没打卡不算断，从昨天往前数
      if (!state.logs[d] || !state.logs[d].checked) d = U.addDays(d, -1);
      while (state.logs[d] && state.logs[d].checked) { n++; d = U.addDays(d, -1); }
      return n;
    },

    /* ---------------- 存档导出 / 导入 ---------------- */
    /**
     * 导出存档。
     * 默认剔除 AI 密钥：备份文件常被丢进网盘或转发，密钥不该跟着走。
     * 恢复后到「我的 → AI 接口配置」重填一次即可。
     * @param {{ keepSecret?: boolean }} [opt] 传 keepSecret 则连密钥一起导出
     */
    exportJSON: function (opt) {
      Store.flush();
      var data = clone(state);
      var keep = !!(opt && opt.keepSecret);
      if (!keep && data.settings && data.settings.ai) data.settings.ai.apiKey = '';
      return JSON.stringify({
        app: 'cet-workbench',
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        keyIncluded: keep,
        data: data
      }, null, 2);
    },

    /**
     * 导入存档
     * @returns {{ok:boolean, message:string}}
     */
    importJSON: function (text) {
      var parsed;
      try { parsed = JSON.parse(text); }
      catch (e) { return { ok: false, message: '不是合法的 JSON 文件，请检查后重试' }; }

      var data = parsed && parsed.data ? parsed.data : parsed;
      if (!data || typeof data !== 'object') return { ok: false, message: '文件内容不是有效的存档格式' };
      if (!data.settings && !data.progress && !data.logs) {
        return { ok: false, message: '未找到存档字段（settings / progress / logs），可能选错了文件' };
      }

      // 先备份当前状态，迁移失败可回滚
      var backup = clone(state);
      try {
        var next = migrate(data);
        // 备份默认不含密钥：如果当前设备已经配过，就别让空值把密钥抹掉
        var oldAi = (backup.settings && backup.settings.ai) || {};
        if (next.settings && next.settings.ai && !next.settings.ai.apiKey && oldAi.apiKey
            && next.settings.ai.baseUrl === oldAi.baseUrl) {
          next.settings.ai.apiKey = oldAi.apiKey;
        }
        state = next;
        dirty = true;
        Store.flush();
        emit('change', state);
        emit('imported', state);
        return { ok: true, message: '存档导入成功' };
      } catch (e) {
        state = backup;
        return { ok: false, message: '导入失败，已保留原数据：' + e.message };
      }
    },

    /** 清空全部数据（恢复出厂） */
    reset: function () {
      state = defaultState();
      dirty = true;
      Store.flush();
      emit('change', state);
    },

    /** 存档体积（字节，UTF-8 近似） */
    sizeBytes: function () {
      try {
        var txt = localStorage.getItem(STORAGE_KEY) || '';
        var bytes = 0;
        for (var i = 0; i < txt.length; i++) {
          var c = txt.charCodeAt(i);
          bytes += c < 0x80 ? 1 : (c < 0x800 ? 2 : 3);
        }
        return bytes;
      } catch (e) { return 0; }
    }
  };

  App.Store = Store;
})(window);
