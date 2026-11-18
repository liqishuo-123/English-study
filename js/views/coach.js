/* =========================================================
   views/coach.js — 学习教练（计划 + 复盘）
   依赖：core/coach.js, core/agent.js, core/ai.js
   对外：App.Views.coach

   页面从上到下：
   1. 计划卡：分阶段进度 + 今日重点 + 每日目标，可重新制定 / 应用目标
   2. 复盘提醒：到了该复盘的日子就在这里亮出来（不自动请求接口，避免偷偷花钱）
   3. 复盘卡：结论 + 评分 + 亮点 / 问题 / 易错词 / 下一步，可一键丢给助教细聊
   4. 易错词与近 14 天曲线：纯本地统计，永远可用，不依赖 API
   ========================================================= */
(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var U = App.Utils;

  var SCORES = [425, 500, 550, 600];
  var MINUTES = [30, 45, 60, 90, 120];
  var WEEKDAYS = [4, 5, 6, 7];
  var WEAK = ['单词', '阅读', '写作', '听力'];
  var EVERY = [
    { v: 1, t: '每天' },
    { v: 3, t: '每 3 天' },
    { v: 7, t: '每周' },
    { v: 0, t: '关闭提醒' }
  ];

  /* ---------------- 小组件 ---------------- */

  /** 单选 / 多选 chips，返回 { node, get() } */
  function chipGroup(options, initial, multi) {
    var picked = multi ? (initial || []).slice() : initial;
    var wrap = U.el('div.chips');
    options.forEach(function (o) {
      wrap.appendChild(U.el('button.chip' + (isOn(o.v) ? '.is-on' : ''), {
        type: 'button',
        onclick: function () {
          if (multi) {
            var i = picked.indexOf(o.v);
            if (i >= 0) picked.splice(i, 1); else picked.push(o.v);
          } else {
            picked = o.v;
          }
          syncChips(wrap, options, isOn);
        }
      }, [o.t]));
    });
    function isOn(v) { return multi ? picked.indexOf(v) >= 0 : picked === v; }
    return {
      node: wrap,
      get: function () { return picked; }
    };
  }

  function syncChips(wrap, options, isOn) {
    var kids = wrap.children;
    for (var i = 0; i < kids.length; i++) {
      var o = options[i];
      if (!o) continue;
      kids[i].classList.toggle('is-on', !!isOn(o.v));
    }
  }

  function fieldRow(label, hint, node) {
    return U.el('div.field', { style: { marginBottom: '16px' } }, [
      U.el('label.field-label', { text: label }),
      hint ? U.el('div.field-hint', { style: { margin: '4px 0 6px' }, text: hint }) : null,
      node
    ]);
  }

  function secTitle(icon, text, extra) {
    return U.el('div.card-title', null, [U.icon(icon), text, U.el('span.spacer'), extra || null]);
  }

  /* =========================================================
     页面
     ========================================================= */
  function view() {
    var root = null;
    var alive = true;
    var busy = '';            // '' | 'plan' | 'report'
    var lastError = null;     // {where:'plan'|'report', text}
    var open = {};            // 展开的复盘卡 id

    /* ---------- 状态原点 ---------- */
    function rerender() { if (root && alive) render(root); }

    function setBusy(kind) {
      busy = kind;
      lastError = null;
      if (kind) rerender();
    }

    /* ---------- 计划卡 ---------- */
    function planCard() {
      var p = App.Coach.plan();
      if (!p) return emptyPlan();

      var pr = App.Coach.planProgress();
      var ph = pr && pr.phase;
      var day = pr ? pr.day : 1;
      var pct = pr ? pr.rate : 0;

      var head = U.el('div.coach-plan-top', null, [
        U.el('div.coach-plan-title', { text: p.title }),
        U.el('span.badge.badge-brand', { text: '第 ' + day + '/' + p.horizonDays + ' 天' })
      ]);

      // 阶段进度条：每段宽度按天数占比，当前阶段高亮
      var bars = U.el('div.coach-phases');
      p.phases.forEach(function (x, i) {
        var now = ph && ph.index === i;
        bars.appendChild(U.el('div.coach-phase' + (now ? '.is-now' : '') + (ph && i < ph.index ? '.is-past' : ''), {
          style: { flex: String(Math.max(1, x.days)) }
        }, [
          U.el('span.coach-phase-name', { text: x.name }),
          U.el('span.coach-phase-days', { text: x.days + ' 天' })
        ]));
      });

      var chipRow = U.el('div.coach-goals', null, [
        goalChip('新词 ' + p.targets.dailyNewWords),
        goalChip('阅读 ' + p.targets.dailyQuiz + ' 篇'),
        goalChip('素材 ' + p.targets.dailyWriting + ' 条'),
        goalChip('精听 ' + p.targets.dailyListen + ' 段'),
        goalChip(p.targets.dailyMinutes + ' 分钟')
      ]);

      var body = U.el('div', null, [
        head,
        U.el('div.coach-plan-sum', { text: p.summary }),
        bars,
        ph ? U.el('div.coach-focus', null, [
          U.el('span.coach-focus-tag', { text: ph.done ? '收尾' : '当前阶段 · ' + ph.name }),
          U.el('div.coach-focus-text', { text: p.todayFocus || ph.focus })
        ]) : null,
        chipRow,
        p.rules && p.rules.length ? U.el('div.coach-rules', null, p.rules.map(function (r) {
          return U.el('div.coach-rule', null, [U.icon('check'), r]);
        })) : null,
        U.el('div.coach-actions', null, [
          U.el('button.btn.btn-primary.btn-sm', {
            type: 'button',
            onclick: function () { openChat('看看我现在这份计划，按最新数据要不要调？要调就直接改。'); }
          }, [U.icon('compass'), '和教练聊聊']),
          U.el('button.btn.btn-ghost.btn-sm', {
            type: 'button',
            onclick: function () {
              U.confirm({
                title: '重新制定计划',
                message: '会重新问你几个问题，然后按最新数据生成一份新计划，覆盖现在这份。',
                okText: '重新制定'
              }).then(function (yes) { if (yes) openWizard(); });
            }
          }, [U.icon('refresh'), '重新制定']),
          U.el('button.btn.btn-ghost.btn-sm', {
            type: 'button',
            onclick: function () {
              App.Coach.applyTargets();
              U.toast('已按计划写入每日目标', 'ok');
              rerender();
            }
          }, [U.icon('target'), p.applied ? '重新应用目标' : '应用目标']),
          U.el('button.icon-btn', {
            type: 'button', 'aria-label': '删除计划',
            onclick: function () {
              U.confirm({ title: '删除计划', message: '只删计划表，学习进度与每日目标都会保留。', danger: true, okText: '删除' })
                .then(function (yes) {
                  if (!yes) return;
                  App.Coach.clearPlan();
                  U.toast('已删除计划', 'ok');
                  rerender();
                });
            }
          }, [U.icon('trash')])
        ])
      ]);

      return U.el('section.card.coach-plan', null, [body]);
    }

    function goalChip(text) {
      return U.el('span.coach-goal', { text: text });
    }

    function emptyPlan() {
      var ready = App.Coach.aiReady();
      return U.el('section.card.coach-empty', null, [
        U.el('div.coach-empty-icon', null, [U.icon('compass')]),
        U.el('div.coach-empty-title', { text: '还没有学习计划' }),
        U.el('div.coach-empty-desc', {
          text: ready
            ? '回答 4 个问题，教练会按你的考试日期、每天能投入的时间、薄弱项排一张分阶段计划，并直接写进每日目标。'
            : '没配 AI 也能用：本地模板会按剩余天数和你的完成率排一份计划。配了 API 之后会贴合得多。'
        }),
        U.el('div.coach-empty-actions', null, [
          ready ? U.el('button.btn.btn-primary', {
            type: 'button', onclick: function () { openWizard(); }
          }, [U.icon('sparkle'), '让 AI 制定计划']) : null,
          U.el('button.btn' + (ready ? '.btn-ghost' : '.btn-primary'), {
            type: 'button',
            onclick: function () {
              App.Coach.makeLocalPlan();
              U.toast('已用本地模板生成计划', 'ok');
              rerender();
            }
          }, [U.icon('target'), '用模板生成']),
          ready ? U.el('button.btn.btn-ghost', {
            type: 'button',
            onclick: function () { openChat(); }
          }, [U.icon('compass'), '先和教练聊聊']) : null
        ])
      ]);
    }

    /* ---------- 忙碌 / 出错 ---------- */
    function busyCard() {
      var text = busy === 'plan' ? '正在按你的真实数据排计划…' : '正在翻你最近的学习记录…';
      return U.el('section.card.coach-run', null, [
        U.el('div.coach-run-icon', null, [U.icon('refresh')]),
        U.el('div.coach-run-text', { text: text }),
        U.el('div.coach-run-sub', { text: '通常 10~30 秒，请保持页面打开' })
      ]);
    }

    function errorCard() {
      if (!lastError) return null;
      var where = lastError.where;
      return U.el('section.card.coach-error', null, [
        U.el('div.coach-error-title', null, [U.icon('close'), '这次没成']),
        U.el('div.coach-error-text', { text: lastError.text }),
        U.el('div.coach-actions', null, [
          U.el('button.btn.btn-ghost.btn-sm', {
            type: 'button',
            onclick: where === 'plan' ? function () { runPlan(); } : function () { runReport(); }
          }, [U.icon('refresh'), '重试']),
          U.el('button.btn.btn-ghost.btn-sm', {
            type: 'button',
            onclick: function () {
              if (where === 'plan') {
                App.Coach.makeLocalPlan();
                U.toast('已改用本地模板生成', 'ok');
              } else {
                App.Coach.makeLocalReport(7);
                U.toast('已改用本地统计生成', 'ok');
              }
              lastError = null;
              rerender();
            }
          }, ['用本地版本'])
        ])
      ]);
    }

    /* ---------- 复盘区 ---------- */
    function reportSection() {
      var due = App.Coach.dueReport();
      var list = App.Coach.reports();
      var ready = App.Coach.aiReady();

      var head = U.el('div.card-title', null, [
        U.icon('chart'), '学习复盘',
        U.el('span.spacer'),
        U.el('button.link-btn', {
          type: 'button',
          onclick: function () { openSettings(); }
        }, [U.icon('settings'), '频率'])
      ]);

      var kids = [head];

      if (!ready) {
        kids.push(U.el('div.tip-line', {
          text: '没配 AI 也能复盘：本地会按出勤、目标达成率、正确率算一份诊断。配了 API 之后会指出具体问题并给记忆方法。'
        }));
      }

      if (due.due) {
        kids.push(U.el('div.coach-due', null, [
          U.icon('fire'),
          U.el('div.coach-due-main', null, [
            U.el('div.coach-due-title', {
              text: due.never ? '做第一次复盘吧' : '距离上次复盘已经 ' + due.days + ' 天'
            }),
            U.el('div.coach-due-sub', { text: '按你的设置每 ' + due.every + ' 天看一次数据，问题不会拖太久' })
          ])
        ]));
      }

      var actions = U.el('div.coach-actions', null, [
        ready ? U.el('button.btn' + (list.length ? '.btn-ghost' : '.btn-primary') + '.btn-sm', {
          type: 'button',
          onclick: function () { runReport(); }
        }, [U.icon('sparkle'), list.length ? '生成新复盘' : '让 AI 复盘']) : null,
        U.el('button.btn.btn-ghost.btn-sm', {
          type: 'button',
          onclick: function () {
            App.Coach.makeLocalReport(7);
            U.toast('已生成数据版复盘', 'ok');
            rerender();
          }
        }, [U.icon('chart'), '数据版复盘'])
      ]);
      kids.push(actions);

      if (!list.length) {
        kids.push(U.el('div.coach-none', { text: '还没有复盘记录。做一次之后，这里会积累成一个时间线，能看到自己哪几周在退步。' }));
      } else {
        var box = U.el('div.coach-reps');
        list.slice(0, 8).forEach(function (rep, i) {
          box.appendChild(reportCard(rep, i === 0));
        });
        kids.push(box);
      }

      return U.el('section.card', null, kids);
    }

    function reportCard(rep, isFirst) {
      var expanded = isFirst || !!open[rep.id];
      var dateLabel = rep.at.slice(5).replace('-', '/') + (rep.atTime ? ' ' + rep.atTime : '');

      var head = U.el('button.coach-rep-head', {
        type: 'button',
        onclick: function () {
          open[rep.id] = !expanded;
          rerender();
        }
      }, [
        U.el('div.coach-score' + (rep.score >= 80 ? '.is-good' : rep.score >= 60 ? '' : '.is-low'), {
          text: String(rep.score || '—')
        }),
        U.el('div.coach-rep-main', null, [
          U.el('div.coach-rep-headline', { text: rep.headline }),
          U.el('div.coach-rep-meta', {
            text: dateLabel + ' · ' + (rep.source === 'ai' ? 'AI 复盘' : '数据复盘') +
              (rep.range && rep.range.days ? ' · 近 ' + rep.range.days + ' 天' : '')
          })
        ]),
        U.icon(expanded ? 'up' : 'down')
      ]);

      var card = U.el('div.coach-rep' + (expanded ? '.is-open' : ''), null, [head]);
      if (!expanded) return card;

      var body = U.el('div.coach-rep-body');

      if (rep.highlights && rep.highlights.length) {
        body.appendChild(secList('check', '做得好的', rep.highlights.map(function (h) {
          return U.el('div.coach-li.is-good', null, [U.icon('check'), h]);
        })));
      }

      if (rep.problems && rep.problems.length) {
        body.appendChild(secList('close', '要注意的', rep.problems.map(function (p) {
          return U.el('div.coach-li.is-bad', null, [
            U.icon('close'),
            U.el('div.coach-li-main', null, [
              U.el('div.coach-li-title', { text: p.title }),
              p.evidence ? U.el('div.coach-li-sub', { text: p.evidence }) : null,
              p.fix ? U.el('div.coach-li-fix', { text: '怎么改：' + p.fix }) : null
            ])
          ]);
        })));
      }

      if (rep.weakWords && rep.weakWords.length) {
        var wbox = U.el('div.coach-weaks');
        rep.weakWords.forEach(function (w) {
          wbox.appendChild(U.el('div.coach-w-item', null, [
            U.el('div.coach-w-top', null, [
              U.el('span.coach-w-word', { text: w.word }),
              w.meaning ? U.el('span.coach-w-mean', { text: w.meaning }) : null
            ]),
            w.why ? U.el('div.coach-w-why', { text: w.why }) : null,
            w.tip ? U.el('div.coach-w-tip', { text: w.tip }) : null
          ]));
        });
        body.appendChild(secList('cards', '易错词', [wbox]));
      }

      if (rep.nextActions && rep.nextActions.length) {
        body.appendChild(secList('target', '明天先做这些', rep.nextActions.map(function (a, i) {
          return U.el('div.coach-li', null, [
            U.el('span.coach-li-num', { text: String(i + 1) }),
            a
          ]);
        })));
      }

      if (rep.adjust && Object.keys(rep.adjust).length) {
        var map = {
          dailyNewWords: '新词', dailyQuiz: '阅读', dailyWriting: '素材',
          dailyListen: '精听', dailyMinutes: '时长'
        };
        var txt = Object.keys(rep.adjust).map(function (k) {
          return (map[k] || k) + ' → ' + rep.adjust[k];
        }).join('，');
        body.appendChild(U.el('div.coach-adjust', null, [
          U.icon('target'),
          U.el('span', { text: '建议调整为：' + txt }),
          U.el('button.link-btn', {
            type: 'button',
            onclick: function () {
              var applied = App.Coach.applyAdjust(rep.adjust);
              if (!Object.keys(applied).length) { U.toast('没有可应用的调整'); return; }
              U.toast('已应用调整', 'ok');
              rerender();
            }
          }, ['应用'])
        ]));
      }

      var foot = U.el('div.coach-rep-foot', null, [
        U.el('button.link-btn', {
          type: 'button',
          onclick: function () {
            var q = '这是我 ' + rep.at + ' 的学习复盘结论：「' + rep.headline + '」。' +
              (rep.problems && rep.problems[0] ? '最需要解决的问题是「' + rep.problems[0].title + '」。' : '') +
              '请帮我拆成这周每天的具体动作，要能直接执行。';
            if (App.Agent && App.Agent.seed) App.Agent.seed(q);
          }
        }, [U.icon('sparkle'), '找助教细聊']),
        U.el('span.spacer'),
        U.el('button.link-btn', {
          type: 'button',
          onclick: function () {
            U.confirm({ title: '删除这条复盘', message: '只删这条记录。', danger: true, okText: '删除' })
              .then(function (yes) {
                if (!yes) return;
                App.Coach.removeReport(rep.id);
                rerender();
              });
          }
        }, [U.icon('trash'), '删除'])
      ]);

      card.appendChild(body);
      card.appendChild(foot);
      return card;
    }

    function secList(icon, title, kids) {
      return U.el('div.coach-sec', null, [
        U.el('div.coach-sec-title', null, [U.icon(icon), title]),
        U.el('div.coach-sec-body', null, kids)
      ]);
    }

    /* ---------- 易错词 + 曲线 ---------- */
    function dataSection() {
      var weak = App.Coach.weakWords(8);
      var st = App.Coach.stats(14);
      var kids = [];

      // 近 14 天柱状图
      var maxV = 1;
      st.daily.forEach(function (d) { maxV = Math.max(maxV, d.newWords + d.reviewed); });
      var bars = U.el('div.coach-bars');
      st.daily.forEach(function (d) {
        var v = d.newWords + d.reviewed;
        bars.appendChild(U.el('div.coach-bar', { title: d.date + '：新学 ' + d.newWords + '，复习 ' + d.reviewed },
          [U.el('div.coach-bar-fill', { style: { height: Math.max(3, Math.round((v / maxV) * 100)) + '%' } })]));
      });

      kids.push(secTitle('chart', '近 14 天', U.el('span.coach-stat', {
        text: '学习 ' + st.sum.activeDays + ' 天 · 新学 ' + st.sum.newWords + ' 词 · 正确率 ' + (st.accuracy || 0) + '%'
      })));
      kids.push(bars);

      if (weak.length) {
        kids.push(U.el('div.coach-sec-title', { style: { marginTop: '18px' } }, [U.icon('cards'), '最记不住的词']));
        kids.push(U.el('div.coach-weak-list', null, weak.map(function (w) {
          return U.el('button.coach-w-chip', {
            type: 'button',
            onclick: function () {
              if (App.Agent && App.Agent.seed) {
                App.Agent.seed('我老记不住 ' + w.word + '（' + w.meaning + '），遗忘 ' + w.lapses +
                  ' 次了。给我一个记得住的办法，再各造一个四六级难度的例句。');
              }
            }
          }, [
            U.el('span.coach-w-chip-word', { text: w.word }),
            U.el('span.coach-w-chip-num', { text: '×' + w.lapses })
          ]);
        })));
        kids.push(U.el('div.tip-line', { text: '点任意一个词，直接丢给助教要记忆法。' }));
      }

      return U.el('section.card', null, kids);
    }

    /* ---------- 顶部 ---------- */
    function pageHead() {
      return U.el('div.page-head', null, [
        U.el('button.icon-btn', {
          type: 'button', 'aria-label': '返回今日',
          onclick: function () { App.Router.go('#/today'); }
        }, [U.icon('back')]),
        U.el('div', null, [
          U.el('h1.page-title', { text: '学习教练' }),
          U.el('div.ag-sub', { text: '按你的真实数据定计划 · 定期揪出退步和易错词' })
        ]),
        U.el('span.spacer'),
        U.el('button.icon-btn', {
          type: 'button', 'aria-label': '复盘设置',
          onclick: function () { openSettings(); }
        }, [U.icon('settings')]),
        U.el('button.icon-btn', {
          type: 'button', 'aria-label': '和教练对话',
          onclick: function () { openChat(); }
        }, [U.icon('sparkle')])
      ]);
    }

    function aiHintCard() {
      if (App.Coach.aiReady()) return null;
      return U.el('div.coach-ai-hint', null, [
        U.icon('sparkle'),
        U.el('div', null, [
          U.el('div.coach-ai-hint-title', { text: '还没配 AI 接口' }),
          U.el('div.coach-ai-hint-sub', { text: '计划和复盘都能用本地版本，但配了 API 会按你的情况写得更细。' })
        ]),
        U.el('button.link-btn', { type: 'button', onclick: function () { App.Router.go('#/me'); } }, ['去配置'])
      ]);
    }

    /* ---------- 首次向导 ---------- */
    function openWizard() {
      var p = App.Coach.profile();
      var score = chipGroup(SCORES.map(function (v) { return { v: v, t: v + ' 分' }; }), p.targetScore || 500, false);
      var mins = chipGroup(MINUTES.map(function (v) { return { v: v, t: v + ' 分钟' }; }), p.minutes || 60, false);
      var days = chipGroup(WEEKDAYS.map(function (v) { return { v: v, t: '每周 ' + v + ' 天' }; }), p.daysPerWeek || 6, false);
      var weak = chipGroup(WEAK.map(function (v) { return { v: v, t: v }; }), p.weak, true);
      var every = chipGroup(EVERY.map(function (o) { return { v: o.v, t: o.t }; }),
        p.autoReport === false ? 0 : (p.reportEvery || 3), false);
      var ready = App.Coach.aiReady();

      var body = U.el('div', null, [
        U.el('div.field-hint', {
          style: { marginBottom: '16px', lineHeight: 1.7 },
          text: '这几项会写进你的档案，之后教练改计划、写复盘都会用。随时能再改。'
        }),
        fieldRow('你的目标分数', '按四六级 710 分制估，不知道就选 425 分（过线）', score.node),
        fieldRow('每天能学多久', '按真实可投入的时间填，填大了计划必然完不成', mins.node),
        fieldRow('每周能学几天', '留出休息日更容易坚持', days.node),
        fieldRow('最薄弱的模块', '可以多选，教练会在这上面多给时间', weak.node),
        fieldRow('多久复盘一次', '到时间首页会提醒你，不会自动扣接口费', every.node)
      ]);

      var foot = [
        U.el('button.btn.btn-ghost', { type: 'button', onclick: U.closeSheet }, ['取消']),
        U.el('button.btn.btn-primary', {
          type: 'button',
          onclick: function () {
            var ev = every.get();
            App.Store.commit(function (s) {
              if (!s.settings.coach || typeof s.settings.coach !== 'object') s.settings.coach = {};
              s.settings.coach.targetScore = score.get();
              s.settings.coach.daysPerWeek = days.get();
              s.settings.coach.weak = weak.get();
              s.settings.coach.every = ev || 3;
              s.settings.coach.auto = ev > 0;
              s.settings.dailyMinutes = mins.get();
            });
            App.Store.flush();
            U.closeSheet();
            if (ready) runPlan();
            else {
              App.Coach.makeLocalPlan();
              U.toast('已用本地模板生成计划', 'ok');
              rerender();
            }
          }
        }, [ready ? '开始制定' : '生成计划'])
      ];

      U.openSheet({ title: '制定学习计划', body: body, foot: foot });
    }

    /* ---------- 复盘设置 ---------- */
    function openSettings() {
      var p = App.Coach.profile();
      var every = chipGroup(EVERY.map(function (o) { return { v: o.v, t: o.t }; }),
        p.autoReport === false ? 0 : (p.reportEvery || 3), false);
      var mins = chipGroup(MINUTES.map(function (v) { return { v: v, t: v + ' 分钟' }; }), p.minutes || 60, false);

      var body = U.el('div', null, [
        fieldRow('多久提醒一次复盘', '只是提醒，不会自动调用接口。到点后在首页和本页亮提示。', every.node),
        fieldRow('每天能学多久', '', mins.node)
      ]);

      var foot = [
        U.el('button.btn.btn-ghost', { type: 'button', onclick: U.closeSheet }, ['取消']),
        U.el('button.btn.btn-primary', {
          type: 'button',
          onclick: function () {
            var ev = every.get();
            App.Store.commit(function (s) {
              if (!s.settings.coach || typeof s.settings.coach !== 'object') s.settings.coach = {};
              s.settings.coach.every = ev || 3;
              s.settings.coach.auto = ev > 0;
              s.settings.dailyMinutes = mins.get();
            });
            App.Store.flush();
            U.closeSheet();
            U.toast('已保存', 'ok');
            rerender();
          }
        }, ['保存'])
      ];

      U.openSheet({ title: '复盘设置', body: body, foot: foot });
    }

    /* ---------- 和教练对话（不离开本页） ---------- */
    var CHAT_SEED = [
      { t: '按我的数据定个计划', q: '按我现在的真实数据定一份学习计划，用 save_plan 存进来，再用三句话说清为什么这么排。' },
      { t: '复盘最近两周', q: '复盘我最近两周：进度、做得好的、要注意的问题、最记不住的词，用 save_report 存进时间线。' },
      { t: '今天该先做什么', q: '看下我的真实数据，告诉我今天这 30 分钟该先做什么、后做什么。' }
    ];

    var CHAT_TOOL = {
      get_stats: '统计近期数据',
      get_plan: '读取计划',
      save_plan: '保存计划',
      save_report: '保存复盘',
      update_plan: '调整每日目标',
      list_words: '查看单词',
      search_word: '查词',
      add_words: '加生词',
      navigate: '跳转页面'
    };

    function fmtChat(s) {
      var t = U.escapeHtml(String(s || ''));
      t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      t = t.replace(/^\s*[-*]\s+/gm, '· ');
      return t.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
    }

    function openChat(seedText) {
      if (!App.Coach.aiReady()) {
        U.toast('先配好 AI 接口，才能跟教练对话', 'err');
        App.Router.go('#/me');
        return;
      }

      var history = [];
      var sending = false;
      var touched = false;   // 这轮对话里改过计划/复盘吗

      var listEl = U.el('div.coach-chat-list');
      var inputEl = U.el('textarea.coach-chat-input', {
        rows: '2',
        placeholder: '想聊什么？比如「我只有 20 天，来得及吗」'
      });
      var sendBtn = U.el('button.coach-chat-send', { type: 'button', 'aria-label': '发送' }, [U.icon('right')]);

      function bottom() {
        var sc = listEl.parentNode;
        if (sc) sc.scrollTop = sc.scrollHeight;
      }

      function push(role, html, isHtml) {
        var bubble = U.el('div.coach-msg' + (role === 'me' ? '.is-me' : ''), null, [
          U.el('div.coach-msg-body', isHtml ? { html: html } : { text: html })
        ]);
        listEl.appendChild(bubble);
        bottom();
        return bubble;
      }

      function chips() {
        var row = U.el('div.coach-chat-seeds', null, CHAT_SEED.map(function (s) {
          return U.el('button.chip', {
            type: 'button',
            onclick: function () {
              inputEl.value = s.q;
              doSend();
            }
          }, [s.t]);
        }));
        listEl.appendChild(row);
        bottom();
      }

      function doSend() {
        if (sending) return;
        var text = String(inputEl.value || '').trim();
        if (!text) return;
        inputEl.value = '';
        push('me', text);

        sending = true;
        sendBtn.classList.add('is-busy');
        sendBtn.disabled = true;

        var think = U.el('div.coach-chat-run', null, [U.icon('refresh'), '教练正在看你的数据…']);
        listEl.appendChild(think);
        bottom();

        var used = [];
        App.Agent.run({
          text: text,
          history: history.slice(-8),
          onEvent: function (e) {
            if (e.type === 'tool') {
              U.clear(think);
              think.appendChild(U.icon('refresh'));
              think.appendChild(document.createTextNode('正在' + (CHAT_TOOL[e.name] || '查数据') + '…'));
              bottom();
            } else if (e.type === 'tool-done') {
              used.push({ name: e.name, ok: e.ok, summary: e.summary });
              if (e.name === 'save_plan' || e.name === 'save_report' || e.name === 'update_plan') touched = true;
            }
          }
        }).then(function (r) {
          sending = false;
          sendBtn.classList.remove('is-busy');
          sendBtn.disabled = false;
          if (think.parentNode) think.parentNode.removeChild(think);

          if (r && r.ok) {
            history.push({ role: 'user', content: text });
            history.push({ role: 'assistant', content: r.text || '' });
            var bubble = push('bot', fmtChat(r.text || '（模型没有返回内容，再问一次？'), true);
            if (used.length) {
              bubble.appendChild(U.el('div.coach-msg-tools', null, used.map(function (t) {
                return U.el('span.coach-tool' + (t.ok ? '' : '.is-fail'), { text: (t.ok ? '✓ ' : '✕ ') + t.summary });
              })));
            }
            bottom();
          } else {
            push('bot', '⚠️ ' + ((r && r.error) || '请求失败，再试一次'));
          }
          sendBtn.disabled = false;
        });
      }

      var close = U.openSheet({
        title: '学习教练',
        body: U.el('div.coach-chat', null, [
          listEl,
          U.el('div.coach-chat-foot', null, [inputEl, sendBtn])
        ]),
        onClose: function () {
          if (touched && alive) rerender();
        }
      });

      push('bot', '我是你的学习教练。能直接看你的真实数据、<strong>定计划</strong>、<strong>写复盘</strong>，也能陪你把错词啃下来。想从哪开始？', true);
      chips();

      // 快捷发送
      sendBtn.addEventListener('click', doSend);
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          doSend();
        }
      });

      if (seedText) {
        inputEl.value = seedText;
        setTimeout(doSend, 120);
      }
      return close;
    }

    /* ---------- 跑生成 ---------- */
    function runPlan() {
      if (busy) return;
      setBusy('plan');
      App.Coach.generatePlan({
        onEvent: function () { /* 单次请求，无需分步提示 */ }
      }).then(function (r) {
        busy = '';
        if (!alive) return;
        if (r.ok) {
          U.toast('计划已生成，每日目标也一起更新了', 'ok');
          lastError = null;
        } else {
          lastError = { where: 'plan', text: r.error || '生成失败' };
        }
        rerender();
      });
    }

    function runReport() {
      if (busy) return;
      setBusy('report');
      var pro = App.Coach.profile();
      var days = pro.reportEvery >= 7 ? 7 : (pro.reportEvery <= 1 ? 3 : 7);
      App.Coach.generateReport({
        days: days,
        onEvent: function () { }
      }).then(function (r) {
        busy = '';
        if (!alive) return;
        if (r.ok) {
          U.toast('复盘完成', 'ok');
          open[r.report.id] = true;
          lastError = null;
        } else {
          lastError = { where: 'report', text: r.error || '复盘失败' };
        }
        rerender();
      });
    }

    /* ---------- 骨架 ---------- */
    function render(el) {
      root = el;
      alive = true;
      U.clear(el);
      el.classList.add('coach-page');

      el.appendChild(pageHead());

      var hint = aiHintCard();
      if (hint) el.appendChild(hint);

      if (busy) {
        el.appendChild(busyCard());
      } else {
        el.appendChild(planCard());
      }
      var err = errorCard();
      if (err) el.appendChild(err);
      if (busy) {
        el.appendChild(reportSectionForBusy());
      } else {
        el.appendChild(reportSection());
      }
      el.appendChild(dataSection());

      var tip = U.el('div.save-tip', null, [
        U.el('span.dot'),
        U.el('span', { text: '计划和复盘都存在本机浏览器；只有点「生成」时才会把统计数据发给你的模型接口' })
      ]);
      el.appendChild(tip);
    }

    // 生成中时，复盘区只显示标题，避免两个按钮同时可点
    function reportSectionForBusy() {
      var list = App.Coach.reports();
      var kids = [U.el('div.card-title', null, [U.icon('chart'), '学习复盘', U.el('span.spacer')])];
      if (!list.length) {
        kids.push(U.el('div.coach-none', { text: '还没有复盘记录。' }));
      } else {
        var box = U.el('div.coach-reps');
        list.slice(0, 3).forEach(function (rep) { box.appendChild(reportCard(rep, false)); });
        kids.push(box);
      }
      return U.el('section.card', null, kids);
    }

    function destroy() {
      alive = false;
      busy = '';
      if (root) root.classList.remove('coach-page');
    }

    return { render: render, destroy: destroy };
  }

  App.Views = App.Views || {};
  App.Views.coach = function () { return view(); };

  /* =========================================================
     每天第一次打开时：到复盘时间就提醒一句
     只出提示、不自动请求接口（避免偷偷花额度）
     ========================================================= */
  App.CoachNudge = function nudge() {
    if (!App.Coach || !App.Coach.notice) return null;
    var info = App.Coach.notice();
    if (!info) return null;
    // 已经有浮层开着（向导、确认框等）就先不打扰
    if (document.querySelector('#sheet-root .sheet')) return null;

    App.Coach.markNotice();

    var days = info.never ? 0 : (info.days || 0);
    var titleText = info.never ? '计划已经走了 ' + info.planDay + ' 天，还没复盘过' : '距上次复盘 ' + days + ' 天，该看一看了';
    var subText = info.never
      ? '花一分钟看看：这几天完成了多少、卡在哪种题上、哪些词一直记不住。'
      : '看看这几天的进度、易错题型和最记不住的词，顺便调一下目标。';

    var closed = false;
    var sheet = null;

    var foot = [
      U.el('button.btn.btn-ghost', {
        type: 'button',
        onclick: function () { U.closeSheet(); }
      }, ['今天先不']),
      U.el('button.btn.btn-primary', {
        type: 'button',
        onclick: function () { run(false); }
      }, [U.icon(info.ai ? 'sparkle' : 'chart'), info.ai ? '用 AI 复盘' : '生成数据版复盘'])
    ];

    if (info.ai) {
      foot.splice(1, 0, U.el('button.btn.btn-ghost', {
        type: 'button',
        onclick: function () { run(true); }
      }, ['不用 AI']));
    }

    var bodyText = U.el('div.coach-due-sub', { style: { margin: '0 0 12px' }, text: subText });
    var list = U.el('div.coach-rules', null, [
      U.el('div.coach-rule', null, [U.icon('check'), '进度：这 ' + Math.max(1, info.planDay) + ' 天的目标达成率']),
      U.el('div.coach-rule', null, [U.icon('check'), '易错点：错得最多的题型和原因']),
      U.el('div.coach-rule', null, [U.icon('check'), '易错词：遗忘最多的词 + 记忆方法'])
    ]);

    var body = U.el('div', null, [
      U.el('div.coach-due', null, [
        U.icon('chart'),
        U.el('div.coach-due-main', null, [
          U.el('div.coach-due-title', { text: titleText }),
          U.el('div.coach-due-sub', {
            text: '第 ' + Math.max(1, info.planDay) + '/' + info.total + ' 天' +
              (info.phase ? ' · ' + info.phase : '')
          })
        ])
      ]),
      bodyText,
      list,
      U.el('div.tip-line', { text: '只在你点的时候才调用接口，生成的复盘会存进教练页的时间线。' })
    ]);

    sheet = U.openSheet({
      title: '该复盘了', body: body, foot: foot,
      onClose: function () { closed = true; }
    });

    function run(localOnly) {
      if (closed) return;
      var box = body.querySelector('.coach-due');
      bodyText.textContent = '正在翻你最近的记录…';
      if (box) box.classList.add('is-busy');

      var done = function (ok, err) {
        if (ok) {
          U.toast('复盘已生成', 'ok');
          if (App.Router.currentRoute() === '#/coach') App.Router.reload();
          else App.Router.go('#/coach');
          setTimeout(function () { U.closeSheet(); }, 260);
        } else {
          U.toast(err || '生成失败', 'err');
          bodyText.textContent = '这次没成：' + (err || '未知错误') + '。想重试就再点一次，或者去教练页用本地版本。';
        }
      };

      if (localOnly || !info.ai) {
        var rep = App.Coach.makeLocalReport(info.never ? 7 : Math.max(info.every || 7, 3));
        done(!!rep, '');
        return;
      }

      App.Coach.generateReport({ days: info.never ? 7 : Math.max(info.every || 7, 3) }).then(function (r) {
        done(r && r.ok, r && r.error);
      });
    }

    return { close: sheet, info: info };
  };
})(window);
