/* =========================================================
   views/listen.js — 听力精听
   没有音频文件也能练：用浏览器自带的英文语音合成（App.TTS）逐句朗读，
   支持调速、单句循环、隐藏原文听写、逐词比对。
   数据存在 Store.state.listenTasks：[{id,title,text,rounds,lastAt,createdAt}]
   ========================================================= */
(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var U = App.Utils;

  var RATES = [0.6, 0.75, 0.9, 1, 1.25];
  var LOOPS = [1, 2, 3];

  /* 空态示例：三段原创短材料，覆盖新闻/对话/讲座三种语感 */
  var SAMPLES = [
    {
      title: '示例 · 校园新闻',
      text: 'The university library will extend its opening hours during the final exam weeks. ' +
        'Students can now study there until midnight on weekdays. ' +
        'The change was announced after a survey showed that most students preferred late-night study. ' +
        'Library staff ask students to keep the reading rooms quiet and to bring their student cards.'
    },
    {
      title: '示例 · 日常对话',
      text: 'Hi, I heard you are looking for a part-time job on campus. ' +
        "Yes, I applied to the writing center last week. They need someone to help students with essays. " +
        'That sounds perfect for you. When will you know the result? ' +
        'They said they would call me before Friday.'
    },
    {
      title: '示例 · 学术讲座',
      text: 'Today I want to talk about how sleep affects memory. ' +
        'Research shows that the brain replays what we learn during the day while we sleep. ' +
        'People who sleep less than six hours tend to forget new words much faster. ' +
        'So if you are preparing for an exam, regular sleep may be as important as review.'
    }
  ];

  function store() { return App.Store.state; }

  function tasks() {
    var s = store();
    if (!Array.isArray(s.listenTasks)) s.listenTasks = [];
    return s.listenTasks;
  }

  /** 按句末标点切句，过短的片段（如缩写残留）并入上一句 */
  function splitSentences(text) {
    var raw = String(text || '')
      .replace(/\r/g, '')
      .replace(/([.!?。！？])\s+/g, '$1\n')
      .split('\n');
    var out = [];
    raw.forEach(function (line) {
      line = line.trim();
      if (!line) return;
      if (out.length && countWords(out[out.length - 1]) < 4 && countWords(line) < 4) {
        out[out.length - 1] += ' ' + line;
      } else {
        out.push(line);
      }
    });
    return out;
  }

  function countWords(s) {
    return String(s || '').trim().split(/\s+/).filter(Boolean).length;
  }

  /* 归一化：小写、去标点、压缩空白 */
  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokens(s) { return normalize(s).split(' ').filter(Boolean); }

  /**
   * 逐词比对（LCS 对齐），返回
   * { accuracy, html, missing: [], extra: [] }
   * html 里：正确=原样、遗漏=<span class="dw-miss">词</span>、多余=<span class="dw-extra">词</span>
   */
  function diff(input, target) {
    var a = tokens(input);
    var b = tokens(target);
    var n = a.length, m = b.length;
    var dp = [];
    for (var i = 0; i <= n; i++) {
      dp.push(new Array(m + 1).fill(0));
    }
    for (i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var html = [];
    var missing = [];
    var extra = [];
    i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        html.push(U.escapeHtml(b[j]));
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        html.push('<span class="dw-extra">' + U.escapeHtml(a[i]) + '</span>');
        extra.push(a[i]);
        i++;
      } else {
        html.push('<span class="dw-miss">' + U.escapeHtml(b[j]) + '</span>');
        missing.push(b[j]);
        j++;
      }
    }
    while (i < n) { html.push('<span class="dw-extra">' + U.escapeHtml(a[i]) + '</span>'); extra.push(a[i]); i++; }
    while (j < m) { html.push('<span class="dw-miss">' + U.escapeHtml(b[j]) + '</span>'); missing.push(b[j]); j++; }

    var hit = Math.max(0, m - missing.length);
    var accuracy = m ? Math.round(hit / m * 100) : 0;
    return { accuracy: accuracy, html: html.join(' '), missing: missing, extra: extra };
  }

  /* =========================================================
     视图
     ========================================================= */
  function view() {
    var root = null;
    var alive = true;

    // 播放会话状态（切走就停）
    var session = null;   // { task, sentences, idx, rate, loops, hidden, ctrl, startedAt }

    /* ---------------- 列表页 ---------------- */
    function renderList(el) {
      U.clear(el);

      var head = U.el('div.page-head', null, [
        U.el('h1.page-title', { text: '听力精听' }),
        U.el('span.spacer'),
        U.el('button.icon-btn', {
          type: 'button', 'aria-label': '新建材料',
          onclick: function () { openEditor(); }
        }, [U.icon('plus')])
      ]);
      el.appendChild(head);

      if (!App.TTS.supported()) {
        el.appendChild(U.el('div.empty', null, [
          U.el('div.empty-title', { text: '当前浏览器不支持语音朗读' }),
          U.el('div.empty-desc', { text: '请用 Chrome / Edge 打开；听写功能仍然可用。' })
        ]));
      }

      var list = tasks();
      el.appendChild(U.el('div.tip-line', {
        text: '没有音频也能练：选一段材料，逐句精听、听写、对照。'
      }));

      if (list.length) {
        var wrap = U.el('div');
        list.slice().reverse().forEach(function (t) {
          wrap.appendChild(taskCard(t));
        });
        el.appendChild(wrap);
      }

      // 示例区（始终可见，可一键导入）
      el.appendChild(U.el('div.card-title', { text: '示例材料' }));
      var sampleWrap = U.el('div');
      SAMPLES.forEach(function (s) {
        sampleWrap.appendChild(taskCard({ title: s.title, text: s.text, sample: true }));
      });
      el.appendChild(sampleWrap);

      el.appendChild(U.el('button.btn.btn-primary.btn-block', {
        type: 'button',
        onclick: function () { openEditor(); }
      }, [U.icon('plus'), '粘贴一段英文，创建精听材料']));
    }

    function taskCard(t) {
      var n = splitSentences(t.text).length;
      var isSample = !!t.sample;
      return U.el('button.card.mat-card', {
        type: 'button',
        onclick: function () {
          var task = t;
          if (isSample) task = importSample(t);
          openPlayer(task);
        }
      }, [
        U.el('div.mat-title', null, [
          U.el('span', { text: t.title }),
          isSample ? U.el('span.badge.badge-info', { text: '示例' }) : null
        ]),
        U.el('div.mat-body', { text: t.text.slice(0, 96) + (t.text.length > 96 ? '…' : '') }),
        U.el('div.mat-tags', null, [
          U.el('span.badge', { text: n + ' 句' }),
          U.el('span.badge', { text: Math.max(1, Math.round(countWords(t.text) / 120)) + ' 分钟' }),
          t.rounds ? U.el('span.badge.badge-ok', { text: '已练 ' + t.rounds + ' 轮' }) : null
        ])
      ]);
    }

    function importSample(t) {
      var task = {
        id: U.uid('ls'),
        title: t.title.replace(/^示例\s*·\s*/, ''),
        text: t.text,
        rounds: 0,
        createdAt: Date.now(),
        lastAt: 0
      };
      App.Store.commit(function (s) {
        if (!Array.isArray(s.listenTasks)) s.listenTasks = [];
        s.listenTasks.push(task);
      });
      App.Store.flush();
      U.toast('已加入我的材料', 'ok');
      return task;
    }

    /* ---------------- 新建/编辑 ---------------- */
    function openEditor(existing) {
      var titleInput = U.el('input.input', {
        value: existing ? existing.title : '',
        placeholder: '标题，例如：2023 年 6 月听力新闻 1',
        maxlength: '60'
      });
      var textArea = U.el('textarea.textarea', {
        rows: '9',
        placeholder: '粘贴英文原文。每句以 . ! ? 结束，会自动切分句子。'
      });
      textArea.value = existing ? existing.text : '';

      var stat = U.el('div.field-hint', { text: '0 句' });
      textArea.addEventListener('input', function () {
        stat.textContent = splitSentences(textArea.value).length + ' 句 / ' +
          countWords(textArea.value) + ' 词';
      });

      var body = U.el('div', null, [
        U.el('div.field', null, [U.el('label.field-label', { text: '标题' }), titleInput]),
        U.el('div.field', null, [U.el('label.field-label', { text: '英文原文' }), textArea, stat])
      ]);

      U.openSheet({
        title: existing ? '编辑材料' : '新建精听材料',
        body: body,
        foot: [
          existing ? U.el('button.btn.btn-ghost', {
            type: 'button',
            onclick: function () {
              U.confirm({ title: '删除材料', message: '只删除这份文本，不影响练习记录。', danger: true, okText: '删除' })
                .then(function (yes) {
                  if (!yes) return;
                  App.Store.commit(function (s) {
                    s.listenTasks = (s.listenTasks || []).filter(function (x) { return x.id !== existing.id; });
                  });
                  App.Store.flush();
                  U.closeSheet();
                  renderList(root);
                  U.toast('已删除', 'ok');
                });
            }
          }, ['删除']) : null,
          U.el('span.spacer'),
          U.el('button.btn.btn-primary', {
            type: 'button',
            onclick: function () {
              var text = textArea.value.trim();
              var title = titleInput.value.trim() || '未命名材料';
              if (countWords(text) < 8) {
                U.toast('至少粘贴 8 个单词的英文', 'err');
                return;
              }
              App.Store.commit(function (s) {
                if (!Array.isArray(s.listenTasks)) s.listenTasks = [];
                if (existing) {
                  existing.title = title;
                  existing.text = text;
                } else {
                  s.listenTasks.push({
                    id: U.uid('ls'), title: title, text: text,
                    rounds: 0, createdAt: Date.now(), lastAt: 0
                  });
                }
              });
              App.Store.flush();
              U.closeSheet();
              if (root) renderList(root);
              U.toast(existing ? '已保存' : '已创建', 'ok');
            }
          }, ['保存'])
        ].filter(Boolean)
      });
    }

    /* ---------------- 播放/精听页 ---------------- */
    function openPlayer(task) {
      var sentences = splitSentences(task.text);
      if (!sentences.length) { U.toast('这份材料没有可用句子', 'err'); return; }
      session = {
        task: task,
        sentences: sentences,
        idx: 0,
        rate: Number(store().settings.ttsRate) || 0.9,
        loops: 1,
        hidden: false,
        ctrl: null,
        startedAt: Date.now(),
        auto: false
      };
      renderPlayer();
    }

    function renderPlayer() {
      var s = session;
      U.clear(root);

      root.appendChild(U.el('div.page-head', null, [
        U.el('button.icon-btn', {
          type: 'button', 'aria-label': '返回列表',
          onclick: function () { stopAudio(); session = null; renderList(root); }
        }, [U.icon('back')]),
        U.el('h1.page-title', { text: s.task.title }),
        U.el('span.spacer'),
        U.el('button.icon-btn', {
          type: 'button', 'aria-label': '编辑',
          onclick: function () { openEditor(s.task); }
        }, [U.icon('edit')])
      ]));

      // 进度
      var progress = U.el('div.player-time', null, [
        U.el('span', { text: '第 ' + (s.idx + 1) + ' / ' + s.sentences.length + ' 句' }),
        U.el('span', { text: countWords(s.sentences[s.idx]) + ' 词' })
      ]);
      root.appendChild(progress);

      // 当前句卡片
      var curCard = U.el('div.player', { id: 'ls-cur' });
      root.appendChild(curCard);
      paintCurrent(curCard);

      // 控制区
      var rateWrap = U.el('div.row', { style: { gap: '8px', flexWrap: 'wrap', marginTop: '14px' } });
      RATES.forEach(function (r) {
        rateWrap.appendChild(U.el('button.rate-chip' + (Math.abs(r - s.rate) < 0.001 ? '.is-on' : ''), {
          type: 'button',
          onclick: function () {
            s.rate = r;
            App.Store.commit(function (st) { st.settings.ttsRate = r; });
            App.Store.flush();
            paintRate(rateWrap);
            play(true);
          }
        }, [r.toFixed(2).replace(/0$/, '') + '×']));
      });
      root.appendChild(rateWrap);

      var loopWrap = U.el('div.row', { style: { gap: '8px', flexWrap: 'wrap', marginTop: '10px' } }, [
        U.el('span.field-hint', { text: '重复' })
      ]);
      LOOPS.forEach(function (n) {
        loopWrap.appendChild(U.el('button.rate-chip' + (n === s.loops ? '.is-on' : ''), {
          type: 'button',
          onclick: function () {
            s.loops = n;
            U.$$('.rate-chip', loopWrap).forEach(function (b) { b.classList.remove('is-on'); });
            this.classList.add('is-on');
          }
        }, ['×' + n]));
      });
      root.appendChild(loopWrap);

      // 播放控制
      var ctrls = U.el('div.player-ctrls', { style: { marginTop: '16px' } }, [
        U.el('button.player-side', {
          type: 'button', 'aria-label': '上一句',
          onclick: function () { goto(s.idx - 1); }
        }, [U.icon('back')]),
        U.el('button.player-play', {
          type: 'button', id: 'ls-play', 'aria-label': '播放',
          onclick: function () { play(true); }
        }, [U.icon('play')]),
        U.el('button.player-side', {
          type: 'button', 'aria-label': '下一句',
          onclick: function () { goto(s.idx + 1); }
        }, [U.icon('right')])
      ]);
      root.appendChild(ctrls);

      // 听写模式切换
      var modeRow = U.el('div.row', { style: { marginTop: '16px', justifyContent: 'center', gap: '10px' } }, [
        U.el('button.chip' + (s.hidden ? '.is-on' : ''), {
          type: 'button',
          onclick: function () {
            s.hidden = !s.hidden;
            this.classList.toggle('is-on', s.hidden);
            renderPlayer();
          }
        }, [U.icon('mic'), s.hidden ? '听写中（点此显示原文）' : '进入听写模式'])
      ]);
      root.appendChild(modeRow);

      root.appendChild(U.el('div.tip-line', {
        text: s.hidden
          ? '先听 3 遍再写。写不出的词可以只写首字母，提交后对照。'
          : '点任意句子可重读；隐藏原文可进入听写模式。'
      }));

      // 句子列表
      var listWrap = U.el('div', { id: 'ls-list', style: { marginTop: '6px', paddingBottom: '20px' } });
      s.sentences.forEach(function (text, i) {
        listWrap.appendChild(sentenceRow(text, i));
      });
      root.appendChild(listWrap);
    }

    function paintRate(wrap) {
      var chips = U.$$('.rate-chip', wrap);
      RATES.forEach(function (r, i) {
        if (chips[i]) chips[i].classList.toggle('is-on', Math.abs(r - session.rate) < 0.001);
      });
    }

    function sentenceRow(text, i) {
      var s = session;
      var active = i === s.idx;
      var row = U.el('button.card.mat-card' + (active ? '.is-active' : ''), {
        type: 'button',
        style: active ? { borderColor: 'var(--brand-2)', background: 'var(--grad-brand-soft)' } : null,
        onclick: function () { goto(i); play(true); }
      }, [
        U.el('div.mat-title', null, [
          U.el('span.badge', { text: String(i + 1) }),
          U.el('span', { text: s.hidden && !active ? '··········' : truncate(text, 70) })
        ])
      ]);
      return row;
    }

    function truncate(s, n) {
      s = String(s || '');
      return s.length > n ? s.slice(0, n) + '…' : s;
    }

    function paintCurrent(card) {
      var s = session;
      var text = s.sentences[s.idx];
      U.clear(card);
      card.appendChild(U.el('div.player-name', { text: '第 ' + (s.idx + 1) + ' 句' }));

      if (!s.hidden) {
        card.appendChild(U.el('div.dictation', {
          style: { border: 'none', boxShadow: 'none', padding: '0' },
          text: text
        }));
        return;
      }

      // 听写模式：输入框 + 提交后对照
      var input = U.el('textarea.textarea', {
        rows: '3',
        placeholder: '把你听到的写下来（不要求标点）'
      });
      var out = U.el('div');
      var submit = U.el('button.btn.btn-primary.btn-block', {
        type: 'button',
        onclick: function () {
          var r = diff(input.value, text);
          U.clear(out);
          out.appendChild(U.el('div.dict-answer', {
            text: r.accuracy >= 90 ? '准确率 ' + r.accuracy + '%，几乎全对'
              : r.accuracy >= 60 ? '准确率 ' + r.accuracy + '%，再看一眼漏掉的词'
                : '准确率 ' + r.accuracy + '%，先按 0.75 倍速重听两遍'
          }));
          out.appendChild(U.el('div.dictation', {
            style: { marginTop: '8px', fontSize: '14.5px', lineHeight: '2' },
            html: r.html
          }));
          if (r.missing.length) {
            out.appendChild(U.el('div.field-hint', { text: '漏听 ' + r.missing.length + ' 词：' + r.missing.slice(0, 12).join(', ') }));
          }
        }
      }, ['对照答案']);

      card.appendChild(input);
      card.appendChild(U.el('div.row', { style: { gap: '8px', marginTop: '10px' } }, [
        U.el('button.btn.btn-ghost.btn-sm', {
          type: 'button', onclick: function () { play(true); }
        }, [U.icon('volume'), '重听']),
        U.el('span.spacer'),
        U.el('button.btn.btn-ghost.btn-sm', {
          type: 'button', onclick: function () { goto(s.idx + 1); }
        }, ['下一句'])
      ]));
      card.appendChild(submit);
      card.appendChild(out);
      setTimeout(function () { try { input.focus(); } catch (e) { /* 忽略 */ } }, 60);
    }

    function goto(i) {
      var s = session;
      if (!s) return;
      if (i < 0) i = 0;
      if (i >= s.sentences.length) { finishRound(); return; }
      s.idx = i;
      renderPlayer();
    }

    /* ---------------- 播放 ---------------- */
    function play(autoplayNext) {
      var s = session;
      if (!s) return;
      stopAudio();
      updatePlayBtn(true);

      var remaining = s.loops;
      var guard = null;

      function once() {
        if (!alive || !session) return;
        s.ctrl = App.TTS.speak(s.sentences[s.idx], {
          rate: s.rate,
          onend: function () {
            if (!alive || !session) return;
            remaining--;
            if (remaining > 0) {
              guard = setTimeout(once, 320);   // 句间留半拍，方便跟读
            } else {
              updatePlayBtn(false);
              if (autoplayNext && s.idx < s.sentences.length - 1) {
                setTimeout(function () {
                  if (!alive || !session) return;
                  var wasAuto = autoplayNext;
                  s.idx++;
                  renderPlayer();
                  play(wasAuto);
                }, 520);
              } else if (autoplayNext) {
                finishRound();
              }
            }
          }
        });
      }
      once();
      s.guard = guard;
    }

    function stopAudio() {
      if (session && session.guard) { clearTimeout(session.guard); session.guard = null; }
      App.TTS.cancel();
      updatePlayBtn(false);
    }

    function updatePlayBtn(on) {
      var b = U.$('#ls-play');
      if (!b) return;
      U.clear(b);
      b.appendChild(U.icon(on ? 'pause' : 'play'));
    }

    /* ---------------- 一轮结束 ---------------- */
    function finishRound() {
      var s = session;
      if (!s) return;
      stopAudio();
      var minutes = Math.max(1, Math.min(60, Math.round((Date.now() - s.startedAt) / 60000)));

      App.Store.commit(function (st) {
        var t = (st.listenTasks || []).filter(function (x) { return x.id === s.task.id; })[0];
        if (t) { t.rounds = (t.rounds || 0) + 1; t.lastAt = Date.now(); }
      });
      App.Store.addLog({ listenDone: 1, minutes: minutes });
      App.Store.flush();

      U.confirm({
        title: '这一轮练完了',
        message: '用时约 ' + minutes + ' 分钟，已记入今日听力。',
        okText: '再来一轮'
      }).then(function (again) {
        if (!alive) return;
        if (again) {
          session.idx = 0;
          session.startedAt = Date.now();
          renderPlayer();
        } else {
          session = null;
          renderList(root);
        }
      });
    }

    /* ---------------- 生命周期 ---------------- */
    function render(el) {
      root = el;
      alive = true;
      session = null;
      renderList(el);
    }

    function destroy() {
      alive = false;
      stopAudio();
      session = null;
    }

    return { render: render, destroy: destroy };
  }

  App.Views = App.Views || {};
  App.Views.listen = function () { return view(); };
})(window);
