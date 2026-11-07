/* 口袋 AI 课：课程列表、继续阅读、按课程下载离线 */
(function () {
  "use strict";
  var BASE = "__BASE__";
  var RES = { book: "文字教材", ppt: "授课PPT", anim: "交互动画", quiz: "测试习题", lab: "实验" };
  var KEY_OFF = "pocket.offline"; // { id: {version, bytes, at} }
  var KEY_LAST = "pocket.last";   // { id, name, title, url, at }

  function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function mb(b) { return b ? (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + " MB" : ""; }
  function $(s, el) { return (el || document).querySelector(s); }

  var catalog = null;

  // ---------- 环境提示 ----------
  var ua = navigator.userAgent;
  var inWeChat = /MicroMessenger/i.test(ua);
  var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (inWeChat) $("#wechat").hidden = false;

  var deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (!inWeChat && !standalone) { $("#install").hidden = false; $("#install-btn").hidden = false; }
  });
  $("#install-btn").addEventListener("click", function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.finally(function () { deferredPrompt = null; $("#install").hidden = true; });
  });
  var isIOS = /iPhone|iPad|iPod/i.test(ua);
  if (isIOS && !standalone && !inWeChat) {
    $("#install-text").textContent = "在 Safari 里点底部「分享」→「添加到主屏幕」，即可像 APP 一样使用；不添加的话，iPhone 可能会自动清掉离线内容。";
    $("#install").hidden = false;
  }

  function updateNet() { $("#net").hidden = navigator.onLine; }
  window.addEventListener("online", updateNet);
  window.addEventListener("offline", updateNet);
  updateNet();

  // ---------- Service Worker ----------
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(BASE + "sw.js", { scope: BASE }).catch(function (e) { console.warn("SW 注册失败", e); });
  }

  // ---------- 继续阅读 ----------
  function showResume() {
    var last = load(KEY_LAST, null);
    if (!last || !last.url) return;
    $("#resume").hidden = false;
    $("#resume-link").href = last.url;
    $("#resume-course").textContent = last.name || "";
    $("#resume-title").textContent = last.title || "上次读到的页面";
  }

  // ---------- 离线下载 ----------
  function courseUrl(c, f) { return BASE + "courses/" + c.id + "/" + (f || ""); }

  async function fetchAll(cache, urls, onProgress) {
    var done = 0, i = 0, failed = [];
    async function worker() {
      while (i < urls.length) {
        var u = urls[i++];
        try {
          var r = await fetch(u, { cache: "no-cache" });
          if (!r.ok) throw new Error(r.status);
          await cache.put(u, r);
        } catch (e) { failed.push(u); }
        done++;
        onProgress(done / urls.length);
      }
    }
    var n = Math.min(6, urls.length), ws = [];
    for (var k = 0; k < n; k++) ws.push(worker());
    await Promise.all(ws);
    return failed;
  }

  async function ensureVendor() {
    var v = catalog.vendor;
    if (!v || !v.files.length) return;
    var cache = await caches.open("vendor");
    var have = await cache.keys();
    if (have.length >= v.files.length) return;
    await fetchAll(cache, v.files.map(function (f) { return BASE + f; }), function () {});
  }

  async function download(c, card) {
    if (!("caches" in window)) { alert("这个浏览器不支持离线下载，请换用系统浏览器或 Chrome。"); return; }
    var btns = card.querySelectorAll("button");
    btns.forEach(function (b) { b.disabled = true; });
    var prog = $(".progress", card), bar = $(".bar", prog);
    prog.hidden = false; bar.style.width = "0";
    try {
      if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e) {} }
      var man = await (await fetch(courseUrl(c, "offline.json"), { cache: "no-store" })).json();
      await ensureVendor();
      var name = "course-" + c.id;
      await caches.delete(name);
      var cache = await caches.open(name);
      var urls = man.files.map(function (f) { return courseUrl(c, f); });
      var failed = await fetchAll(cache, urls, function (p) { bar.style.width = Math.round(p * 100) + "%"; });
      if (failed.length > urls.length * 0.02) {
        await caches.delete(name);
        throw new Error(failed.length + " 个文件下载失败");
      }
      var off = load(KEY_OFF, {});
      off[c.id] = { version: man.version, bytes: man.bytes, at: Date.now() };
      save(KEY_OFF, off);
    } catch (e) {
      alert("「" + c.name + "」下载没有完成：" + e.message + "。请在网络稳定时重试。");
    }
    prog.hidden = true;
    btns.forEach(function (b) { b.disabled = false; });
    renderCard(c, card);
    showStorage();
  }

  async function remove(c, card) {
    if (!confirm("删除「" + c.name + "」的离线内容？之后需要联网才能看。")) return;
    await caches.delete("course-" + c.id);
    var off = load(KEY_OFF, {});
    delete off[c.id];
    save(KEY_OFF, off);
    renderCard(c, card);
    showStorage();
  }

  // ---------- 渲染 ----------
  function renderCard(c, card) {
    var off = load(KEY_OFF, {})[c.id];
    var badge = $(".badge", card);
    var dl = $(".act-dl", card), up = $(".act-update", card), del = $(".act-del", card);
    var meta = [];
    if (c.chapters) meta.push(c.chapters + " 章");
    if (c.offline && c.bytes) meta.push("离线约 " + mb(c.bytes));
    if (!c.offline) {
      badge.textContent = "仅在线"; badge.className = "badge";
      dl.hidden = true; up.hidden = true; del.hidden = true;
    } else if (off && off.version === c.version) {
      badge.textContent = "已离线"; badge.className = "badge ok";
      dl.hidden = true; up.hidden = true; del.hidden = false;
    } else if (off) {
      badge.textContent = "有更新"; badge.className = "badge warn";
      dl.hidden = true; up.hidden = false; del.hidden = false;
    } else {
      badge.textContent = ""; badge.className = "badge"; badge.hidden = true;
      dl.hidden = false; up.hidden = true; del.hidden = true;
    }
    if (badge.textContent) badge.hidden = false;
    $(".card-meta", card).textContent = meta.join(" · ");
  }

  function buildCard(c) {
    var card = document.importNode($("#card-tpl").content, true).firstElementChild;
    $(".card-name", card).textContent = c.name;
    $(".card-blurb", card).textContent = c.blurb || "";
    var tags = $(".tags", card);
    (c.res || []).forEach(function (r) {
      if (!RES[r]) return;
      var s = document.createElement("span"); s.textContent = RES[r]; tags.appendChild(s);
    });
    var open = $(".act-open", card);
    open.href = c.offline ? courseUrl(c) : c.url;
    if (!c.offline) { open.target = "_blank"; open.rel = "noopener"; }
    $(".act-dl", card).addEventListener("click", function () { download(c, card); });
    $(".act-update", card).addEventListener("click", function () { download(c, card); });
    $(".act-del", card).addEventListener("click", function () { remove(c, card); });
    renderCard(c, card);
    return card;
  }

  function render() {
    var root = $("#groups");
    root.textContent = "";
    catalog.groups.forEach(function (g) {
      var list = catalog.courses.filter(function (c) { return c.group === g.id && c.status === "online"; });
      if (!list.length) return;
      var sec = document.createElement("section"); sec.className = "group";
      var h = document.createElement("h2"); h.textContent = g.name;
      var small = document.createElement("small"); small.textContent = list.length + " 门";
      h.appendChild(small); sec.appendChild(h);
      var cards = document.createElement("div"); cards.className = "cards";
      list.forEach(function (c) { cards.appendChild(buildCard(c)); });
      sec.appendChild(cards); root.appendChild(sec);
    });
    if (catalog.built) $("#built").textContent = "内容同步时间：" + catalog.built.replace("T", " ").slice(0, 16);
  }

  async function showStorage() {
    var off = load(KEY_OFF, {});
    var ids = Object.keys(off);
    var t = ids.length ? "已离线 " + ids.length + " 门课，约 " + mb(ids.reduce(function (s, k) { return s + (off[k].bytes || 0); }, 0)) + "。" : "还没有下载离线课程。";
    if (navigator.storage && navigator.storage.estimate) {
      try {
        var est = await navigator.storage.estimate();
        if (est.quota) t += " 本机可用空间约 " + mb(est.quota - est.usage) + "。";
      } catch (e) {}
    }
    $("#storage-text").textContent = t;
  }

  async function init() {
    showResume();
    try {
      var r = await fetch(BASE + "catalog.json", { cache: "no-cache" });
      catalog = await r.json();
    } catch (e) {
      $("#groups").innerHTML = '<p class="muted pad">课程列表加载失败，请联网后重试。</p>';
      return;
    }
    render();
    showStorage();
  }
  init();
})();
