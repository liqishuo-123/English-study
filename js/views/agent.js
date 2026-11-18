/* =========================================================
   views/agent.js — AI 学习助教（智能体对话界面）
   依赖：core/agent.js, core/ai.js
   对外：App.Views.agent

   界面分三层：
   1. 未配置：直接给服务商预设卡片 + 三行输入框，填完立即能聊；
   2. 对话：消息气泡 + 工具执行痕迹（「已读取学习状态」这类小标签），
      让用户看得见 AI 到底做了什么，而不是黑箱；
   3. 快捷指令：没有历史消息时给 4 个常用入口，降低开口成本。
   ========================================================= */
(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var U = App.Utils;

  var TOOL_LABEL = {
    get_status: '读取学习状态',
    list_words: '查看单词列表',
    search_word: '检索词库',
    add_words: '加入生词本',
    set_word_state: '更新单词状态',
    update_plan: '调整每日目标',
    add_quiz: '录入练习题',
    save_material: '保存写作素材',
    search_material: '搜索素材库',
    get_stats: '统计近期数据',
    get_plan: '读取学习计划',
    save_plan: '保存学习计划',
    save_report: '保存复盘',
    navigate: '跳转页面'
  };

  var QUICK = [
    { icon: 'target', text: '帮我看看现在的进度，今天该学什么？' },
    { icon: 'compass', text: '按我的真实数据定一份学习计划，直接存进去' },
    { icon: 'chart', text: '复盘一下最近两周：进度、易错点、易错词' },
    { icon: 'cards', text: '抽查我 5 个到期单词，逐个考我' },
    { icon: 'read', text: '按四级难度给我出一篇仔细阅读' }
  ];

  var MAX_KEEP = 80;   // 本地最多保留多少条消息

  /* ---------------- 极简 Markdown 渲染（先转义，再替换） ---------------- */
  function mdToHtml(text) {
    var s = U.escapeHtml(String(text || ''));
    // 代码块
    s = s.replace(/```([\s\S]*?)```/g, function (_, code) {
      return '<pre class="ag-pre">' + code.replace(/^\n/, '') + '</pre>';
    });
    // 行内代码
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // 粗体 / 斜体
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    // 标题 ### 
    s = s.replace(/^#{1,4}\s*(.+)$/gm, '<div class="ag-h">$1</div>');
    // 列表
    s = s.replace(/^\s*[-*]\s+/gm, '· ');
    // 换行
    return s.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
  }

  function nowText() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  /* =========================================================
     页面
     ========================================================= */
  function view() {
    var root = null;
    var listEl = null;
    var inputEl = null;
    var sendBtn = null;
    var running = false;
    var alive = true;

    function messages() {
      var s = App.Store.state;
      if (!Array.isArray(s.agentMessages)) s.agentMessages = [];
      return s.agentMessages;
    }

    function saveMessages(arr) {
      if (arr.length > MAX_KEEP) arr = arr.slice(arr.length - MAX_KEEP);
      App.Store.commit(function (s) { s.agentMessages = arr; });
      App.Store.flush();
    }

    /* ---------- 消息气泡 ---------- */
    function bubble(m) {
      var isUser = m.role === 'user';
      var wrap = U.el('div.ag-row' + (isUser ? '.is-me' : ''), null, [
        U.el('div.ag-avatar', null, [U.icon(isUser ? 'user' : 'sparkle')]),
        U.el('div.ag-body', null, [
          (m.tools && m.tools.length) ? U.el('div.ag-tools', null, m.tools.map(function (t) {
            return U.el('span.ag-tool' + (t.ok === false ? '.is-bad' : ''), null, [
              U.icon(t.ok === false ? 'close' : 'check'),
              TOOL_LABEL[t.name] || t.name
            ]);
          })) : null,
          U.el('div.ag-bubble', { html: mdToHtml(m.text) }),
          U.el('div.ag-meta', { text: m.at || nowText() })
        ])
      ]);
      return wrap;
    }

    function typing() {
      return U.el('div.ag-row.ag-typing', null, [
        U.el('div.ag-avatar', null, [U.icon('sparkle')]),
        U.el('div.ag-body', null, [
          U.el('div.ag-bubble', null, [
            U.el('span.dot'), U.el('span.dot'), U.el('span.dot')
          ])
        ])
      ]);
    }

    function scrollBottom() {
      if (!listEl) return;
      try { listEl.scrollTop = listEl.scrollHeight; } catch (e) { /* 忽略 */ }
    }

    function paintAll() {
      U.clear(listEl);
      var arr = messages();
      if (!arr.length) {
        listEl.appendChild(welcome());
        return;
      }
      arr.forEach(function (m) { listEl.appendChild(bubble(m)); });
      scrollBottom();
    }

    function welcome() {
      var card = U.el('div.ag-welcome', null, [
        U.el('div.ag-welcome-icon', null, [U.icon('sparkle')]),
        U.el('div.ag-welcome-title', { text: '我是你的 AI 学习助教' }),
        U.el('div.ag-welcome-desc', {
          text: '我能看到你的真实学习数据，也能直接帮你改：加生词、调目标、出题、存素材。说人话就行。'
        }),
        U.el('div.ag-quick', null, QUICK.map(function (q) {
          return U.el('button.chip', {
            type: 'button',
            onclick: function () { send(q.text); }
          }, [U.icon(q.icon), q.text]);
        }))
      ]);
      // 快捷指令下发一句能力说明
      card.appendChild(U.el('div.ag-hint', {
        text: '提示：配置你自己的 API 密钥后一切都在本机运行，数据不会离开浏览器。'
      }));
      return card;
    }

    /* ---------- 发送 ---------- */
    function send(text) {
      text = String(text || '').trim();
      if (!text || running) return;
      if (!App.AI || !App.AI.isEnabled()) {
        U.toast('请先配置 AI 接口', 'err');
        paintConfig();
        return;
      }

      var arr = messages();
      var history = arr.slice(-12);
      arr.push({ id: U.uid('m'), role: 'user', text: text, at: nowText() });
      saveMessages(arr);
      paintAll();
      scrollBottom();

      inputEl.value = '';
      autoGrow();
      running = true;
      refill();
      animateRing(true);

      var toolsUsed = [];
      var think = typing();
      listEl.appendChild(think);
      scrollBottom();

      App.Agent.run({
        text: text,
        history: history,
        onEvent: function (e) {
          if (!alive) return;
          if (e.type === 'tool') {
            var chip = U.el('div.ag-run', null, [
              U.icon('refresh'),
              '正在' + (TOOL_LABEL[e.name] || e.name) + '…'
            ]);
            listEl.appendChild(chip);
            scrollBottom();
          } else if (e.type === 'tool-done') {
            toolsUsed.push({ name: e.name, ok: e.ok, summary: e.summary });
          }
        }
      }).then(function (r) {
        running = false;
        animateRing(false);
        refill();
        if (!alive) return;

        // 清掉「正在执行…」临时提示和打字动画
        var runs = U.$$('.ag-run', listEl);
        runs.forEach(function (n) { n.parentNode.removeChild(n); });
        if (think.parentNode) think.parentNode.removeChild(think);

        var cur = messages();
        if (r.ok) {
          cur.push({
            id: U.uid('m'), role: 'assistant',
            text: r.text || '（模型没有返回内容，再试一次？）',
            tools: toolsUsed, at: nowText()
          });
          saveMessages(cur);
          listEl.appendChild(bubble(cur[cur.length - 1]));
          scrollBottom();
        } else {
          U.toast(r.error || '请求失败', 'err');
          listEl.appendChild(U.el('div.ag-error', { text: '⚠️ ' + (r.error || '请求失败') }));
          scrollBottom();
          if (r.code === 'no-key' || r.code === 'auth') paintConfig();
        }
      });
    }

    function animateRing(on) {
      if (!sendBtn) return;
      sendBtn.classList.toggle('is-busy', !!on);
    }
    function refill() {
      if (!sendBtn) return;
      sendBtn.disabled = running;
    }

    function autoGrow() {
      if (!inputEl) return;
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(140, inputEl.scrollHeight) + 'px';
    }

    /* ---------- 配置面板 ---------- */
    function paintConfig() {
      var zone = U.$('#ag-config');
      if (!zone) return;
      U.clear(zone);

      var st = App.Store.state.settings;
      var baseInput = U.el('input.input', { value: st.ai.baseUrl || '', placeholder: 'https://api.deepseek.com/v1' });
      var modelInput = U.el('input.input', { value: st.ai.model || '', placeholder: 'deepseek-chat' });
      var keyInput = U.el('input.input', { type: 'password', value: st.ai.apiKey || '', placeholder: 'sk-…' });

      var presetRow = U.el('div.ag-presets', null, App.Agent.PRESETS.map(function (p) {
        return U.el('button.chip', {
          type: 'button',
          title: p.note,
          onclick: function () {
            baseInput.value = p.baseUrl;
            modelInput.value = p.model;
            U.toast('已填入 ' + p.name + '，再填密钥即可', 'ok');
            keyInput.focus();
          }
        }, [p.name]);
      }));

      var save = U.el('button.btn.btn-primary.btn-block', {
        type: 'button',
        onclick: function () {
          App.Store.commit(function (s) {
            s.settings.ai.baseUrl = baseInput.value.trim();
            s.settings.ai.model = modelInput.value.trim();
            s.settings.ai.apiKey = keyInput.value.trim();
          });
          App.Store.flush();
          if (App.AI.isEnabled()) {
            U.toast('已保存，可以开始对话了', 'ok');
            U.clear(zone);
            zone.style.display = 'none';
          } else {
            U.toast('接口地址和密钥都要填', 'err');
          }
        }
      }, [U.icon('save'), '保存配置']);

      zone.appendChild(U.el('div.card', null, [
        U.el('div.card-title', null, [U.icon('settings'), '配置 AI 接口（OpenAI 兼容）']),
        U.el('div.ag-presets-label', { text: '选一个服务商快速填充：' }),
        presetRow,
        U.el('div.field', null, [U.el('label.field-label', { text: '接口地址' }), baseInput]),
        U.el('div.field', null, [U.el('label.field-label', { text: '模型名' }), modelInput]),
        U.el('div.field', null, [U.el('label.field-label', { text: 'API 密钥' }), keyInput]),
        U.el('div.ag-hint', { text: '密钥只存在本机浏览器里。用法：填完保存，直接问我「今天该学什么」。' }),
        save
      ]));
    }

    /* ---------- 骨架 ---------- */
    function render(el) {
      root = el;
      alive = true;
      U.clear(root);

      var head = U.el('div.page-head', null, [
        U.el('div', null, [
          U.el('h1.page-title', { text: 'AI 学习助教' }),
          U.el('div.ag-sub', { text: '能查数据、能改设置、能出题的学习智能体' })
        ]),
        U.el('span.spacer'),
        U.el('button.icon-btn', {
          type: 'button', 'aria-label': '清空对话',
          onclick: function () {
            if (!messages().length) { U.toast('还没有对话'); return; }
            U.confirm({ title: '清空对话', message: '会删除全部聊天记录，学习数据不受影响。', danger: true, okText: '清空' })
              .then(function (yes) {
                if (!yes) return;
                saveMessages([]);
                paintAll();
                U.toast('已清空', 'ok');
              });
          }
        }, [U.icon('trash')]),
        U.el('button.icon-btn', {
          type: 'button', 'aria-label': 'AI 配置',
          onclick: function () { App.Router.go('#/me'); }
        }, [U.icon('settings')])
      ]);

      var configZone = U.el('div', { id: 'ag-config' });
      configZone.style.display = App.AI && App.AI.isEnabled() ? 'none' : 'block';

      listEl = U.el('div.ag-list');

      inputEl = U.el('textarea.textarea.ag-input', {
        rows: '1',
        placeholder: '问点什么，或直接让我改设置…（Enter 发送，Shift+Enter 换行）'
      });
      inputEl.addEventListener('input', autoGrow);
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          send(inputEl.value);
        }
      });

      sendBtn = U.el('button.ag-send', {
        type: 'button', 'aria-label': '发送',
        onclick: function () { send(inputEl.value); }
      }, [U.icon('right')]);

      var composer = U.el('div.ag-composer', null, [
        inputEl,
        sendBtn
      ]);

      root.appendChild(head);
      root.appendChild(configZone);
      root.appendChild(listEl);
      root.appendChild(composer);

      if (!App.AI || !App.AI.isEnabled()) paintConfig();
      paintAll();
      animateRing(false);
      refill();

      // 从别的页面带过来的问题（单词卡「问助教」等）
      var seeded = App.Agent && App.Agent.takeSeed ? App.Agent.takeSeed() : '';
      if (seeded) {
        inputEl.value = seeded;
        autoGrow();
        if (App.AI && App.AI.isEnabled()) {
          setTimeout(function () { if (alive) send(seeded); }, 220);
        } else {
          U.toast('先填好接口配置，再点发送');
        }
      }

      // 桌面端自动聚焦
      setTimeout(function () {
        if (!alive) return;
        if (!App.AI || !App.AI.isEnabled()) return;
        if (seeded) return;
        try { inputEl.focus(); } catch (e) { /* 忽略 */ }
      }, 180);
    }

    function destroy() {
      alive = false;
      running = false;
      if (App.TTS && App.TTS.cancel) App.TTS.cancel();
    }

    return { render: render, destroy: destroy };
  }

  App.Views = App.Views || {};
  App.Views.agent = function () { return view(); };
})(window);
