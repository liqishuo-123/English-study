/* =========================================================
   views/me.js — 我的（数据看板 + 全部设置）
   依赖：core/*, data/*
   功能：
   - 数据看板：连续打卡概览卡 / 四统计卡
   - Canvas 手绘图表：打卡热力图（近 12 周）、掌握率折线（近 30 天）、模块正确率环形图
   - 设置：考试信息与每日计划 / 主题 / AI 配置 / 导入词库 / 导出导入备份 / 错题本与已掌握词入口 / 清空数据

   图表说明：
   - 卡片内 canvas 以 DPR 自适应缩放，绘色读取 CSS 变量以跟随深浅主题
   - 统计数值使用滚动动画，图表有入场动画；resize 防抖重绘
   - 打卡热力图按「当天是否有学习记录」上色，并把当天打卡的格子描边突出
   ========================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.Utils;

  var WEEK_LABEL = ['日', '一', '二', '三', '四', '五', '六'];

  var lastRoot = null;
  var offChange = null;
  var offSaved = null;
  var resizeHandler = null;
  var drawTimer = null;

  /* =========================================================
     数据汇总
     ========================================================= */

  /** 逐日扫描，返回：学习天数、累计分钟、已打卡天数、打卡率、学习天数数组 */
  function scanLogs(days) {
    var logs = App.Store.state.logs || {};
    var sumMin = 0, studyDays = 0, checkDays = 0, arr = [];
    for (var i = days - 1; i >= 0; i--) {
      var key = U.addDays(U.today(), -i);
      var l = logs[key];
      var active = dayActive(l);
      if (active) {
        studyDays++;
        sumMin += Math.round((l && l.minutes) || 0);
      }
      if (l && l.checked) checkDays++;
      arr.push({ date: key, active: active, checked: !!(l && l.checked), minutes: (l && l.minutes) || 0 });
    }
    return { studyDays: studyDays, minutes: sumMin, checkDays: checkDays, arr: arr };
  }

  function daysSince(first) {
    var d = U.diffDays(first || U.today(), U.today());
    return d >= 0 ? d + 1 : 0;
  }

  /** 四统计卡 / 概览卡所需的汇总值（扫全部存档日志） */
  function overview() {
    var st = App.Store.state;
    var counts = App.Words ? App.Words.counts() : { total: 0, mastered: 0, starred: 0, custom: 0 };
    var logs = st.logs || {};

    var quizDone = 0, quizCorrect = 0, totalStudyDays = 0, totalMinutes = 0;
    for (var k in logs) {
      if (!Object.prototype.hasOwnProperty.call(logs, k)) continue;
      var l = logs[k];
      quizDone += l.quizDone || 0;
      quizCorrect += l.quizCorrect || 0;
      totalMinutes += Math.round(l.minutes || 0);
      if (dayActive(l)) totalStudyDays++;
    }

    var wrong = st.wrongbook || [];
    var due = wrong.filter(function (w) { return !w.nextReviewAt || U.diffDays(w.nextReviewAt, U.today()) <= 0; }).length;

    return {
      streak: App.Store.streak(),
      studyDays: totalStudyDays,
      minutes: totalMinutes,
      mastered: counts.mastered,
      total: counts.total,
      quizDone: quizDone,
      quizCorrect: quizCorrect,
      quizAcc: U.pct(quizCorrect, quizDone),
      wrong: wrong.length,
      wrongDue: due,
      days: daysSince(st.settings.firstDay)
    };
  }

  /** 某一天的日志是否有学习行为 */
  function dayActive(l) {
    if (!l) return false;
    return (l.wordsNew > 0 || l.wordsReviewed > 0 || l.quizDone > 0 ||
      l.listenDone > 0 || l.writingDone > 0 || !!l.checked);
  }

  /* =========================================================
     主题色（canvas 读取 CSS 变量，深浅主题自动适配）
     ========================================================= */
  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v && v.trim()) || fallback;
    } catch (e) { return fallback; }
  }

  function themeColors() {
    return {
      text: cssVar('--text'),
      text2: cssVar('--text-2'),
      text3: cssVar('--text-3'),
      border: cssVar('--border-strong', 'rgba(0,0,0,.15)'),
      sunken: cssVar('--surface-sunken', '#F1F3FA'),
      brand1: '#4F46E5', brand2: '#6366F1', brand3: '#22D3EE',
      grad: function (ctx, x, y, w, h) {
        var g = ctx.createLinearGradient(x, y, x + w, y + h);
        g.addColorStop(0, '#4F46E5');
        g.addColorStop(1, '#22D3EE');
        return g;
      }
    };
  }

  /** 画布初始化：按设备像素比放大 + 逻辑坐标绘制 */
  function setupCanvas(canvas, cssW, cssH) {
    var dpr = (global.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(cssW * dpr));
    var h = Math.max(1, Math.round(cssH * dpr));
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: cssW, h: cssH };
  }

  /** 画圆角矩形路径（兼容不支持 ctx.roundRect 的老版本 WebView） */
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /* ---------------- 打卡热力图：近 12 个自然周，每列为一周（周日~周六） ----------------
     画布宽度 = 周标签 + 12 列格子，由 .chart-box 横向居中；月份标注精确出现在换月的那一格顶部 */
  function drawHeatmap(canvas) {
    var C = themeColors();
    var today = U.today();
    var logs = App.Store.state.logs || {};
    var cell = 13, gap = 4;
    var rows = 7, cols = 12;
    var padL = 20, padT = 20;
    var gridW = cols * (cell + gap);
    var gridH = rows * (cell + gap);
    var s = setupCanvas(canvas, padL + gridW, padT + gridH);
    var ctx = s.ctx;
    ctx.clearRect(0, 0, s.w, s.h);

    // 对齐自然周：以「最近一个周日」为终点，往前推 11 周，共 12 周
    var weekStart = U.addDays(today, -U.weekdayOf(today));
    var start = U.addDays(weekStart, -(cols - 1) * 7);
    var total = cols * rows;

    // 左侧星期行标（周日=顶行）
    ctx.font = '9px sans-serif';
    ctx.fillStyle = C.text3;
    ctx.textAlign = 'right';
    for (var r = 0; r < rows; r++) {
      ctx.fillText(WEEK_LABEL[r], padL - 6, padT + r * (cell + gap) + cell / 2 + 3);
    }

    // 月份标注 + 格子绘制（一次遍历；跳过晚于今天的格子）
    var lastM = null;
    for (var i = 0; i < total; i++) {
      var key = U.addDays(start, i);
      if (U.diffDays(key, today) > 0) continue; // 本周尚未到来的日子
      var col = Math.floor(i / rows), row = i % rows;
      var x = padL + col * (cell + gap), y = padT + row * (cell + gap);

      var m = key.slice(5, 7);
      if (m !== lastM) {
        lastM = m;
        ctx.textAlign = 'center';
        ctx.fillStyle = C.text3;
        ctx.fillText(Number(m) + '月', x + cell / 2, 11);
      }

      var l = logs[key];
      var act = dayActive(l);
      var minutes = (l && l.minutes) || 0;
      ctx.globalAlpha = act ? (minutes < 25 ? 0.5 : (minutes < 50 ? 0.75 : 1)) : 0.14;
      ctx.fillStyle = '#4F46E5';
      ctx.beginPath();
      roundRectPath(ctx, x, y, cell, cell, 3.5);
      ctx.fill();
      if (l && l.checked) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(255,255,255,.95)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- 掌握率折线（近 30 天）+ 今天最后一天作为今日点 ---------------- */
  function drawCurve(canvas, pts) {
    var C = themeColors();
    var padL = 26, padR = 8, padT = 10, padB = 20;
    var cssW = Math.max(180, Math.round(canvas.parentNode.clientWidth || 300));
    var cssH = 172;
    var s = setupCanvas(canvas, cssW, cssH);
    var ctx = s.ctx;
    var iw = cssW - padL - padR, ih = cssH - padT - padB;
    ctx.clearRect(0, 0, s.w, s.h);

    var maxV = 1;
    var lastV = 0;
    for (var i = 0; i < pts.length; i++) { maxV = Math.max(maxV, pts[i].v); lastV = pts[i].v; }
    if (pts.length) {
      // 让曲线有呼吸空间
      var ref = maxV > 0 ? maxV : 1;
      maxV = ref * 1.12;
    }

    function px(i) { return padL + (pts.length === 1 ? iw : (iw * i / (pts.length - 1))); }
    function py(v) { return padT + ih - (ih * (v / maxV)); }

    // 横向参考线 + 日期刻度
    ctx.font = '10px sans-serif';
    ctx.fillStyle = C.text3;
    ctx.textAlign = 'left';
    for (var gi = 0; gi <= 4; gi++) {
      var y = padT + ih * gi / 4;
      ctx.strokeStyle = C.sunken;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + iw, y);
      ctx.stroke();
      var label = Math.round(maxV * (1 - gi / 4));
      ctx.fillText(String(label), 0, y + 3);
    }

    if (pts.length > 1) {
      // 每个 ~6 个点标注一次日期
      ctx.textAlign = 'center';
      var stepDay = Math.ceil(pts.length / 5);
      for (var di = 0; di < pts.length; di++) {
        if (di === pts.length - 1 || di % stepDay === 0) {
          var dstr = String(pts[di].date).slice(5).replace('-', '/');
          ctx.fillText(dstr, px(di), cssH - 7);
        }
      }
    }

    // 面积渐变
    var grad = C.grad(ctx, 0, padT, 0, cssH - padB);
    var line = C.grad(ctx, padL, padT, padL + iw, padT);

    if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(px(0), py(pts[0].v));
      for (var p = 1; p < pts.length; p++) ctx.lineTo(px(p), py(pts[p].v));
      ctx.lineTo(px(pts.length - 1), py(pts[pts.length - 1].v));
      ctx.lineTo(px(pts.length - 1), padT + ih);
      ctx.lineTo(px(0), padT + ih);
      ctx.closePath();
      var ag = ctx.createLinearGradient(0, padT, 0, padT + ih);
      ag.addColorStop(0, 'rgba(99,102,241,.28)');
      ag.addColorStop(1, 'rgba(99,102,241,.02)');
      ctx.fillStyle = ag;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(px(0), py(pts[0].v));
      for (var p2 = 1; p2 < pts.length; p2++) ctx.lineTo(px(p2), py(pts[p2].v));
      ctx.strokeStyle = line;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // 端点：首末点
    function dot(i) {
      ctx.fillStyle = '#4F46E5';
      ctx.beginPath();
      ctx.arc(px(i), py(pts[i].v), 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(px(i), py(pts[i].v), 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (pts.length) dot(0);
    if (pts.length > 1) dot(pts.length - 1);

    ctx.fillStyle = C.text2;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('累计掌握 ' + Math.round(lastV), cssW - padR, padT + 9);
  }

  /* ---------------- 模块正确率：每模块一行进度条（三个指标相互独立，不叠加成环避免误读） ---------------- */
  function drawDonut(canvas, items) {
    var C = themeColors();
    var cssW = Math.max(180, Math.round(canvas.parentNode.clientWidth || 300));
    var rowH = 42;
    var cssH = Math.max(110, items.length * rowH + 14);
    var s = setupCanvas(canvas, cssW, cssH);
    var ctx = s.ctx;
    ctx.clearRect(0, 0, s.w, s.h);
    if (!items.length) return;

    var padL = 2, nameX = padL;
    var nameW = 76;             // 名称区（固定，保证进度条对齐）
    var valW = 44;              // 数值区
    var barX = nameX + nameW;
    var barW = Math.max(40, cssW - barX - valW - padL);
    var barH = 12;
    var barY0 = 8;

    ctx.font = '12px sans-serif';

    items.forEach(function (it, i) {
      var rowTop = barY0 + i * rowH;
      var barY = rowTop + (rowH - barH) / 2;

      // 名称
      ctx.textAlign = 'left';
      ctx.fillStyle = C.text2;
      ctx.fillText(it.name, nameX, barY + barH / 2 + 4);

      // 数值（右侧对齐）
      ctx.textAlign = 'right';
      ctx.fillStyle = C.text;
      ctx.font = '600 12px sans-serif';
      ctx.fillText(String(it.label || '—'), cssW - padL, barY + barH / 2 + 4);
      ctx.font = '12px sans-serif';

      // 进度条底
      roundRectPath(ctx, barX, barY, barW, barH, barH / 2);
      ctx.fillStyle = C.sunken;
      ctx.fill();

      // 进度填充
      var frac = Math.max(0, Math.min(1, (it.pct || 0) / 100));
      if (frac > 0) {
        ctx.fillStyle = it.color;
        ctx.beginPath();
        roundRectPath(ctx, barX, barY, Math.max(barH, Math.round(barW * frac)), barH, barH / 2);
        ctx.fill();
        // 末端小光点，让进度更醒目
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.beginPath();
        ctx.arc(barX + Math.max(barH / 2, Math.round(barW * frac) - barH / 2), barY + barH / 2, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  /* =========================================================
     数据拼装 + 渲染
     ========================================================= */

  function render(root) {
    lastRoot = root;
    U.clear(root);
    var st = App.Store.state.settings;

    root.appendChild(U.el('div.page-head', null, [
      U.el('div.page-title', { text: '我的' }),
      U.el('span.spacer'),
      U.el('button.icon-btn', {
        type: 'button', 'aria-label': '切换主题',
        onclick: function () {
          var next = App.Store.state.settings.theme === 'dark' ? 'light' : 'dark';
          App.Store.setSetting('theme', next);
          App.applyTheme(next);
          render(root);
        }
      }, [U.icon(App.Store.state.settings.theme === 'dark' ? 'sun' : 'moon')])
    ]));

    var o = overview();
    root.appendChild(buildHero(o));
    root.appendChild(buildStatGrid(o));

    // 图表区（CSS 在 ≥900px 时自动变两列，resize 无需重建 DOM）
    var chartWrap = U.el('div.chart-grid', null, [
      heatCard(),
      curveCard(),
      donutCard()
    ]);
    root.appendChild(chartWrap);

    root.appendChild(buildSettings());

    drawAll();
  }

  /* ---------------- 概览卡 ---------------- */
  function buildHero(o) {
    var today = U.today();
    var first = U.addDays(today, -6);
    var week = [];
    for (var i = 0; i < 7; i++) {
      var key = U.addDays(first, i);
      var l = App.Store.state.logs[key];
      var has = !!(l && l.checked);
      week.push({ key: key, has: has });
    }

    var dots = U.el('div.week-dots', null, week.map(function (d) {
      // 已打卡圆点打勾，未打卡显示当天的「几号」
      return U.el('div.week-dot' + (d.has ? '.is-on' : ''), {
        title: d.key
      }, [d.has ? '✓' : String(Number(d.key.slice(8)))]);
    }));

    var todayLog = App.Store.state.logs[today] || {};
    return U.el('div.me-hero', null, [
      U.el('div.me-hero-main', null, [
        U.el('div.me-hero-cap', { text: '连续打卡' }),
        U.el('div.me-hero-num', { id: 'me-hero-num', text: '0' }),
        U.el('div.me-hero-label', {
          text: '自 ' + (App.Store.state.settings.firstDay || today) + ' 开始 · 今天' + (todayLog.checked ? '已打卡' : '还没打卡')
        }),
        dots
      ])
    ]);
  }

  function statCard(id, label, num, suffix) {
    var isNum = typeof num === 'number';
    return U.el('div.stat-card', null, [
      U.el('div.stat-num', null, [
        U.el('span', { id: id, text: isNum ? '0' : String(num === undefined || num === null ? '' : num) }),
        suffix ? U.el('small', { text: suffix }) : null
      ]),
      U.el('div.stat-label', { text: label })
    ]);
  }

  function buildStatGrid(o) {
    return U.el('div.stat-grid', null, [
      statCard('st-streak', '连续打卡', o.streak, ' 天'),
      statCard('st-days', '累计学习', o.studyDays, ' 天'),
      statCard('st-mastered', '掌握单词', o.mastered, o.total ? ' / ' + o.total : ''),
      statCard('st-acc', '真题正确率', o.quizDone ? o.quizAcc : '—', o.quizDone ? '%' : '')
    ]);
  }

  /* ---------------- 三个图表卡 ---------------- */
  function heatCard() {
    var canvas = U.el('canvas');
    return U.el('div.chart-card', null, [
      U.el('div.chart-title', null, [U.icon('fire'), '打卡热力图（近 12 周）',
        U.el('span.spacer'),
        U.el('span.field-hint', { style: { margin: 0 }, text: '点亮=有学习，加圈=已打卡' })]),
      U.el('div.chart-sub', { text: '每天用一点点时间，坚持比爆发更重要。' }),
      U.el('div.chart-box', { id: 'chart-heat' }, [canvas])
    ]);
  }

  function curveCard() {
    var canvas = U.el('canvas');
    return U.el('div.chart-card', null, [
      U.el('div.chart-title', null, [U.icon('chart'), '掌握率曲线（近 30 天）']),
      U.el('div.chart-sub', { text: '每天记录一次累计掌握的词数，见证成长。' }),
      U.el('div.chart-box', { id: 'chart-curve' }, [canvas])
    ]);
  }

  function donutCard() {
    var canvas = U.el('canvas');
    return U.el('div.chart-card', null, [
      U.el('div.chart-title', null, [U.icon('target'), '模块正确率']),
      U.el('div.chart-sub', { text: '用每个模块自己的方式衡量，坚持练习稳步提升。' }),
      U.el('div.chart-box', { id: 'chart-donut' }, [canvas])
    ]);
  }

  /* ---------------- 设置 ---------------- */
  function buildSettings() {
    var st = App.Store.state.settings;
    var wrap = U.el('div');
    var wrongDue = overview().wrongDue;
    var o2 = overview();

    // 学习计划组
    wrap.appendChild(U.el('div.group-title', null, ['学习计划']));
    wrap.appendChild(U.el('div.set-group', null, [
      setRow('target', '考试', U.escapeHtml(st.examName || '大学英语四级') + ' · ' + st.examDate, function () { pickExam(); }),
      setRow('chart', '每日目标', planSummary(), function () { App.openPlanEditor(); }),
      setRow('book', '词书偏好', '当前练习：' + wordBookLabel(st.wordBook), function () { pickWordBook(); }),
      setRow('compass', '学习教练', coachSummary(), function () { App.Router.go('#/coach'); })
    ]));

    // 主题与 AI
    wrap.appendChild(U.el('div.group-title', null, ['外观与 AI']));
    wrap.appendChild(U.el('div.set-group', null, [
      setRow('sun', '外观主题', App.Store.state.settings.theme === 'dark' ? '深色模式' : '浅色模式', function () {
        var next = App.Store.state.settings.theme === 'dark' ? 'light' : 'dark';
        App.Store.setSetting('theme', next);
        App.applyTheme(next);
        U.toast(next === 'dark' ? '已切换到深色模式' : '已切换到浅色模式', 'ok');
        if (lastRoot) render(lastRoot);
      }),
      soundRow(),
      setRow('sparkle', 'AI 学习助教', App.AI && App.AI.isEnabled() ? '能查数据、能改设置、能出题 · 点击对话' : '对话式学习助手 · 需先配置密钥', function () { App.Router.go('#/agent'); }),
      setRow('settings', 'AI 接口配置', aiSummary(), function () { openAIConfig(); })
    ]));

    // 听力与朗读
    wrap.appendChild(U.el('div.group-title', null, ['听力与朗读']));
    wrap.appendChild(U.el('div.set-group', null, [
      setRow('headset', '听力精听', '逐句朗读 + 听写对照 · 点击进入', function () { App.Router.go('#/listen'); }),
      setRow('volume', '朗读语音与语速', ttsSummary(), function () { openTtsConfig(); })
    ]));

    // 词库与题库
    wrap.appendChild(U.el('div.group-title', null, ['词库与题库']));
    wrap.appendChild(U.el('div.set-group', null, [
      setRow('upload', '导入词库（CSV / JSON）', '从模板文件或自行整理的数据扩充词库', function () { openWordImport(); }),
      setRow('book', '录入真题', '把购买到的真题按模板粘贴进系统自动判分', function () { App.Router.go('#/quiz'); }),
      setRow('check', '已掌握的词', o2.mastered + ' 个 · 点击管理', function () { openMasteredSheet(); }),
      setRow('fire', '错题本', (o2.wrongDue ? '有 ' + o2.wrongDue + ' 题待复习' : '错题本空空如也') + ' · 点击进入', function () { App.Router.go('#/wrongbook'); })
    ]));

    // 数据
    wrap.appendChild(U.el('div.group-title', null, ['数据']));
    wrap.appendChild(U.el('div.set-group', null, [
      setRow('download', '导出备份', '全部进度 / 自建内容存成 JSON；不含 AI 密钥', function () { doExport(); }),
      setRow('upload', '导入备份', '恢复之前导出的存档，导入前会自动备份当前数据', function () { doImport(); }),
      setRow('trash', '清空所有数据', '重置为初始状态，操作前会二次确认', function () { doReset(); }, true)
    ]));

    wrap.appendChild(U.el('div.save-tip', null, [
      U.el('span.dot'),
      U.el('span', { text: '数据自动保存在本机浏览器（localStorage），不会上传任何服务器' })
    ]));

    return wrap;
  }

  function setRow(iconName, title, sub, onClick, danger) {
    var row = U.el('button.set-row', { type: 'button' }, [
      U.el('span.set-icon', null, [U.icon(iconName)]),
      U.el('span.set-main', null, [
        U.el('span.set-title', { html: danger ? '<span style="color:var(--danger)">' + U.escapeHtml(title) + '</span>' : U.escapeHtml(title) }),
        U.el('span.set-sub', { html: U.escapeHtml(sub) })
      ]),
      U.el('span.row-tail', null, [U.icon('right')])
    ]);
    if (onClick) row.addEventListener('click', function () {
      U.vibrate(6);
      onClick();
    });
    return row;
  }

  function soundRow() {
    var on = App.Store.state.settings.sound !== false;
    var sw = U.el('div.switch' + (on ? '.is-on' : ''));
    var row = U.el('button.set-row', {
      type: 'button',
      onclick: function () {
        var next = !(App.Store.state.settings.sound !== false);
        App.Store.setSetting('sound', next);
        U.vibrate(6);
        if (next) U.playTone('right');   // 开启时试听一声
        U.toast(next ? '音效已开启' : '音效已关闭', next ? 'ok' : 'err');
        if (lastRoot) render(lastRoot);
      }
    }, [
      U.el('span.set-icon', null, [U.icon('volume')]),
      U.el('span.set-main', null, [
        U.el('span.set-title', { text: '答题音效' }),
        U.el('span.set-sub', { text: on ? '答对 / 答错时播放提示音' : '已关闭' })
      ]),
      U.el('span.row-tail', null, [sw])
    ]);
    return row;
  }

  /** 每日目标概要（用于设置项副标题） */
  function planSummary() {
    var s = App.Store.state.settings;
    var parts = [];
    var nw = parseInt(s.dailyNewWords, 10) || 0;
    var qz = parseInt(s.dailyQuiz, 10) || 0;
    var wr = parseInt(s.dailyWriting, 10) || 0;
    if (nw > 0) parts.push('新学 ' + nw + ' 词');
    if (qz > 0) parts.push('阅读 ' + qz + ' 篇');
    if (wr > 0) parts.push('素材 ' + wr + ' 条');
    var ls = parseInt(s.dailyListen, 10) || 0;
    if (ls > 0) parts.push('精听 ' + ls + ' 段');
    if (!parts.length) return '今天没设任务目标 · 点击去填';
    return parts.join(' · ') + ' · 点击修改';
  }

  /** 学习教练概要 */
  function coachSummary() {
    if (!App.Coach) return '按数据定计划 · 定期复盘';
    var p = App.Coach.plan();
    if (!p) {
      return (App.Coach.aiReady() ? '让 AI 按考试日期排计划' : '还没配 AI，可先用本地模板') + ' · 点击进入';
    }
    var pr = App.Coach.planProgress();
    var due = App.Coach.dueReport();
    var parts = ['第 ' + (pr ? pr.day : 1) + '/' + p.horizonDays + ' 天'];
    if (pr && pr.phase) parts.push('「' + pr.phase.name + '」');
    parts.push(due.due ? (due.never ? '还没复盘过' : '该复盘了') : '计划中');
    return parts.join(' · ') + ' · 点击进入';
  }

  /** 朗读设置概要 */
  function ttsSummary() {
    if (!App.TTS || !App.TTS.supported()) return '当前浏览器不支持语音合成';
    var s = App.Store.state.settings;
    var v = App.TTS.pickVoice(s.ttsVoice);
    var rate = Number(s.ttsRate) || 0.9;
    return (v ? v.name : '自动选择语音') + ' · 语速 ' + rate + '×';
  }

  /** 语音与语速设置 */
  function openTtsConfig() {
    if (!App.TTS || !App.TTS.supported()) {
      U.toast('当前浏览器不支持语音合成', 'err');
      return;
    }
    var current = App.Store.state.settings.ttsVoice || '';
    var rate = Number(App.Store.state.settings.ttsRate) || 0.9;
    var body = U.el('div');
    var listWrap = U.el('div');

    function paintVoices() {
      U.clear(listWrap);
      var vs = App.TTS.voices();
      if (!vs.length) {
        listWrap.appendChild(U.el('div.field-hint', { text: '系统里没有找到英文语音。Windows 可在「设置 → 时间和语言 → 语音」里添加英语语音包。' }));
        return;
      }
      var rows = [{ name: '', label: '自动（推荐英文语音）' }].concat(vs.map(function (v) {
        return { name: v.name, label: v.name + ' · ' + v.lang };
      }));
      rows.forEach(function (r) {
        var on = (r.name || '') === (App.Store.state.settings.ttsVoice || '');
        listWrap.appendChild(U.el('div.set-row', {
          style: { padding: '10px 0', cursor: 'pointer' },
          onclick: function () {
            App.Store.commit(function (s) { s.settings.ttsVoice = r.name; });
            App.Store.flush();
            paintVoices();
            U.toast('已切换语音', 'ok');
          }
        }, [
          U.el('span.set-icon', null, [U.icon(on ? 'check' : 'volume')]),
          U.el('span.set-main', null, [U.el('span.set-title', { text: r.label })]),
          U.el('span.row-tail', null, [U.el('button.btn.btn-ghost.btn-sm', {
            type: 'button',
            onclick: function (ev) {
              ev.stopPropagation();
              App.TTS.speak('Vocabulary is the foundation of reading comprehension.', {
                voiceName: r.name || undefined,
                rate: Number(App.Store.state.settings.ttsRate) || 0.9
              });
            }
          }, ['试听'])])
        ]));
      });
    }

    var rateWrap = U.el('div.chips');
    [0.6, 0.75, 0.9, 1, 1.25].forEach(function (r) {
      rateWrap.appendChild(U.el('button.chip' + (Math.abs(r - rate) < 0.001 ? '.is-on' : ''), {
        type: 'button',
        onclick: function () {
          App.Store.commit(function (s) { s.settings.ttsRate = r; });
          App.Store.flush();
          U.$$('.chip', rateWrap).forEach(function (b) { b.classList.remove('is-on'); });
          this.classList.add('is-on');
          App.TTS.speak('This is the reading speed you will hear.', { rate: r });
        }
      }, [r + '×']));
    });

    body.appendChild(U.el('div.field-hint', {
      style: { marginBottom: '10px', lineHeight: 1.7 },
      text: '听力和单词朗读都使用这里的语音。语速建议精听用 0.75~0.9，泛听用 1.0。'
    }));
    body.appendChild(U.el('div.field-label', { text: '语速' }));
    body.appendChild(rateWrap);
    body.appendChild(U.el('div.field-label', { style: { marginTop: '16px' }, text: '语音' }));
    body.appendChild(listWrap);

    U.openSheet({ title: '朗读语音与语速', body: body, foot: [] });
    paintVoices();
    App.TTS.ready(1200).then(function () { if (listWrap.parentNode) paintVoices(); });
  }

  function wordBookLabel(k) {
    return k === 'cet6' ? '六级高频' : (k === 'all' ? '全部词书' : '四级核心');
  }

  /* =========================================================
     数据绘制
     ========================================================= */
  function drawAll() {
    if (drawTimer) clearTimeout(drawTimer);
    drawTimer = setTimeout(function () { drawAllNow(); }, 30);
  }

  function drawAllNow() {
    var o = overview();
    // 概览卡数字滚动
    countUpIf('#me-hero-num', o.streak);
    countUpIf('#st-streak', o.streak);
    countUpIf('#st-days', o.studyDays);
    countUpIf('#st-mastered', o.mastered);
    var acc = o.quizDone ? o.quizAcc : -1;
    var accNode = U.$('#st-acc');
    if (accNode && acc >= 0) countUpIf('#st-acc', acc);

    // 热力图：近 12 周（自然周对齐，内部按今天定位列）
    var heatCanvas = U.$('#chart-heat canvas');
    if (heatCanvas) {
      try { drawHeatmap(heatCanvas); } catch (e) { console.warn('[Me] 热力图绘制失败', e); }
    }

    // 掌握率曲线：近 30 天
    var curveCanvas = U.$('#chart-curve canvas');
    if (curveCanvas) {
      var pts = [];
      var mastery = App.Store.state.mastery || {};
      var lastV = 0;
      var today = U.today();
      for (var i = 29; i >= 0; i--) {
        var key = U.addDays(today, -i);
        if (mastery[key] !== undefined) lastV = mastery[key];
        pts.push({ date: key, v: lastV });
      }
      try { drawCurve(curveCanvas, pts); } catch (e) { console.warn('[Me] 折线绘制失败', e); }
    }

    // 模块正确率环形
    var donutCanvas = U.$('#chart-donut canvas');
    if (donutCanvas) {
      try { drawDonut(donutCanvas, moduleRings()); } catch (e) { console.warn('[Me] 环形图绘制失败', e); }
    }
  }

  function countUpIf(sel, to) {
    var node = U.$(sel);
    if (node) U.countUp(node, Math.max(0, Math.round(to)));
  }

  /** 三个环形数据源（无数据时用 '—' 占位） */
  function moduleRings() {
    var o = overview();
    var counts = App.Words ? App.Words.counts() : { total: 0, mastered: 0 };
    var colors = ['#4F46E5', '#22D3EE', '#10B981'];
    var items = [];

    if (o.total > 0) {
      items.push({ name: '掌握率', pct: U.pct(counts.mastered, o.total), label: Math.round(U.pct(counts.mastered, o.total)) + '%', color: colors[0] });
    } else {
      items.push({ name: '掌握率', pct: 0, label: '—', color: colors[0] });
    }

    if (o.quizDone > 0) {
      items.push({ name: '真题正确率', pct: o.quizAcc, label: o.quizAcc + '%', color: colors[1] });
    } else {
      items.push({ name: '真题正确率', pct: 0, label: '—', color: colors[1] });
    }

    var checkDays = scanLogs(7).checkDays;
    items.push({ name: '本周打卡率', pct: Math.round(checkDays / 7 * 100), label: checkDays + '/' + 7, color: colors[2] });

    return items;
  }

  /* =========================================================
     设置操作
     ========================================================= */

  /** 考试日期 / 名称 */
  function pickExam() {
    var st = App.Store.state.settings;
    var draft = { examName: st.examName || '大学英语四级', examDate: st.examDate || U.today() };

    var nameInput = U.el('input.input', { type: 'text', value: draft.examName, placeholder: '如：大学英语四级' });
    var dateInput = U.el('input.input', { type: 'date', value: draft.examDate });

    var hint = U.el('div.field-hint', { text: '倒计时会在「今日」页首屏显示，日期建议填考试当天（可随时修改）。' });

    U.openSheet({
      title: '考试信息',
      body: [
        U.el('div.field', null, [
          U.el('label.field-label', { text: '考试名称' }),
          nameInput
        ]),
        U.el('div.field', null, [
          U.el('label.field-label', { text: '考试日期' }),
          dateInput
        ]),
        hint
      ],
      foot: [
        U.el('button.btn.btn-ghost', { type: 'button', onclick: U.closeSheet }, ['取消']),
        U.el('button.btn.btn-primary', {
          type: 'button',
          onclick: function () {
            var name = nameInput.value.trim() || '大学英语四级';
            var date = dateInput.value || U.today();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { U.toast('请选择有效的考试日期', 'err'); return; }
            App.Store.commit(function (s) { s.settings.examName = name; s.settings.examDate = date; });
            App.Store.flush();
            U.closeSheet();
            U.toast('已保存考试信息', 'ok');
            if (lastRoot) render(lastRoot);
          }
        }, ['保存'])
      ]
    });
  }

  /** 词书偏好（作用于单词 Tab 默认筛选的 level） */
  function pickWordBook() {
    var draft = App.Store.state.settings.wordBook || 'cet4';
    var body = U.el('div');
    var opts = [
      { k: 'cet4', label: '四级核心', sub: '最贴近 2026 年 12 月四级首考目标' },
      { k: 'cet6', label: '六级高频', sub: '学有余力，冲刺六级词汇' },
      { k: 'all', label: '全部词书', sub: '四级 + 六级 + 短语全部混排' }
    ];

    function rebuild() {
      U.clear(body);
      opts.forEach(function (op) {
        var row = U.el('button.set-row', {
          type: 'button',
          onclick: function () {
            draft = op.k;
            rebuild();
          }
        }, [
          U.el('span.set-icon', null, [U.icon(op.k === 'cet4' ? 'book' : (op.k === 'cet6' ? 'book' : 'cards'))]),
          U.el('span.set-main', null, [
            U.el('span.set-title', { text: op.label }),
            U.el('span.set-sub', { text: op.sub })
          ]),
          U.el('span.row-tail', null, [
            draft === op.k ? U.el('span.badge.badge-ok', { text: '当前' }) : U.icon('right')
          ])
        ]);
        body.appendChild(row);
      });
    }
    rebuild();

    U.openSheet({
      title: '词书偏好',
      body: body,
      foot: [
        U.el('button.btn.btn-ghost', { type: 'button', onclick: U.closeSheet }, ['取消']),
        U.el('button.btn.btn-primary', {
          type: 'button',
          onclick: function () {
            App.Store.commit(function (s) { s.settings.wordBook = draft; });
            App.Store.flush();
            U.closeSheet();
            U.toast('已设置默认词书：' + wordBookLabel(draft), 'ok');
          }
        }, ['确定'])
      ]
    });
  }

  /** AI 配置 */
  function aiSummary() {
    if (!App.AI || !App.AI.isEnabled()) return '未配置 · 其他功能不受影响';
    var mask = App.AI.maskedKey();
    var model = (App.AI.config().model || '').trim() || '默认模型';
    return '已启用 · ' + model + ' · ' + mask;
  }

  function openAIConfig() {
    var cfg = (App.Store.state.settings.ai || {});
    var baseUrl = U.el('input.input', { type: 'url', value: cfg.baseUrl || '', placeholder: 'https://api.openai.com' });
    var apiKey = U.el('input.input', { type: 'password', value: cfg.apiKey || '', placeholder: 'sk-...（仅存本机）', autocomplete: 'off' });
    var model = U.el('input.input', { type: 'text', value: cfg.model || '', placeholder: '留空使用默认，如 gpt-3.5-turbo' });
    var result = U.el('div.ai-out', { style: { marginTop: '12px' } });

    var body = U.el('div', null, [
      U.el('div.field-hint', { style: { marginBottom: '12px', lineHeight: 1.6 }, html:
        '<b>可选功能，不填也能用全部学习功能。</b>AI 用于：作文批改 / 生成例句 / 长难句解析。<br>密钥仅保存在本机浏览器；前端直连会把密钥发给 API 服务商，仅供个人自用，勿在公共设备填写。' }),
      U.el('div.field', null, [
        U.el('label.field-label', { text: '接口地址（OpenAI 兼容）' }),
        baseUrl
      ]),
      U.el('div.field', null, [
        U.el('label.field-label', { text: 'API Key' }),
        apiKey
      ]),
      U.el('div.field', null, [
        U.el('label.field-label', { text: '模型名称（可选）' }),
        model
      ]),
      result
    ]);

    function msg(text, isErr) {
      U.clear(result);
      if (text) result.appendChild(U.el('div', { style: { color: isErr ? 'var(--danger)' : 'var(--ok)' }, text: text }));
    }

    U.openSheet({
      title: 'AI 配置',
      body: body,
      foot: [
        U.el('button.btn', {
          type: 'button',
          onclick: function () {
            var ok = baseUrl.value.trim() && apiKey.value.trim();
            if (!ok) { msg('请填写接口地址与 Key 才能测试', true); return; }
            // 先保存再测试
            App.Store.commit(function (s) {
              s.settings.ai.baseUrl = baseUrl.value.trim();
              s.settings.ai.apiKey = apiKey.value.trim();
              s.settings.ai.model = model.value.trim();
            });
            App.Store.flush();
            msg('正在测试连接…');
            App.AI.chat([{ role: 'user', content: '你好，请只回复两个字：收到' }], { temperature: 0 })
              .then(function (r) {
                if (r.ok) msg('连接成功！回复：' + r.text.slice(0, 60));
                else msg(r.error || '连接失败', true);
              });
          }
        }, ['测试连接']),
        U.el('button.btn.btn-ghost', { type: 'button', onclick: U.closeSheet }, ['取消']),
        U.el('button.btn.btn-primary', {
          type: 'button',
          onclick: function () {
            App.Store.commit(function (s) {
              s.settings.ai.baseUrl = baseUrl.value.trim();
              s.settings.ai.apiKey = apiKey.value.trim();
              s.settings.ai.model = model.value.trim();
            });
            App.Store.flush();
            U.closeSheet();
            U.toast(App.AI.isEnabled() ? 'AI 已启用' : '已清空 AI 配置', 'ok');
            if (lastRoot) render(lastRoot);
          }
        }, ['保存'])
      ]
    });
  }

  /** 导入词库 */
  function openWordImport() {
    var ta = U.el('textarea.textarea', {
      style: { minHeight: '130px', fontFamily: 'monospace', fontSize: '13px' },
      placeholder: '把 CSV 文本粘贴到这里…\n表头示例：\nword,phonetic,pos,meaning,example,exampleCn,level,freq,stage,posTag\n'
    });
    var report = U.el('div', { style: { marginTop: '8px' } });

    function show(r, errs) {
      U.clear(report);
      if (!r.added && !r.skipped && (!errs || !errs.length)) return;
      report.appendChild(U.el('div.field-hint', {
        html: '<span style="color:var(--ok);font-weight:700">成功导入 ' + r.added + ' 个</span>；重复跳过 ' + r.skipped + ' 个' +
          (errs && errs.length ? '；<span style="color:var(--danger)">' + errs.length + ' 行异常</span>' : '')
      }));
      if (errs && errs.length) {
        var box = U.el('div', { style: { marginTop: '6px', maxHeight: '150px', overflowY: 'auto', fontSize: '12px', lineHeight: 1.8, color: 'var(--danger-soft)' } });
        errs.slice(0, 50).forEach(function (e) {
          box.appendChild(U.el('div', { text: '· ' + e }));
        });
        if (errs.length > 50) box.appendChild(U.el('div', { text: '…… 共 ' + errs.length + ' 条' }));
        report.appendChild(box);
      }
    }

    U.openSheet({
      title: '导入词库',
      body: [
        U.el('div.field-hint', { text: '支持 CSV 或 JSON。模板文件在 docs/templates/words-template.csv，也可以从 Excel 另存为 CSV 后用记事本打开复制粘贴。' }),
        ta,
        report
      ],
      foot: [
        U.el('button.btn.btn-ghost', { type: 'button', onclick: U.closeSheet }, ['关闭']),
        U.el('button.btn.btn-primary', {
          type: 'button',
          onclick: function () {
            var v = ta.value.trim();
            if (!v) { U.toast('请先粘贴内容', 'err'); return; }
            var p = App.Importer.parseWords(v);
            if (p.errors && p.errors.length && !p.list.length) {
              show({ added: 0, skipped: 0 }, p.errors);
              return;
            }
            var r = App.Importer.applyWords(p.list);
            show(r, p.errors || []);
            if (r.added) {
              U.toast('成功导入 ' + r.added + ' 个词', 'ok');
              if (App.Words) App.Words.rebuild();
              setTimeout(function () { if (lastRoot) render(lastRoot); }, 400);
            } else {
              U.toast('没有新词需要导入', 'ok');
            }
          }
        }, ['导入'])
      ]
    });
  }

  /** 导出备份 */
  function doExport() {
    try {
      var stamp = U.today();
      var json = App.Store.exportJSON();
      U.downloadFile('cet4-6-backup-' + stamp + '.json', json, 'application/json');
      U.toast('备份已导出，请妥善保存', 'ok');
    } catch (e) {
      U.toast('导出失败：' + e.message, 'err');
    }
  }

  /** 导入备份 */
  function doImport() {
    U.pickFile('.json,application/json', function (f) {
      U.readText(f).then(function (text) {
        var res = App.Store.importJSON(text);
        U.toast(res.message, res.ok ? 'ok' : 'err');
        if (res.ok) {
          App.Words.rebuild();
          App.applyTheme(App.Store.state.settings.theme);
          if (lastRoot) render(lastRoot);
        }
      }).catch(function (e) {
        U.toast('读取文件失败：' + e.message, 'err');
      });
    });
  }

  /** 清空数据 */
  function doReset() {
    U.confirm({
      title: '清空所有数据',
      message: '将删除全部学习进度、错题本、自建素材与设置，恢复到初始状态。此操作不可撤销，建议先「导出备份」。确定继续吗？',
      okText: '清空', danger: true
    }).then(function (yes) {
      if (!yes) return;
      App.Store.reset();
      App.Words.rebuild();
      App.Picker.invalidate();
      App.applyTheme(App.Store.state.settings.theme);
      U.toast('已清空全部数据', 'ok');
      if (lastRoot) render(lastRoot);
    });
  }

  /* ---------------- 已掌握词管理（复用 Picker 数据源） ---------------- */
  function openMasteredSheet() {
    var list = App.Picker.masteredWords();

    function build() {
      var body = U.el('div');
      if (!list.length) {
        body.appendChild(U.el('div.empty', null, [
          U.icon('check'),
          U.el('div.empty-title', { text: '还没有标记为掌握的词' }),
          U.el('div.empty-desc', { text: '在单词卡右上角点击对勾即可标记，这里可以批量取消' })
        ]));
        return body;
      }
      body.appendChild(U.el('div.field-hint', {
        style: { marginBottom: '12px' },
        text: '共 ' + list.length + ' 个。已掌握的词默认不参与抽题，取消标记后会重新回到练习池。'
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
              if (lastRoot) render(lastRoot);
            });
          }
        }, ['取消全部掌握'])
      ] : null
    });
  }

  /* =========================================================
     视图工厂：订阅存档变化自动刷新
     ========================================================= */
  App.Views = App.Views || {};
  App.Views.me = function () {
    return {
      render: function (root) {
        lastRoot = root;
        // 订阅：背词/答题/打卡后回到本页自动重绘图表与统计（只订阅一次，避免重复挂载累积监听）
        if (!offChange) {
          offChange = App.Store.on('change', function () {
            if (lastRoot && App.Router && App.Router.currentRoute() === '#/me') drawAllNow();
          });
          offSaved = App.Store.on('saved', function () {
            if (lastRoot && App.Router && App.Router.currentRoute() === '#/me') drawAllNow();
          });
        }
        // resize 监听同样只绑一次，destroy 时解除，防止泄漏
        if (!resizeHandler) {
          resizeHandler = function () { drawAll(); };
          global.addEventListener('resize', resizeHandler);
        }
        render(root);
        drawAllNow();
      },
      destroy: function () {
        if (offChange) { offChange(); offChange = null; }
        if (offSaved) { offSaved(); offSaved = null; }
        if (resizeHandler) {
          global.removeEventListener('resize', resizeHandler);
          resizeHandler = null;
        }
        lastRoot = null;
        if (drawTimer) { clearTimeout(drawTimer); drawTimer = null; }
      }
    };
  };
})(window);
