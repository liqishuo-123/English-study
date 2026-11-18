/* =========================================================
   views/words.js — 单词背诵
   依赖：core/*, data/*
   包含：组合筛选面板 / 抽题引擎会话 / 三种自测模式 / 掌握标记 / 滑动手势
   ========================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.Utils;

  var FREQ_LABEL = { high: '高频', mid: '中频', low: '低频' };
  var STAGE_LABEL = { hs: '高中课标内', beyond: '高中外增量' };
  var STATUS_LABEL = { new: '未学', learning: '学习中', mastered: '已掌握' };
  var SCOPE_LABEL = { 'today-new': '今日新词', due: '到期复习', starred: '生词本', custom: '自定义数量' };

  var mode = 'study';           // study | spell | choice
  var session = null;           // 抽题会话（跨重绘保持，保证单轮不重复）
  var current = null;           // 当前单词
  var poolResult = null;        // 最近一次构建的抽题池结果
  var flipped = false;
  var choiceState = null;
  var spellState = null;
  var keyHandler = null;
  var lastRoot = null;          // 供局部重绘使用

  /* ---------------- 会话管理 ---------------- */
  function filterCfg() { return App.Store.state.settings.filter; }

  /** 构建抽题池 + 创建会话（仅进入页面或筛选变化时调用） */
  function resetSession() {
    poolResult = App.Picker.buildPool(filterCfg());
    if (poolResult.empty) { session = null; current = null; return; }
    session = App.Picker.createSession(poolResult.words);
    current = null;
    nextWord();
  }

  function nextWord() {
    flipped = false;
    choiceState = null;
    spellState = null;
    current = session ? session.next() : null;
    if (current) App.Store.setProg(current.id, { lastSeenAt: U.today() });
  }

  function redraw() { if (lastRoot) draw(lastRoot); }

  /* ---------------- 评分 ---------------- */
  function grade(q) {
    if (!current) return;
    var w = current;
    var nextSrs = App.SRS.gradeWord(w.srs, q);
    App.Store.setProg(w.id, { srs: nextSrs, status: App.SRS.statusFor(nextSrs) });

    var isNew = (w.srs.interval === 0 && w.srs.reps === 0);
    App.Store.addLog(isNew ? { wordsNew: 1 } : { wordsReviewed: 1 });

    if (!w.mastered && App.SRS.isAutoMastered(nextSrs)) {
      App.Store.setProg(w.id, { mastered: true, masteredAt: U.today() });
      U.toast('「' + w.word + '」已自动标记为掌握', 'ok');
    }

    if (q === 0) {
      U.vibrate(22);
      U.playTone('wrong');
      shake();
    } else {
      U.vibrate(8);
      U.playTone('right');
    }
    nextWord();
    redraw();
  }

  function shake() {
    var card = U.$('#word-card');
    if (!card) return;
    card.classList.remove('is-shake');
    void card.offsetWidth;
    card.classList.add('is-shake');
  }

  /* ---------------- 掌握 / 收藏 ---------------- */
  function toggleMastered() {
    if (!current) return;
    var w = current;
    var nextVal = !w.mastered;
    App.Store.setProg(w.id, { mastered: nextVal, masteredAt: nextVal ? U.today() : null });
    U.vibrate(12);
    if (nextVal) {
      if (session) session.drop(w.id);
      U.toast('已标记掌握，该词已退出抽题池', 'ok');
      nextWord();
    } else {
      U.toast('已取消掌握标记');
    }
    App.Picker.invalidate();
    redraw();
  }

  function toggleStar() {
    if (!current) return;
    App.Store.setProg(current.id, { starred: !current.starred });
    U.vibrate(8);
    redraw();
  }

  /* ---------------- 主渲染 ---------------- */
  function draw(root) {
    lastRoot = root;
    U.clear(root);

    var log = App.Store.log();
    var goalToday = Math.max(10, App.Store.state.settings.dailyNewWords || 30);
    var totalToday = (log.wordsNew || 0) + (log.wordsReviewed || 0);

    /* --- 顶部：进度 + 筛选胶囊 --- */
    root.appendChild(U.el('div.words-top', null, [
      U.el('div.words-prog', null, [
        U.el('div.bar.words-prog-bar', null, [
          U.el('div.bar-fill', { style: { width: U.clamp(Math.round(totalToday / goalToday * 100), 0, 100) + '%' } })
        ]),
        U.el('div.words-prog-text', null, [
          U.el('span', { text: '今日 ' + totalToday + ' / ' + goalToday + ' 词' }),
          U.el('span', { text: session ? ('本轮剩余 ' + session.remaining() + ' / ' + session.total) : '0' })
        ])
      ]),
      U.el('button.pill' + (hasActiveFilter() ? '.is-on' : ''), {
        type: 'button', onclick: openFilterSheet
      }, [U.icon('filter'), U.el('span', { text: session ? String(session.total) : '0' })])
    ]));

    root.appendChild(U.el('div.seg', { style: { marginBottom: '12px' } }, [
      segItem('学习', 'study'), segItem('拼写', 'spell'), segItem('选择', 'choice')
    ]));

    /* --- 空池兜底 --- */
    if (!session || !current) {
      root.appendChild(U.el('div.empty', null, [
        U.icon('filter'),
        U.el('div.empty-title', { text: '没有符合条件的单词' }),
        U.el('div.empty-desc', { text: poolResult && poolResult.reason ? App.Picker.reasonText(poolResult.reason) : '试试放宽筛选条件' }),
        U.el('div', { style: { marginTop: '16px', display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' } }, [
          U.el('button.btn', { type: 'button', onclick: resetFilter }, ['重置筛选']),
          U.el('button.btn.btn-primary', {
            type: 'button',
            onclick: function () {
              App.Store.commit(function (s) { s.settings.filter.consolidate = true; });
              resetSession();
              redraw();
            }
          }, ['开启巩固模式'])
        ])
      ]));
      return;
    }

    if (mode === 'study') root.appendChild(buildCard());
    else if (mode === 'spell') root.appendChild(buildSpell());
    else root.appendChild(buildChoice());
  }

  function hasActiveFilter() {
    var f = filterCfg();
    return f.freq.length !== 3 || f.stage.length !== 2 || f.status.length !== 3 ||
      f.consolidate || f.starredOnly || f.level !== 'cet4';
  }

  function segItem(label, key) {
    return U.el('button.seg-item' + (mode === key ? '.is-active.seg-fill' : ''), {
      type: 'button', onclick: function () { mode = key; redraw(); }
    }, [label]);
  }

  /* ---------------- 学习模式：翻面卡片 ---------------- */
  function buildCard() {
    var w = current;
    var zone = U.el('div.word-card-zone');
    var card = U.el('div.word-card' + (flipped ? '.is-flipped' : ''), { id: 'word-card' });

    card.appendChild(U.el('div.word-face.word-face-front', null, [
      U.el('div.word-badges', null, [
        U.el('span.badge.badge-brand', { text: FREQ_LABEL[w.freq] || '中频' }),
        U.el('span.badge', { text: STAGE_LABEL[w.stage] || '高中课标内' }),
        w.mastered ? U.el('span.badge.badge-ok', { text: '已掌握' }) : null,
        w.starred ? U.el('span.badge.badge-warn', { text: '生词本' }) : null,
        w.isPhrase ? U.el('span.badge.badge-info', { text: '短语' }) : null
      ]),
      U.el('button.word-star' + (w.mastered ? '.is-on' : ''), {
        type: 'button', title: '标为已掌握（快捷键 M）',
        onclick: function (e) { e.stopPropagation(); toggleMastered(); }
      }, [U.icon('check')]),
      U.el('div.word-main', null, [
        U.el('div.word-text', { text: w.word }),
        w.phonetic ? U.el('div.word-phonetic', { text: w.phonetic }) : null,
        (App.TTS && App.TTS.supported()) ? U.el('button.word-speak', {
          type: 'button', 'aria-label': '朗读单词',
          onclick: function (e) {
            e.stopPropagation();
            App.TTS.say(w.word);
          }
        }, [U.icon('volume')]) : null
      ]),
      U.el('div.word-tip', { text: '点击卡片查看释义 · 左右滑动换词' })
    ]));

    card.appendChild(U.el('div.word-face.word-face-back', null, [
      U.el('div.word-badges', null, [
        U.el('span.badge.badge-brand', { text: w.word }),
        w.mastered ? U.el('span.badge.badge-ok', { text: '已掌握' }) : null
      ]),
      U.el('div.word-back-scroll', null, [
        U.el('div.word-pos', { text: w.pos || '' }),
        U.el('div.word-meaning', { text: w.meaning }),
        w.example ? U.el('div.word-ex', null, [
          U.el('div.word-ex-en', { html: highlight(w.example, w.word) }),
          w.exampleCn ? U.el('div.word-ex-cn', { text: w.exampleCn }) : null
        ]) : null,
        U.el('button.link-btn', {
          type: 'button',
          style: { marginTop: '10px' },
          onclick: function (e) {
            e.stopPropagation();
            askAgent(w);
          }
        }, [U.icon('sparkle'), '问助教：词根 · 搭配 · 易混词']),
        U.el('div', { style: { marginTop: '14px', fontSize: '12px', color: 'var(--text-3)' } }, [
          App.SRS.dueLabel(w.srs) + ' · 已复习 ' + (w.srs.reps || 0) + ' 次'
        ])
      ]),
      U.el('div.word-tip', { text: '点击卡片返回正面' })
    ]));

    zone.appendChild(card);
    U.onSwipe(zone, {
      tap: function () { flipped = !flipped; card.classList.toggle('is-flipped'); },
      left: function () { nextWord(); redraw(); },
      right: function () { nextWord(); redraw(); }
    });

    var frag = document.createDocumentFragment();
    frag.appendChild(zone);
    frag.appendChild(gradeBar());
    frag.appendChild(U.el('div.word-actions', null, [
      U.el('button.btn.btn-sm' + (current.starred ? '.btn-ok' : ''), {
        type: 'button', onclick: toggleStar
      }, [U.icon('star'), current.starred ? '已收藏' : '生词本']),
      U.el('button.btn.btn-sm' + (current.mastered ? '.btn-ok' : ''), {
        type: 'button', onclick: toggleMastered
      }, [U.icon('check'), current.mastered ? '已掌握' : '标为已掌握']),
      U.el('button.btn.btn-sm', {
        type: 'button', onclick: openMasteredSheet
      }, [U.icon('cards'), '已掌握 ' + App.Picker.masteredWords().length])
    ]));
    return frag;
  }

  function gradeBar() {
    return U.el('div.grade-bar', null, [
      U.el('button.grade-btn.grade-0', { type: 'button', onclick: function () { grade(0); } }, ['不认识', U.el('span.g-key', { text: '1' })]),
      U.el('button.grade-btn.grade-1', { type: 'button', onclick: function () { grade(1); } }, ['模糊', U.el('span.g-key', { text: '2' })]),
      U.el('button.grade-btn.grade-2', { type: 'button', onclick: function () { grade(2); } }, ['认识', U.el('span.g-key', { text: '3' })])
    ]);
  }

  function highlight(text, word) {
    var safe = U.escapeHtml(text);
    if (!word) return safe;
    try {
      var re = new RegExp('(' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      return safe.replace(re, '<b>$1</b>');
    } catch (e) { return safe; }
  }

  /* ---------------- 问助教 ---------------- */
  function askAgent(w) {
    if (!App.Agent || !App.Agent.seed) { U.toast('AI 助教未就绪'); return; }
    App.Agent.seed('给我讲讲 ' + w.word + '（' + (w.meaning || '') + '）这个词：'
      + '词根词缀怎么记、常见搭配有哪些、容易和哪些词混，最后各造一个四六级难度的例句。');
  }

  /* ---------------- 拼写模式 ---------------- */
  function buildSpell() {
    var w = current;
    var input = U.el('input.spell-input', {
      type: 'text', placeholder: '输入单词后按回车', autocomplete: 'off',
      autocapitalize: 'off', spellcheck: 'false'
    });
    if (spellState) input.value = spellState.value;

    var blanked = '';
    try {
      blanked = U.escapeHtml(w.example || '').replace(
        new RegExp(w.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '______');
    } catch (e) { blanked = U.escapeHtml(w.example || ''); }

    var frag = document.createDocumentFragment();
    frag.appendChild(U.el('div.card', null, [
      U.el('div.card-title', null, [U.icon('pen'), '写出这个单词',
        U.el('span.spacer'),
        U.el('span.badge.badge-brand', { text: FREQ_LABEL[w.freq] || '中频' })]),
      U.el('div.word-pos', { text: w.pos || '' }),
      U.el('div.word-meaning', { text: w.meaning, style: { fontSize: '19px' } }),
      blanked ? U.el('div.word-ex', { style: { marginTop: '12px' }, html: blanked }) : null
    ]));

    frag.appendChild(U.el('div', { style: { margin: '16px 0' } }, [input]));
    frag.appendChild(U.el('button.btn.btn-primary.btn-block.btn-lg', {
      type: 'button', onclick: function () { doSpell(input.value); }
    }, ['核对答案']));

    if (spellState && spellState.checked) {
      frag.appendChild(U.el('div.card', { style: { marginTop: '12px' } }, [
        U.el('div', { style: { fontSize: '16px' } }, [
          U.el('b', { text: w.word }),
          w.phonetic ? U.el('span', { style: { color: 'var(--text-3)', marginLeft: '8px', fontSize: '14px' }, text: w.phonetic }) : null
        ]),
        w.exampleCn ? U.el('div', { style: { marginTop: '6px', fontSize: '13.5px', color: 'var(--text-2)' }, text: w.exampleCn }) : null
      ]));
      frag.appendChild(U.el('div', { style: { marginTop: '12px' } }, [gradeBar()]));
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doSpell(input.value); }
    });
    input.addEventListener('input', function () {
      spellState = spellState || {};
      spellState.value = input.value;
    });
    setTimeout(function () { try { input.focus(); } catch (e) { } }, 80);
    return frag;
  }

  function doSpell(val) {
    var w = current;
    var v = (val || '').trim().toLowerCase();
    if (!v) { U.toast('请先输入单词', 'err'); return; }
    var ok = v === w.word.toLowerCase();
    spellState = { value: val || '', checked: true, ok: ok };
    U.vibrate(ok ? 10 : 25);
    U.playTone(ok ? 'right' : 'wrong');
    redraw();
    setTimeout(function () {
      var input = U.$('#view .spell-input');
      if (input) {
        input.classList.add(ok ? 'is-ok' : 'is-bad');
      }
    }, 0);
  }

  /* ---------------- 选择模式 ---------------- */
  function buildChoice() {
    var w = current;
    if (!choiceState) {
      var pool = App.Words.all.filter(function (x) {
        return x.id !== w.id && x.level === w.level && !x.isPhrase && x.meaning !== w.meaning;
      });
      var opts = U.shuffle(U.sample(pool, 3).map(function (x) { return x.meaning; }).concat([w.meaning]));
      choiceState = { options: opts, answered: false, picked: -1 };
    }

    var frag = document.createDocumentFragment();
    frag.appendChild(U.el('div.card', null, [
      U.el('div.card-title', null, [U.icon('cards'), '选出正确释义',
        U.el('span.spacer'),
        U.el('span.badge.badge-brand', { text: FREQ_LABEL[w.freq] || '中频' })]),
      U.el('div.word-text', { text: w.word, style: { textAlign: 'center', margin: '8px 0 4px' } }),
      w.phonetic ? U.el('div.word-phonetic', { text: w.phonetic, style: { textAlign: 'center' } }) : null
    ]));

    var list = U.el('div', { style: { marginTop: '14px' } });
    choiceState.options.forEach(function (opt, i) {
      var cls = 'opt';
      if (choiceState.answered) {
        if (opt === w.meaning) cls += '.is-right';
        else if (i === choiceState.picked) cls += '.is-wrong';
        else cls += '.is-dim';
      }
      list.appendChild(U.el('button.' + cls, {
        type: 'button',
        onclick: function () { pickChoice(i); }
      }, [
        U.el('span.opt-key', { text: String.fromCharCode(65 + i) }),
        U.el('span', { text: opt })
      ]));
    });
    frag.appendChild(list);

    if (choiceState.answered) {
      frag.appendChild(U.el('div', { style: { marginTop: '12px' } }, [gradeBar()]));
    }
    return frag;
  }

  function pickChoice(i) {
    if (choiceState.answered) return;
    var w = current;
    choiceState.answered = true;
    choiceState.picked = i;
    var ok = choiceState.options[i] === w.meaning;
    U.vibrate(ok ? 10 : 25);
    U.playTone(ok ? 'right' : 'wrong');
    if (ok) { App.Store.setProg(w.id, { lastSeenAt: U.today() }); U.toast('回答正确', 'ok'); }
    redraw();
  }

  /* ---------------- 筛选面板 ---------------- */
  function openFilterSheet() {
    var draft = JSON.parse(JSON.stringify(filterCfg()));
    var refresh = null;   // 由面板内部填充的重算函数

    var hitBox = U.el('div.hit-line');

    function refreshHit() {
      var r = App.Picker.buildPool(draft);
      U.clear(hitBox);
      if (r.empty) {
        hitBox.classList.add('is-empty');
        hitBox.appendChild(U.icon('close'));
        hitBox.appendChild(U.el('span', { text: App.Picker.reasonText(r.reason) }));
      } else {
        hitBox.classList.remove('is-empty');
        hitBox.appendChild(U.el('span.num', { text: String(r.words.length) }));
        hitBox.appendChild(U.el('span', { text: '个单词符合条件' }));
      }
    }

    function chip(label, isOn, onToggle) {
      var node = U.el('button.chip' + (isOn ? '.is-on' : ''), { type: 'button' }, [label]);
      node.addEventListener('click', function () {
        onToggle();
        node.classList.toggle('is-on');
        refreshHit();
      });
      return node;
    }

    function singleChip(label, isOn, onPick) {
      var node = U.el('button.chip' + (isOn ? '.is-on' : ''), { type: 'button' }, [label]);
      node.addEventListener('click', function () {
        var group = node.parentNode;
        U.$$('.chip', group).forEach(function (c) { c.classList.remove('is-on'); });
        node.classList.add('is-on');
        onPick();
        refreshHit();
        rebuild();
      });
      return node;
    }

    var body = U.el('div');
    var rebuild = function () {
      U.clear(body);
      body.appendChild(hitBox);

      body.appendChild(U.el('div.filter-group', null, [
        U.el('div.filter-group-title', { text: '词书' }),
        U.el('div.chips', null, [
          singleChip('四级', draft.level === 'cet4', function () { draft.level = 'cet4'; }),
          singleChip('六级', draft.level === 'cet6', function () { draft.level = 'cet6'; }),
          singleChip('全部', draft.level === 'all', function () { draft.level = 'all'; })
        ])
      ]));

      body.appendChild(U.el('div.filter-group', null, [
        U.el('div.filter-group-title', { text: '考试频率（主维度，默认高频优先）' }),
        U.el('div.chips', null, ['high', 'mid', 'low'].map(function (k) {
          return chip(FREQ_LABEL[k], draft.freq.indexOf(k) >= 0, function () { toggleIn(draft.freq, k); });
        }))
      ]));

      body.appendChild(U.el('div.filter-group', null, [
        U.el('div.filter-group-title', { text: '学段（次要筛选，可多选）' }),
        U.el('div.chips', null, ['hs', 'beyond'].map(function (k) {
          return chip(STAGE_LABEL[k], draft.stage.indexOf(k) >= 0, function () { toggleIn(draft.stage, k); });
        }))
      ]));

      body.appendChild(U.el('div.filter-group', null, [
        U.el('div.filter-group-title', { text: '学习状态' }),
        U.el('div.chips', null, ['new', 'learning', 'mastered'].map(function (k) {
          return chip(STATUS_LABEL[k], draft.status.indexOf(k) >= 0, function () { toggleIn(draft.status, k); });
        }))
      ]));

      body.appendChild(U.el('div.filter-group', null, [
        U.el('div.filter-group-title', { text: '练习范围' }),
        U.el('div.chips', null, Object.keys(SCOPE_LABEL).map(function (k) {
          return singleChip(SCOPE_LABEL[k], draft.scope === k, function () { draft.scope = k; });
        }))
      ]));

      if (draft.scope === 'custom') {
        var countInput = U.el('input.input', {
          type: 'number', min: '5', max: '200', value: String(draft.count || 20)
        });
        countInput.addEventListener('input', function () {
          draft.count = U.clamp(parseInt(countInput.value, 10) || 20, 5, 200);
          refreshHit();
        });
        body.appendChild(U.el('div.field', null, [
          U.el('label.field-label', { text: '本次练习数量（5–200）' }),
          countInput
        ]));
      }

      body.appendChild(U.el('div.filter-group', null, [
        U.el('div.filter-group-title', { text: '选项' }),
        switchRow('巩固模式（把已掌握的词重新拉回来练）', draft.consolidate, function (v) { draft.consolidate = v; refreshHit(); }),
        switchRow('只看生词本', draft.starredOnly, function (v) { draft.starredOnly = v; refreshHit(); })
      ]));

      refreshHit();
    };

    rebuild();

    U.openSheet({
      title: '选择要背的单词',
      body: body,
      foot: [
        U.el('button.btn.btn-ghost', {
          type: 'button', onclick: function () { U.closeSheet(); resetFilter(); }
        }, ['重置']),
        U.el('button.btn.btn-primary', {
          type: 'button',
          onclick: function () {
            App.Store.commit(function (s) { s.settings.filter = draft; });
            App.Picker.invalidate();
            U.closeSheet();
            resetSession();
            redraw();
          }
        }, ['开始练习'])
      ]
    });
  }

  function toggleIn(arr, v) {
    var i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
  }

  function switchRow(label, on, onChange) {
    var sw = U.el('div.switch' + (on ? '.is-on' : ''));
    return U.el('button.row', {
      type: 'button',
      style: { minHeight: '48px', padding: '6px 0', width: '100%' },
      onclick: function () {
        var nowOn = !sw.classList.contains('is-on');
        sw.classList.toggle('is-on', nowOn);
        onChange(nowOn);
      }
    }, [
      U.el('span.row-main', null, [
        U.el('span.row-title', { style: { fontSize: '14.5px', fontWeight: '500', textAlign: 'left' }, text: label })
      ]),
      U.el('span.row-tail', null, [sw])
    ]);
  }

  function resetFilter() {
    App.Store.commit(function (s) {
      s.settings.filter = {
        level: 'cet4', freq: ['high'], stage: ['hs', 'beyond'],
        status: ['new', 'learning'], starredOnly: false, consolidate: false,
        scope: 'today-new', count: 20
      };
    });
    App.Picker.invalidate();
    resetSession();
    redraw();
  }

  /* ---------------- 已掌握词批量管理 ---------------- */
  function openMasteredSheet() {
    var list = App.Picker.masteredWords();

    function build() {
      var body = U.el('div');
      if (!list.length) {
        body.appendChild(U.el('div.empty', null, [
          U.icon('check'),
          U.el('div.empty-title', { text: '还没有标记为掌握的词' }),
          U.el('div.empty-desc', { text: '在单词卡右上角点击对勾即可标记' })
        ]));
        return body;
      }
      body.appendChild(U.el('div.field-hint', {
        style: { marginBottom: '12px' },
        text: '共 ' + list.length + ' 个词。已掌握的词默认不参与抽题，取消标记后会重新回到练习池。'
      }));
      list.slice(0, 300).forEach(function (w) {
        body.appendChild(U.el('div.word-row', null, [
          U.el('div.word-row-main', null, [
            U.el('div.word-row-w', { text: w.word }),
            U.el('div.word-row-m', { text: w.meaning })
          ]),
          U.el('div.word-row-tail', null, [
            U.el('button.btn.btn-sm', {
              type: 'button',
              onclick: function () {
                App.Store.setProg(w.id, { mastered: false, masteredAt: null });
                App.Picker.invalidate();
                U.toast('已恢复「' + w.word + '」');
                list = App.Picker.masteredWords();
                U.clear(sheetBody);
                sheetBody.appendChild(build());
              }
            }, ['取消掌握'])
          ])
        ]));
      });
      if (list.length > 300) {
        body.appendChild(U.el('div.field-hint', { text: '仅显示前 300 个，共 ' + list.length + ' 个' }));
      }
      return body;
    }

    var sheetBody = build();

    U.openSheet({
      title: '已掌握的词',
      body: sheetBody,
      foot: list.length ? [
        U.el('button.btn.btn-danger', {
          type: 'button',
          onclick: function () {
            U.confirm({
              title: '取消全部掌握标记',
              message: '将把 ' + list.length + ' 个已掌握的词全部恢复到练习池中，确定继续吗？',
              okText: '确定取消', danger: true
            }).then(function (yes) {
              if (!yes) return;
              App.Store.commit(function (s) {
                list.forEach(function (w) {
                  var p = s.progress[w.id];
                  if (p) { p.mastered = false; p.masteredAt = null; }
                });
              });
              App.Picker.invalidate();
              U.closeSheet();
              U.toast('已恢复 ' + list.length + ' 个词', 'ok');
              redraw();
            });
          }
        }, ['取消全部掌握'])
      ] : null
    });
  }

  /* ---------------- 桌面快捷键 ---------------- */
  function bindKeys() {
    keyHandler = function (e) {
      if (U.$('#sheet-root .sheet') || U.$('#modal-root .modal')) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === ' ') {
        e.preventDefault();
        var c = U.$('#word-card');
        if (c) { flipped = !flipped; c.classList.toggle('is-flipped'); }
      } else if (e.key === '1') grade(0);
      else if (e.key === '2') grade(1);
      else if (e.key === '3') grade(2);
      else if (e.key === 's' || e.key === 'S') toggleStar();
      else if (e.key === 'm' || e.key === 'M') toggleMastered();
    };
    document.addEventListener('keydown', keyHandler);
  }

  App.Views = App.Views || {};
  App.Views.words = function () {
    return {
      render: function (root) {
        lastRoot = root;
        bindKeys();
        if (!session) resetSession();
        draw(root);
      },
      destroy: function () {
        if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
        lastRoot = null;
        session = null;
        current = null;
      }
    };
  };
})(window);
