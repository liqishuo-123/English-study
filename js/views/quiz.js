/* =========================================================
   views/quiz.js — 真题训练（二级页，从「今日」主行动卡进入）
   依赖：core/*, data/*
   包含：题型切换 / 套题列表 / 答题与判分 / 解析 / 结果页 / 录入真题
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

  var stage = 'list';      // list | doing | result
  var paper = null;        // 当前套题
  var answers = {};        // subQuestionId -> 用户答案
  var submitted = false;

  function allPapers() {
    var builtin = App.QUIZ_BUILTIN || [];
    var custom = App.Store.state.customQuestions || [];
    return builtin.concat(custom);
  }

  function papersOf(type) {
    return allPapers().filter(function (p) { return p.type === type; });
  }

  function render(root) {
    U.clear(root);
    var type = App.Store.state.settings.quizType || 'reading';

    root.appendChild(U.el('div.page-head', null, [
      U.el('div.page-title', { text: '阅读训练' }),
      U.el('span.spacer'),
      U.el('button.btn.btn-sm', { type: 'button', onclick: openImportSheet }, [U.icon('plus'), '录入真题'])
    ]));

    if (stage === 'list') renderList(root, type);
    else if (stage === 'doing') renderDoing(root);
    else renderResult(root);
  }

  /* ---------------- 套题列表 ---------------- */
  function renderList(root, type) {
    root.appendChild(U.el('div.seg', { style: { marginBottom: '16px' } }, [
      Object.keys(TYPE_LABEL).map(function (k) {
        return U.el('button.seg-item' + (type === k ? '.is-active.seg-fill' : ''), {
          type: 'button',
          onclick: function () { App.Store.setSetting('quizType', k); render(root); }
        }, [TYPE_LABEL[k]]);
      })
    ]));

    var list = papersOf(type);
    var box = U.el('div.paper-list');

    if (!list.length) {
      box.appendChild(U.el('div.empty', null, [
        U.icon('book'),
        U.el('div.empty-title', { text: '这个题型还没有题目' }),
        U.el('div.empty-desc', { text: '点击右上角「录入真题」，把买到的真题粘贴进来即可练习' })
      ]));
      root.appendChild(box);
      return;
    }

    var builtin = list.filter(function (p) { return p.source !== 'custom'; });
    var custom = list.filter(function (p) { return p.source === 'custom'; });

    function section(title, arr) {
      if (!arr.length) return null;
      return U.el('div', { style: { marginBottom: '4px' } }, [
        U.el('div', {
          style: { fontSize: '12.5px', fontWeight: '700', color: 'var(--text-3)', margin: '4px 0 8px' },
          text: title + '（' + arr.length + '）'
        }),
        U.el('div', null, arr.map(function (p) {
          return U.el('button.paper-item', {
            type: 'button',
            onclick: function () { startPaper(p); render(root); }
          }, [
            U.el('div.paper-icon', null, [U.icon(p.source === 'custom' ? 'edit' : 'book')]),
            U.el('div.paper-item-main', null, [
              U.el('div.paper-item-title', { text: p.title || p.paper || '未命名' }),
              U.el('div.paper-item-sub', null, [
                p.source === 'custom'
                  ? U.el('span.badge.badge-brand', { text: (p.year || '真题') + ' ' + (p.paper || '') })
                  : U.el('span.badge', { text: p.paper || '原创仿真' }),
                U.el('span', { text: p.subQuestions.length + ' 题' })
              ])
            ]),
            U.el('span', { style: { color: 'var(--text-3)', flex: 'none' } }, [U.icon('right')])
          ]);
        }))
      ]);
    }

    var secB = section('内置仿真题', builtin);
    var secC = section('我录入的真题', custom);
    if (secB) box.appendChild(secB);
    if (secC) box.appendChild(secC);
    root.appendChild(box);

    root.appendChild(U.el('div.card', { style: { marginTop: '16px' } }, [
      U.el('div.card-title', null, [U.icon('target'), '提示']),
      U.el('div', { style: { fontSize: '13.5px', lineHeight: '1.7', color: 'var(--text-2)' },
        text: '内置题目全部为本项目原创撰写，不是官方真题原文。想练真题请点右上角「录入真题」，按模板把你购买的真题粘贴进来，系统会自动判分、收录错题并安排复习。' })
    ]));
  }

  /* ---------------- 答题 ---------------- */
  function startPaper(p) {
    paper = p;
    answers = {};
    submitted = false;
    stage = 'doing';
  }

  function renderDoing(root) {
    root.appendChild(U.el('div.page-head', null, [
      U.el('button.icon-btn', { type: 'button', onclick: function () { stage = 'list'; render(root); } }, [U.icon('back')]),
      U.el('div', { style: { flex: '1', minWidth: '0' } }, [
        U.el('div', { style: { fontSize: '16px', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: paper.title || paper.paper || '练习' }),
        U.el('div', { style: { fontSize: '12px', color: 'var(--text-3)' }, text: TYPE_LABEL[paper.type] + ' · ' + paper.subQuestions.length + ' 题' })
      ])
    ]));

    root.appendChild(renderPassage(paper));

    paper.subQuestions.forEach(function (q, i) {
      root.appendChild(renderQuestion(paper, q, i));
    });

    root.appendChild(U.el('div.quiz-foot', null, [
      U.el('button.btn', {
        type: 'button', onclick: function () { stage = 'list'; render(root); }
      }, ['返回列表']),
      U.el('button.btn.btn-primary', {
        type: 'button', onclick: function () { submit(); render(root); }
      }, ['提交并查看解析'])
    ]));
  }

  /** 渲染文章：选词填空挖空、长篇匹配分段、仔细阅读分段 */
  function renderPassage(p) {
    if (!p.passage) return document.createDocumentFragment();

    var box = U.el('div.passage');
    if (p.title && p.type !== 'select-fill') {
      box.appendChild(U.el('div.passage-title', { text: p.title }));
    }

    if (p.type === 'select-fill') {
      var parts = String(p.passage).split(/\[\[(\d+)\]\]/g);
      var pEl = U.el('div');
      for (var i = 0; i < parts.length; i++) {
        if (i % 2 === 1) {
          var n = parseInt(parts[i], 10);
          var val = answers[blankKey(p, n)];
          pEl.appendChild(U.el('span.blank', {
            dataset: { blank: String(n) },
            text: val ? ('[' + val + ']') : ('(' + n + ')')
          }));
        } else {
          parts[i].split('\n\n').forEach(function (para) {
            if (para.trim()) pEl.appendChild(U.el('p', { text: para.trim() }));
          });
        }
      }
      box.appendChild(pEl);
    } else if (p.type === 'matching') {
      String(p.passage).split(/\n\s*\n/).forEach(function (para) {
        var t = para.trim();
        if (!t) return;
        var m = t.match(/^\[([A-Z])\]\s*/);
        var label = m ? m[1] : '';
        var text = m ? t.slice(m[0].length) : t;
        box.appendChild(U.el('p', { style: { display: 'flex', gap: '8px' } }, [
          label ? U.el('b', { style: { color: 'var(--brand-2)', flex: 'none' }, text: label }) : null,
          U.el('span', { text: text })
        ]));
      });
    } else {
      String(p.passage).split(/\n\s*\n/).forEach(function (para) {
        if (para.trim()) box.appendChild(U.el('p', { text: para.trim() }));
      });
    }
    return box;
  }

  function blankKey(p, n) {
    var q = p.subQuestions[n - 1];
    return q ? (q.id || ('b' + n)) : ('b' + n);
  }

  function renderQuestion(p, q, idx) {
    var key = q.id || ('q' + idx);
    var box = U.el('div.q-block');

    if (p.type === 'select-fill') {
      box.appendChild(U.el('div.q-stem', null, [
        U.el('span.q-no', { text: String(idx + 1) + '.' }),
        U.el('span', { text: '第 ' + (idx + 1) + ' 空：从下方候选词中选择' })
      ]));
      var chosen = answers[key];
      var chips = U.el('div.chips', { style: { marginTop: '4px' } });
      (p.options || []).forEach(function (word) {
        var used = Object.keys(answers).some(function (k) { return answers[k] === word; });
        var isMine = chosen === word;
        chips.appendChild(U.el('button.chip' + (isMine ? '.is-on' : '') + (used && !isMine ? '[disabled]' : ''), {
          type: 'button',
          style: used && !isMine ? { opacity: '.35' } : null,
          onclick: function () {
            if (submitted) return;
            answers[key] = word;
            var view = U.$('#view');
            if (view) render(view);
          }
        }, [word]));
      });
      box.appendChild(chips);
      if (chosen) {
        box.appendChild(U.el('div', {
          style: { marginTop: '8px', fontSize: '13px', color: 'var(--text-2)' },
          text: '已选：' + chosen
        }));
      }
    } else if (p.type === 'matching') {
      box.appendChild(U.el('div.q-stem', null, [
        U.el('span.q-no', { text: String(idx + 1) + '.' }),
        U.el('span', { text: q.stem })
      ]));
      var labels = paragraphLabels(p);
      var mChips = U.el('div.chips');
      labels.forEach(function (L) {
        mChips.appendChild(U.el('button.chip' + (answers[key] === L ? '.is-on' : ''), {
          type: 'button',
          onclick: function () {
            if (submitted) return;
            answers[key] = L;
            render(U.$('#view'));
          }
        }, [L]));
      });
      box.appendChild(mChips);
    } else {
      box.appendChild(U.el('div.q-stem', null, [
        U.el('span.q-no', { text: String(idx + 1) + '.' }),
        U.el('span', { text: q.stem })
      ]));
      (q.options || []).forEach(function (opt, oi) {
        var letter = IMP.optionLetter(opt, oi);
        var cls = 'opt';
        if (submitted) {
          if (letter === String(q.answer).trim().toUpperCase()) cls += '.is-right';
          else if (answers[key] === letter) cls += '.is-wrong';
          else cls += '.is-dim';
        } else if (answers[key] === letter) {
          cls += '.is-right';
        }
        box.appendChild(U.el('button.' + cls, {
          type: 'button',
          onclick: function () {
            if (submitted) return;
            answers[key] = letter;
            render(U.$('#view'));
          }
        }, [
          U.el('span.opt-key', { text: letter }),
          U.el('span', { text: opt })
        ]));
      });
    }

    if (submitted && q.explanation) {
      box.appendChild(U.el('div.explain', { html: '<b>解析</b>　' + U.escapeHtml(q.explanation) }));
    }
    if (submitted) {
      var ok = IMP.isAnswerRight(q, answers[key]);
      box.appendChild(U.el('div', {
        style: { marginTop: '8px', fontSize: '13px', fontWeight: '600', color: ok ? 'var(--ok)' : 'var(--danger)' },
        text: ok ? '✓ 回答正确' : '✗ 回答错误　正确答案：' + q.answer
      }));
    }
    return box;
  }

  function paragraphLabels(p) {
    var out = [];
    var re = /\[([A-Z])\]/g, m;
    var src = String(p.passage || '');
    while ((m = re.exec(src))) { if (out.indexOf(m[1]) < 0) out.push(m[1]); }
    if (!out.length) {
      for (var i = 0; i < 10; i++) out.push(String.fromCharCode(65 + i));
    }
    return out;
  }

  /* ---------------- 提交与错题收录 ---------------- */
  function score() {
    var correct = 0;
    paper.subQuestions.forEach(function (q, i) {
      var key = q.id || ('q' + i);
      if (IMP.isAnswerRight(q, answers[key])) correct++;
    });
    return correct;
  }

  function submit() {
    submitted = true;
    var total = paper.subQuestions.length;
    var correct = score();

    // 整卷反馈音效：全对上行音，有错下行音
    U.playTone(correct === total ? 'right' : 'wrong');

    App.Store.addLog({ quizDone: total, quizCorrect: correct, quizPapers: 1 });

    // 收录错题
    var wrongs = [];
    paper.subQuestions.forEach(function (q, i) {
      var key = q.id || ('q' + i);
      if (IMP.isAnswerRight(q, answers[key])) return;
      wrongs.push({
        id: U.uid('wb'),
        paperId: paper.id,
        questionId: key,
        type: paper.type,
        paperTitle: paper.title || paper.paper || '',
        source: paper.source || 'custom',
        stem: q.stem,
        options: q.options || [],
        answer: q.answer,
        userAnswer: answers[key] || '',
        explanation: q.explanation || '',
        wrongCount: 1,
        addedAt: U.today(),
        lastWrongAt: U.today(),
        nextReviewAt: U.addDays(U.today(), 2)
      });
    });

    if (wrongs.length) {
      App.Store.commit(function (s) {
        wrongs.forEach(function (w) {
          var exist = null;
          for (var i = 0; i < s.wrongbook.length; i++) {
            if (s.wrongbook[i].paperId === w.paperId && s.wrongbook[i].questionId === w.questionId) { exist = s.wrongbook[i]; break; }
          }
          if (exist) {
            exist.wrongCount = (exist.wrongCount || 1) + 1;
            exist.lastWrongAt = w.lastWrongAt;
            exist.nextReviewAt = w.nextReviewAt;
            exist.userAnswer = w.userAnswer;
          } else {
            s.wrongbook.push(w);
          }
        });
      });
      App.Store.flush();
    }
    stage = 'result';
  }

  /* ---------------- 结果页 ---------------- */
  function renderResult(root) {
    var total = paper.subQuestions.length;
    var correct = score();
    var rate = U.pct(correct, total);

    root.appendChild(U.el('div.result-hero', null, [
      U.el('div.result-num', { text: rate + '%' }),
      U.el('div.result-label', { text: '答对 ' + correct + ' / ' + total + ' 题' }),
      U.el('div.result-tips', {
        text: rate >= 80 ? '状态很好，继续保持这个节奏。' :
          rate >= 60 ? '基础不错，把错题弄懂就能再上一个台阶。' :
            '先别急着刷新题，把本篇的生词和长难句吃透再练下一篇。'
      })
    ]));

    root.appendChild(U.el('div.card', null, [
      U.el('div.card-title', null, [U.icon('target'), '逐题回顾']),
      U.el('div', null, paper.subQuestions.map(function (q, i) {
        var key = q.id || ('q' + i);
        var ok = IMP.isAnswerRight(q, answers[key]);
        return U.el('div.wrong-item', null, [
          U.el('div.wrong-head', null, [
            U.el('span.badge' + (ok ? '.badge-ok' : '.badge-danger'), { text: ok ? '正确' : '错误' }),
            U.el('span.badge', { text: '第 ' + (i + 1) + ' 题' })
          ]),
          U.el('div.wrong-stem', { text: q.stem }),
          U.el('div.wrong-answer', null, [
            U.el('span', { html: '你的答案：<b>' + U.escapeHtml(answers[key] || '未作答') + '</b>' }),
            U.el('span', { html: '正确答案：<b>' + U.escapeHtml(String(q.answer)) + '</b>' })
          ]),
          q.explanation ? U.el('div.explain', { html: '<b>解析</b>　' + U.escapeHtml(q.explanation) }) : null
        ]);
      }))
    ]));

    root.appendChild(U.el('div.quiz-foot', null, [
      U.el('button.btn', {
        type: 'button', onclick: function () {
          answers = {}; submitted = false; stage = 'doing'; render(root);
        }
      }, ['再做一次']),
      U.el('button.btn.btn-primary', {
        type: 'button', onclick: function () { stage = 'list'; render(root); }
      }, ['回到列表'])
    ]));
  }

  /* ---------------- 录入真题 ---------------- */
  function openImportSheet() {
    var ta = U.el('textarea.textarea', {
      placeholder: '把 JSON 内容粘贴到这里（格式见下方说明）',
      style: { minHeight: '180px', fontFamily: 'monospace', fontSize: '13px' }
    });
    var report = U.el('div');

    var body = U.el('div', null, [
      U.el('div.field-hint', {
        style: { marginBottom: '10px', lineHeight: '1.7' },
        text: '真题原文受版权保护，本项目不内置。请自行录入你购买的真题。支持 JSON 格式，单篇结构如下（也可直接粘贴一个数组一次录入多篇）：'
      }),
      U.el('pre', {
        style: {
          background: 'var(--surface-sunken)', padding: '12px', borderRadius: '10px',
          fontSize: '11.5px', lineHeight: '1.6', overflowX: 'auto', margin: '0 0 12px',
          color: 'var(--text-2)'
        },
        text: '{\n  "type": "reading",\n  "year": "2024-06",\n  "paper": "第1套",\n  "title": "文章标题",\n  "passage": "正文…",\n  "subQuestions": [\n    { "stem": "题干",\n      "options": ["A. …", "B. …"],\n      "answer": "B",\n      "explanation": "解析" }\n  ]\n}'
      }),
      ta,
      U.el('div', { style: { display: 'flex', gap: '8px', margin: '10px 0' } }, [
        U.el('button.btn.btn-sm', {
          type: 'button',
          onclick: function () {
            U.downloadFile('quiz-template.json', JSON.stringify([{
              type: 'reading', year: '2024-06', paper: '第1套', title: '示例文章',
              passage: '在此粘贴正文。', subQuestions: [
                { stem: '题干写在这里', options: ['A. 选项一', 'B. 选项二', 'C. 选项三', 'D. 选项四'], answer: 'B', explanation: '解析写在这里' }
              ]
            }], null, 2));
          }
        }, [U.icon('download'), '下载模板']),
        U.el('button.btn.btn-sm', {
          type: 'button', onclick: function () { U.pickFile('.json,application/json', loadFile); }
        }, [U.icon('upload'), '从文件读取'])
      ]),
      report
    ]);

    function loadFile(f) {
      U.readText(f).then(function (txt) { ta.value = txt; }).catch(function () { U.toast('文件读取失败', 'err'); });
    }

    U.openSheet({
      title: '录入真题',
      body: body,
      foot: [
        U.el('button.btn.btn-ghost', { type: 'button', onclick: function () { U.closeSheet(); } }, ['取消']),
        U.el('button.btn.btn-primary', {
          type: 'button',
          onclick: function () {
            var txt = ta.value.trim();
            if (!txt) { U.toast('请先粘贴内容', 'err'); return; }
            var r = IMP.parseQuiz(txt);
            U.clear(report);
            if (r.errors && r.errors.length) {
              report.appendChild(U.el('div', {
                style: { marginTop: '12px', padding: '10px', borderRadius: '10px', background: 'var(--warn-soft)', color: 'var(--warn)', fontSize: '12.5px', maxHeight: '160px', overflowY: 'auto' },
                html: r.errors.map(function (e) { return '· ' + U.escapeHtml(e); }).join('<br>')
              }));
            }
            if (!r.list.length) { U.toast('没有可录入的题目，请检查格式', 'err'); return; }
            var applied = IMP.applyQuiz(r.list);
            U.toast('成功录入 ' + applied.added + ' 篇' + (applied.skipped ? '，跳过重复 ' + applied.skipped + ' 篇' : ''), 'ok');
            U.closeSheet();
            stage = 'list';
            render(U.$('#view'));
          }
        }, ['解析并录入'])
      ]
    });
  }

  App.Views = App.Views || {};
  App.Views.quiz = function () {
    return {
      render: render,
      destroy: function () { paper = null; answers = {}; submitted = false; stage = 'list'; }
    };
  };
})(window);
