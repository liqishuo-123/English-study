/* =========================================================
   core/router.js — hash 路由
   依赖：core/utils.js, core/nav.js
   对外：window.App.Router

   视图契约：每个视图是一个工厂函数，返回 { render(el), destroy() }
   ========================================================= */
(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var U = App.Utils;

  var routes = Object.create(null);
  var defaultRoute = '#/today';
  var container = null;
  var current = null;      // { view, route }
  var started = false;

  function register(route, factory) { routes[route] = factory; }

  function normalize(hash) {
    if (!hash || hash === '#') return defaultRoute;
    var base = hash.split('?')[0];
    if (!routes[base]) return defaultRoute;
    return base;
  }

  function mount(route) {
    if (!container) return;
    var factory = routes[route];
    if (!factory) { location.hash = defaultRoute; return; }

    // 卸载旧视图：销毁定时器、释放音频等资源
    if (current && typeof current.view.destroy === 'function') {
      try { current.view.destroy(); }
      catch (e) { console.error('[Router] 视图销毁出错', e); }
    }

    U.clear(container);
    var view = factory();
    current = { view: view, route: route };

    var wrap = U.el('div.view-enter');
    container.appendChild(wrap);
    try {
      view.render(wrap);
    } catch (e) {
      console.error('[Router] 视图渲染出错', e);
      U.clear(wrap);
      wrap.appendChild(U.el('div.empty', null, [
        U.icon('close'),
        U.el('div.empty-title', { text: '页面加载出错' }),
        U.el('div.empty-desc', { text: String(e && e.message || e) })
      ]));
    }

    if (App.NAV) App.NAV.sync(route);

    // 切换页面回到顶部，避免停留在上个页面的滚动位置
    var scroller = document.scrollingElement || document.documentElement;
    if (scroller) scroller.scrollTop = 0;

    // 刷新底部红点
    if (App.Router.onMount) {
      try { App.Router.onMount(route); } catch (e) { console.error(e); }
    }
  }

  function onHashChange() {
    var route = normalize(location.hash);
    mount(route);
  }

  function start(mountEl) {
    container = mountEl;
    if (!started) {
      window.addEventListener('hashchange', onHashChange);
      started = true;
    }
    if (!location.hash) location.hash = defaultRoute;
    else onHashChange();
  }

  function go(route) { location.hash = route; }

  /** 重新渲染当前页（例如导入数据后刷新） */
  function reload() {
    if (!current) return onHashChange();
    var route = current.route;
    mount(route);
  }

  function currentRoute() { return current ? current.route : defaultRoute; }

  App.Router = {
    register: register,
    start: start,
    go: go,
    reload: reload,
    currentRoute: currentRoute,
    normalize: normalize,
    onMount: null
  };
})(window);
