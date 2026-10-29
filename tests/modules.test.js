import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { MODULES } from "../js/modules.js";
import { APP_VERSION } from "../js/config.js";

const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [relative("js", p).split("\\").join("/")] : []; });

test("模块清单和 js/ 下的实际文件一致（新增 / 删除文件要同步 js/modules.js）", () => {
  assert.deepEqual([...MODULES].sort(), walk("js").sort());
});
test("版本号：config.js、index.html（meta、css、js）、sw.js 缓存名一致", () => {
  const html = readFileSync("index.html", "utf8"), sw = readFileSync("sw.js", "utf8");
  assert.match(html, new RegExp(`name="app-version" content="${APP_VERSION}"`));
  assert.ok(html.includes("app.css?v=" + APP_VERSION)); assert.ok(html.includes("app.js?v=" + APP_VERSION));
  assert.ok(sw.includes("seed-ledger-" + APP_VERSION));
  assert.match(APP_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
});
