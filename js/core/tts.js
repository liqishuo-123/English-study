/* =========================================================
   core/tts.js — 语音朗读封装（Web Speech API）
   用途：听力精听/影子跟读、单词发音、例句朗读。
   设计要点：
   - 语音列表在 Chrome 里是异步加载的，第一次 getVoices() 常常为空，
     这里用 voiceschanged 兜底，并在需要时轮询等待；
   - 统一返回一个控制器，支持中途停止（切题、翻页时很重要）；
   - 语速/语音都从 settings 读，未选时自动挑一个英语语音。
   ========================================================= */
(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var U = App.Utils;

  var synth = global.speechSynthesis || null;
  var cachedVoices = [];
  var listening = false;

  function supported() {
    return !!(synth && global.SpeechSynthesisUtterance);
  }

  function isEnglish(v) {
    return /^en(-|_|$)/i.test(String(v.lang || ''));
  }

  function refresh() {
    if (!supported()) return cachedVoices;
    var list = [];
    try { list = synth.getVoices() || []; } catch (e) { list = []; }
    if (list.length) cachedVoices = list;
    return cachedVoices;
  }

  if (supported()) {
    refresh();
    // 语音列表晚到时再刷一次，并通知界面
    try {
      synth.addEventListener('voiceschanged', function () {
        refresh();
        if (typeof App.onVoicesChanged === 'function') {
          try { App.onVoicesChanged(voices()); } catch (e) { /* 忽略 */ }
        }
      });
    } catch (e) {
      /* 老浏览器没有 addEventListener，忽略即可 */
    }
  }

  /** 英文语音优先，按「用户所选 > 美音 > 英音 > 任意英文」排序 */
  function voices() {
    var all = refresh().filter(isEnglish);
    var pref = (App.Store && App.Store.state.settings.ttsVoice) || '';
    all.sort(function (a, b) {
      if (a.name === pref) return -1;
      if (b.name === pref) return 1;
      var pa = /en[-_]US/i.test(a.lang) ? 0 : 1;
      var pb = /en[-_]US/i.test(b.lang) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return String(a.name).localeCompare(String(b.name));
    });
    return all;
  }

  function pickVoice(name) {
    var list = voices();
    if (!list.length) return null;
    if (name) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].name === name) return list[i];
      }
    }
    return list[0];
  }

  /* ---------------------------------------------------------
     speak(text, opts) → 控制器 {stop, pause, resume, done(Promise)}
     opts: rate, voice, lang, onstart, onend, onboundary, pitch
     --------------------------------------------------------- */
  function speak(text, opts) {
    opts = opts || {};
    text = String(text == null ? '' : text).trim();

    var ctrl = {
      stop: function () { },
      pause: function () { },
      resume: function () { },
      done: Promise.resolve(),
      get speaking() { return false; }
    };

    if (!supported() || !text) {
      if (opts.onend) { try { opts.onend(); } catch (e) { /* 忽略 */ } }
      return ctrl;
    }

    cancel();                       // 单通道：同一时刻只读一段
    listening = true;

    var u = new global.SpeechSynthesisUtterance(text);
    var v = opts.voice || pickVoice(opts.voiceName);
    if (v) {
      u.voice = v;
      u.lang = v.lang || 'en-US';
    } else {
      u.lang = opts.lang || 'en-US';
    }
    u.rate = typeof opts.rate === 'number' ? U.clamp(opts.rate, 0.5, 2) : 1;
    u.pitch = typeof opts.pitch === 'number' ? opts.pitch : 1;

    var settle;
    ctrl.done = new Promise(function (res) { settle = res; });

    function finish() {
      if (!listening) return;
      listening = false;
      settle();
    }

    u.onstart = function () { if (opts.onstart) opts.onstart(); };
    u.onend = function () {
      finish();
      if (opts.onend) opts.onend();
    };
    u.onerror = function (ev) {
      // 'interrupted'/'canceled' 是我们主动停的，不算错误
      var err = ev && ev.error;
      finish();
      if (opts.onend) opts.onend();
      if (opts.onerror && err && err !== 'interrupted' && err !== 'canceled') {
        opts.onerror(err);
      }
    };
    if (opts.onboundary) {
      u.onboundary = function (ev) { opts.onboundary(ev); };
    }

    ctrl.stop = function () {
      try { synth.cancel(); } catch (e) { /* 忽略 */ }
      finish();
    };
    ctrl.pause = function () { try { synth.pause(); } catch (e) { /* 忽略 */ } };
    ctrl.resume = function () { try { synth.resume(); } catch (e) { /* 忽略 */ } };
    Object.defineProperty(ctrl, 'speaking', { get: function () { return listening; } });

    try { synth.speak(u); } catch (e) {
      finish();
      if (opts.onerror) opts.onerror(String(e && e.message || e));
    }
    return ctrl;
  }

  /** 朗读单个单词/句子（不打断其他内容时的快捷用法） */
  function say(text, rate) {
    return speak(text, { rate: rate || 0.95 });
  }

  function cancel() {
    listening = false;
    if (!supported()) return;
    try { synth.cancel(); } catch (e) { /* 忽略 */ }
  }

  function pause() { try { synth.pause(); } catch (e) { /* 忽略 */ } }
  function resume() { try { synth.resume(); } catch (e) { /* 忽略 */ } }

  /**
   * 等语音列表就绪（首次进入听力页可能还没加载完）。
   * 最多等 ms 毫秒，超时也返回，不阻塞界面。
   */
  function ready(ms) {
    if (!supported()) return Promise.resolve([]);
    var list = refresh();
    if (list.length) return Promise.resolve(voices());
    return new Promise(function (res) {
      var waited = 0;
      var timer = setInterval(function () {
        waited += 120;
        var v = refresh();
        if (v.length || waited >= (ms || 1500)) {
          clearInterval(timer);
          res(voices());
        }
      }, 120);
    });
  }

  App.TTS = {
    supported: supported,
    voices: voices,
    pickVoice: pickVoice,
    speak: speak,
    say: say,
    cancel: cancel,
    pause: pause,
    resume: resume,
    ready: ready
  };
})(window);
