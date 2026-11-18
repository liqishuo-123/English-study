/* =========================================================
   core/importer.js — 词库与真题导入解析
   依赖：core/utils.js, core/store.js
   对外：window.App.Importer

   设计原则：
   - 逐行 / 逐条校验，失败项给出行号与原因
   - 成功部分照常入库，失败部分原样返回给界面展示，绝不静默丢弃
   - 不覆盖已有数据，重复项跳过并计数
   ========================================================= */
(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var U = App.Utils;

  var QUIZ_TYPES = ['select-fill', 'matching', 'reading'];

  /* ================= CSV 解析 ================= */
  /** 支持带引号、引号内逗号与换行、双写引号转义 */
  function parseCSV(text) {
    var rows = [];
    var row = [], field = '';
    var inQuote = false;
    text = String(text).replace(/^\uFEFF/, ''); // 去 BOM

    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuote) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuote = false;
        } else field += c;
      } else {
        if (c === '"') inQuote = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c === '\r') { /* 忽略 */ }
        else field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    // 去掉全空行
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }

  function normalizeHeader(h) {
    return String(h || '').trim().toLowerCase().replace(/[\s_-]/g, '');
  }

  var HEADER_ALIAS = {
    word: 'word', 单词: 'word', vocab: 'word', term: 'word',
    phonetic: 'phonetic', 音标: 'phonetic',
    pos: 'pos', 词性: 'pos',
    meaning: 'meaning', 释义: 'meaning', 中文: 'meaning', 意思: 'meaning', def: 'meaning',
    example: 'example', 例句: 'example',
    examplecn: 'exampleCn', 例句翻译: 'exampleCn', 例句中文: 'exampleCn', translation: 'exampleCn',
    level: 'level', 词书: 'level', 级别: 'level',
    freq: 'freq', 频率: 'freq', 词频: 'freq',
    stage: 'stage', 学段: 'stage',
    postag: 'posTag', 词性标签: 'posTag'
  };

  /* ================= 词库解析 ================= */
  /**
   * @param {string} text CSV 或 JSON 文本
   * @returns {{list:Array, errors:Array, skipped:number}}
   */
  function parseWords(text) {
    var trimmed = String(text || '').trim();
    if (!trimmed) return { list: [], errors: ['内容为空'], skipped: 0 };
    if (trimmed[0] === '[' || trimmed[0] === '{') return parseWordsJSON(trimmed);
    return parseWordsCSV(trimmed);
  }

  function parseWordsCSV(text) {
    var rows = parseCSV(text);
    if (rows.length < 2) return { list: [], errors: ['至少需要表头行和一行数据'], skipped: 0 };

    var header = rows[0].map(normalizeHeader).map(function (h) { return HEADER_ALIAS[h] || h; });
    var idx = {};
    header.forEach(function (h, i) { if (h && idx[h] === undefined) idx[h] = i; });

    if (idx.word === undefined) {
      return { list: [], errors: ['表头缺少 word（单词）列，请参照模板文件'], skipped: 0 };
    }

    var list = [], errors = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var word = (row[idx.word] || '').trim();
      if (!word) { errors.push('第 ' + (r + 1) + ' 行：单词为空，已跳过'); continue; }
      var meaning = idx.meaning !== undefined ? (row[idx.meaning] || '').trim() : '';
      if (!meaning) { errors.push('第 ' + (r + 1) + ' 行：“' + word + '” 缺少释义，已跳过'); continue; }

      var item = {
        word: word,
        phonetic: idx.phonetic !== undefined ? (row[idx.phonetic] || '').trim() : '',
        pos: idx.pos !== undefined ? (row[idx.pos] || '').trim() : '',
        meaning: meaning,
        example: idx.example !== undefined ? (row[idx.example] || '').trim() : '',
        exampleCn: idx.exampleCn !== undefined ? (row[idx.exampleCn] || '').trim() : '',
        level: normLevel(idx.level !== undefined ? row[idx.level] : 'cet4'),
        freq: normFreq(idx.freq !== undefined ? row[idx.freq] : 'mid'),
        stage: normStage(idx.stage !== undefined ? row[idx.stage] : 'hs'),
        posTag: normPosTag(idx.posTag !== undefined ? row[idx.posTag] : ''),
        custom: true
      };
      list.push(item);
    }
    return { list: list, errors: errors, skipped: 0 };
  }

  function parseWordsJSON(text) {
    var data;
    try { data = JSON.parse(text); }
    catch (e) { return { list: [], errors: ['JSON 解析失败：' + e.message], skipped: 0 }; }

    var arr = Array.isArray(data) ? data : (Array.isArray(data.words) ? data.words : null);
    if (!arr) return { list: [], errors: ['JSON 需要是数组，或形如 {"words": [...]} 的对象'], skipped: 0 };

    var list = [], errors = [];
    for (var i = 0; i < arr.length; i++) {
      var o = arr[i] || {};
      var word = String(o.word || '').trim();
      if (!word) { errors.push('第 ' + (i + 1) + ' 条：单词为空，已跳过'); continue; }
      var meaning = String(o.meaning || o.def || '').trim();
      if (!meaning) { errors.push('第 ' + (i + 1) + ' 条：“' + word + '” 缺少释义，已跳过'); continue; }
      list.push({
        word: word,
        phonetic: String(o.phonetic || '').trim(),
        pos: String(o.pos || '').trim(),
        meaning: meaning,
        example: String(o.example || '').trim(),
        exampleCn: String(o.exampleCn || o.translation || '').trim(),
        level: normLevel(o.level),
        freq: normFreq(o.freq),
        stage: normStage(o.stage),
        posTag: normPosTag(o.posTag),
        custom: true
      });
    }
    return { list: list, errors: errors, skipped: 0 };
  }

  function normLevel(v) {
    var s = String(v || '').toLowerCase();
    if (s.indexOf('6') >= 0) return 'cet6';
    return 'cet4';
  }
  function normFreq(v) {
    var s = String(v || '').toLowerCase();
    if (s === 'high' || s === '高' || s === '高频' || s === '3') return 'high';
    if (s === 'low' || s === '低' || s === '低频' || s === '1') return 'low';
    return 'mid';
  }
  function normStage(v) {
    var s = String(v || '').toLowerCase();
    if (s === 'beyond' || s === '高中外' || s === '超纲' || s === '新增') return 'beyond';
    return 'hs';
  }
  function normPosTag(v) {
    var s = String(v || '').toLowerCase().replace(/[^a-z]/g, '');
    if (s.indexOf('v') === 0) return 'v';
    if (s.indexOf('n') === 0) return 'n';
    if (s.indexOf('adj') === 0) return 'adj';
    if (s.indexOf('adv') === 0) return 'adv';
    if (s.indexOf('prep') === 0) return 'prep';
    if (s.indexOf('conj') === 0) return 'conj';
    return '';
  }

  /** 词在同一词性下视为重复（大小写不敏感） */
  function wordKey(w) {
    return String(w.word || '').toLowerCase().trim() + '|' + String(w.pos || '').toLowerCase().trim();
  }

  /**
   * 把导入的词合并进存档
   * @returns {{added:number, skipped:number, errors:Array}}
   */
  function applyWords(list) {
    var added = 0, skipped = 0;
    var existing = Object.create(null);

    // 已存在的词（内置 + 已导入）
    if (App.Words) App.Words.all.forEach(function (w) { existing[wordKey(w)] = 1; });

    var batch = Object.create(null);
    var toAdd = [];
    list.forEach(function (w) {
      var k = wordKey(w);
      if (existing[k] || batch[k]) { skipped++; return; }
      batch[k] = 1;
      w.id = 'cw_' + k.replace(/[^\w]/g, '').slice(0, 40) + '_' + U.uid('').slice(1);
      toAdd.push(w);
    });

    if (toAdd.length) {
      App.Store.commit(function (s) {
        s.customWords = s.customWords.concat(toAdd);
      });
      App.Store.flush();
      if (App.Words) App.Words.rebuild();
      added = toAdd.length;
    }
    return { added: added, skipped: skipped, errors: [] };
  }

  /* ================= 真题解析 ================= */
  /**
   * @param {string} text JSON 文本
   * @returns {{list:Array, errors:Array}}
   */
  function parseQuiz(text) {
    var data;
    try { data = JSON.parse(text); }
    catch (e) { return { list: [], errors: ['JSON 解析失败：' + e.message] }; }

    var arr = Array.isArray(data) ? data : (Array.isArray(data.questions) ? data.questions : [data]);
    if (!arr.length) return { list: [], errors: ['没有找到任何题目'] };

    var list = [], errors = [];
    for (var i = 0; i < arr.length; i++) {
      var o = arr[i] || {};
      var type = String(o.type || '').trim();
      if (QUIZ_TYPES.indexOf(type) < 0) {
        errors.push('第 ' + (i + 1) + ' 篇：type 必须是 ' + QUIZ_TYPES.join(' / ') + ' 之一，已跳过');
        continue;
      }
      var subs = Array.isArray(o.subQuestions) ? o.subQuestions : (Array.isArray(o.questions) ? o.questions : []);
      if (!subs.length) { errors.push('第 ' + (i + 1) + ' 篇：没有题目（subQuestions 为空），已跳过'); continue; }

      var normalized = [];
      var ok = true;
      for (var j = 0; j < subs.length; j++) {
        var q = subs[j] || {};
        var stem = String(q.stem || q.question || '').trim();
        var answer = String(q.answer || '').trim();
        var options = Array.isArray(q.options) ? q.options.map(function (x) { return String(x).trim(); })
          : (Array.isArray(o.options) ? o.options.map(function (x) { return String(x).trim(); }) : []);
        if (!answer) { errors.push('第 ' + (i + 1) + ' 篇 第 ' + (j + 1) + ' 题：缺少 answer，已跳过该题'); ok = false; continue; }
        if (type !== 'select-fill' && options.length < 2) {
          errors.push('第 ' + (i + 1) + ' 篇 第 ' + (j + 1) + ' 题：选项少于 2 个，已跳过该题');
          ok = false; continue;
        }
        normalized.push({
          id: U.uid('q'),
          stem: stem,
          options: options,
          answer: answer,
          explanation: String(q.explanation || q.analysis || '').trim()
        });
      }
      if (!normalized.length || !ok && normalized.length === 0) continue;

      list.push({
        id: U.uid('paper'),
        type: type,
        source: 'custom',
        year: String(o.year || '').trim(),
        paper: String(o.paper || o.name || '').trim(),
        title: String(o.title || '').trim(),
        passage: String(o.passage || o.text || '').trim(),
        options: Array.isArray(o.options) ? o.options.map(function (x) { return String(x).trim(); }) : [],
        subQuestions: normalized
      });
    }
    return { list: list, errors: errors };
  }

  /**
   * 合并真题进存档
   * @returns {{added:number, skipped:number}}
   */
  function applyQuiz(list) {
    var added = 0, skipped = 0;
    var seen = Object.create(null);
    App.Store.state.customQuestions.forEach(function (p) { seen[p.id] = 1; });

    var toAdd = [];
    list.forEach(function (p) {
      var k = p.type + '|' + p.year + '|' + p.paper + '|' + p.title + '|' + p.passage.slice(0, 60);
      if (seen[k]) { skipped++; return; }
      seen[k] = 1;
      p.dedupKey = k;
      toAdd.push(p);
    });

    if (toAdd.length) {
      App.Store.commit(function (s) { s.customQuestions = s.customQuestions.concat(toAdd); });
      App.Store.flush();
      added = toAdd.length;
    }
    return { added: added, skipped: skipped };
  }

  /* ================= 答案比对 ================= */
  /**
   * 判断用户答案是否正确
   * 兼容：直接写答案文本 / 写选项字母 A-D / 大小写与空格差异
   */
  function isAnswerRight(question, userAnswer) {
    var ua = String(userAnswer || '').trim().toLowerCase();
    var ans = String(question.answer || '').trim().toLowerCase();
    if (!ua) return false;
    if (ua === ans) return true;

    // 选项形如 "B. xxx" / "B) xxx" / "B、xxx"
    var m = ans.match(/^([a-p])[\.、\)\s]/);
    if (m && m[1] === ua) return true;
    // 用户在选项里选的可能是选项文本本身
    for (var i = 0; i < question.options.length; i++) {
      var opt = String(question.options[i]).trim().toLowerCase();
      var om = opt.match(/^([a-p])[\.、\)\s]/);
      if (om && om[1] === ans && opt === ua) return true;
      if (opt === ans) return true;
    }
    // 去标点后比较
    var strip = function (s) { return s.replace(/[^a-z0-9\u4e00-\u9fa5]/g, ''); };
    if (strip(ua) === strip(ans)) return true;
    for (var j = 0; j < question.options.length; j++) {
      var o2 = String(question.options[j]).trim().toLowerCase();
      var o2m = o2.match(/^([a-p])[\.、\)\s]/);
      if (o2m && o2m[1] === ans && strip(ua) === strip(o2)) return true;
    }
    return false;
  }

  /** 取选项字母（无前缀时按序号推算） */
  function optionLetter(opt, index) {
    var m = String(opt).trim().match(/^([A-Pa-p])[\.、\)\s]/);
    if (m) return m[1].toUpperCase();
    return String.fromCharCode(65 + index);
  }

  App.Importer = {
    parseCSV: parseCSV,
    parseWords: parseWords,
    applyWords: applyWords,
    parseQuiz: parseQuiz,
    applyQuiz: applyQuiz,
    isAnswerRight: isAnswerRight,
    optionLetter: optionLetter,
    normFreq: normFreq,
    normStage: normStage,
    normPosTag: normPosTag
  };
})(window);
