/* 口袋 AI 课 Service Worker
 * - 外壳（首页、样式、脚本、图标）预缓存，版本变化时更新
 * - catalog.json 联网优先，断网用缓存
 * - 课程页面：已下载离线的课程直接读缓存；其余联网优先，看过的页面放进 runtime 缓存，断网时还能打开
 */
var BASE = "__BASE__";
var SHELL = "shell-__SHELL_VERSION__";
var RUNTIME = "runtime";
var SHELL_FILES = [
  BASE, BASE + "app.css", BASE + "app.js", BASE + "bridge.js", BASE + "manifest.webmanifest",
  BASE + "icons/icon-192.png", BASE + "icons/icon-512.png", BASE + "icons/icon-180.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(SHELL_FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("shell-") === 0 && k !== SHELL; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function normalize(url) {
  var u = new URL(url);
  u.search = ""; u.hash = "";
  if (u.pathname.endsWith("/index.html")) u.pathname = u.pathname.slice(0, -10);
  return u.href;
}

async function fromCaches(href) {
  var hit = await caches.match(href, { ignoreSearch: true });
  if (hit) return hit;
  if (!href.endsWith("/") && !/\.[a-z0-9]+$/i.test(href)) return caches.match(href + "/", { ignoreSearch: true });
  return undefined;
}

async function networkFirst(req, href) {
  try {
    var res = await fetch(req);
    if (res.ok && res.type === "basic") {
      var copy = res.clone();
      caches.open(RUNTIME).then(function (c) { c.put(href, copy); });
    }
    return res;
  } catch (err) {
    var hit = await fromCaches(href);
    if (hit) return hit;
    if (req.mode === "navigate") {
      return new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>离线</title><body style="font-family:sans-serif;padding:24px;line-height:1.6">' +
        '<h2>这一页还没有离线保存</h2><p>当前没有网络。回到 <a href="' + BASE + '">口袋 AI 课首页</a>，' +
        '联网时点课程的「下载离线」，之后就能断网阅读整门课。</p></body>',
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    throw err;
  }
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf(BASE) !== 0) return;
  var href = normalize(req.url);
  var path = url.pathname.slice(BASE.length);

  if (path === "catalog.json" || path.endsWith("/offline.json")) {
    e.respondWith(networkFirst(req, href));
    return;
  }
  if (path.indexOf("courses/") === 0 || path.indexOf("vendor/") === 0) {
    // 已下载离线的课程和公共库：缓存优先
    e.respondWith(caches.keys().then(async function (keys) {
      var m = path.match(/^courses\/([^/]+)\//);
      var pinned = path.indexOf("vendor/") === 0 ? "vendor" : (m ? "course-" + m[1] : null);
      if (pinned && keys.indexOf(pinned) >= 0) {
        var c = await caches.open(pinned);
        var hit = await c.match(href, { ignoreSearch: true });
        if (!hit && !href.endsWith("/") && !/\.[a-z0-9]+$/i.test(href)) hit = await c.match(href + "/");
        if (hit) return hit;
      }
      return networkFirst(req, href);
    }));
    return;
  }
  // 外壳：缓存优先，后台更新
  e.respondWith(caches.match(href).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(SHELL).then(function (c) { c.put(href, copy); }); }
      return res;
    });
    return hit || net;
  }));
});
