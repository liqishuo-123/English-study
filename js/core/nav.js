/* =========================================================
   core/nav.js — 底部导航配置与渲染（单一数据源）
   依赖：core/utils.js
   对外：window.App.NAV

   想调整底部 Tab（增删改、换顺序、换图标）只需要改下面这个数组。
   例如把「真题」提到一级导航，加一行即可：
   { key:'quiz', title:'真题', route:'#/quiz', icon:'book', order:3, visible:true }
   （同时记得把其他条目的 order 顺延）
   ========================================================= */
(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var U = App.Utils;

  var tabs = [
    { key: 'agent',   title: 'AI 助教', route: '#/agent',  icon: 'sparkle', order: 1, visible: true, accent: true },
    { key: 'today',   title: '今日', route: '#/today',   icon: 'home',    order: 2, visible: true },
    { key: 'words',   title: '单词', route: '#/words',   icon: 'cards',   order: 3, visible: true },
    { key: 'writing', title: '写作', route: '#/writing', icon: 'pen',     order: 4, visible: true },
    { key: 'quiz',    title: '阅读', route: '#/quiz',    icon: 'read',    order: 5, visible: true },
    { key: 'me',      title: '我的', route: '#/me',      icon: 'user',    order: 6, visible: true }
  ];

  // 二级路由（不出现在底部 Tab，由页面内入口进入）
  var secondary = [
    { key: 'wrongbook', title: '错题本', route: '#/wrongbook' }
  ];

  var dots = Object.create(null);
  var currentRoute = '';

  function visibleTabs() {
    return tabs.filter(function (t) { return t.visible !== false; })
      .sort(function (a, b) { return a.order - b.order; });
  }

  /** 判断某 Tab 是否处于激活态（二级页归属到它的父级 Tab） */
  function isActive(tab, route) {
    route = route || currentRoute;
    if (route === tab.route) return true;
    // 错题本、学习教练为二级页，从「今日」进入，归属高亮到「今日」
    if (tab.key === 'today' && (route === '#/wrongbook' || route === '#/coach')) return true;
    return false;
  }

  function render(container) {
    if (!container) return;
    U.clear(container);
    var list = visibleTabs();
    var frag = document.createDocumentFragment();

    list.forEach(function (tab) {
      var btn = U.el('button.tab-item' + (tab.accent ? '.is-accent' : ''), {
        type: 'button',
        dataset: { key: tab.key, route: tab.route },
        'aria-label': tab.title,
        onclick: function () {
          if (location.hash === tab.route) App.Router.reload();
          else location.hash = tab.route;
        }
      }, [
        U.icon(tab.icon),
        U.el('span.tab-label', { text: tab.title }),
        U.el('i.tab-dot')
      ]);
      frag.appendChild(btn);
    });
    container.appendChild(frag);
    sync();
  }

  /** 同步激活态 */
  function sync(route) {
    if (route) currentRoute = route;
    var nodes = U.$$('#tabbar .tab-item');
    nodes.forEach(function (n) {
      var tab = findByKey(n.dataset.key);
      if (!tab) return;
      var on = isActive(tab, currentRoute);
      n.classList.toggle('is-active', on);
      n.setAttribute('aria-current', on ? 'page' : 'false');
      n.classList.toggle('has-dot', !!dots[tab.key]);
    });
  }

  function findByKey(key) {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].key === key) return tabs[i];
    return null;
  }

  /** 设置红点提醒 */
  function setDot(key, on) {
    dots[key] = !!on;
    sync();
  }
  function clearDots() {
    dots = Object.create(null);
    sync();
  }

  App.NAV = {
    tabs: tabs,
    secondary: secondary,
    visibleTabs: visibleTabs,
    render: render,
    sync: sync,
    setDot: setDot,
    clearDots: clearDots,
    isActive: isActive
  };
})(window);
