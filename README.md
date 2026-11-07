# 口袋 AI 课

广州开放大学人工智能教学团队开源课程的手机 APP（PWA）。把各门课程网站镜像到同一个站点下，学生可以安装到手机桌面、按课程下载离线学习。

## 它做什么

- 课程列表：按通识课 / 专业基础课 / 专业核心课 / 专业拓展课分组，数据来自 `data/courses.yaml`（与门户网站 `src/data/courses.yaml` 是同一份，改课程信息请两边一起改）。
- 课程内容：每天自动从各课程仓库拉取最新内容，用 MkDocs 重新生成，课程内容本身不修改。
- 离线：每门课可单独“下载离线”，下载后章节、交互动画、随堂小测、公式和课内搜索断网可用。看过的页面也会自动缓存。
- 继续阅读：记住上次读到的页面，只保存在本机，不登录、不上传。
- 微信内打开时提示用浏览器打开；iPhone 提示“添加到主屏幕”。

不包含：实验代码运行、Releases 里的课件/教案/PDF（请到课程仓库获取）、登录和学习记录。

## 发布到 GitHub Pages

1. 在 GitHub 上新建仓库（例如 `pocket-ai`），把本目录内容推上去。
2. 仓库 Settings → Pages → Source 选 **GitHub Actions**。
3. Actions 里手动运行一次「同步课程并发布口袋 AI 课」，之后每天北京时间 03:00 自动同步；推送到 main 也会重新发布。
4. 地址：`https://<账号>.github.io/<仓库名>/`。

## 本地构建

```bash
pip install -r requirements.txt     # 还需要 git 和 npm
python scripts/build.py --base /pocket-ai/ --out dist
# 预览：把 dist 放到 www/pocket-ai 下，在 www 目录运行 python -m http.server
```

## 构建时做的处理

- 删除 Google 字体引用（国内加载慢、离线不可用），改用系统字体。
- MathJax（原来走 jsDelivr）和 Mermaid（原来走 unpkg）换成 `vendor/` 下的本地副本。
- 删除 `.map` 调试文件。
- 在每个课程页面加一个“口袋 AI 课”返回按钮，并记录阅读位置。
- 每门课生成 `offline.json`（文件清单、大小、版本 = 仓库最新提交前 12 位）。

某门课构建失败不会影响其他课，该课在 APP 里显示为“仅在线”，直接链接原网站。

## 新增课程

在 `data/courses.yaml` 里加一条（`status: online`，填 `id`、`name`、`group`、`url`、`repo` 等），推送即可。
