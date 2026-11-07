/* 注入到每个课程页面：返回首页按钮 + 记录阅读位置（只存在本机） */
(function () {
  "use strict";
  var s = document.querySelector("script[data-pocket-bridge]");
  if (!s) return;
  var base = s.getAttribute("data-base") || "/";
  var course = s.getAttribute("data-course");

  try {
    var name = s.getAttribute("data-name") || "";
    var h1 = document.querySelector("article h1, .md-content h1");
    var title = (h1 ? h1.textContent : document.title).replace(/[¶#]\s*$/, "").trim();
    localStorage.setItem("pocket.last", JSON.stringify({
      id: course, name: name.trim(), title: title, url: location.pathname, at: Date.now()
    }));
  } catch (e) {}

  var a = document.createElement("a");
  a.href = base;
  a.textContent = "口袋 AI 课";
  a.setAttribute("aria-label", "返回口袋 AI 课首页");
  a.style.cssText = [
    "position:fixed", "left:12px", "bottom:calc(12px + env(safe-area-inset-bottom))", "z-index:9",
    "background:#183078", "color:#fff", "font:14px/1 sans-serif", "padding:10px 14px",
    "border-radius:99px", "box-shadow:0 2px 8px rgba(0,0,0,.25)", "text-decoration:none", "opacity:.92"
  ].join(";");
  document.body.appendChild(a);
})();
