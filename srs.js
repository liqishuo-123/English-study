/* =========================================================
   core/srs.js — 间隔重复算法（简化版 SM-2）
   依赖：core/utils.js
   对外：window.App.SRS

   为什么用 SM-2 而不是原始艾宾浩斯：
   原始艾宾浩斯是固定间隔（1/2/4/7/15 天），不看你答得好不好。
   SM-2 会为每张卡片维护「难度系数 ease」，答错就缩短间隔、答对就拉长，
   同一个词你总是记不住就天天见，一次就会的词可以几周后再见，效率更高。
   ========================================================= */
(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var U = App.Utils;

  var EASE_MIN = 1.3;
  var EASE_MAX = 2.8;
  var MAX_INTERVAL = 180;   // 最长 180 天
  var AUTO_MASTER_INTERVAL = 15; // 间隔达到 15 天且连续答对 4 次 → 自动判定掌握
  var AUTO_MASTER_REPS = 4;

  /**
   * 评分并计算下一次复习时间
   * @param {Object} srs  { ease, interval, reps, lapses, due }
   * @param {number} q    0=不认识 1=模糊 2=认识
   * @returns {Object} 新的 srs 对象（不修改入参）
   */
  function gradeWord(srs, q) {
    srs = srs || { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: U.today() };
    var ease = typeof srs.ease === 'number' ? srs.ease : 2.5;
    var interval = typeof srs.interval === 'number' ? srs.interval : 0;
    var reps = typeof srs.reps === 'number' ? srs.reps : 0;
    var lapses = typeof srs.lapses === 'number' ? srs.lapses : 0;

    if (q === 2) {
      // 认识：按难度系数拉长间隔，阶梯起步 1 → 2 天，之后 ×ease
      reps += 1;
      if (reps === 1) interval = 1;
      else if (reps === 2) interval = 2;
      else interval = Math.min(MAX_INTERVAL, Math.max(3, Math.round(interval * ease)));
      ease = Math.min(EASE_MAX, ease + 0.05);
    } else if (q === 1) {
      // 模糊：不进反退，间隔砍半但至少 1 天，明天再见
      reps = 0;
      interval = interval > 0 ? Math.max(1, Math.round(interval * 0.5)) : 1;
      ease = Math.max(EASE_MIN, ease - 0.15);
    } else {
      // 不认识：完全重置，今天还要再见到它
      reps = 0;
      interval = 0;
      lapses += 1;
      ease = Math.max(EASE_MIN, ease - 0.20);
    }

    return {
      ease: Math.round(ease * 100) / 100,
      interval: interval,
      reps: reps,
      lapses: lapses,
      due: U.addDays(U.today(), interval)
    };
  }

  /** 单词当前应处于的状态（不含手动掌握标记） */
  function statusFor(srs) {
    if (!srs) return 'new';
    if (srs.interval === 0 && (srs.reps || 0) === 0) return 'new';
    return 'learning';
  }

  /** 是否达到「自动掌握」门槛 */
  function isAutoMastered(srs) {
    if (!srs) return false;
    return (srs.interval || 0) >= AUTO_MASTER_INTERVAL && (srs.reps || 0) >= AUTO_MASTER_REPS;
  }

  /** 逾期天数（正数表示已经该复习了） */
  function overdueDays(srs, today) {
    if (!srs || !srs.due) return 0;
    return U.diffDays(srs.due, today || U.today());
  }

  /**
   * 取出到期需要复习的词
   * @param {Array} words 完整词表（每项需含 srs 字段）
   * @param {string} today
   * @returns {Array} 按逾期天数降序
   */
  function getDueQueue(words, today) {
    today = today || U.today();
    var out = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w.srs || !w.srs.due) continue;
      if (U.diffDays(w.srs.due, today) >= 0) out.push(w);
    }
    out.sort(function (a, b) {
      return overdueDays(b.srs, today) - overdueDays(a.srs, today);
    });
    return out;
  }

  /**
   * 统计各状态数量（供数据看板使用）
   * @returns {{new:number, learning:number, mastered:number, due:number, total:number}}
   */
  function getMasteryStats(words, today) {
    today = today || U.today();
    var st = { new: 0, learning: 0, mastered: 0, due: 0, total: words.length };
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.mastered) { st.mastered++; continue; }
      var s = statusFor(w.srs);
      if (s === 'new') st.new++; else st.learning++;
      if (w.srs && w.srs.due && U.diffDays(w.srs.due, today) >= 0) st.due++;
    }
    return st;
  }

  /** 把下一次复习时间转成中文说明，便于界面展示 */
  function dueLabel(srs, today) {
    if (!srs || !srs.due) return '未学习';
    var d = U.diffDays(today || U.today(), srs.due);
    if (d < 0) return '已逾期 ' + (-d) + ' 天';
    if (d === 0) return '今天复习';
    if (d === 1) return '明天复习';
    return d + ' 天后复习';
  }

  App.SRS = {
    gradeWord: gradeWord,
    statusFor: statusFor,
    isAutoMastered: isAutoMastered,
    overdueDays: overdueDays,
    getDueQueue: getDueQueue,
    getMasteryStats: getMasteryStats,
    dueLabel: dueLabel,
    AUTO_MASTER_INTERVAL: AUTO_MASTER_INTERVAL,
    AUTO_MASTER_REPS: AUTO_MASTER_REPS
  };
})(window);
