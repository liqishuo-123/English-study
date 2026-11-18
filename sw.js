/* =========================================================
   sw.js — Service Worker（离线缓存策略）
   设计目标：
   1. 仅在有 http(s) 部署时生效；file:// 下注册会自动静默失败。
   2. 静态资源 Cache-First 预缓存，断网仍可打开全部页面与脚本。
   3. 缓存名带版本号，发新版时清理旧缓存，避免「更新后仍是旧页面」。
   4. AI 请求、非 GET 请求、跨域请求一律 Network-Only，不缓存。
   ========================================================= */
(function () {
  'use strict';

  var CACHE_VERSION = 'v4';
  var CACHE_NAME = 'cet-workbench-' + CACHE_VERSION;

  // 预缓存清单（与 index.html 中 script/link 顺序保持一致）
  var PRECACHE = [
    './',
    './index.html',
    './manifest.webmanifest',
    './css/main.css',
    './css/views.css',
    './js/core/utils.js',
    './js/core/store.js',
    './js/core/srs.js',
    './js/core/picker.js',
    './js/core/importer.js',
    './js/core/ai.js',
    './js/core/tts.js',
    './js/core/nav.js',
    './js/core/router.js',
    './js/core/wordsdb.js',
    './js/core/agent.js',
    './js/data/cet4-words-1.js',
    './js/data/cet4-words-2.js',
    './js/data/cet4-words-3.js',
    './js/data/cet4-words-4.js',
    './js/data/cet4-words-5.js',
    './js/data/cet4-words-6.js',
    './js/data/cet4-words-7.js',
    './js/data/cet4-words-8.js',
    './js/data/cet4-words-9.js',
    './js/data/cet4-words-10.js',
    './js/data/cet4-words-11.js',
    './js/data/cet4-words-12.js',
    './js/data/cet6-words-1.js',
    './js/data/cet6-words-2.js',
    './js/data/cet6-words-3.js',
    './js/data/phrases.js',
    './js/data/quiz-select-fill.js',
    './js/data/quiz-matching.js',
    './js/data/quiz-reading.js',
    './js/data/writing.js',
    './js/views/today.js',
    './js/views/words.js',
    './js/views/quiz.js',
    './js/views/wrongbook.js',
    './js/views/writing.js',
    './js/views/listen.js',
    './js/views/agent.js',
    './js/views/me.js',
    './js/app.js',
    './icons/favicon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png'
  ];

  /** 安装阶段：预缓存核心静态资源 */
  self.addEventListener('install', function (event) {
    event.waitUntil(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.addAll(PRECACHE).catch(function (err) {
          console.warn('[SW] 预缓存部分失败：', err);
        });
      }).then(function () {
        return self.skipWaiting();
      })
    );
  });

  /** 激活阶段：清理旧版本缓存 */
  self.addEventListener('activate', function (event) {
    event.waitUntil(
      caches.keys().then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            if (key.indexOf(CACHE_NAME) !== 0) {
              return caches.delete(key);
            }
          })
        );
      }).then(function () {
        return self.clients.claim();
      })
    );
  });

  /** 拦截请求：GET 静态资源走 Cache-First；其余 Network-Only */
  self.addEventListener('fetch', function (event) {
    var req = event.request;

    // 非 GET、跨域、AI 接口均不拦截
    if (req.method !== 'GET') return;
    if (req.url.indexOf(self.location.origin) !== 0) return;
    var url = new URL(req.url);
    if (url.pathname.indexOf('/api/') === 0 || url.search.indexOf('ai=') !== -1) return;

    // 导航请求：Network-Falling-Back-To-Cache，保证更新及时
    if (req.mode === 'navigate') {
      event.respondWith(
        fetch(req).then(function (res) {
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
          }
          return res;
        }).catch(function () {
          return caches.match(req).then(function (cached) {
            return cached || caches.match('./index.html');
          });
        })
      );
      return;
    }

    // 脚本与样式：Stale-While-Revalidate
    // 先返回缓存（秒开、断网可用），同时后台拉新版本写回缓存，
    // 这样即使忘了改 CACHE_VERSION，下一次打开也能拿到新代码。
    if (/\.(?:js|css)$/.test(url.pathname)) {
      event.respondWith(
        caches.open(CACHE_NAME).then(function (cache) {
          return cache.match(req).then(function (cached) {
            var network = fetch(req).then(function (res) {
              if (res && res.status === 200 && res.type === 'basic') {
                cache.put(req, res.clone());
              }
              return res;
            }).catch(function () {
              return cached || new Response('', { status: 503, statusText: 'Service Unavailable' });
            });
            return cached || network;
          });
        })
      );
      return;
    }

    // 静态资源：Cache-First
    event.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (res) {
          if (!res || res.status !== 200 || res.type !== 'basic') return res;
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
          return res;
        }).catch(function () {
          // 离线且无缓存时返回空响应，避免崩溃
          return new Response('', { status: 503, statusText: 'Service Unavailable' });
        });
      })
    );
  });
})();
