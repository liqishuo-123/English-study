/* =========================================================
   core/utils.js — 通用工具（无依赖，必须最先加载）
   对外：window.App.Utils
   ========================================================= */
(function (global) {
  'use strict';

  var App = global.App = global.App || {};

  /* ---------------- DOM 助手 ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /**
   * 创建元素
   * el('div.card', { onclick: fn }, [child, '文本'])
   */
  function el(spec, attrs, children) {
    var parts = String(spec).split('.');
    var tag = parts.shift() || 'div';
    var node = document.createElement(tag);
    if (parts.length) node.className = parts.join(' ');

    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class' || k === 'className') { node.className = node.className ? node.className + ' ' + v : v; }
        else if (k === 'html') { node.innerHTML = v; }
        else if (k === 'text') { node.textContent = v; }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') { node.addEventListener(k.slice(2).toLowerCase(), v); }
        else if (k === 'style' && typeof v === 'object') { for (var s in v) node.style[s] = v[s]; }
        else if (k === 'dataset') { for (var d in v) node.dataset[d] = v[d]; }
        else { node.setAttribute(k, v === true ? '' : v); }
      }
    }
    appendKids(node, children);
    return node;
  }

  function appendKids(node, children) {
    if (children === null || children === undefined) return;
    if (Array.isArray(children)) {
      for (var i = 0; i < children.length; i++) appendKids(node, children[i]);
    } else if (children instanceof Node) {
      node.appendChild(children);
    } else {
      node.appendChild(document.createTextNode(String(children)));
    }
  }

  /** 内联 SVG 图标 */
  function icon(name, cls) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  /** HTML 转义：所有用户输入渲染前必须经过它，防止 XSS */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 清空节点 */
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  /* ---------------- 日期（统一本地日期字符串 YYYY-MM-DD） ---------------- */
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function toKey(d) {
    // 不用 toISOString()，它会按时区偏移导致日期错乱
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function today() { return toKey(new Date()); }
  function parseKey(s) {
    var p = String(s || '').split('-');
    return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
  }
  function addDays(key, n) {
    var d = parseKey(key);
    d.setDate(d.getDate() + n);
    return toKey(d);
  }
  /** b - a，单位天（正数表示 b 在 a 之后） */
  function diffDays(a, b) {
    var da = parseKey(a), db = parseKey(b);
    return Math.round((db - da) / 86400000);
  }
  function weekdayOf(key) { return parseKey(key).getDay(); } // 0=周日
  function isFuture(key) { return diffDays(today(), key) > 0; }

  /* ---------------- 数组 / 随机 ---------------- */
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function sample(arr, n) { return shuffle(arr).slice(0, Math.max(0, Math.min(n, arr.length))); }
  function unique(arr) {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < arr.length; i++) {
      var k = arr[i];
      if (!seen[k]) { seen[k] = 1; out.push(k); }
    }
    return out;
  }

  /* ---------------- 函数节流 ---------------- */
  function debounce(fn, wait) {
    var t = null;
    return function () {
      var ctx = this, args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(ctx, args); }, wait || 200);
    };
  }
  function rafThrottle(fn) {
    var pending = false, lastArgs = null;
    return function () {
      lastArgs = arguments;
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; fn.apply(null, lastArgs); });
    };
  }

  /* ---------------- 格式化 ---------------- */
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + pad2(s);
  }
  function fmtMinutes(min) {
    min = Math.round(min || 0);
    if (min < 60) return min + ' 分钟';
    var h = Math.floor(min / 60), m = min % 60;
    return m ? h + ' 小时 ' + m + ' 分' : h + ' 小时';
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }

  /** 数字滚动动画 */
  function countUp(node, to, dur) {
    var from = parseInt(node.textContent, 10);
    if (isNaN(from)) from = 0;
    if (from === to) { node.textContent = to; return; }
    dur = dur || 500;
    var start = performance.now();
    function step(now) {
      var p = clamp((now - start) / dur, 0, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      node.textContent = Math.round(from + (to - from) * eased);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------------- 触觉反馈 ---------------- */
  function vibrate(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 10); } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 音效（Web Audio 合成，零资源、离线可用） ---------------- */
  var audioCtx = null;
  function ensureAudioCtx() {
    if (audioCtx) return audioCtx;
    try {
      var Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    } catch (e) { audioCtx = null; }
    return audioCtx;
  }

  /**
   * 播放提示音：right=答对（上行双音），wrong=答错（下行双音）
   * 受 settings.sound 开关控制；浏览器自动播放策略下，首次需在用户手势（点击）中触发。
   */
  function playTone(type) {
    try {
      if (App.Store && App.Store.state && App.Store.state.settings &&
          App.Store.state.settings.sound === false) return;
    } catch (e) { /* 无 Store 时仍播放 */ }

    var ctx = ensureAudioCtx();
    if (!ctx) return;
    try { if (ctx.state === 'suspended') ctx.resume(); } catch (e) { /* 忽略 */ }

    var notes = type === 'wrong'
      ? [{ f: 220, t: 0, d: 0.16 }, { f: 174.61, t: 0.14, d: 0.22 }]     // A3 → F3 下行
      : [{ f: 659.25, t: 0, d: 0.12 }, { f: 880, t: 0.11, d: 0.18 }];      // E5 → A5 上行

    var now = ctx.currentTime;
    notes.forEach(function (n) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.f, now + n.t);
      var start = now + n.t;
      var end = start + n.d;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.32, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.03);
    });
  }

  /* ---------------- Toast ---------------- */
  var toastTimers = [];
  function toast(msg, type) {
    var root = $('#toast-root');
    if (!root) return;
    // 最多同时 3 条，避免刷屏
    while (root.children.length >= 3) root.removeChild(root.firstChild);

    var node = el('div.toast', { role: 'status' }, [
      icon(type === 'err' ? 'close' : 'check'),
      el('span', { text: msg })
    ]);
    if (type === 'ok') node.classList.add('toast-ok');
    if (type === 'err') { node.classList.add('toast-err'); }
    root.appendChild(node);

    var t1 = setTimeout(function () {
      node.classList.add('is-out');
      var t2 = setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 220);
      toastTimers.push(t2);
    }, 1900);
    toastTimers.push(t1);
  }

  /* ---------------- 底部弹出面板 Sheet ---------------- */
  var activeSheet = null;

  /**
   * openSheet({ title, body, foot, onClose })
   * @returns {Function} close
   */
  function openSheet(opt) {
    closeSheet();
    var root = $('#sheet-root');
    var mask = el('div.sheet-mask');
    var sheet = el('div.sheet', { role: 'dialog', 'aria-modal': 'true' });

    var grip = el('div.sheet-grip');
    var head = el('div.sheet-head', null, [
      el('div.sheet-title', { text: opt.title || '' }),
      el('button.icon-btn', { type: 'button', 'aria-label': '关闭', onclick: function () { closeSheet(); } }, [icon('close')])
    ]);
    var body = el('div.sheet-body');
    if (opt.body instanceof Node) body.appendChild(opt.body);
    else if (typeof opt.body === 'string') body.innerHTML = opt.body;
    else if (Array.isArray(opt.body)) appendKids(body, opt.body);

    sheet.appendChild(grip);
    sheet.appendChild(head);
    sheet.appendChild(body);

    if (opt.foot) {
      var foot = el('div.sheet-foot');
      appendKids(foot, opt.foot);
      sheet.appendChild(foot);
    }

    root.appendChild(mask);
    root.appendChild(sheet);

    // 触发进场动画
    requestAnimationFrame(function () {
      mask.classList.add('is-open');
      sheet.classList.add('is-open');
    });

    mask.addEventListener('click', closeSheet);
    bindSwipeDown(sheet, grip, closeSheet);

    activeSheet = { mask: mask, sheet: sheet, onClose: opt.onClose };
    document.body.style.overflow = 'hidden';
    return closeSheet;
  }

  function closeSheet() {
    if (!activeSheet) return;
    var s = activeSheet;
    activeSheet = null;
    s.mask.classList.remove('is-open');
    s.sheet.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(function () {
      if (s.mask.parentNode) s.mask.parentNode.removeChild(s.mask);
      if (s.sheet.parentNode) s.sheet.parentNode.removeChild(s.sheet);
      if (typeof s.onClose === 'function') s.onClose();
    }, 280);
  }

  /** 面板顶部把手：下滑关闭（仅移动端） */
  function bindSwipeDown(sheet, grip, onClose) {
    var startY = 0, curY = 0, dragging = false;
    function down(e) {
      dragging = true;
      startY = curY = (e.touches ? e.touches[0].clientY : e.clientY);
      sheet.style.transition = 'none';
    }
    function move(e) {
      if (!dragging) return;
      var y = (e.touches ? e.touches[0].clientY : e.clientY);
      var dy = Math.max(0, y - startY);
      curY = y;
      sheet.style.transform = 'translateY(' + dy + 'px)';
    }
    function up() {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = '';
      sheet.style.transform = '';
      var dy = curY - startY;
      if (dy > 90) onClose();
    }
    grip.addEventListener('touchstart', down, { passive: true });
    grip.addEventListener('touchmove', move, { passive: true });
    grip.addEventListener('touchend', up);
    grip.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  /* ---------------- 模态框 ---------------- */
  var activeModal = null;

  /**
   * openModal({ title, body, foot, wide })
   * @returns {Function} close
   */
  function openModal(opt) {
    closeModal();
    var root = $('#modal-root');
    var mask = el('div.modal-mask');
    var box = el('div.modal', { role: 'dialog', 'aria-modal': 'true' });
    if (opt.wide) box.style.maxWidth = '620px';

    var head = el('div.modal-head', null, [
      el('div.modal-title', { text: opt.title || '' }),
      el('button.icon-btn', { type: 'button', 'aria-label': '关闭', onclick: closeModal }, [icon('close')])
    ]);
    var body = el('div.modal-body');
    if (opt.body instanceof Node) body.appendChild(opt.body);
    else if (typeof opt.body === 'string') body.innerHTML = opt.body;
    else if (Array.isArray(opt.body)) appendKids(body, opt.body);

    box.appendChild(head);
    box.appendChild(body);
    if (opt.foot) {
      var foot = el('div.modal-foot');
      appendKids(foot, opt.foot);
      box.appendChild(foot);
    }
    mask.appendChild(box);
    root.appendChild(mask);

    requestAnimationFrame(function () { mask.classList.add('is-open'); });
    mask.addEventListener('click', function (e) { if (e.target === mask) closeModal(); });

    activeModal = { mask: mask, onClose: opt.onClose };
    document.body.style.overflow = 'hidden';
    return closeModal;
  }

  function closeModal() {
    if (!activeModal) return;
    var m = activeModal;
    activeModal = null;
    m.mask.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(function () {
      if (m.mask.parentNode) m.mask.parentNode.removeChild(m.mask);
      if (typeof m.onClose === 'function') m.onClose();
    }, 220);
  }

  /** 确认对话框 */
  function confirm(opt) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (!done) { done = true; closeModal(); resolve(v); } }
      openModal({
        title: opt.title || '确认操作',
        body: el('div', { style: { fontSize: '14.5px', lineHeight: '1.7', color: 'var(--text-2)' }, text: opt.message || '' }),
        foot: [
          el('button.btn.btn-ghost', { type: 'button', onclick: function () { finish(false); } }, ['取消']),
          el('button.btn' + (opt.danger ? '.btn-danger' : '.btn-primary'), { type: 'button', onclick: function () { finish(true); } }, [opt.okText || '确定'])
        ],
        onClose: function () { if (!done) { done = true; resolve(false); } }
      });
    });
  }

  /** 输入对话框 */
  function prompt(opt) {
    return new Promise(function (resolve) {
      var done = false;
      var input = el(opt.multiline ? 'textarea.textarea' : 'input.input', {
        type: opt.multiline ? null : (opt.type || 'text'),
        value: opt.value || '',
        placeholder: opt.placeholder || ''
      });
      if (opt.multiline) input.style.minHeight = (opt.rows ? opt.rows * 24 : 160) + 'px';
      function finish(v) { if (!done) { done = true; closeModal(); resolve(v); } }

      var wrap = el('div', null, [
        opt.message ? el('div', { style: { fontSize: '13.5px', color: 'var(--text-2)', marginBottom: '10px', lineHeight: '1.6' }, text: opt.message }) : null,
        input
      ]);

      openModal({
        title: opt.title || '请输入',
        body: wrap,
        foot: [
          el('button.btn.btn-ghost', { type: 'button', onclick: function () { finish(null); } }, ['取消']),
          el('button.btn.btn-primary', {
            type: 'button',
            onclick: function () {
              var v = input.value.trim();
              if (opt.required && !v) { toast(opt.requiredTip || '内容不能为空', 'err'); return; }
              finish(v);
            }
          }, ['保存'])
        ],
        onClose: function () { if (!done) { done = true; resolve(null); } }
      });
      setTimeout(function () { input.focus(); }, 260);
    });
  }

  /* ---------------- 手势：左右滑动 ---------------- */
  /**
   * onSwipe(node, { left, right, tap, threshold })
   * 只识别水平主导的滑动，避免与纵向滚动冲突
   */
  function onSwipe(node, opt) {
    opt = opt || {};
    var threshold = opt.threshold || 60;
    var sx = 0, sy = 0, ex = 0, ey = 0, active = false, locked = false;

    function down(e) {
      var p = e.touches ? e.touches[0] : e;
      sx = ex = p.clientX; sy = ey = p.clientY;
      active = true; locked = false;
    }
    function move(e) {
      if (!active) return;
      var p = e.touches ? e.touches[0] : e;
      ex = p.clientX; ey = p.clientY;
      if (!locked) {
        var dx = ex - sx, dy = ey - sy;
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
          // 纵向位移更大 → 判定为滚动，放弃手势
          locked = Math.abs(dy) > Math.abs(dx);
        }
      }
    }
    function up() {
      if (!active) return;
      active = false;
      if (locked) return;
      var dx = ex - sx, dy = ey - sy;
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) {
        if (typeof opt.tap === 'function') opt.tap();
        return;
      }
      if (Math.abs(dx) < threshold) return;
      if (dx > 0 && typeof opt.right === 'function') opt.right();
      if (dx < 0 && typeof opt.left === 'function') opt.left();
    }

    node.addEventListener('touchstart', down, { passive: true });
    node.addEventListener('touchmove', move, { passive: true });
    node.addEventListener('touchend', up);
    node.addEventListener('mousedown', down);
    node.addEventListener('mouseup', up);
    return function off() {
      node.removeEventListener('touchstart', down);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', up);
      node.removeEventListener('mousedown', down);
      node.removeEventListener('mouseup', up);
    };
  }

  /* ---------------- 文件读写 ---------------- */
  function downloadFile(filename, content, mime) {
    try {
      var blob = new Blob([content], { type: (mime || 'application/json') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (e) {
      toast('导出失败：' + e.message, 'err');
      return false;
    }
  }

  function pickFile(accept, onLoad) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = accept || '';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (f) onLoad(f);
      document.body.removeChild(input);
    });
    input.click();
  }

  function readText(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(new Error('文件读取失败')); };
      fr.readAsText(file, 'utf-8');
    });
  }

  /** 生成简单唯一 id */
  var idSeed = 0;
  function uid(prefix) {
    idSeed++;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + idSeed.toString(36);
  }

  /* ---------------- 导出 ---------------- */
  App.Utils = {
    $: $, $$: $$, el: el, icon: icon, clear: clear, escapeHtml: escapeHtml,
    today: today, toKey: toKey, parseKey: parseKey, addDays: addDays,
    diffDays: diffDays, weekdayOf: weekdayOf, isFuture: isFuture,
    shuffle: shuffle, sample: sample, unique: unique,
    debounce: debounce, rafThrottle: rafThrottle,
    fmtTime: fmtTime, fmtMinutes: fmtMinutes, clamp: clamp, pct: pct, countUp: countUp,
    vibrate: vibrate, playTone: playTone, toast: toast,
    openSheet: openSheet, closeSheet: closeSheet,
    openModal: openModal, closeModal: closeModal,
    confirm: confirm, prompt: prompt,
    onSwipe: onSwipe,
    downloadFile: downloadFile, pickFile: pickFile, readText: readText,
    uid: uid
  };
})(window);
