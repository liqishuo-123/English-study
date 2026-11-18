/* =========================================================
   views/wrongbook.js — 错题本（二级页）
   依赖：core/*, data/*
   功能：
   - 按题型归类浏览错题，标注错次与到期状态
   - 到期重练 / 单题重练：答对自动移出错题本，答错顺延复习
   - 移除错题与统计
   ========================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.Utils;
  var IMP = App.Importer;

  var TYPE_LABEL = {
    'select-fill': '选词填空',
    'matching': '长篇匹配',
    'reading': '仔细阅读'
  };
  var TYPE_ORDER = ['reading', 'matching', 'select-fill'];

  var stage = 'list';      // list | do
  var queue = [];          // 正在重练的错题
  var index = 0;           // 当前题号
  var rightCount = 0;

  var lastRoot = null;

  function render(root) {
    lastRoot = root;
    U.clear(root);
    root.appendChild(U.el('div.page-head', null, [
      U.el('button.icon-btn', { type: 'button', onclick: function () { App.Router.go('#/today'); } }, [U.icon('back')]),
      U.el('div.page-title', { text: '错题本' }),
      U.el('span.spacer'),
      U.el('button.btn.btn-sm', {
        type: 'button',
        onclick: function () { App.Store.flush(); U.toast('已保存', 'ok'); }
      }, [U.icon('save'), '保存'])
    ]));

    if (stage === 'do') renderDoing(root);
    else renderList(root);
  }

  function allWrongs() {
    return (App.Store.state.wrongbook || []).slice();
  }
  function isDue(w) {
    return !w.nextReviewAt || U.diffDays(w.nextReviewAt, U.today()) <= 0;
  }
  function sortWrongs(arr) {
    return arr.slice().sort(function (a, b) {
      var da = isDue(a) ? 0 : 1, db = isDue(b) ? 0 : 1;
      if (da !== db) return da - db;
      var la = a.lastWrongAt || '', lb = b.lastWrongAt || '';
      return la < lb ? 1 : (la > lb ? -1 : 0);
    });
  }

  /* ---------------- 列表 ---------------- */
  function renderList(root) {
    var typeFilter = App.Store.state.settings.wrongType || 'all';
    var dueOnly = false;
    var list = sortWrongs(allWrongs());

    // 顶部统计
    var totalWrong = list.reduce(function (n, w) { return n + (w.wrongCount || 1); }, 0);
    var dueCount = list.filter(isDue).length;

    root.appendChild(U.el('div.stat-grid', { style: { gridTemplateColumns: 'repeat(3,minmax(0,1fr))', marginBottom: '12px' } }, [
      statCell('错题数', String(list.length)),
      statCell('待复习', String(dueCount), dueCount ? 'var(--danger)' : 'var(--ok)'),
      statCell('累计错次', String(totalWrong))
    ]));

    // 题型过滤
    root.appendChild(U.el('div.seg', { style: { marginBottom: '10px' } }, ['all'].concat(TYPE_ORDER).map(function (k) {
      var label = k === 'all' ? '全部' : TYPE_LABEL[k];
      return U.el('button.seg-item' + (typeFilter === k ? '.is-active.seg-fill' : ''), {
        type: 'button',
        onclick: function () {
          App.Store.setSetting('wrongType', k);
          render(lastRoot);
        }
      }, [label]);
    })));

    // 只看到期
    var dueRow = rowSwitch('只看到期复习的错题', false, function (v) { dueOnly = v; body2(dueOnly); });
    root.appendChild(dueRow);

    var listBox = U.el('div', { style: { marginTop: '6px' } });
    function body2(onlyDue) {
      U.clear(listBox);
      var arr = sortWrongs(allWrongs()).filter(function (w) {
        if (typeFilter !== 'all' && w.type !== typeFilter) return false;
        if (onlyDue && !isDue(w)) return false;
        return true;
      });
      if (!arr.length) {
        listBox.appendChild(U.el('div.empty', null, [
          U.icon('check'),
          U.el('div.empty-title', { text: typeFilter === 'all' && onlyDue ? '没有到期错题，太棒了' : '这里空空如也' }),
          U.el('div.empty-desc', { text: '做真题答错的题会自动收录到这里，按遗忘曲线安排复习' })
        ]));
        return;
      }
      arr.forEach(function (w) { listBox.appendChild(wrongCard(w)); });
    }
    body2(false);
    root.appendChild(listBox);

    // 底部操作：重练
    if (list.length) {
      root.appendChild(U.el('div.quiz-foot', null, [
        U.el('button.btn.btn-primary.btn-lg', {
          type: 'button',
          onclick: function () {
            var due = sortWrongs(allWrongs()).filter(isDue);
            if (!due.length) { U.toast('当前没有到期错题', 'err'); return; }
            startReview(due);
          }
        }, ['重练到期的 ' + dueCount + ' 题'])
      ]));
    }
  }

  function statCell(label, num, color) {
    return U.el('div.stat-card', null, [
      U.el('div.stat-num', { style: { fontSize: '22px', color: color || 'var(--text)' }, text: num }),
      U.el('div.stat-label', { text: label })
    ]);
  }

  function rowSwitch(label, on, onChange) {
    var sw = U.el('div.switch' + (on ? '.is-on' : ''));
    var row = U.el('button.set-row', {
      type: 'button',
      onclick: function () {
        var nowOn = !sw.classList.contains('is-on');
        sw.classList.toggle('is-on', nowOn);
        onChange(nowOn);
      }
    }, [
      U.el('span.set-main', null, [U.el('span.set-title', { style: { fontSize: '14px' }, text: label })]),
      U.el('span.row-tail', null, [sw])
    ]);
    return row;
  }

  function wrongCard(w) {
    var tip = isDue(w) ? '待复习' : (U.diffDays(U.today(), w.nextReviewAt) > 0 ? '' : '');
    var due = isDue(w);
    return U.el('div.wrong-item', null, [
      U.el('div.wrong-head', null, [
        U.el('span.badge' + (due ? '.badge-danger' : '.badge-ok'), { text: due ? '待复习' : '已复习' }),
        U.el('span.badge', { text: TYPE_LABEL[w.type] || w.type }),
        U.el('span.badge.badge-warn', { text: '错 ' + (w.wrongCount || 1) + ' 次' }),
        w.nextReviewAt && due ? null : U.el('span.badge', { text: '下次 ' + (w.nextReviewAt || '—') })
      ]),
      U.el('div.wrong-stem', { text: w.stem || (TYPE_LABEL[w.type] + '题目') }),
      U.el('div.wrong-answer', null, [
        U.el('span', { html: '我的答案：<b style="color:var(--danger)">' + U.escapeHtml(w.userAnswer || '未作答') + '</b>' }),
        U.el('span', { html: '正确答案：<b style="color:var(--ok)">' + U.escapeHtml(String(w.answer)) + '</b>' })
      ]),
      w.explanation ? U.el('div.explain', { html: '<b>解析</b>　' + U.escapeHtml(w.explanation) }) : null,
      U.el('div.wrong-acts', null, [
        U.el('button.btn.btn-sm.btn-primary', { type: 'button', onclick: function () { startReview([w]); } }, ['重练此题']),
        U.el('button.btn.btn-sm.btn-danger', {
          type: 'button',
          onclick: function () {
            U.confirm({
              title: '移出错题本',
              message: '确定把这道题移出错题本吗？该操作只影响错题本，不影响学习数据。',
              okText: '移除', danger: true
            }).then(function (yes) {
              if (!yes) return;
              removeWrong(w.id);
              U.toast('已移出错题本');
              if (lastRoot) render(lastRoot);
            });
          }
        }, ['移出'])
      ])
    ]);
  }

  function removeWrong(id) {
    App.Store.commit(function (s) {
      s.wrongbook = s.wrongbook.filter(function (x) { return x.id !== id; });
    });
    App.Store.flush();
    refreshToday();
  }

  /* ---------------- 重练 ---------------- */
  function startReview(arr) {
    if (!arr || !arr.length) { U.toast('没有可重练的错题', 'err'); return; }
    queue = arr;
    index = 0;
    rightCount = 0;
    stage = 'do';
    if (lastRoot) render(lastRoot);
  }

  function renderDoing(root) {
    var w = queue[index];
    if (!w) { // 队列结束
      stage = 'list';
      renderList(root);
      return;
    }

    root.appendChild(U.el('div.page-head', null, [
      U.el('button.icon-btn', { type: 'button', onclick: function () { stage = 'list'; render(lastRoot); } }, [U.icon('back')]),
      U.el('div.page-title', { text: '错题重练' }),
      U.el('span.spacer'),
      U.el('span.badge.badge-brand', { text: '答对自动移出' })
    ]));

    root.appendChild(U.el('div.card', null, [
      U.el('div.words-prog-text', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12.5px' } }, [
        U.el('span', { text: (index + 1) + ' / ' + queue.length }),
        U.el('span', { text: '已答对 ' + rightCount + ' 题' })
      ]),
      U.el('div.bar', { style: { margin: '6px 0 16px' } }, [
        U.el('div.bar-fill', { style: { width: ((index + 1) / queue.length * 100) + '%' } })
      ]),
      U.el('div.card-title', null, [U.icon('target'), TYPE_LABEL[w.type] || w.type]),
      U.el('div.q-stem', { text: w.stem || '请回忆这道题的正确答案' })
    ]));

    // 选项题 vs 回忆题
    var hasOpts = Array.isArray(w.options) && w.options.length >= 2;
    if (hasOpts && w.type === 'reading') {
      var optBox = U.el('div', { style: { marginTop: '4px' } });
      w.options.forEach(function (opt, oi) {
        var letter = IMP.optionLetter(opt, oi);
        optBox.appendChild(U.el('button.opt', {
          type: 'button',
          onclick: function () { answerWith(w, letter); }
        }, [
          U.el('span.opt-key', { text: letter }),
          U.el('span', { text: opt })
        ]));
      });
      root.appendChild(optBox);
    } else {
      var ph = w.type === 'matching' ? '填写段落字母，如 B' : '填写答案（单词 / 短语）';
      root.appendChild(U.el('div.field', null, [
        U.el('label.field-label', { text: '不看答案，先写下来再核对' }),
        U.el('input.input', { id: 'wb-input', type: 'text', placeholder: ph, autocomplete: 'off', autocapitalize: 'off' })
      ]));
      root.appendChild(U.el('button.btn.btn-primary.btn-block.btn-lg', {
        type: 'button',
        onclick: function () {
          var v = (U.$('#wb-input') || {}).value;
          answerWith(w, v);
        }
      }, ['提交答案']));
      setTimeout(function () {
        var inp = U.$('#wb-input');
        if (inp) { try { inp.focus(); } catch (e) { } }
      }, 60);
    }
  }

  function answerWith(w, val) {
    var right = IMP.isAnswerRight({ answer: w.answer, options: w.options || [] }, val);
    if (right) {
      rightCount++;
      U.vibrate(12);
      U.playTone('right');
      U.toast('答对啦，已移出错题本', 'ok');
      removeWrong(w.id);
    } else {
      U.vibrate(28);
      U.playTone('wrong');
      U.toast('答错了，下次再复习', 'err');
      App.Store.commit(function (s) {
        for (var i = 0; i < s.wrongbook.length; i++) {
          var x = s.wrongbook[i];
          if (x.id === w.id) {
            x.wrongCount = (x.wrongCount || 1) + 1;
            x.lastWrongAt = U.today();
            x.nextReviewAt = U.addDays(U.today(), 2);
            break;
          }
        }
      });
      App.Store.flush();
    }
    index++;
    render(lastRoot);
  }

  /** 供 today 页等刷新错题红点 */
  function refreshToday() {
    if (App.Router && App.Router.currentRoute && App.Router.currentRoute() === '#/today') App.Router.reload();
  }

  App.Views = App.Views || {};
  App.Views.wrongbook = function () {
    return {
      render: render,
      destroy: function () {
        stage = 'list';
        queue = [];
        index = 0;
        rightCount = 0;
        lastRoot = null;
      }
    };
  };
})(window);
