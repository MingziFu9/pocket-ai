#!/usr/bin/env python3
"""口袋 AI 课：把各门开源课程网站镜像到同一个站点下，生成 PWA。

用法：
    python scripts/build.py --base /pocket-ai/ --out dist

步骤：
1. 读 data/courses.yaml（与门户 src/data/courses.yaml 同一份），取 status: online 的课程。
2. 逐门 git clone --depth 1 课程仓库，用 mkdocs build 生成网站到 dist/courses/<id>/。
3. 本地化外部资源：去掉 Google 字体，把 MathJax（jsDelivr）和 Mermaid（unpkg）换成 dist/vendor/ 下的本地副本；删掉 .map 文件。
4. 在每个页面注入 bridge.js（返回首页按钮 + 记录阅读位置）。
5. 每门课生成 offline.json（文件清单、总大小、版本 = 仓库最新提交），并生成 catalog.json。
6. 复制 shell/ 下的 APP 外壳。

某门课构建失败时不会中断整体：该课在 APP 里显示为“仅在线”，直接链接原网站。
课程内容本身不做修改。
"""
import argparse
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
MATHJAX_VER = "3.2.2"
MERMAID_VER = "11.4.1"

GOOGLE_FONT_LINK = re.compile(
    r'<link[^>]+href="https://fonts\.(googleapis|gstatic)\.com[^"]*"[^>]*>\s*', re.I)
MATHJAX_CDN = re.compile(r'https://cdn\.jsdelivr\.net/npm/mathjax@3[^/"]*/es5/')
MERMAID_CDN = re.compile(r'https://unpkg\.com/mermaid@[^"\'`]*?/dist/mermaid\.min\.js')


def log(*a):
    print(*a, flush=True)


def run(cmd, cwd=None, timeout=900):
    return subprocess.run(cmd, cwd=cwd, check=True, timeout=timeout,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True).stdout


def fetch_vendor(out: Path):
    """用 npm pack 取 MathJax 和 Mermaid，放到 out/vendor/。"""
    vend = out / "vendor"
    if (vend / "mathjax" / "tex-mml-chtml.js").exists() and (vend / "mermaid" / "mermaid.min.js").exists():
        return
    with tempfile.TemporaryDirectory() as td:
        run(["npm", "pack", f"mathjax@{MATHJAX_VER}", f"mermaid@{MERMAID_VER}"], cwd=td)
        with tarfile.open(Path(td) / f"mathjax-{MATHJAX_VER}.tgz") as t:
            for m in t.getmembers():
                if m.name == "package/es5/tex-mml-chtml.js" or m.name.startswith("package/es5/output/chtml/fonts/woff-v2/"):
                    m.name = m.name.replace("package/es5/", "")
                    t.extract(m, vend / "mathjax", filter="data")
        with tarfile.open(Path(td) / f"mermaid-{MERMAID_VER}.tgz") as t:
            m = t.getmember("package/dist/mermaid.min.js")
            m.name = "mermaid.min.js"
            t.extract(m, vend / "mermaid", filter="data")


def build_course(c, work: Path, dest: Path, mkdocs_bin: str):
    repo = c["repo"].rstrip("/")
    src = work / c["id"]
    if src.exists():
        shutil.rmtree(src)
    run(["git", "clone", "-q", "--depth", "1", repo + ".git", str(src)], timeout=600)
    sha = run(["git", "rev-parse", "HEAD"], cwd=src).strip()
    if dest.exists():
        shutil.rmtree(dest)
    run([mkdocs_bin, "build", "-q", "-d", str(dest)], cwd=src, timeout=1200)
    return sha


def localize(site: Path, base: str, slug: str, name: str):
    """去外链、注入 bridge.js。"""
    for p in site.rglob("*.map"):
        p.unlink()
    for p in site.rglob("*.html"):
        s = p.read_text(encoding="utf-8", errors="replace")
        s2 = GOOGLE_FONT_LINK.sub("", s)
        s2 = MATHJAX_CDN.sub(base + "vendor/mathjax/", s2)
        # 只给 MkDocs 生成的页面注入（交互动画的 main.html 是独立页面，常被 iframe 嵌入，不注入）
        is_mkdocs = 'name="generator" content="mkdocs' in s2
        if is_mkdocs and "</body>" in s2 and "data-pocket-bridge" not in s2:
            s2 = s2.replace(
                "</body>",
                f'<script data-pocket-bridge data-course="{slug}" data-name="{html.escape(name)}" data-base="{base}" src="{base}bridge.js" defer></script></body>', 1)
        if s2 != s:
            p.write_text(s2, encoding="utf-8")
    for p in site.rglob("*.js"):
        s = p.read_text(encoding="utf-8", errors="replace")
        if "unpkg.com/mermaid" in s:
            p.write_text(MERMAID_CDN.sub(base + "vendor/mermaid/mermaid.min.js", s), encoding="utf-8")


def file_list(site: Path):
    files, total = [], 0
    for p in sorted(site.rglob("*")):
        if not p.is_file() or p.name == "offline.json":
            continue
        rel = p.relative_to(site).as_posix()
        total += p.stat().st_size
        # 目录首页按“目录/”缓存，和浏览器实际请求的地址一致
        if rel == "index.html":
            rel = ""
        elif rel.endswith("/index.html"):
            rel = rel[: -len("index.html")]
        files.append(rel)
    return files, total


def dir_bytes(d: Path):
    return sum(p.stat().st_size for p in d.rglob("*") if p.is_file())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="/", help="站点部署的路径前缀，如 GitHub Pages 项目站点为 /<仓库名>/")
    ap.add_argument("--out", default="dist")
    ap.add_argument("--courses", default=str(ROOT / "data" / "courses.yaml"))
    ap.add_argument("--only", nargs="*", help="只构建这些课程 id（调试用）")
    ap.add_argument("--mkdocs", default="mkdocs")
    args = ap.parse_args()

    base = "/" + args.base.strip("/") + "/" if args.base.strip("/") else "/"
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="pocket-src-"))

    courses = yaml.safe_load(Path(args.courses).read_text(encoding="utf-8"))
    groups = [("gen", "通识课"), ("base", "专业基础课"), ("core", "专业核心课"), ("ext", "专业拓展课")]
    catalog = {"built": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "groups": [], "courses": []}
    for gid, gname in groups:
        catalog["groups"].append({"id": gid, "name": gname})

    log("准备 MathJax / Mermaid 本地副本 …")
    fetch_vendor(out)
    vendor_files, vendor_bytes = file_list(out / "vendor")

    failed = []
    for c in courses:
        if args.only and c["id"] not in args.only:
            continue
        entry = {k: c.get(k) for k in ("id", "no", "inPlan", "name", "group", "status", "url", "repo", "chapters", "blurb", "res")}
        entry["offline"] = False
        if c.get("status") == "online":
            dest = out / "courses" / c["id"]
            t0 = time.time()
            try:
                sha = build_course(c, work, dest, args.mkdocs)
                localize(dest, base, c["id"], c["name"])
                files, total = file_list(dest)
                (dest / "offline.json").write_text(json.dumps(
                    {"id": c["id"], "version": sha[:12], "bytes": total, "files": files},
                    ensure_ascii=False), encoding="utf-8")
                entry.update(offline=True, version=sha[:12], bytes=total, files=len(files))
                log(f"  ✓ {c['name']}  {total/1048576:.1f} MB  {len(files)} 个文件  {time.time()-t0:.0f}s")
            except Exception as e:  # noqa: BLE001
                out_txt = getattr(e, "stdout", "") or str(e)
                failed.append(c["name"])
                log(f"  ✗ {c['name']} 构建失败，APP 里改为仅在线：\n{out_txt[-1500:]}")
        catalog["courses"].append(entry)

    catalog["vendor"] = {"files": ["vendor/" + f for f in vendor_files], "bytes": vendor_bytes}

    # 复制外壳
    for p in (ROOT / "shell").rglob("*"):
        if p.is_file():
            d = out / p.relative_to(ROOT / "shell")
            d.parent.mkdir(parents=True, exist_ok=True)
            if p.suffix in (".html", ".js", ".webmanifest", ".css"):
                d.write_text(p.read_text(encoding="utf-8").replace("__BASE__", base), encoding="utf-8")
            else:
                shutil.copy2(p, d)
    (out / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")

    # 外壳版本号：外壳文件内容的哈希，变了 Service Worker 才会更新外壳缓存
    h = hashlib.sha1()
    for p in sorted((ROOT / "shell").rglob("*")):
        if p.is_file():
            h.update(p.read_bytes())
    sw = out / "sw.js"
    sw.write_text(sw.read_text(encoding="utf-8").replace("__SHELL_VERSION__", h.hexdigest()[:10]), encoding="utf-8")
    (out / ".nojekyll").write_text("")
    shutil.rmtree(work, ignore_errors=True)

    log(f"完成：{len(catalog['courses'])} 门课，总计 {dir_bytes(out)/1048576:.0f} MB → {out}")
    if failed:
        log("构建失败（仅在线）：" + "、".join(failed))


if __name__ == "__main__":
    sys.exit(main())
