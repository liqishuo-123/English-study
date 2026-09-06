/* =========================================================
   core/ai.js — AI 能力封装（可选、可降级）
   依赖：core/utils.js, core/store.js
   对外：window.App.AI

   重要：
   - 未配置密钥时 isEnabled() 返回 false，所有函数返回降级结果，
     界面据此置灰按钮并提示，其余五大模块完全离线正常运行。
   - 密钥只存在本机浏览器 localStorage。前端直连意味着密钥会暴露给
     API 服务商，仅供个人自用，不要在公共设备上填写。
   ========================================================= */
(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var U = App.Utils;

  var TIMEOUT_MS = 30000;

  function cfg() {
    var s = App.Store && App.Store.state;
    return (s && s.settings && s.settings.ai) || { baseUrl: '', apiKey: '', model: '' };
  }

  function isEnabled() {
    var c = cfg();
    return !!(c.apiKey && c.apiKey.trim() && c.baseUrl && c.baseUrl.trim());
  }

  /** 统一降级结果 */
  function disabled() {
    return { ok: false, code: 'no-key', text: '', error: '未配置 AI，请到「我的 → AI 配置」填写接口地址与密钥' };
  }

  /** 拼接接口地址，容错用户填了或没填 /chat/completions */
  function endpoint() {
    var base = cfg().baseUrl.trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(base)) return base;
    if (/\/v\d+$/.test(base)) return base + '/chat/completions';
    return base + '/v1/chat/completions';
  }

  /**
   * 发起一次对话
   * @param {Array<{role:string,content:string}>} messages
   * @param {Object} opt { temperature, maxTokens }
   * @returns {Promise<{ok:boolean, code:string, text:string, error:string}>}
   */
  function chat(messages, opt) {
    if (!isEnabled()) return Promise.resolve(disabled());
    opt = opt || {};

    var c = cfg();
    var ctrl = new AbortController();
    var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { /* 忽略 */ } }, TIMEOUT_MS);

    var body = {
      model: (c.model && c.model.trim()) || 'gpt-3.5-turbo',
      messages: messages,
      temperature: opt.temperature === undefined ? 0.6 : opt.temperature,
      stream: false
    };
    if (opt.maxTokens) body.max_tokens = opt.maxTokens;

    return fetch(endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + c.apiKey.trim()
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    })
      .then(function (res) {
        if (res.status === 401 || res.status === 403) {
          throw mkErr('auth', '密钥无效或没有权限（' + res.status + '），请到「我的 → AI 配置」检查');
        }
        if (res.status === 429) throw mkErr('rate', '请求太频繁被限流了，请稍后再试');
        if (res.status >= 500) throw mkErr('server', '服务商端出错（' + res.status + '），请稍后再试');
        if (!res.ok) throw mkErr('http', '请求失败（' + res.status + '）');
        return res.json();
      })
      .then(function (json) {
        var text = '';
        try { text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content || ''; }
        catch (e) { text = ''; }
        if (!text) {
          if (json && json.error && json.error.message) throw mkErr('api', json.error.message);
          throw mkErr('empty', '没有拿到返回内容，请检查模型名称是否正确');
        }
        return { ok: true, code: 'ok', text: String(text).trim(), error: '' };
      })
      .catch(function (err) {
        if (err && err.__ai) return { ok: false, code: err.code, text: '', error: err.message };
        if (err && err.name === 'AbortError') {
          return { ok: false, code: 'timeout', text: '', error: '请求超时（30 秒），请检查网络或稍后再试' };
        }
        return { ok: false, code: 'network', text: '', error: '网络请求失败，请检查连接或接口地址' };
      })
      .then(function (r) { clearTimeout(timer); return r; });
  }

  function mkErr(code, msg) {
    var e = new Error(msg);
    e.__ai = true; e.code = code;
    return e;
  }

  /* ---------------- 三个具体能力 ---------------- */

  var SYS = '你是大学英语四六级考试的资深阅卷老师，回答用中文，条理清晰，重点突出。';

  /** 作文批改 */
  function correctEssay(text, title) {
    if (!isEnabled()) return Promise.resolve(disabled());
    var prompt = '请批改下面这篇英语作文' + (title ? '（题目：' + title + '）' : '') + '。\n\n' +
      '请按以下四部分输出：\n' +
      '1. 总体评价与建议分数（按四六级 15 分制估算）\n' +
      '2. 语言错误（逐条列出：原句 → 修改后 → 原因）\n' +
      '3. 可提升的表达（给出更高级的替换写法）\n' +
      '4. 修订后的全文\n\n' +
      '作文原文：\n' + text;
    return chat([{ role: 'system', content: SYS }, { role: 'user', content: prompt }], { temperature: 0.4 });
  }

  /** 为一个单词生成例句 */
  function generateExample(word, meaning) {
    if (!isEnabled()) return Promise.resolve(disabled());
    var prompt = '请为英语单词「' + word + '」' + (meaning ? '（释义：' + meaning + '）' : '') +
      '生成 3 个适合大学英语四级考试的例句。\n' +
      '每个例句请按这个格式输出，不要有多余内容：\n' +
      '1. 英文例句\n   中文翻译\n' +
      '要求：难度贴近四级，句子长度 10~25 词，覆盖不同语境。';
    return chat([{ role: 'system', content: SYS }, { role: 'user', content: prompt }], { temperature: 0.7 });
  }

  /** 长难句解析 */
  function analyzeSentence(sentence) {
    if (!isEnabled()) return Promise.resolve(disabled());
    var prompt = '请解析下面这个英语长难句，按四部分输出：\n' +
      '1. 全句翻译\n' +
      '2. 句子结构（主干 / 从句 / 修饰成分，用缩进表示层级）\n' +
      '3. 重点词汇与短语（逐个给出音标与释义）\n' +
      '4. 拆解示范（如何快速读懂这类句子）\n\n' +
      '句子：' + sentence;
    return chat([{ role: 'system', content: SYS }, { role: 'user', content: prompt }], { temperature: 0.4 });
  }

  /** 掩码显示密钥 */
  function maskedKey() {
    var k = (cfg().apiKey || '').trim();
    if (!k) return '';
    if (k.length <= 8) return '••••••••';
    return k.slice(0, 4) + '••••••••' + k.slice(-4);
  }

  App.AI = {
    isEnabled: isEnabled,
    config: cfg,
    chat: chat,
    correctEssay: correctEssay,
    generateExample: generateExample,
    analyzeSentence: analyzeSentence,
    maskedKey: maskedKey
  };
})(window);
