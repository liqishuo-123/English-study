/* =========================================================
   app.js — 应用启动器（最后加载）
   职责：
   1. 初始化 Store（读取 localStorage 存档 + 版本迁移）
   2. Words.rebuild() 装配词库（内置 + 用户导入 + 学习进度黏合）
   3. 注册全部路由与底部导航
   4. 应用主题、存储降级横幅、Service Worker
   5. 首屏渲染
   ========================================================= */
(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var U = App.Utils;

  /** 应用主题：写 <html data-theme> 与 meta theme-color */
  function applyTheme(theme) {
    theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    var mc = document.querySelector('meta[name="theme-color"]');
    if (mc) mc.setAttribute('content', theme === 'dark' ? '#0F1220' : '#4F46E5');
  }
  App.applyTheme = applyTheme;

  /** 顶部横幅（localStorage 写入失败等全局提示） */
  function showBanner(html) {
    var zone = U.$('#banner-zone');
    if (!zone) return;
    U.clear(zone);
    if (!html) return;
    zone.appendChild(U.el('div.banner', { role: 'alert' }, [U.icon('close'), html]));
  }
  App.showBanner = showBanner;

  function registerViews() {
    var map = {
      '#/today': App.Views.today,
      '#/words': App.Views.words,
      '#/quiz': App.Views.quiz,
      '#/wrongbook': App.Views.wrongbook,
      '#/writing': App.Views.writing,
      '#/listen': App.Views.listen,
      '#/coach': App.Views.coach,
      '#/agent': App.Views.agent,
      '#/me': App.Views.me
    };
    Object.keys(map).forEach(function (route) {
      if (typeof map[route] === 'function') App.Router.register(route, map[route]);
    });
  }

  /** 注册 Service Worker（file:// 下静默失败，不影响任何功能） */
  function registerSW() {
    try {
      if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
        navigator.serviceWorker.register('sw.js').catch(function (e) {
          console.warn('[SW] 注册失败（离线缓存不可用）：', e);
        });
      }
    } catch (e) { console.warn('[SW] 当前环境不支持 Service Worker：', e); }
  }

  function start() {
    if (!App.Store || !App.Router || !App.NAV) {
      console.error('[App] 核心模块缺失，请检查 index.html 中 script 加载顺序');
      return;
    }

    // 1. 存档 + 词库
    App.Store.init();
    App.Words.rebuild();

    // 2. 主题
    applyTheme(App.Store.state.settings.theme);

    // 3. 底部导航
    var tabbar = U.$('#tabbar');
    if (tabbar) App.NAV.render(tabbar);

    // 4. 视图路由
    registerViews();

    // 5. 存储降级横幅
    App.Store.on('storage', function (ok) {
      if (ok) { showBanner(''); return; }
      showBanner('本地存档写入失败（隐私模式或空间已满）。当前数据仅保存在内存，关闭页面会丢失，请尽快清理空间或导出备份。');
    });

    // 6. PWA（桌面双击 file:// 时自动忽略）
    registerSW();

    // 7. 首屏
    var root = U.$('#view');
    if (root) App.Router.start(root);
  }

  // 等待 DOM 就绪（脚本在 body 末尾，此处仅为保险）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);
