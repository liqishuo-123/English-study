/**
 * serve.js — 零依赖本地静态服务器（Node 16+，无需 npm install）
 *
 * 用法：
 *   node serve.js            # 默认 http://127.0.0.1:8123
 *   node serve.js 9000       # 指定端口
 *   node serve.js 9000 0.0.0.0  # 指定端口 + 允许局域网访问（手机同 Wi-Fi 可打开）
 *
 * 说明：
 *   - 仅用于本地预览与手机调试，不要直接暴露到公网
 *   - 关闭缓存，避免改代码后看到旧页面
 *   - 未命中路径回退到 index.html，保证 hash 路由刷新不 404
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || 8123;
const HOST = process.argv[3] || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const target = path.normalize(path.join(root, decoded));
  if (!target.startsWith(root)) return null;
  return target;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  let filePath = safeJoin(ROOT, url.parse(req.url).pathname || '/');
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, 'index.html');

    fs.readFile(filePath, (err2, buf) => {
      if (err2) {
        // 静态资源缺失必须如实 404，否则会把 index.html 当成 JS 返回，极难排查
        const wantsHtml = String(req.headers.accept || '').indexOf('text/html') >= 0;
        const hasExt = path.extname(filePath) !== '';
        if (!hasExt && wantsHtml) {
          fs.readFile(path.join(ROOT, 'index.html'), (e3, html) => {
            if (e3) { res.writeHead(404); res.end('Not Found'); return; }
            res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
            res.end(req.method === 'HEAD' ? undefined : html);
          });
          return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('404 Not Found: ' + path.relative(ROOT, filePath));
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': buf.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  });
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log('');
  console.log('  四六级英语工作台 已启动');
  console.log('  本机访问：http://' + shown + ':' + PORT + '/');
  if (HOST === '0.0.0.0') console.log('  手机访问：http://<本机局域网IP>:' + PORT + '/');
  console.log('  按 Ctrl+C 停止');
  console.log('');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用，换一个：node serve.js 8124');
  } else {
    console.error('启动失败：', e.message);
  }
  process.exit(1);
});
