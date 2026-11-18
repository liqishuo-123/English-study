/* =========================================================
   core/agent.js — 学习智能体（Agent 运行时）
   依赖：core/utils.js, core/store.js, core/ai.js, core/wordsdb.js, core/importer.js
   对外：window.App.Agent

   它是什么：
   把「四六级工作台」从一堆静态页面变成一个能被 AI 操作的学习系统。
   模型不只是聊天，它可以调用下面的工具去查数据、改计划、加生词、出题、
   存素材、跳转页面——也就是说，用户说「帮我把这 10 个词加进生词本」，
   应用里的数据真的会变。

   兼容策略（重要）：
   1. 首选 OpenAI 标准 function calling（tools 字段）。DeepSeek、OpenAI、
      Moonshot、通义、智谱、本地 Ollama 的新模型都支持。
   2. 服务商返回 400（不支持 tools）时自动降级为「JSON 协议」：在提示词里
      要求模型只输出 {"tool":"名字","args":{...}}，由本地解析执行。
   3. 两条路都失败就退化成纯聊天，功能全在、只是不能改数据。
   ========================================================= */
(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var U = App.Utils;

  var MAX_STEPS = 5;          // 一次对话最多执行几轮工具
  var TOOL_RESULT_LIMIT = 1800; // 单个工具结果回喂给模型的最大字符数

  /* =========================================================
     一、工具实现
     ========================================================= */

  /** 把对象压成一段紧凑文本给模型看，超长截断 */
  function brief(v) {
    var s;
    try { s = typeof v === 'string' ? v : JSON.stringify(v); }
    catch (e) { s = String(v); }
    if (s.length > TOOL_RESULT_LIMIT) s = s.slice(0, TOOL_RESULT_LIMIT) + '…（已截断）';
    return s;
  }

  function norm(s) { return String(s == null ? '' : s).toLowerCase().trim(); }

  function wordBrief(w) {
    return {
      word: w.word, phonetic: w.phonetic || '', pos: w.pos || '', meaning: w.meaning,
      example: w.example || '', exampleCn: w.exampleCn || '',
      level: w.level, freq: w.freq, mastered: !!w.mastered, starred: !!w.starred,
      due: w.srs ? w.srs.due : null, reps: w.srs ? w.srs.reps : 0
    };
  }

  function scopedWords(scope) {
    var all = (App.Words && App.Words.all) || [];
    var today = U.today();
    if (scope === 'due') {
      return all.filter(function (w) {
        return !w.isPhrase && w.srs && w.srs.reps > 0 && !w.mastered && U.diffDays(w.srs.due, today) >= 0;
      });
    }
    if (scope === 'weak') {
      return all.filter(function (w) {
        return !w.isPhrase && !w.mastered && w.srs && w.srs.lapses > 0;
      });
    }
    if (scope === 'starred') return all.filter(function (w) { return !!w.starred; });
    if (scope === 'learning') return all.filter(function (w) { return w.status === 'learning' && !w.mastered; });
    // new：还没学过的（按高频优先）
    var fresh = all.filter(function (w) { return !w.mastered && (!w.srs || w.srs.reps === 0); });
    return fresh;
  }

  function findWord(q) {
    var key = norm(q);
    if (!key) return null;
    var all = (App.Words && App.Words.all) || [];
    var i;
    for (i = 0; i < all.length; i++) if (norm(all[i].word) === key) return all[i];
    for (i = 0; i < all.length; i++) if (norm(all[i].word).indexOf(key) === 0) return all[i];
    for (i = 0; i < all.length; i++) if (norm(all[i].meaning).indexOf(key) >= 0) return all[i];
    return null;
  }

  function statusSnapshot() {
    var st = App.Store.state;
    var s = st.settings;
    var log = App.Store.log();
    var c = App.Words && App.Words.counts ? App.Words.counts() : {};
    var due = 0, mastered = 0, learning = 0, starred = 0, lapses = 0;
    var all = (App.Words && App.Words.all) || [];
    var today = U.today();
    for (var i = 0; i < all.length; i++) {
      var w = all[i];
      if (w.mastered) mastered++;
      else if (w.status === 'learning') learning++;
      if (w.starred) starred++;
      if (w.srs && w.srs.lapses > 0 && !w.mastered) lapses++;
      if (!w.mastered && w.srs && w.srs.reps > 0 && U.diffDays(w.srs.due, today) >= 0) due++;
    }
    return {
      today: today,
      library: { total: all.length, cet4: c.cet4 || 0, cet6: c.cet6 || 0, phrase: c.phrase || 0 },
      words: { mastered: mastered, learning: learning, starred: starred, dueToday: due, weak: lapses },
      todayLog: {
        newWords: log.wordsNew || 0, reviewed: log.wordsReviewed || 0,
        quizPapers: log.quizPapers || 0, writingDone: log.writingDone || 0,
        listenDone: log.listenDone || 0, checked: !!log.checked
      },
      goals: {
        dailyNewWords: s.dailyNewWords, dailyQuiz: s.dailyQuiz,
        dailyWriting: s.dailyWriting, dailyListen: s.dailyListen, dailyMinutes: s.dailyMinutes
      },
      exam: { name: s.examName, date: s.examDate, daysLeft: U.diffDays(today, s.examDate) },
      streak: App.Store.streak(),
      wrongbook: (st.wrongbook || []).length,
      customMaterials: (st.materials || []).length,
      builtinMaterials: (App.WRITING_BUILTIN || []).length,
      customQuizzes: (st.customQuestions || []).length,
      importedWords: (st.customWords || []).length
    };
  }

  var tools = {

    get_status: {
      desc: '读取用户当前学习状态快照：词库规模、掌握/学习/待复习词数、今日完成量、每日目标、考试倒计时、连续打卡、错题与素材数量。回答任何与「我的进度/我该学什么」有关的问题前先调用它。',
      params: {},
      run: function () {
        return { ok: true, summary: '已读取学习状态', data: statusSnapshot() };
      }
    },

    list_words: {
      desc: '按范围列出单词（最多 40 个）。scope 取值：due=今天到期复习，weak=曾经答错/遗忘的词，new=从未学过的新词，learning=学习中，starred=已收藏。',
      params: {
        scope: { type: 'string', enum: ['due', 'weak', 'new', 'learning', 'starred'], description: '取词范围，默认 new' },
        limit: { type: 'integer', description: '数量，1~40，默认 10' }
      },
      run: function (a) {
        var scope = a.scope || 'new';
        var limit = U.clamp(parseInt(a.limit, 10) || 10, 1, 40);
        var list = scopedWords(scope);
        // new 优先高频
        if (scope === 'new') {
          list = list.slice().sort(function (x, y) {
            var rank = { high: 0, mid: 1, low: 2 };
            return (rank[x.freq] || 3) - (rank[y.freq] || 3);
          });
        }
        var picked = list.slice(0, limit).map(wordBrief);
        return {
          ok: true,
          summary: '共 ' + list.length + ' 个（' + scope + '），已返回前 ' + picked.length + ' 个',
          data: { scope: scope, total: list.length, words: picked }
        };
      }
    },

    search_word: {
      desc: '在本机词库中查找单词（先精确匹配、再前缀、最后按中文释义模糊匹配）。用于确认某个词是否已在词库、以及取它的音标例句。',
      params: { q: { type: 'string', description: '单词或中文释义关键词' } },
      run: function (a) {
        var q = String(a.q || '').trim();
        if (!q) return { ok: false, summary: '缺少查询词' };
        var w = findWord(q);
        if (!w) {
          // 退化为范围搜索
          var key = norm(q);
          var hits = ((App.Words && App.Words.all) || []).filter(function (x) {
            return norm(x.word).indexOf(key) >= 0 || norm(x.meaning).indexOf(key) >= 0;
          }).slice(0, 8).map(wordBrief);
          return {
            ok: true, summary: '未精确命中，返回 ' + hits.length + ' 条相关结果',
            data: { found: false, hits: hits }
          };
        }
        return { ok: true, summary: '找到 ' + w.word, data: { found: true, word: wordBrief(w) } };
      }
    },

    add_words: {
      desc: '把单词加入用户的自建词库（会立即出现在「单词」页的待学队列里）。单词已存在时自动跳过。适合「帮我把这几个词加进去」「把这篇作文里的生词存起来」。',
      params: {
        words: {
          type: 'array',
          description: '单词数组，每项 {word, meaning, phonetic?, pos?, example?, exampleCn?, level?}',
          items: {
            type: 'object',
            properties: {
              word: { type: 'string' }, meaning: { type: 'string' },
              phonetic: { type: 'string' }, pos: { type: 'string' },
              example: { type: 'string' }, exampleCn: { type: 'string' },
              level: { type: 'string', enum: ['cet4', 'cet6'] }
            },
            required: ['word', 'meaning']
          }
        }
      },
      run: function (a) {
        var arr = Array.isArray(a.words) ? a.words : [];
        if (!arr.length) return { ok: false, summary: '没有收到单词' };
        if (!App.Importer) return { ok: false, summary: '导入模块不可用' };
        var list = arr.map(function (o) {
          return {
            word: String(o.word || '').trim(),
            meaning: String(o.meaning || '').trim(),
            phonetic: String(o.phonetic || '').trim(),
            pos: String(o.pos || '').trim(),
            example: String(o.example || '').trim(),
            exampleCn: String(o.exampleCn || '').trim(),
            level: String(o.level || 'cet4').toLowerCase() === 'cet6' ? 'cet6' : 'cet4',
            freq: 'mid', stage: 'beyond', posTag: '', custom: true
          };
        }).filter(function (o) { return o.word && o.meaning; });
        if (!list.length) return { ok: false, summary: '单词或释义为空，未加入' };
        var r = App.Importer.applyWords(list);
        App.Store.flush();
        if (App.Words && App.Words.rebuild) App.Words.rebuild();
        return {
          ok: true,
          summary: '已加入 ' + r.added + ' 个生词' + (r.skipped ? '，跳过已存在 ' + r.skipped + ' 个' : ''),
          data: { added: r.added, skipped: r.skipped, words: list.map(function (o) { return o.word; }) }
        };
      }
    },

    set_word_state: {
      desc: '修改某个单词的状态：标记为已掌握 / 取消掌握 / 收藏 / 取消收藏。',
      params: {
        word: { type: 'string', description: '单词' },
        mastered: { type: 'boolean', description: '是否标记为已掌握' },
        starred: { type: 'boolean', description: '是否收藏' }
      },
      run: function (a) {
        var w = findWord(a.word);
        if (!w) return { ok: false, summary: '词库里没有找到「' + a.word + '」' };
        var patch = {};
        if (typeof a.mastered === 'boolean') patch.mastered = a.mastered;
        if (typeof a.starred === 'boolean') patch.starred = a.starred;
        if (!Object.keys(patch).length) return { ok: false, summary: '没有要修改的字段' };
        if (patch.mastered === true) { patch.status = 'mastered'; patch.masteredAt = U.today(); }
        if (patch.mastered === false) { patch.status = 'learning'; patch.masteredAt = null; }
        App.Store.setProg(w.id, patch);
        App.Store.flush();
        if (App.Words && App.Words.rebuild) App.Words.rebuild();
        return { ok: true, summary: '已更新「' + w.word + '」：' + brief(patch), data: patch };
      }
    },

    update_plan: {
      desc: '修改每日学习目标或考试信息。只传需要改的字段。每日目标会直接改变「今日」页的任务清单。',
      params: {
        dailyNewWords: { type: 'integer', description: '每天新学单词数 0~200' },
        dailyQuiz: { type: 'integer', description: '每天阅读篇数 0~20' },
        dailyWriting: { type: 'integer', description: '每天写作素材条数 0~50' },
        dailyListen: { type: 'integer', description: '每天听力训练段数 0~20' },
        dailyMinutes: { type: 'integer', description: '每天学习时长（分钟）0~600' },
        examName: { type: 'string', description: '考试名称，如「大学英语四级」' },
        examDate: { type: 'string', description: '考试日期 YYYY-MM-DD' }
      },
      run: function (a) {
        var applied = {};
        App.Store.commit(function (s) {
          function num(k, lo, hi) {
            if (a[k] === undefined || a[k] === null) return;
            var n = parseInt(a[k], 10);
            if (isNaN(n)) return;
            s.settings[k] = U.clamp(n, lo, hi);
            applied[k] = s.settings[k];
          }
          num('dailyNewWords', 0, 200);
          num('dailyQuiz', 0, 20);
          num('dailyWriting', 0, 50);
          num('dailyListen', 0, 20);
          num('dailyMinutes', 0, 600);
          if (a.examName) { s.settings.examName = String(a.examName).slice(0, 40); applied.examName = s.settings.examName; }
          if (a.examDate && /^\d{4}-\d{2}-\d{2}$/.test(a.examDate)) {
            s.settings.examDate = a.examDate;
            applied.examDate = a.examDate;
          }
        });
        App.Store.flush();
        if (!Object.keys(applied).length) return { ok: false, summary: '没有有效的修改字段' };
        return { ok: true, summary: '已更新：' + brief(applied), data: applied };
      }
    },

    add_quiz: {
      desc: '把 AI 生成的练习题录入「阅读」页的真题库（用户随后可以像内置题一样作答、自动判分、错题进错题本）。json 必须是题库格式：{"type":"reading|select-fill|matching","year":"2025-06","paper":"AI 生成","title":"标题","passage":"正文","subQuestions":[{"stem":"题干","options":["A. ...","B. ...","C. ...","D. ..."],"answer":"B","explanation":"解析"}]}。也可以传数组一次多篇。',
      params: { json: { type: 'string', description: '题库 JSON 字符串' } },
      run: function (a) {
        var txt = String(a.json || '').trim();
        if (!txt) return { ok: false, summary: '缺少题目 JSON' };
        if (!App.Importer) return { ok: false, summary: '导入模块不可用' };
        var parsed = App.Importer.parseQuiz(txt);
        if (!parsed.list || !parsed.list.length) {
          return { ok: false, summary: '格式不合法：' + ((parsed.errors || []).slice(0, 3).join('；') || '没有解析到题目') };
        }
        var r = App.Importer.applyQuiz(parsed.list);
        App.Store.flush();
        return {
          ok: true,
          summary: '已录入 ' + r.added + ' 篇' + (r.skipped ? '，跳过重复 ' + r.skipped + ' 篇' : ''),
          data: { added: r.added, skipped: r.skipped, errors: (parsed.errors || []).slice(0, 3) }
        };
      }
    },

    save_material: {
      desc: '把一段写作模板/句型/高级替换/翻译句式存进「写作」页的素材库（用户之后能搜索、编辑、翻译自测）。cat 取值：template=作文模板，pattern=万能句型，synonym=高级替换，translation=翻译句式。',
      params: {
        title: { type: 'string', description: '素材标题' },
        content: { type: 'string', description: '素材正文' },
        cat: { type: 'string', enum: ['template', 'pattern', 'synonym', 'translation'], description: '分类，默认 template' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签，最多 8 个' }
      },
      run: function (a) {
        var title = String(a.title || '').trim();
        var content = String(a.content || '').trim();
        if (!title || !content) return { ok: false, summary: '标题和正文都不能为空' };
        var cat = ['template', 'pattern', 'synonym', 'translation'].indexOf(a.cat) >= 0 ? a.cat : 'template';
        var tags = (Array.isArray(a.tags) ? a.tags : []).map(function (t) { return String(t).slice(0, 12); }).slice(0, 8);
        var id = U.uid('mat');
        App.Store.commit(function (s) {
          s.materials.unshift({ id: id, cat: cat, title: title, content: content, tags: tags, createdAt: U.today() });
        });
        App.Store.flush();
        return { ok: true, summary: '已存入素材库：' + title, data: { id: id, cat: cat } };
      }
    },

    search_material: {
      desc: '在素材库（内置 + 自建）中搜索写作素材，返回标题与正文摘要。',
      params: {
        q: { type: 'string', description: '关键词，留空则列出全部标题' },
        limit: { type: 'integer', description: '数量，默认 8' }
      },
      run: function (a) {
        var key = norm(a.q);
        var limit = U.clamp(parseInt(a.limit, 10) || 8, 1, 30);
        var all = [];
        var builtin = App.WRITING_BUILTIN || [];
        var mine = App.Store.state.materials || [];
        mine.forEach(function (m) {
          all.push({ id: m.id, cat: m.cat, title: m.title, content: m.content, custom: true });
        });
        builtin.forEach(function (m) {
          all.push({ id: m.id, cat: m.cat, title: m.title, content: m.content, custom: false });
        });
        var hits = all.filter(function (m) {
          if (!key) return true;
          return (norm(m.title) + ' ' + norm(m.content)).indexOf(key) >= 0;
        });
        var out = hits.slice(0, limit).map(function (m) {
          return { id: m.id, cat: m.cat, title: m.title, custom: m.custom, excerpt: String(m.content).slice(0, 160) };
        });
        return { ok: true, summary: '共匹配 ' + hits.length + ' 条', data: { total: hits.length, items: out } };
      }
    },

    navigate: {
      desc: '让界面跳转到某个页面，用户能立刻看到结果。route 取值：#/today 今日、#/words 单词、#/writing 写作、#/quiz 阅读、#/wrongbook 错题本、#/listen 听力、#/me 我的。',
      params: { route: { type: 'string', description: '路由，如 #/words' } },
      run: function (a) {
        var route = String(a.route || '').trim();
        if (!/^#\//.test(route)) route = '#/' + route.replace(/^#?\/?/, '');
        if (App.Router) {
          // 延迟到本轮回复渲染后跳转，避免用户看不到回答
          setTimeout(function () { App.Router.go(route); }, 1200);
        }
        return { ok: true, summary: '稍后跳转到 ' + route, data: { route: route } };
      }
    }
  };

  /* =========================================================
     二、OpenAI function calling 描述（由 tools 自动生成）
     ========================================================= */
  function toolSchema() {
    return Object.keys(tools).map(function (name) {
      var t = tools[name];
      var props = {}, required = [];
      Object.keys(t.params || {}).forEach(function (k) {
        var p = t.params[k];
        var o = { type: p.type === 'integer' ? 'integer' : p.type === 'boolean' ? 'boolean' : p.type === 'array' ? 'array' : 'string' };
        if (p.description) o.description = p.description;
        if (p.enum) o.enum = p.enum;
        if (p.items) o.items = p.items;
        props[k] = o;
      });
      // 必填规则：简单工具把非 optional 的都当必填；这里显式声明更可控
      if (name === 'search_word') required = ['q'];
      if (name === 'add_words') required = ['words'];
      if (name === 'save_material') required = ['title', 'content'];
      if (name === 'add_quiz') required = ['json'];
      if (name === 'set_word_state') required = ['word'];
      if (name === 'navigate') required = ['route'];
      return {
        type: 'function',
        function: {
          name: name,
          description: t.desc,
          parameters: { type: 'object', properties: props, required: required }
        }
      };
    });
  }

  /* =========================================================
     三、系统提示词：把「使用者是谁、能干什么、不许干什么」讲清楚
     ========================================================= */
  function systemPrompt() {
    return [
      '你是「四六级英语工作台」内置的学习智能体，服务对象是一名正在备考大学英语四六级的中国学生。',
      '',
      '## 你能做的事',
      '你不只会聊天，还能调用工具直接操作这个应用里的真实数据：查看进度、列单词、查词、加生词、改每日目标、录入 AI 出的题、保存写作素材、跳转页面。',
      '凡涉及用户自己的数据（进度、待复习、生词、目标、错题、素材），必须先调用工具拿真实数据，严禁凭印象编造数字。',
      '',
      '## 回答风格',
      '1. 中文回答，口语化、直接，不写「作为AI」这类空话。',
      '2. 先给结论或可执行的下一步，再给必要解释；需要分点时用 2~5 条，别超过 6 条。',
      '3. 单次回复控制在 300 字以内，除非用户明确要求详细讲解（如长难句解析、作文批改）。',
      '4. 涉及英语内容时用英文原句 + 中文解释，音标用 /.../ 格式。',
      '5. 不要向用户展示 JSON、函数名或工具调用过程，用户只看到自然语言结果。',
      '',
      '## 学习建议原则',
      '1. 依据真实数据给建议：到期复习多就先复习，新词目标没完成就别加新负担。',
      '2. 目标要小步可完成（例如一次 10 个词），不要一次布置 100 个。',
      '3. 用户想练题时，用 add_quiz 生成一篇（或一套）贴合四六级难度的原创题，题干 4 个选项、答案唯一，并在 explanation 里写清为什么。生成后提示用户去「阅读」页作答。',
      '4. 用户说「帮我记住这些词」时，用 add_words 存进生词本，而不是只在聊天里解释。',
      '',
      '## 工具调用规则',
      '1. 一次可以调用多个工具，但只在确实需要数据时才调。',
      '2. 修改类工具（add_words / update_plan / add_quiz / save_material / set_word_state）执行后，用一句话告诉用户改了什么、去哪看。',
      '3. 工具失败时不要重复死磕，向用户说明原因并给替代方案。',
      '',
      '## 当前状态快照（仅供参考，涉及细节请调用工具获取最新值）',
      brief(statusSnapshot())
    ].join('\n');
  }

  /* =========================================================
     四、执行 + 多轮循环
     ========================================================= */
  function execute(name, args) {
    var t = tools[name];
    if (!t) return { ok: false, summary: '未知工具：' + name, data: null };
    var a = args || {};
    if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { a = {}; } }
    try {
      var r = t.run(a);
      return r || { ok: false, summary: '工具没有返回结果' };
    } catch (e) {
      return { ok: false, summary: '工具执行出错：' + (e && e.message ? e.message : e), data: null };
    }
  }

  /** 从纯文本里解析出「JSON 协议」的工具调用（降级模式用） */
  function parseInlineCall(text) {
    if (!text) return null;
    var t = String(text);

    // 1) 形如 {"tool":"get_status","args":{}}，可能被 ``` 包起来
    var m = t.match(/\{[\s\S]*"tool"[\s\S]*\}/);
    if (m) {
      var src = m[0];
      // 尝试逐渐缩短，容忍模型在后面多写了说明文字
      for (var end = src.length; end > 8; end--) {
        try {
          var o = JSON.parse(src.slice(0, end));
          if (o && typeof o.tool === 'string') {
            return { name: o.tool, args: o.args || o.arguments || {}, raw: src.slice(0, end) };
          }
        } catch (e) { /* 继续尝试更短的切法 */ }
      }
    }
    // 2) 形如 <tool>get_status</tool><args>{}</args>
    var n = t.match(/<tool>\s*([a-z_]+)\s*<\/tool>/i);
    if (n) {
      var argMatch = t.match(/<args>([\s\S]*?)<\/args>/i);
      var argObj = {};
      if (argMatch) { try { argObj = JSON.parse(argMatch[1]); } catch (e2) { argObj = {}; } }
      return { name: n[1], args: argObj, raw: m ? m[0] : '' };
    }
    return null;
  }

  function historyToMessages(history) {
    var out = [];
    (history || []).forEach(function (m) {
      if (!m || !m.role) return;
      if (m.role === 'user' || m.role === 'assistant') {
        out.push({ role: m.role, content: String(m.content || m.text || '') });
      }
    });
    return out;
  }

  /**
   * 跑一轮对话
   * @param {Object} opt { text, history, onEvent }
   *   onEvent({type:'tool'|'thinking'|'reply'|'error', ...})
   * @returns {Promise<{ok:boolean, text:string, error:string, steps:Array}>}
   */
  function run(opt) {
    opt = opt || {};
    var onEvent = opt.onEvent || function () { };
    var steps = [];
    var useJsonProtocol = false;

    if (!App.AI || !App.AI.isEnabled()) {
      return Promise.resolve({
        ok: false, code: 'no-key', steps: [],
        error: '还没有配置 AI 接口。到「我的 → AI 配置」填接口地址、模型和密钥就能用了。'
      });
    }

    var messages = [{ role: 'system', content: systemPrompt() }]
      .concat(historyToMessages(opt.history))
      .concat([{ role: 'user', content: String(opt.text || '') }]);

    function callModel(allowTools) {
      var o = { temperature: 0.35, timeout: 60000 };
      if (allowTools) o.tools = toolSchema();
      return App.AI.chat(messages, o);
    }

    function step(i) {
      if (i >= MAX_STEPS) {
        return { ok: true, text: '（这轮工具调用次数到上限了，先说结论，需要继续的话告诉我）', steps: steps };
      }
      onEvent({ type: 'thinking', round: i });

      return callModel(!useJsonProtocol && !opt.noTools).then(function (r) {
        // 服务商不支持 tools → 切 JSON 协议重试一次
        if (!r.ok && (r.code === 'bad-request' || r.code === 'http') && !useJsonProtocol && !opt.noTools) {
          useJsonProtocol = true;
          onEvent({ type: 'fallback', mode: 'json' });
          return callModel(false);
        }
        if (!r.ok) return { ok: false, error: r.error, code: r.code, steps: steps };

        // A. 标准 tool_calls
        if (r.toolCalls && r.toolCalls.length) {
          messages.push({
            role: 'assistant',
            content: r.text || '',
            tool_calls: r.toolCalls
          });
          var seq = Promise.resolve();
          r.toolCalls.forEach(function (call) {
            seq = seq.then(function () {
              var name = call.function ? call.function.name : '';
              var rawArgs = call.function ? call.function.arguments : '{}';
              var args = {};
              try { args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : (rawArgs || {}); }
              catch (e) { args = {}; }
              onEvent({ type: 'tool', name: name, args: args });
              var res = execute(name, args);
              steps.push({ name: name, args: args, ok: res.ok, summary: res.summary });
              onEvent({ type: 'tool-done', name: name, ok: res.ok, summary: res.summary });
              messages.push({
                role: 'tool',
                tool_call_id: call.id || name,
                content: brief(res.ok ? res.summary + '\n' + brief(res.data || '') : res.summary)
              });
            });
          });
          return seq.then(function () { return step(i + 1); });
        }

        // B. 文本里藏着的 JSON 协议调用
        var call = parseInlineCall(r.text);
        if (call && tools[call.name]) {
          messages.push({ role: 'assistant', content: r.text });
          onEvent({ type: 'tool', name: call.name, args: call.args });
          var res2 = execute(call.name, call.args);
          steps.push({ name: call.name, args: call.args, ok: res2.ok, summary: res2.summary });
          onEvent({ type: 'tool-done', name: call.name, ok: res2.ok, summary: res2.summary });
          messages.push({
            role: 'user',
            content: '【工具 ' + call.name + ' 的执行结果】\n' +
              (res2.ok ? res2.summary + '\n' + brief(res2.data || '') : '失败：' + res2.summary) +
              '\n\n请基于以上真实结果继续，直接回答用户，不要再说要调用工具。'
          });
          return step(i + 1);
        }

        // C. 正常回答
        return { ok: true, text: r.text, steps: steps };
      });
    }

    return step(0).catch(function (e) {
      return { ok: false, error: '智能体运行出错：' + (e && e.message ? e.message : e), steps: steps };
    });
  }

  /* =========================================================
     五、常见服务商预设（配置页一键填充）
     ========================================================= */
  var PRESETS = [
    { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', note: '便宜、中文好，支持工具调用' },
    { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', note: '支持工具调用' },
    { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', note: '阿里云百炼，OpenAI 兼容' },
    { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', note: '有免费额度' },
    { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', note: '长文本强' },
    { name: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', note: '完全本地、无需联网（需允许跨域）' }
  ];

  /* =========================================================
     六、跨页面预填（例如单词卡上的「问助教」）
     ========================================================= */
  var SEED_KEY = 'cet-agent-seed';

  /**
   * 把一句话带到 AI 助教页：跳转后自动填进输入框（可用时直接发送）。
   * @param {string} text
   */
  function seed(text) {
    try { sessionStorage.setItem(SEED_KEY, String(text || '')); }
    catch (e) { /* 隐私模式下不可用，忽略 */ }
    if (App.Router) App.Router.go('#/agent');
  }

  /** 取出并清空待发送内容 */
  function takeSeed() {
    var t = '';
    try {
      t = sessionStorage.getItem(SEED_KEY) || '';
      if (t) sessionStorage.removeItem(SEED_KEY);
    } catch (e) { /* 忽略 */ }
    return t;
  }

  App.Agent = {
    tools: tools,
    toolSchema: toolSchema,
    systemPrompt: systemPrompt,
    execute: execute,
    parseInlineCall: parseInlineCall,
    status: statusSnapshot,
    run: run,
    seed: seed,
    takeSeed: takeSeed,
    PRESETS: PRESETS
  };
})(window);
