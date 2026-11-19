import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP_VERSION } from "../js/config.js";

test("版本号：config.js、index.html（meta、css、js）、sw.js 缓存名一致", () => {
  const html = readFileSync("index.html", "utf8"), sw = readFileSync("sw.js", "utf8");
  assert.match(html, new RegExp(`name="app-version" content="${APP_VERSION}"`));
  assert.ok(html.includes("app.css?v=" + APP_VERSION)); assert.ok(html.includes("dist/app.js?v=" + APP_VERSION));
  assert.ok(sw.includes("seed-ledger-" + APP_VERSION));
  assert.match(APP_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
});
