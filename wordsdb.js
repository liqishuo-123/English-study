/* =========================================================
   core/wordsdb.js — 词库装配层（在数据文件之后、视图之前加载）
   依赖：core/utils.js, core/store.js
   对外：window.App.Words

   设计要点：
   - 静态词条来自 data/*，学习进度来自 Store.state.progress
   - 用属性 getter 把两者「黏」在同一个对象上，视图读 w.mastered 就像读普通字段，
     但底层始终是 Store 里的存档数据，改一处即同步，不需要每次重建整个词表
   ========================================================= */
(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var U = App.Utils;

  var all = [];
  var byId = Object.create(null);

  var DEFAULT_SRS = null; // 延迟到首次使用时生成（依赖当天日期）

  function defaultSrs() {
    if (!DEFAULT_SRS) {
      DEFAULT_SRS = { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: U.today() };
    }
    return DEFAULT_SRS;
  }

  /** 把学习进度挂到词条对象上，视图读写无感知 */
  function decorate(w) {
    var defs = {
      srs: {
        get: function () {
          var p = App.Store.state.progress[w.id];
          return p && p.srs ? p.srs : defaultSrs();
        },
        set: function (v) { App.Store.setProg(w.id, { srs: v }); }
      },
      status: {
        get: function () {
          var p = App.Store.state.progress[w.id];
          return p ? p.status : 'new';
        },
        set: function (v) { App.Store.setProg(w.id, { status: v }); }
      },
      mastered: {
        get: function () {
          var p = App.Store.state.progress[w.id];
          return !!(p && p.mastered);
        },
        set: function (v) { App.Store.setProg(w.id, { mastered: !!v, masteredAt: v ? U.today() : null }); }
      },
      masteredAt: {
        get: function () {
          var p = App.Store.state.progress[w.id];
          return p ? p.masteredAt : null;
        },
        set: function (v) { App.Store.setProg(w.id, { masteredAt: v }); }
      },
      starred: {
        get: function () {
          var p = App.Store.state.progress[w.id];
          return !!(p && p.starred);
        },
        set: function (v) { App.Store.setProg(w.id, { starred: !!v }); }
      },
      lastSeenAt: {
        get: function () {
          var p = App.Store.state.progress[w.id];
          return p ? p.lastSeenAt : null;
        },
        set: function (v) { App.Store.setProg(w.id, { lastSeenAt: v }); }
      }
    };
    Object.defineProperties(w, defs);
    return w;
  }

  /** 原始条目 → 标准词条 */
  function normalize(raw, level, index, isPhrase) {
    var prefix = isPhrase ? 'ph' : (level === 'cet6' ? 'c6' : 'c4');
    return decorate({
      id: raw.id || (prefix + '_' + index),
      word: String(raw.w || raw.word || '').trim(),
      phonetic: String(raw.p || raw.phonetic || '').trim(),
      pos: String(raw.pos || '').trim(),
      meaning: String(raw.m || raw.meaning || '').trim(),
      example: String(raw.e || raw.example || '').trim(),
      exampleCn: String(raw.ec || raw.exampleCn || '').trim(),
      level: level,
      freq: raw.f || raw.freq || 'mid',
      stage: raw.s || raw.stage || 'hs',
      posTag: raw.posTag || '',
      isPhrase: !!isPhrase,
      custom: !!raw.custom
    });
  }

  function rebuild() {
    all = [];
    byId = Object.create(null);

    var cet4 = App.RAW_CET4 || [];
    var cet6 = App.RAW_CET6 || [];
    var phrases = App.RAW_PHRASES || [];
    var custom = App.Store.state.customWords || [];

    var i;
    for (i = 0; i < cet4.length; i++) all.push(normalize(cet4[i], 'cet4', i, false));
    for (i = 0; i < cet6.length; i++) all.push(normalize(cet6[i], 'cet6', i, false));
    for (i = 0; i < phrases.length; i++) all.push(normalize(phrases[i], 'cet4', i, true));
    for (i = 0; i < custom.length; i++) {
      var c = custom[i];
      all.push(decorate({
        id: c.id || ('cw_' + i),
        word: c.word, phonetic: c.phonetic || '', pos: c.pos || '',
        meaning: c.meaning, example: c.example || '', exampleCn: c.exampleCn || '',
        level: c.level || 'cet4', freq: c.freq || 'mid', stage: c.stage || 'hs',
        posTag: c.posTag || '', isPhrase: false, custom: true
      }));
    }

    for (i = 0; i < all.length; i++) byId[all[i].id] = all[i];
    if (App.Picker) App.Picker.invalidate();
    return all;
  }

  /** 按 id 取词 */
  function get(id) { return byId[id] || null; }

  /** 按 level 取子集 */
  function byLevel(level) {
    if (level === 'all') return all;
    return all.filter(function (w) { return w.level === level; });
  }

  /** 今日待办统计（供今日页与底部红点使用） */
  function todayPending() {
    var today = U.today();
    var dueCount = 0;
    for (var i = 0; i < all.length; i++) {
      var w = all[i];
      if (w.level === 'cet6') continue;
      if (w.mastered) continue;
      if (w.srs && w.srs.due && U.diffDays(w.srs.due, today) >= 0 && w.srs.reps > 0) dueCount++;
    }
    return dueCount;
  }

  function counts() {
    var c = { total: all.length, cet4: 0, cet6: 0, phrase: 0, custom: 0, mastered: 0, starred: 0 };
    for (var i = 0; i < all.length; i++) {
      var w = all[i];
      if (w.isPhrase) c.phrase++;
      else if (w.level === 'cet6') c.cet6++;
      else c.cet4++;
      if (w.custom) c.custom++;
      if (w.mastered) c.mastered++;
      if (w.starred) c.starred++;
    }
    return c;
  }

  App.Words = {
    rebuild: rebuild,
    get: get,
    byLevel: byLevel,
    todayPending: todayPending,
    counts: counts,
    get all() { return all; }
  };
})(window);
