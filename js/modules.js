/* 所有模块文件（相对 js/）。发布新版后，浏览器可能把新的 index.html 和缓存里的旧模块混在一起（内部 import 没有版本号）：
   index.html 里的 meta 版本和 config.js 不一致时，app.js 会用这份清单强制重新抓取所有模块并刷新一次（做法同小月亮 / 家庭学堂）。
   新增 / 删除 js 文件时同步改这里；tests/modules.test.js 会检查清单和实际文件一致。 */
export const MODULES = [
  "app.js", "config.js", "modules.js",
  "core/advice.js", "core/ai.js", "core/auth-msg.js", "core/db.js", "core/file-readers.js", "core/i18n.js", "core/state.js", "core/sync.js", "core/util.js",
  "data/i18n-en.js", "data/s2t.js",
  "logic/ledger.js", "logic/pricing.js", "logic/profile.js", "logic/route.js", "logic/scan-import.js",
  "ui/actions.js", "ui/charts.js", "ui/common.js", "ui/customers.js", "ui/home.js", "ui/kit.js", "ui/more.js", "ui/print.js", "ui/reports.js", "ui/routes.js", "ui/sales.js", "ui/scan.js", "ui/stock.js"
];
