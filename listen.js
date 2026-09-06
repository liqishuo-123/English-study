/* =========================================================
   views/listen.js — 听力训练（Tab 4）
   依赖：core/utils.js
   状态：该功能暂未开发，当前仅展示占位提示
   ========================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.Utils;

  function render(root) {
    U.clear(root);
    root.appendChild(U.el('div.page-head', null, [
      U.el('div.page-title', { text: '听力训练' })
    ]));

    root.appendChild(U.el('div.empty', null, [
      U.icon('headset'),
      U.el('div.empty-title', { text: '该功能暂未开发' }),
      U.el('div.empty-desc', { text: '听力训练模块正在建设中，敬请期待。' })
    ]));
  }

  App.Views = App.Views || {};
  App.Views.listen = function () {
    return {
      render: render,
      destroy: function () { /* 无资源需要释放 */ }
    };
  };
})(window);
