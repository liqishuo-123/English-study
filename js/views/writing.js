/* =========================================================
   views/writing.js — 写作与翻译库（模板 / 句型 / 替换词 / 翻译句式）
   依赖：core/*, data/writing.js
   对外：App.Views.writing

   设计要点：
   1. 内置素材来自 App.WRITING_BUILTIN，自建素材存在 Store.state.materials，
      两者合并成一个列表，用 custom 标记区分，删除/编辑只对自建项开放。
   2. 点开一条素材即计入当日「写作素材」任务（Store.addLog 的 writingSeen），
      同一条当天重复点开只算一次。
   3. AI 作文批改可降级：未配置密钥时按钮可点但会提示去配置，不阻塞其他功能。
   ========================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.Utils;

  var CATS = [
    { key: 'all', label: '全部' },
    { key: 'template', label: '作文模板', icon: 'book' },
    { key: 'pattern', label: '万能句型', icon: 'sparkle' },
    { key: 'synonym', label: '高级替换', icon: 'refresh' },
    { key: 'translation', label: '翻译句式', icon: 'pen' },
    { key: 'mine', label: '我的收藏', icon: 'star' }
  ];

  var CAT_LABEL = {
    template: '模板', pattern: '句型', synonym: '替换', translation: '翻译'
  };

  var filter = { cat: 'all', q: '' };

  /** 合并内置 + 自建素材，附带学习状态 */
  function allMaterials() {
    var seen = (App.Store.log().writingSeen || []);
    var seenMap = Object.create(null);
    for (var i = 0; i < seen.length; i++) seenMap[seen[i]] = 1;

    var out = [];
    var builtin = App.WRITING_BUILTIN || [];
    for (var j = 0; j < builtin.length; j++) {
      var b = builtin[j];
      out.push({
        id: b.id, cat: b.cat || 'template', title: b.title || '未命名素材',
        content: b.content || '', tags: b.tags || [],
        custom: false, seenToday: !!seenMap[b.id]
      });
    }
    var mine = App.Store.state.materials || [];
    for (var k = 0; k < mine.length; k++) {
      var m = mine[k];
      out.push({
        id: m.id, cat: m.cat || 'template', title: m.title || '未命名素材',
        content: m.content || '', tags: m.tags || [],
        custom: true, seenToday: !!seenMap[m.id]
      });
    }
    return out;
  }

  function filterList(list) {
    var q = filter.q.trim().toLowerCase();
    return list.filter(function (it) {
      if (filter.cat === 'mine') { if (!it.custom) return false; }
      else if (filter.cat !== 'all' && it.cat !== filter.cat) return false;

      if (!q) return true;
      var hay = (it.title + ' ' + it.content + ' ' + (it.tags || []).join(' ')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  /** 计入今日写作素材任务 */
  function markSeen(id) {
    var log = App.Store.log();
    if ((log.writingSeen || []).indexOf(id) >= 0) return false;
    App.Store.addLog({ writingSeen: [id] });
    App.Store.flush();
    return true;
  }

  function card(it) {
    return U.el('button.mat-card', {
      type: 'button',
      onclick: function () { openDetail(it); }
    }, [
      U.el('div.mat-title', null, [
        U.el('span', { text: it.title }),
        U.el('span.badge' + (it.cat === 'translation' ? '.badge-info' : '.badge-brand'), {
          text: CAT_LABEL[it.cat] || '素材'
        }),
        it.custom ? U.el('span.badge.badge-warn', { text: '自建' }) : null,
        it.seenToday ? U.el('span.badge.badge-ok', { text: '今日已读' }) : null
      ]),
      U.el('div.mat-body', { text: it.content }),
      (it.tags && it.tags.length) ? U.el('div.mat-tags', null, it.tags.map(function (t) {
        return U.el('span.badge', { text: '#' + t });
      })) : null
    ]);
  }

  /* ---------------- 详情 ---------------- */
  function openDetail(it) {
    var newly = markSeen(it.id);

    var body = U.el('div', null, [
      U.el('div.detail-body', { text: it.content }),
      (it.tags && it.tags.length) ? U.el('div.mat-tags', null, it.tags.map(function (t) {
        return U.el('span.badge.badge-brand', { text: '#' + t });
      })) : null,
      U.el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' } }, [
        U.el('button.btn.btn-ghost.btn-sm', {
          type: 'button',
          onclick: function () {
            copyText(it.content).then(function (ok) {
              U.toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择文本', ok ? 'ok' : 'err');
            });
          }
        }, [U.icon('save'), '复制原文']),
        it.custom ? U.el('button.btn.btn-ghost.btn-sm', {
          type: 'button', onclick: function () { openEditor(it); }
        }, [U.icon('edit'), '编辑']) : null,
        it.custom ? U.el('button.btn.btn-ghost.btn-sm', {
          type: 'button', onclick: function () { removeMaterial(it); }
        }, [U.icon('trash'), '删除']) : null
      ]),
      it.cat === 'translation' ? buildTranslateZone(it) : buildAiZone(it)
    ]);

    U.openModal({
      title: it.title,
      body: body,
      wide: true,
      foot: [
        U.el('button.btn.btn-ghost', { type: 'button', onclick: U.closeModal }, ['关闭']),
        U.el('button.btn.btn-primary', {
          type: 'button',
          onclick: function () {
            U.closeModal();
            if (newly && App.Router) App.Router.reload();
          }
        }, [newly ? '记住了' : '完成'])
      ]
    });
  }

  /** 翻译句式：自测（先自己译，再看参考答案） */
  function buildTranslateZone(it) {
    var revealed = false;
    var answer = U.el('div.ai-out', { text: it.content, style: { display: 'none' } });
    var btn = U.el('button.btn.btn-primary.btn-sm', {
      type: 'button',
      onclick: function () {
        revealed = !revealed;
        answer.style.display = revealed ? 'block' : 'none';
        btn.textContent = revealed ? '收起参考答案' : '自己先译 · 看参考答案';
      }
    }, ['自己先译 · 看参考答案']);

    return U.el('div.ai-zone', null, [
      U.el('div.ai-zone-title', null, [U.icon('pen'), '翻译自测']),
      U.el('div', { style: { fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.7, marginBottom: '10px' },
        text: '先在纸上或心里把内容译出来，再点下面按钮核对参考答案。主动回忆比直接看答案记得牢。' }),
      btn,
      answer
    ]);
  }

  /** 非翻译类素材：AI 作文批改 */
  function buildAiZone(it) {
    var enabled = App.AI && App.AI.isEnabled();
    var out = U.el('div.ai-out');
    var input = U.el('textarea.textarea', {
      placeholder: '把你的作文粘贴到这里，AI 会按四六级 15 分制估算分数并逐条给出修改建议…',
      style: { minHeight: '110px', marginTop: '10px' }
    });

    var btn = U.el('button.btn.btn-primary.btn-sm', { type: 'button' }, enabled ? ['AI 批改我的作文'] : ['AI 未配置 · 去设置']);
    btn.addEventListener('click', function () {
      if (!App.AI || !App.AI.isEnabled()) {
        U.closeModal();
        U.toast('请先到「我的 → AI 配置」填写接口地址与密钥');
        App.Router.go('#/me');
        return;
      }
      var text = input.value.trim();
      if (text.length < 20) { U.toast('作文太短了，至少写 20 个字符', 'err'); return; }
      if (text.split(/\s+/).length < 15) { U.toast('内容偏少，建议先写成完整一篇再批改', 'err'); return; }

      btn.disabled = true;
      btn.textContent = '批改中…';
      out.textContent = '正在请求 AI，通常需要 5~20 秒…';
      App.AI.correctEssay(text, it.title).then(function (r) {
        btn.disabled = false;
        btn.textContent = '重新批改';
        if (r.ok) { out.textContent = r.text; }
        else { out.textContent = '⚠️ ' + r.error; }
      });
    });

    return U.el('div.ai-zone', null, [
      U.el('div.ai-zone-title', null, [U.icon('sparkle'), 'AI 作文批改（可选）']),
      U.el('div', {
        style: { fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.7 },
        text: '先用上面的模板自己写一篇，再粘到这里让 AI 逐条挑错。没配置 AI 也不影响其他功能。'
      }),
      input,
      U.el('div', { style: { marginTop: '10px' } }, [btn]),
      out
    ]);
  }

  /* ---------------- 复制（含降级） ---------------- */
  function copyText(text) {
    return new Promise(function (resolve) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(fallback()); });
        return;
      }
      resolve(fallback());
    });
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
  }

  /* ---------------- 自建素材 ---------------- */
  function openEditor(existing) {
    var cur = existing || { title: '', content: '', cat: 'template', tags: [] };
    var titleInput = U.el('input.input', { value: cur.title, placeholder: '例如：观点对比型·正文段' });
    var contentInput = U.el('textarea.textarea', {
      value: cur.content,
      placeholder: '粘贴或手写内容。模板里可以用 ______ 表示要填的空。',
      style: { minHeight: '160px' }
    });
    var tagsInput = U.el('input.input', { value: (cur.tags || []).join(' '), placeholder: '用空格分隔，如 开头 图表' });
    var catSelect = U.el('select.select', null, CATS.filter(function (c) {
      return c.key !== 'all' && c.key !== 'mine';
    }).map(function (c) {
      var o = U.el('option', { value: c.key, text: c.label });
      if (c.key === cur.cat) o.selected = true;
      return o;
    }));

    var body = U.el('div', null, [
      U.el('div.field', null, [U.el('label.field-label', { text: '标题' }), titleInput]),
      U.el('div.field', null, [U.el('label.field-label', { text: '分类' }), catSelect]),
      U.el('div.field', null, [U.el('label.field-label', { text: '内容' }), contentInput]),
      U.el('div.field', null, [U.el('label.field-label', { text: '标签（可留空）' }), tagsInput])
    ]);

    U.closeModal();
    U.openModal({
      title: existing ? '编辑素材' : '新增写作素材',
      body: body,
      wide: true,
      foot: [
        U.el('button.btn.btn-ghost', { type: 'button', onclick: U.closeModal }, ['取消']),
        U.el('button.btn.btn-primary', {
          type: 'button',
          onclick: function () {
            var title = titleInput.value.trim();
            var content = contentInput.value.trim();
            if (!title) { U.toast('请填写标题', 'err'); return; }
            if (!content) { U.toast('请填写内容', 'err'); return; }
            var tags = tagsInput.value.split(/[\s,，]+/).filter(Boolean).slice(0, 8);

            App.Store.commit(function (s) {
              if (existing) {
                for (var i = 0; i < s.materials.length; i++) {
                  if (s.materials[i].id === existing.id) {
                    s.materials[i].title = title;
                    s.materials[i].content = content;
                    s.materials[i].cat = catSelect.value;
                    s.materials[i].tags = tags;
                    break;
                  }
                }
              } else {
                s.materials.unshift({
                  id: U.uid('mat'), cat: catSelect.value,
                  title: title, content: content, tags: tags,
                  createdAt: U.today()
                });
              }
            });
            App.Store.flush();
            U.closeModal();
            U.toast(existing ? '已保存修改' : '素材已添加', 'ok');
            App.Router.reload();
          }
        }, ['保存'])
      ]
    });
  }

  function removeMaterial(it) {
    U.confirm({
      title: '删除素材',
      message: '确定删除「' + it.title + '」吗？删除后无法恢复。',
      danger: true,
      okText: '删除'
    }).then(function (yes) {
      if (!yes) return;
      App.Store.commit(function (s) {
        s.materials = s.materials.filter(function (m) { return m.id !== it.id; });
      });
      App.Store.flush();
      U.closeModal();
      U.toast('已删除', 'ok');
      App.Router.reload();
    });
  }

  /* ---------------- 页面渲染 ---------------- */
  function render(root) {
    U.clear(root);
    var list = allMaterials();
    var shown = filterList(list);
    var log = App.Store.log();
    var doneToday = (log.writingSeen || []).length;
    var target = Math.max(0, parseInt(App.Store.state.settings.dailyWriting, 10) || 0);

    var head = U.el('div.page-head', null, [
      U.el('div', null, [
        U.el('h1.page-title', { text: '写作与翻译' }),
        U.el('div', { style: { fontSize: '12.5px', color: 'var(--text-3)', marginTop: '4px' },
          text: '今日已复习 ' + doneToday + (target > 0 ? ' / ' + target : '') + ' 条' })
      ]),
      U.el('span.spacer'),
      U.el('button.icon-btn', {
        type: 'button', 'aria-label': '新增素材',
        onclick: function () { openEditor(null); }
      }, [U.icon('plus')])
    ]);

    var seg = U.el('div.seg', { style: { marginBottom: '12px' } }, CATS.map(function (c) {
      return U.el('button.seg-item' + (filter.cat === c.key ? '.is-active.seg-fill' : ''), {
        type: 'button',
        onclick: function () {
          filter.cat = c.key;
          render(root);
        }
      }, [c.icon ? U.icon(c.icon) : null, c.label]);
    }));

    var searchInput = U.el('input.input', {
      type: 'search',
      value: filter.q,
      placeholder: '搜索标题、内容或标签'
    });
    searchInput.addEventListener('input', U.debounce(function () {
      filter.q = searchInput.value;
      renderList();
    }, 220));

    var search = U.el('div.search-bar', null, [U.icon('search'), searchInput]);

    var listWrap = U.el('div');
    function renderList() {
      U.clear(listWrap);
      var items = filterList(allMaterials());
      if (!items.length) {
        listWrap.appendChild(U.el('div.empty', null, [
          U.icon(filter.q ? 'search' : 'pen'),
          U.el('div.empty-title', { text: filter.q ? '没有匹配的素材' : '这里还没有内容' }),
          U.el('div.empty-desc', { text: filter.q ? '换个关键词，或切换到「全部」分类看看' : '点右上角 + 新增一条自己的模板或句式' })
        ]));
        return;
      }
      items.forEach(function (it) { listWrap.appendChild(card(it)); });
    }

    root.appendChild(head);
    root.appendChild(seg);
    root.appendChild(search);
    root.appendChild(listWrap);
    renderList();

    // 底部：新增按钮 + 进度提示
    root.appendChild(U.el('button.btn.btn-primary.btn-block', {
      type: 'button', style: { marginTop: '4px' },
      onclick: function () { openEditor(null); }
    }, [U.icon('plus'), '新增写作素材']));

    if (App.NAV) App.NAV.setDot('writing', false);
  }

  App.Views = App.Views || {};
  App.Views.writing = function () {
    return { render: render, destroy: function () { } };
  };
})(window);
