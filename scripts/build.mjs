/* 打包：把 js/ 下的源码（原生 ES 模块）打成 dist/ 给 GitHub Pages 用。
 *   npm run build        发布用：压缩，输出到 dist/，并更新 index.html 里的 modulepreload 清单（都要和源码一起提交）
 *   npm run build:dev    调试用：不压缩 + sourcemap
 *   npm run check:dist   检查 dist/ 和 index.html 是不是最新（用源码重新打一遍逐文件比较），不是最新就报错
 * 启动时要用的模块打进 dist/app.js 和几个共享块；import("…") 按需加载的页面各自成块，放在 dist/chunks/（文件名带内容哈希，新发布不会撞旧缓存）。 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const dev = process.argv.includes("--dev");
const check = process.argv.includes("--check");
const outdir = check ? ".dist-check" : "dist";

const files = (dir, base = dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), base) : [join(dir, e.name).slice(base.length + 1).split("\\").join("/")]));
const digest = (p) => createHash("sha1").update(readFileSync(p)).digest("hex");
const kb = (n) => `${Math.round(n / 1024)}KB`;

/** 从 app.js 出发，静态 import 能走到的所有文件 = 启动时一定要下载的（动态 import 不算） */
function startupFiles(dir) {
  const seen = new Set(), todo = ["app.js"];
  const re = /(?:import|export)\s*(?:[^"';(]*?)from\s*"(\.[^"]+)"|import\s*"(\.[^"]+)"/g;
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(re)) todo.push(normalize(join(dirname(f), m[1] || m[2])).split("\\").join("/"));
  }
  return [...seen].filter((f) => f !== "app.js").sort();
}

/** index.html 里 <!-- build:preload --> 和 <!-- /build:preload --> 之间换成启动文件的 modulepreload */
function withPreload(html, startup) {
  const crlf = html.includes("\r\n"), s = html.replace(/\r\n/g, "\n");
  const re = /(<!-- build:preload[^\n]*-->\n)[\s\S]*?(  <!-- \/build:preload -->)/;
  if (!re.test(s)) throw new Error("index.html 里没有 build:preload 标记");
  const out = s.replace(re, (_, a, b) => `${a}${startup.map((f) => `  <link rel="modulepreload" href="dist/${f}">\n`).join("")}${b}`);
  return crlf ? out.replace(/\n/g, "\r\n") : out;
}

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
await build({
  entryPoints: { app: "js/app.js" },
  outdir,
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2022",
  chunkNames: "chunks/[name]-[hash]",
  minify: !dev,
  sourcemap: dev ? "linked" : false,
  legalComments: "none",
  charset: "utf8",
  logLevel: "warning",
  logOverride: { "duplicate-object-key": "silent" },   // 词典里有重复的键（后面的生效），行为和浏览器原生一致，不用每次提醒
});

const list = files(outdir), startup = startupFiles(outdir);
const html = withPreload(readFileSync("index.html", "utf8"), startup);
const size = (f) => statSync(join(outdir, f)).size;
if (!check) {
  writeFileSync("index.html", html);
  console.log(`dist/ ${list.length} 个文件，共 ${kb(list.reduce((s, f) => s + size(f), 0))}`);
  console.log(`启动时要下载：app.js ${kb(size("app.js"))} + ${startup.length} 个共享块 ${kb(startup.reduce((s, f) => s + size(f), 0))}（压缩后、未 gzip）`);
} else {
  const same = existsSync("dist") && JSON.stringify(files("dist")) === JSON.stringify(list)
    && list.every((f) => digest(join("dist", f)) === digest(join(outdir, f))) && readFileSync("index.html", "utf8") === html;
  rmSync(outdir, { recursive: true, force: true });
  if (!same) { console.error("dist/ 或 index.html 不是最新：请运行 npm run build 并一起提交"); process.exit(1); }
  console.log("dist/ 和 index.html 都是最新的");
}
