// 断网自检：出包前把全部交互动画、题目页和“试一试”逐个打开，任何一项失败就以非 0 退出。
// 用法：node scripts/offline-check.js <dist 目录> <站点地址，如 http://localhost:8765/>
// 规则：只允许访问本地站点，任何外网请求都会被拦截并记为失败。
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DIST = path.resolve(process.argv[2] || "dist");
const SITE = (process.argv[3] || "http://localhost:8765/").replace(/\/?$/, "/");
const ORIGIN = new URL(SITE).origin;
const COURSES = path.join(DIST, "courses");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const KNOWN = JSON.parse(fs.readFileSync(path.join(__dirname, "known-issues.json"), "utf8"));
const warnings = [];
const toUrl = (f) => SITE + path.relative(DIST, f).split(path.sep).join("/").replace(/index\.html$/, "");

const htmlFiles = walk(COURSES).filter((f) => f.endsWith(".html"));
const sims = htmlFiles.filter((f) => /[\\/]sims[\\/][^\\/]+[\\/]main\.html$/.test(f));
const quizPages = htmlFiles.filter((f) => /class="quiz( quiz-(judge|multi))?"/.test(fs.readFileSync(f, "utf8")));
// “试一试”：Python（Pyodide）和 SQL（sql.js）两种，每门课取第一处
const TRYIT = [
  { mark: 'class="tryit"', btn: ".tryit .tryit-btn", out: ".tryit-out", busy: /加载|运行中|正在/, bad: /tryit-err/ },
  { mark: 'class="sql-try"', btn: ".sql-try .sql-run", out: ".sql-output", busy: /正在运行/, bad: /sql-err/ },
];
const tryitPages = [];
for (const course of fs.readdirSync(COURSES)) {
  for (const k of TRYIT) {
    const f = htmlFiles.find((x) => x.startsWith(path.join(COURSES, course) + path.sep) && fs.readFileSync(x, "utf8").includes(k.mark));
    if (f) tryitPages.push({ f, k });
  }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(ORIGIN) ? r.continue() : r.abort()));
  const failures = [];

  async function open(url, fn) {
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push("脚本报错: " + e.message.slice(0, 150)));
    page.on("requestfailed", (r) => {
      const u = r.url();
      // 课程页上“最新版本”等 GitHub 接口信息属于在线附加信息，断网时取不到是预期行为
      if (/^https:\/\/api\.github\.com\//.test(u)) return;
      errs.push((u.startsWith(ORIGIN) ? "加载失败: " : "访问外网: ") + u.slice(0, 150));
    });
    page.on("response", (r) => { if (r.status() >= 400) errs.push(r.status() + ": " + r.url().slice(0, 150)); });
    try {
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(800);
      if (fn) await fn(page, errs);
    } catch (e) {
      errs.push("异常: " + e.message.split("\n")[0].slice(0, 150));
    }
    await page.close();
    // 已登记的已知问题只警告，不阻止出包
    const real = [...new Set(errs)].filter((e) => {
      const k = KNOWN.find((k) => url.includes(k.url) && e.includes(k.error));
      if (k) warnings.push(url + "  " + k.note);
      return !k;
    });
    if (real.length) failures.push({ url, errs: real });
    return real.length === 0;
  }

  console.log(`交互动画 ${sims.length} 个`);
  let ok = 0;
  for (const f of sims) if (await open(toUrl(f))) ok++;
  console.log(`  通过 ${ok}/${sims.length}`);

  console.log(`题目页 ${quizPages.length} 页`);
  ok = 0;
  for (const f of quizPages) {
    const passed = await open(toUrl(f), async (page, errs) => {
      // 每种题型点一题，确认页面有反应（判对错、展开解析或更新进度）
      for (const sel of [".quiz:not(.quiz-multi):not(.quiz-judge)", ".quiz.quiz-judge"]) {
        const q = page.locator(sel).first();
        if (!(await q.count())) continue;
        const before = await q.evaluate((el) => el.outerHTML);
        // 用脚本点击，题目在折叠区或屏幕外也能测到交互逻辑
        await q.locator("li").first().evaluate((el) => el.click());
        await page.waitForTimeout(150);
        if ((await q.evaluate((el) => el.outerHTML)) === before) errs.push("点选后没有反应: " + sel);
      }
      const multi = page.locator(".quiz.quiz-multi").first();
      if (await multi.count()) {
        await multi.locator("li").first().evaluate((el) => el.click());
        const submit = multi.locator("button");
        if (await submit.count()) {
          const before = await multi.evaluate((el) => el.outerHTML);
          await submit.first().evaluate((el) => el.click());
          await page.waitForTimeout(150);
          if ((await multi.evaluate((el) => el.outerHTML)) === before) errs.push("多选题提交后没有反应");
        }
      }
    });
    if (passed) ok++;
  }
  console.log(`  通过 ${ok}/${quizPages.length}`);

  console.log(`“试一试”运行代码 ${tryitPages.length} 处`);
  ok = 0;
  for (const { f, k } of tryitPages) {
    const passed = await open(toUrl(f), async (page, errs) => {
      const btn = page.locator(k.btn).first();
      if (!(await btn.count())) { errs.push("没有找到运行按钮 " + k.btn); return; }
      await btn.click();
      try {
        // Pyodide 首次加载约 12 MB，给足时间
        await page.waitForFunction(([sel, busy]) => {
          const el = document.querySelector(sel);
          return el && el.textContent.trim().length > 0 && !new RegExp(busy).test(el.textContent);
        }, [k.out, k.busy.source], { timeout: 90000 });
        const html = await page.locator(k.out).first().evaluate((el) => el.outerHTML);
        if (k.bad.test(html)) errs.push("运行结果是错误: " + html.replace(/<[^>]+>/g, " ").slice(0, 150));
      } catch (e) {
        errs.push("运行没有输出（90 秒超时）");
      }
    });
    if (passed) ok++;
  }
  console.log(`  通过 ${ok}/${tryitPages.length}`);

  await browser.close();
  if (warnings.length) console.log("\n已知问题（不阻止出包）：\n- " + [...new Set(warnings)].join("\n- "));
  if (failures.length) {
    console.log(`\n失败 ${failures.length} 项：`);
    for (const f of failures.slice(0, 50)) console.log("- " + f.url + "\n    " + f.errs.join("\n    "));
    process.exit(1);
  }
  console.log("\n全部通过。");
})();
