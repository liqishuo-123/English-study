/* =========================================================
   views/today.js — 今日总览（启动首页）+ 每日计划生成器
   依赖：core/*, data/*
   ========================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.Utils;

  var lastRoot = null;   // 当前渲染根节点，供设置面板保存后重绘

  /**
   * 今日任务清单：直接根据 settings 里的每日目标数字生成，
   * 不再需要手动增删任务。目标 ≤ 0 的分类不显示（不想练就填 0）。
   */
  function buildPlan() {
    var st = App.Store.state.settings;
    var log = App.Store.log();
    var today = U.today();
    var rows = [];

    // 1) 复习到期词（自动按遗忘曲线计算，无需设置）
    var dueCount = 0;
    var words = App.Words.all;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.level === 'cet6' || w.mastered || w.isPhrase) continue;
      if (w.srs && w.srs.due && w.srs.reps > 0 && U.diffDays(w.srs.due, today) >= 0) dueCount++;
    }
    var reviewTarget = Math.min(60, dueCount);
    rows.push({
      id: 'review', type: 'review',
      title: reviewTarget > 0 ? '复习到期单词 ' + reviewTarget + ' 个' : '今日暂无到期复习',
      sub: reviewTarget > 0 ? '按遗忘曲线安排，逾期越久越优先' : '没有到期复习时，可专注新学单词',
      done: reviewTarget === 0 ? true : log.wordsReviewed >= reviewTarget,
      go: '#/words'
    });

    // 2) 新学单词
    var newN = Math.max(0, parseInt(st.dailyNewWords, 10) || 0);
    if (newN > 0) {
      rows.push({
        id: 'new', type: 'new',
        title: '新学单词 ' + newN + ' 个',
        sub: '高频优先，已掌握的词自动跳过',
        done: log.wordsNew >= newN,
        go: '#/words'
      });
    }

    // 3) 阅读 / 真题训练（按完成套数统计）
    var quizN = Math.max(0, parseInt(st.dailyQuiz, 10) || 0);
    if (quizN > 0) {
      rows.push({
        id: 'reading', type: 'quiz',
        title: quizN > 1 ? '完成 ' + quizN + ' 篇阅读训练' : '完成 1 篇阅读训练',
        sub: '选词填空 / 长篇匹配 / 仔细阅读任选，提交一套记一次',
        done: (log.quizPapers || 0) >= quizN,
        go: '#/quiz'
      });
    }

    // 4) 写作素材（按当天复习的条数统计）
    var wrN = Math.max(0, parseInt(st.dailyWriting, 10) || 0);
    if (wrN > 0) {
      rows.push({
        id: 'writing', type: 'writing',
        title: wrN > 1 ? '复习 ' + wrN + ' 条写作素材' : '复习 1 条写作素材',
        sub: '模板 / 句型 / 替换词 / 翻译句式，点开即计数',
        done: (log.writingDone || 0) >= wrN,
        go: '#/writing'
      });
    }

    return rows;
  }

  function render(root) {
    lastRoot = root;
    U.clear(root);
    var st = App.Store.state.settings;
    var log = App.Store.log();
    var today = U.today();
    var plan = buildPlan();

    var daysLeft = U.diffDays(today, st.examDate);
    var totalDays = Math.max(1, U.diffDays(st.firstDay || today, st.examDate));
    var passedDays = U.diffDays(st.firstDay || today, today);
    var progress = U.clamp(Math.round((passedDays / totalDays) * 100), 0, 100);

    var doneCount = plan.filter(function (t) { return t.done; }).length;

    /* ---------- 顶部倒计时卡 ---------- */
    var hero = U.el('section.hero', null, [
      U.el('div.hero-top', null, [
        U.el('div.hero-appname', { text: '四六级英语工作台' }),
        U.el('button.icon-btn', {
          type: 'button', 'aria-label': '切换主题',
          onclick: function () {
            var next = App.Store.state.settings.theme === 'dark' ? 'light' : 'dark';
            App.Store.setSetting('theme', next);
            App.applyTheme(next);
            render(root);
          }
        }, [U.icon(App.Store.state.settings.theme === 'dark' ? 'sun' : 'moon')])
      ]),
      U.el('div.hero-count', null, [
        U.el('div.hero-count-num', { text: daysLeft >= 0 ? String(daysLeft) : '0' }),
        U.el('div.hero-count-unit', { text: '天' }),
        U.el('div.hero-count-label', { html: (daysLeft >= 0 ? '距离 ' + U.escapeHtml(st.examName || '考试') : '考试日期已过，可到「我的」修改') + '<br>' + U.escapeHtml(st.examDate) })
      ]),
      U.el('div.hero-bar', null, [
        U.el('div.hero-bar-fill', { style: { width: progress + '%' } })
      ])
    ]);

    /* ---------- 今日进度环 ---------- */
    var R = 34, C = 2 * Math.PI * R;
    var ringOffset = C * (1 - doneCount / plan.length);
    var ring = U.el('section.ring-wrap', null, [
      U.el('div.ring', null, [
        (function () {
          var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 84 84');
          var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
          defs.innerHTML = '<linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0%" stop-color="#4F46E5"/><stop offset="100%" stop-color="#22D3EE"/></linearGradient>';
          var t = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          t.setAttribute('class', 'ring-track');
          t.setAttribute('cx', '42'); t.setAttribute('cy', '42'); t.setAttribute('r', String(R));
          t.setAttribute('fill', 'none'); t.setAttribute('stroke-width', '7');
          var p = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          p.setAttribute('class', 'ring-prog');
          p.setAttribute('cx', '42'); p.setAttribute('cy', '42'); p.setAttribute('r', String(R));
          p.setAttribute('fill', 'none'); p.setAttribute('stroke-width', '7');
          p.setAttribute('stroke-dasharray', String(C));
          p.setAttribute('stroke-dashoffset', String(ringOffset));
          svg.appendChild(defs); svg.appendChild(t); svg.appendChild(p);
          return svg;
        })(),
        U.el('div.ring-text', null, [
          U.el('div.ring-num', { text: doneCount + '/' + plan.length }),
          U.el('div.ring-sub', { text: '今日任务' })
        ])
      ]),
      U.el('div.ring-info', null, [
        U.el('div.ring-info-title', { text: doneCount === plan.length ? '今日任务已完成 🎉' : '还差 ' + (plan.length - doneCount) + ' 项' }),
        U.el('div.ring-info-desc', {
          text: '目标 ' + U.fmtMinutes(st.dailyMinutes) + '／天，完成后记得打卡'
        })
      ])
    ]);

    /* ---------- 任务清单 ---------- */
    var taskCard = U.el('section.card', null, [
      U.el('div.card-title', null, [U.icon('target'), '今日任务', U.el('span.spacer'),
        U.el('span.badge.badge-brand', { text: doneCount + '/' + plan.length }),
        U.el('button.link-btn', {
          type: 'button',
          onclick: function () { App.openPlanEditor ? App.openPlanEditor() : App.Router.go('#/me'); }
        }, [U.icon('edit'), '调整目标'])]),
      U.el('div', null, plan.map(function (t) {
        return U.el('button.task' + (t.done ? '.is-done' : ''), {
          type: 'button',
          onclick: function () { App.Router.go(t.go); }
        }, [
          U.el('span.task-box', null, [U.icon('check')]),
          U.el('span.task-main', null, [
            U.el('span.task-title', { text: t.title }),
            U.el('span.task-sub', { text: t.sub })
          ]),
          U.el('span.task-go', null, [U.icon('right')])
        ]);
      }))
    ]);

    /* ---------- 真题主行动卡（底部 Tab 未收录真题，放在这里做主入口） ---------- */
    var wrongCount = App.Store.state.wrongbook.length;
    var cta = U.el('button.cta-quiz', {
      type: 'button',
      onclick: function () { App.Router.go('#/quiz'); }
    }, [
      U.el('span.cta-quiz-icon', null, [U.icon('book')]),
      U.el('span.cta-quiz-main', null, [
        U.el('span.cta-quiz-title', { text: '真题训练' }),
        U.el('span.cta-quiz-desc', { text: wrongCount > 0 ? '错题本有 ' + wrongCount + ' 题待复习' : '选词填空 · 长篇匹配 · 仔细阅读' })
      ]),
      U.el('span.cta-quiz-tail', null, [
        wrongCount > 0 ? U.el('span.badge', { style: { background: 'rgba(255,255,255,.25)', color: '#fff' }, text: String(wrongCount) }) : null,
        U.icon('right')
      ])
    ]);

    /* ---------- 模块宫格 ---------- */
    var grid = U.el('div.grid-mod', null, [
      modCell('cards', '单词', '#/words', 0),
      modCell('book', '错题本', '#/wrongbook', wrongCount),
      modCell('pen', '写作', '#/writing', 0),
      modCell('read', '阅读', '#/quiz', 0)
    ]);

    /* ---------- 打卡按钮 ---------- */
    var checkin = U.el('button.checkin' + (log.checked ? '.is-done' : ''), {
      type: 'button',
      onclick: function () {
        if (App.Store.log().checked) {
          U.toast('今天已经打过卡啦', 'ok');
          return;
        }
        App.Store.addLog({ checked: true });
        App.Store.flush();
        U.vibrate([12, 40, 18]);
        this.classList.add('is-done', 'is-just');
        U.toast('打卡成功，连续 ' + App.Store.streak() + ' 天', 'ok');
        var self = this;
        setTimeout(function () { self.classList.remove('is-just'); }, 600);
        setTimeout(function () { render(root); }, 700);
      }
    }, [
      U.icon(log.checked ? 'check' : 'fire'),
      log.checked ? '今日已打卡 · 连续 ' + App.Store.streak() + ' 天' : '完成今日学习，打卡'
    ]);

    root.appendChild(hero);
    root.appendChild(ring);
    root.appendChild(taskCard);
    root.appendChild(cta);
    root.appendChild(grid);
    root.appendChild(checkin);

    // 底部「单词」Tab 红点：有到期复习时提醒
    var due = App.Words.todayPending();
    if (App.NAV) App.NAV.setDot('words', due > 0);
  }

  function modCell(iconName, label, route, badge) {
    return U.el('button.mod-cell', {
      type: 'button',
      onclick: function () { App.Router.go(route); }
    }, [
      badge > 0 ? U.el('span.badge', { text: String(badge) }) : null,
      U.icon(iconName),
      U.el('span.mod-cell-label', { text: label })
    ]);
  }

  /* =========================================================
     每日目标设置（简单版，挂到 App.openPlanEditor）
     - 直接用数字设置：每天新学几词 / 做几篇阅读 / 精听几段 / 复习几条素材
     - 填 0 = 不练这类，任务清单里就不出现该任务
     - 复习到期的词由系统按遗忘曲线自动安排，无需设置
     ========================================================= */
  function numRow(label, hint, input) {
    return U.el('div.field', { style: { marginBottom: '14px' } }, [
      U.el('label.field-label', { text: label }),
      hint ? U.el('div.field-hint', { style: { margin: '4px 0 6px' }, text: hint }) : null,
      input
    ]);
  }

  function openPlanEditor() {
    var st = App.Store.state.settings;

    var newInput = U.el('input.input', { type: 'number', min: '0', max: '200', step: '5', value: String(st.dailyNewWords || 0) });
    var quizInput = U.el('input.input', { type: 'number', min: '0', max: '20', step: '1', value: String(st.dailyQuiz || 0) });
    var wrInput = U.el('input.input', { type: 'number', min: '0', max: '50', step: '1', value: String(st.dailyWriting || 0) });
    var minInput = U.el('input.input', { type: 'number', min: '0', max: '600', step: '10', value: String(st.dailyMinutes || 0) });

    var body = U.el('div', null, [
      U.el('div.field-hint', {
        style: { marginBottom: '12px', lineHeight: 1.7 },
        text: '直接填数字就行，保存后「今日」的任务清单会自动按这些目标生成。哪类不想练就填 0，对应任务当天不会出现。到期该复习的词由系统自动算好，不用你管。'
      }),
      numRow('每天新学单词（个）', '建议 20~50，填 0 表示今天不背新词', newInput),
      numRow('每天完成阅读（篇）', '提交一套选词填空 / 长篇匹配 / 仔细阅读即算 1 篇', quizInput),
      numRow('每天复习写作素材（条）', '模板 / 句型 / 替换词 / 翻译句式，点开一条记一条', wrInput),
      numRow('每天学习时长（分钟）', '仅作参考展示，用于控制学习节奏', minInput)
    ]);

    U.openSheet({
      title: '调整每日目标',
      body: body,
      foot: [
        U.el('button.btn.btn-ghost', { type: 'button', onclick: U.closeSheet }, ['取消']),
        U.el('button.btn.btn-primary', {
          type: 'button',
          onclick: function () {
            function num(v, lo, hi, dft) {
              var n = parseInt(v, 10);
              if (isNaN(n)) return dft;
              return Math.max(lo, Math.min(hi, n));
            }
            App.Store.commit(function (s) {
              s.settings.dailyNewWords = num(newInput.value, 0, 200, 30);
              s.settings.dailyQuiz = num(quizInput.value, 0, 20, 1);
              s.settings.dailyWriting = num(wrInput.value, 0, 50, 1);
              s.settings.dailyMinutes = num(minInput.value, 0, 600, 60);
              s.settings.customPlan = [];   // 旧版复杂自定义计划已弃用，清空避免影响
            });
            App.Store.flush();
            U.closeSheet();
            U.toast('每日目标已保存', 'ok');
            if (lastRoot) render(lastRoot);
          }
        }, ['保存'])
      ]
    });
  }

  // 挂到 App 供「我的」页与今日页复用
  App.openPlanEditor = openPlanEditor;

  App.Views = App.Views || {};
  App.Views.today = function () {
    return { render: render, destroy: function () { } };
  };
})(window);
