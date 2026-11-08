/* ============ 发布日志（四个姊妹应用共用同一份文件：小月亮、家庭学堂、爱家小助手、牧羊人） ============
   每个应用只提供自己的数据（RELEASES：每次发布一条：{ v: "YYYY-MM-DD.N", title: { zh, en }（一句话简介）, items: [{ k: "new" | "better" | "fix", zh, en }]（要点，一条一句） }）和三个接口：
   - initReleases({ version, releases, lang, accent, appId, open })：启动时调一次；记这台设备「新版本提示」出现了几次
   - releaseBadgeHTML()：今日页顶上的一条提示（新版本第一次打开起，最多出现 5 次；点了或按 ✕ 就不再出现）；打印时不出现
   - releasePageHTML()：「发布日志」整页（筛选：类型 / 时间，排序，列表 | 时间线，分批加载）
   页面上的筛选、切换、加载更多都由本文件自己处理（data-rl-*），只重画 #rlPage 里那一块，不用应用整页 render。
   这个文件在四个仓库里内容一致；改了要四份一起改。 */

const MAX_SHOWS = 5, PAGE = 10;
const C = { version: "", releases: [], lang: () => "zh", appId: "app", open: "", shown: false };
const ST = { type: "all", range: "all", sort: "new", view: "list", group: "ver", n: PAGE };   // group：按版本 ver / 按天 day；视图和分组记在这台设备

/* ---- 文字（自带，不依赖各应用的 i18n） ---- */
const TX = {
  zh: { title: "发布日志", cur: "当前版本", type: "类型", time: "时间", sort: "排序", all: "全部", new: "新功能", better: "改进", fix: "修复",
    d7: "近 7 天", d30: "近 30 天", d90: "近 3 个月", newest: "最新在前", oldest: "最早在前", list: "列表", timeline: "时间线", view: "视图",
    count: "{v} 个版本 · {n} 条", more: "再显示 {k} 个（还有 {r} 个）", end: "已经全部显示", empty: "这些条件下没有更新。", clear: "清除筛选",
    badge: "新版本", see: "看看更新了什么", dismiss: "不再提示", thisv: "本次", intro: "每次发布的简短说明：新功能、改进和修复。", filters: "筛选与排序", group: "分组", gver: "按版本", gday: "按天", countd: "{d} 天 · {v} 个版本 · {n} 条", mored: "再显示 {k} 天（还有 {r} 天）", nver: "{n} 个版本", early: "当天更新（还没有版本号）" },
  tw: { title: "發布日誌", cur: "目前版本", type: "類型", time: "時間", sort: "排序", all: "全部", new: "新功能", better: "改進", fix: "修復",
    d7: "近 7 天", d30: "近 30 天", d90: "近 3 個月", newest: "最新在前", oldest: "最早在前", list: "列表", timeline: "時間線", view: "檢視",
    count: "{v} 個版本 · {n} 條", more: "再顯示 {k} 個（還有 {r} 個）", end: "已經全部顯示", empty: "這些條件下沒有更新。", clear: "清除篩選",
    badge: "新版本", see: "看看更新了什麼", dismiss: "不再提示", thisv: "本次", intro: "每次發布的簡短說明：新功能、改進和修復。", filters: "篩選與排序", group: "分組", gver: "按版本", gday: "按天", countd: "{d} 天 · {v} 個版本 · {n} 條", mored: "再顯示 {k} 天（還有 {r} 天）", nver: "{n} 個版本", early: "當天更新（還沒有版本號）" },
  en: { title: "Release notes", cur: "Current version", type: "Type", time: "Time", sort: "Sort", all: "All", new: "New", better: "Improved", fix: "Fixed",
    d7: "Last 7 days", d30: "Last 30 days", d90: "Last 3 months", newest: "Newest first", oldest: "Oldest first", list: "List", timeline: "Timeline", view: "View",
    count: "{v} versions · {n} notes", more: "Show {k} more ({r} left)", end: "That's everything", empty: "No updates match these filters.", clear: "Clear filters",
    badge: "New version", see: "See what's new", dismiss: "Don't show again", thisv: "This version", intro: "Short notes for each release: new features, improvements and fixes.", filters: "Filter and sort", group: "Group", gver: "By version", gday: "By day", countd: "{d} days · {v} versions · {n} notes", mored: "Show {k} more days ({r} left)", nver: "{n} versions", early: "Updates that day (before version numbers)" }
};
const lg = () => { const l = String(C.lang() || "zh"); return l.startsWith("en") ? "en" : /TW|HK|Hant/i.test(l) ? "tw" : "zh"; };
const tx = (k, p = {}) => String(TX[lg()][k] ?? TX.zh[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => p[x] ?? "");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const titleOf = r => itemText(r.title || {}) || itemText(r.items[0] || {});
const itemText = it => (lg() === "en" ? it.en || it.zh : lg() === "tw" ? it.tw || it.zh : it.zh) || "";
const dateOf = v => String(v).slice(0, 10);
const store = { get(k){ try { return localStorage.getItem(`${C.appId}.rl.${k}`); } catch { return null; } }, set(k, v){ try { localStorage.setItem(`${C.appId}.rl.${k}`, v); } catch { /* 隐私模式：不记 */ } } };

/** 启动时调一次。open：今日页提示要链到发布日志页的属性（比如 'data-tab="me-releases"' 或 'href="#/me/releases"'） */
function initReleases({ version, releases, lang, accent, appId, open }){
  Object.assign(C, { version, releases: releases || [], appId: appId || C.appId, open: open || "" });
  if (lang) C.lang = lang;
  if (accent) document.documentElement.style.setProperty("--rl-accent", accent);
  const v = store.get("view"); if (v === "timeline" || v === "list") ST.view = v;
  const g = store.get("group"); if (g === "day" || g === "ver") ST.group = g;
  injectCSS();
  // 这台设备第一次打开这个版本起算：每次打开应用算一次，最多 5 次；点过 / ✕ 过就不再出现
  if (!C.releases.some(r => r.v === version) || store.get("seen") === version) return;
  let n = 0; try { const o = JSON.parse(store.get("shows") || "{}"); n = o.v === version ? +o.n || 0 : 0; } catch { /* 坏数据：从 0 算 */ }
  n += 1; store.set("shows", JSON.stringify({ v: version, n }));
  C.shown = n <= MAX_SHOWS;
}
const markSeen = () => { store.set("seen", C.version); C.shown = false; };

/** 今日页顶上的新版本提示（不该出现时是空串） */
function releaseBadgeHTML(){
  if (!C.shown) return "";
  const r = C.releases.find(x => x.v === C.version); if (!r) return "";
  const first = titleOf(r), more = "";
  const tag = /^\s*href=/.test(C.open) ? "a" : "button";
  return `<div class="rl-badge" role="status">
    <${tag} ${tag === "button" ? 'type="button" ' : ""}class="rl-badge-main" ${C.open} data-rl="open" aria-label="${esc(`${tx("badge")} ${C.version}：${tx("see")}`)}">
      <span class="rl-pill">${esc(tx("badge"))}</span><span class="rl-badge-txt"><b class="rl-num">${esc(C.version)}</b> <span class="rl-badge-first">${esc(first)}${esc(more)}</span></span><span class="rl-badge-go" aria-hidden="true">›</span>
    </${tag}><button type="button" class="rl-x" data-rl="dismiss" aria-label="${esc(tx("dismiss"))}" title="${esc(tx("dismiss"))}">✕</button></div>`;
}

/* ---- 发布日志页 ---- */
const DAY = 864e5;
function filtered(){
  const since = { d7: 7, d30: 30, d90: 90 }[ST.range], from = since ? new Date(Date.now() - (since - 1) * DAY).toISOString().slice(0, 10) : "";
  const list = C.releases.filter(r => !from || dateOf(r.v) >= from)
    .map(r => ({ ...r, items: r.items.filter(it => ST.type === "all" || it.k === ST.type) })).filter(r => r.items.length);
  // 版本号 YYYY-MM-DD.N：按日期再按 N 排
  const key = r => { const [d, n] = String(r.v).split("."); return `${d}.${String(n || 0).padStart(3, "0")}`; };
  return list.sort((a, b) => (ST.sort === "old" ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a))));
}
const dayTitle = d => { try { return new Date(d + "T12:00:00").toLocaleDateString(lg() === "en" ? "en-US" : lg() === "tw" ? "zh-TW" : "zh-CN", { year: "numeric", month: "short", day: "numeric", weekday: "short" }); } catch { return d; } };
const itemsHTML = items => `<ul class="rl-items">${items.map(it => `<li><span class="rl-k rl-k-${esc(it.k)}">${esc(tx(it.k) || it.k)}</span><span class="rl-it">${esc(itemText(it))}</span></li>`).join("")}</ul>`;
const sumHTML = r => (r.title ? `<p class="rl-sum">${esc(itemText(r.title))}</p>` : "");
const curPill = r => (r.v === C.version ? `<span class="rl-cur">${esc(tx("thisv"))}</span>` : "");
/* 版本号还没启用之前（v 只有日期）：标「当天更新」 */
const hasNum = r => /\.\d+$/.test(String(r.v));
const verLabel = r => (hasNum(r) ? `<b class="rl-num">${esc(r.v)}</b>` : `<b>${esc(tx("early"))}</b>`);
const dateTag = r => `<time class="rl-date" datetime="${esc(dateOf(r.v))}">${esc(dayTitle(dateOf(r.v)))}</time>`;
const verBlock = r => `${sumHTML(r)}${itemsHTML(r.items)}`;
function byDay(list){ const gs = []; list.forEach(r => { const d = dateOf(r.v), g = gs[gs.length - 1]; if (g && g.d === d) g.rs.push(r); else gs.push({ d, rs: [r] }); }); return gs; }
function bodyHTML(){
  const all = filtered(), notes = all.reduce((s, r) => s + r.items.length, 0), day = ST.group === "day";
  // 分批：按版本时一批 10 个版本，按天时一批 10 天
  const units = day ? byDay(all) : all, shown = units.slice(0, ST.n), rest = units.length - shown.length;
  let body;
  if (!all.length) body = `<div class="rl-empty">${esc(tx("empty"))}${ST.type !== "all" || ST.range !== "all" ? ` <button type="button" class="rl-link" data-rl="clear">${esc(tx("clear"))}</button>` : ""}</div>`;
  else if (ST.view === "timeline" && day)
    body = `<div class="rl-tl">${shown.map(g => `<section class="rl-day"><h3 class="rl-day-h">${esc(dayTitle(g.d))}${g.rs.length > 1 ? ` <span class="rl-sub">${esc(tx("nver", { n: g.rs.length }))}</span>` : ""}</h3>${g.rs.map(r => `<div class="rl-tl-v"><div class="rl-tl-vh">${verLabel(r)}${curPill(r)}</div>${verBlock(r)}</div>`).join("")}</section>`).join("")}</div>`;
  else if (ST.view === "timeline")
    body = `<div class="rl-tl">${shown.map(r => `<section class="rl-day"><h3 class="rl-day-h rl-vh">${verLabel(r)}${curPill(r)}${dateTag(r)}</h3><div class="rl-tl-v">${verBlock(r)}</div></section>`).join("")}</div>`;
  else if (day)
    body = `<div class="rl-cards">${shown.map(g => `<article class="rl-card"><header class="rl-card-h"><b>${esc(dayTitle(g.d))}</b>${g.rs.length > 1 ? `<span class="rl-date">${esc(tx("nver", { n: g.rs.length }))}</span>` : ""}</header>${g.rs.map(r => `<div class="rl-dv"><div class="rl-dv-h">${verLabel(r)}${curPill(r)}</div>${verBlock(r)}</div>`).join("")}</article>`).join("")}</div>`;
  else body = `<div class="rl-cards">${shown.map(r => `<article class="rl-card"><header class="rl-card-h">${verLabel(r)}${curPill(r)}${dateTag(r)}</header>${verBlock(r)}</article>`).join("")}</div>`;
  const more = !all.length ? "" : rest > 0 ? `<div class="rl-more"><button type="button" class="rl-more-btn" data-rl="more">${esc(tx(day ? "mored" : "more", { k: Math.min(PAGE, rest), r: rest }))}</button></div>` : units.length > PAGE ? `<p class="rl-end">${esc(tx("end"))}</p>` : "";
  const seg = `<div class="rl-seg" role="group" aria-label="${esc(tx("view"))}">${["list", "timeline"].map(v => `<button type="button" data-rl="view" data-v="${v}" aria-pressed="${ST.view === v}">${esc(tx(v))}</button>`).join("")}</div>`;
  const count = day ? tx("countd", { d: units.length, v: all.length, n: notes }) : tx("count", { v: all.length, n: notes });
  return `<div class="rl-bar"><span class="rl-count">${esc(count)}</span>${seg}</div>${body}${more}`;
}
const sel = (k, label, opts) => `<label class="rl-f"><span>${esc(label)}</span><select data-rl-f="${k}">${opts.map(([v, l]) => `<option value="${v}" ${ST[k] === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
function releasePageHTML(){
  if (C.shown) markSeen();   // 打开过发布日志页：提示就不再出现
  const filters = `<div class="rl-filter" role="group" aria-label="${esc(tx("filters"))}">
    ${sel("type", tx("type"), [["all", tx("all")], ["new", tx("new")], ["better", tx("better")], ["fix", tx("fix")]])}
    ${sel("range", tx("time"), [["all", tx("all")], ["d7", tx("d7")], ["d30", tx("d30")], ["d90", tx("d90")]])}
    ${sel("sort", tx("sort"), [["new", tx("newest")], ["old", tx("oldest")]])}
    ${sel("group", tx("group"), [["ver", tx("gver")], ["day", tx("gday")]])}</div>`;
  return `<div class="rl" id="rlPage">
    <div class="rl-head"><div><h2 class="rl-title">${esc(tx("title"))}</h2><p class="rl-intro">${esc(tx("intro"))}</p></div><span class="rl-curv">${esc(tx("cur"))} <b class="rl-num">${esc(C.version)}</b></span></div>
    ${filters}
    <div id="rlBody">${bodyHTML()}</div>
  </div>`;
}
/** 只重画列表那块（筛选、视图、加载更多）；keep = 加载更多时不跳动 */
function repaint(){ const b = document.getElementById("rlBody"); if (b) { b.innerHTML = bodyHTML(); watchMore(); } }

/* 「再显示」：按钮滑到屏幕里就自动加载下一批（滚动阅读不用停下来点）；按钮本身保留，键盘、读屏照样能点 */
let io = null;
function watchMore(){
  if (!("IntersectionObserver" in window)) return;
  io?.disconnect();
  const btn = document.querySelector("#rlPage [data-rl='more']"); if (!btn) return;
  io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); setTimeout(() => { if (document.body.contains(btn)) loadMore(); }, 150); } }, { rootMargin: "120px" });
  io.observe(btn);
}
function loadMore(){ ST.n += PAGE; repaint(); }

document.addEventListener("click", e => {
  const el = e.target.closest?.("[data-rl]"); if (!el) return;
  const a = el.dataset.rl;
  if (a === "open") { markSeen(); return; }   // 让应用自己的导航接着处理（data-tab / href）
  if (a === "dismiss") { e.preventDefault(); e.stopPropagation(); markSeen(); el.closest(".rl-badge")?.remove(); return; }
  if (a === "more") { loadMore(); return; }
  if (a === "view") { ST.view = el.dataset.v === "timeline" ? "timeline" : "list"; store.set("view", ST.view); ST.n = PAGE; repaint(); return; }
  if (a === "clear") { ST.type = "all"; ST.range = "all"; ST.n = PAGE; document.querySelectorAll("#rlPage [data-rl-f]").forEach(s => { s.value = ST[s.dataset.rlF]; }); repaint(); }
}, true);
document.addEventListener("change", e => {
  const s = e.target.closest?.("[data-rl-f]"); if (!s) return;
  e.stopPropagation(); ST[s.dataset.rlF] = s.value; ST.n = PAGE;
  if (s.dataset.rlF === "group") store.set("group", ST.group);   // 分组：这台设备记住，下次默认就是它
  repaint();
}, true);
// 页面换进来之后（应用 render 完）接上自动加载
new MutationObserver(() => { const p = document.getElementById("rlPage"); if (p && !p._rl) { p._rl = 1; watchMore(); } }).observe(document.documentElement, { childList: true, subtree: true });

/* ---- 样式：用各应用自己的 --bg / --surface / --ink / --muted / --line，强调色 --rl-accent ---- */
function injectCSS(){
  if (document.getElementById("rl-css")) return;
  const s = document.createElement("style"); s.id = "rl-css";
  s.textContent = `
.rl-badge{display:flex;align-items:stretch;gap:0;margin:0 0 12px;border:1px solid color-mix(in srgb,var(--rl-accent,#3b6ea5) 45%,var(--line));border-radius:12px;background:color-mix(in srgb,var(--rl-accent,#3b6ea5) 9%,var(--surface));overflow:hidden;min-width:0}
.rl-badge-main{all:unset;box-sizing:border-box;flex:1;min-width:0;display:flex;align-items:center;gap:10px;padding:9px 6px 9px 12px;min-height:44px;cursor:pointer;color:var(--ink);font-size:14px;line-height:1.35;text-decoration:none}
.rl-badge-main:focus-visible,.rl-x:focus-visible{outline:2px solid var(--rl-accent,#3b6ea5);outline-offset:-3px;border-radius:10px}
.rl-pill{flex:none;font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--rl-accent,#3b6ea5);color:var(--surface);white-space:nowrap}
.rl-badge-txt{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rl-badge-first{color:var(--muted)}
.rl-badge-go{flex:none;font-size:20px;line-height:1;color:var(--rl-accent,#3b6ea5)}
.rl-x{all:unset;box-sizing:border-box;flex:none;display:grid;place-items:center;width:44px;color:var(--muted);font-size:14px;cursor:pointer;border-left:1px solid color-mix(in srgb,var(--rl-accent,#3b6ea5) 25%,var(--line))}
.rl-x:hover{color:var(--ink);background:color-mix(in srgb,var(--rl-accent,#3b6ea5) 12%,transparent)}
.rl-num{font-variant-numeric:tabular-nums;font-weight:700}
.rl{min-width:0}
.rl-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px 16px;flex-wrap:wrap;margin:4px 0 12px}
.rl-title{margin:0 0 2px}
.rl-intro{margin:0;font-size:13px;color:var(--muted)}
.rl-curv{flex:none;font-size:13px;color:var(--muted);padding:5px 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface);white-space:nowrap}
.rl-curv .rl-num{color:var(--ink)}
.rl-filter{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.rl-f{display:grid;gap:4px;min-width:0}
.rl-f>span{font-size:12px;color:var(--muted)}
.rl-f select{display:block;width:100%;min-width:0;min-height:40px;padding:7px 30px 7px 11px;border:1px solid var(--line);border-radius:10px;background-color:var(--surface);color:var(--ink);font:inherit;font-size:15px;text-overflow:ellipsis;cursor:pointer;-webkit-appearance:none;appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 16px) 52%,calc(100% - 11px) 52%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
.rl-f select:focus-visible{outline:2px solid var(--rl-accent,#3b6ea5);outline-offset:1px}
.rl-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:14px 0 10px}
.rl-seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--surface)}
.rl-seg button{all:unset;box-sizing:border-box;min-height:36px;padding:6px 16px;font-size:14px;color:var(--muted);cursor:pointer}
.rl-seg button+button{border-left:1px solid var(--line)}
.rl-seg button[aria-pressed="true"]{background:var(--rl-accent,#3b6ea5);color:var(--surface);font-weight:600}
.rl-seg button:focus-visible{outline:2px solid var(--rl-accent,#3b6ea5);outline-offset:-2px}
.rl-count{font-size:13px;color:var(--muted);min-width:0}
.rl-sub{font-weight:400;font-size:12.5px;color:var(--muted);margin-left:4px}
.rl-vh{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rl-vh .rl-date{margin-left:auto;font-weight:400}
.rl-dv{padding:10px 0 0;margin-top:10px;border-top:1px solid var(--line)}
.rl-card-h + .rl-dv{border-top:0;margin-top:0;padding-top:2px}
.rl-dv-h{display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:13px;color:var(--muted)}
.rl-sum{margin:0 0 8px;font-size:15px;font-weight:600;line-height:1.45;color:var(--ink)}
.rl-cards{display:grid;gap:10px}
.rl-card{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:12px 14px}
.rl-card-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.rl-date{margin-left:auto;font-size:12.5px;color:var(--muted);white-space:nowrap}
.rl-cur{font-size:11.5px;font-weight:700;padding:1px 8px;border-radius:999px;border:1px solid var(--rl-accent,#3b6ea5);color:var(--rl-accent,#3b6ea5)}
.rl-items{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.rl-items li{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:baseline;padding-left:14px;font-size:14px;line-height:1.5;color:var(--ink)}
.rl-items li::before{content:"";position:absolute;left:2px;top:.62em;width:5px;height:5px;border-radius:50%;background:var(--muted)}
.rl-k{font-size:11.5px;font-weight:700;padding:1px 7px;border-radius:6px;white-space:nowrap;min-width:3.6em;text-align:center;box-sizing:border-box}
.rl-k-new{background:color-mix(in srgb,#2f8f5b 16%,var(--surface));color:color-mix(in srgb,#2f8f5b 80%,var(--ink))}
.rl-k-better{background:color-mix(in srgb,var(--rl-accent,#3b6ea5) 16%,var(--surface));color:color-mix(in srgb,var(--rl-accent,#3b6ea5) 80%,var(--ink))}
.rl-k-fix{background:color-mix(in srgb,#c0743a 18%,var(--surface));color:color-mix(in srgb,#c0743a 80%,var(--ink))}
.rl-it{overflow-wrap:anywhere}
.rl-tl{border-left:2px solid var(--line);margin-left:6px;padding-left:16px}
.rl-day{position:relative;margin-bottom:14px}
.rl-day::before{content:"";position:absolute;left:-23px;top:4px;width:10px;height:10px;border-radius:50%;background:var(--rl-accent,#3b6ea5);border:2px solid var(--bg)}
.rl-day-h{margin:0 0 6px;font-size:14px;font-weight:700;color:var(--ink)}
.rl-tl-v{border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:9px 12px;margin-bottom:8px}
.rl-tl-vh{display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:13px;color:var(--muted)}
.rl-empty{padding:28px 12px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:12px}
.rl-link{all:unset;cursor:pointer;color:var(--rl-accent,#3b6ea5);text-decoration:underline;text-underline-offset:3px;margin-left:6px}
.rl-more{display:flex;justify-content:center;margin:12px 0 4px}
.rl-more-btn{all:unset;box-sizing:border-box;min-height:40px;padding:8px 18px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink);font-size:14px;cursor:pointer}
.rl-more-btn:hover{border-color:var(--rl-accent,#3b6ea5)}
.rl-more-btn:focus-visible{outline:2px solid var(--rl-accent,#3b6ea5);outline-offset:2px}
.rl-end{text-align:center;font-size:12.5px;color:var(--muted);margin:12px 0 4px}
@media (max-width:640px){.rl-filter{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:480px){.rl-filter{gap:8px;padding:10px 12px}.rl-f select{font-size:14px;padding:7px 24px 7px 9px;background-position:calc(100% - 13px) 52%,calc(100% - 8px) 52%}.rl-seg button{padding:6px 12px}.rl-items li{font-size:13.5px}.rl-sum{font-size:14.5px}.rl-badge-main{font-size:13.5px;gap:8px}}
@media print{.rl-badge{display:none!important}}`;
  document.head.appendChild(s);
}

export { initReleases, releaseBadgeHTML, releasePageHTML, markSeen as markReleaseSeen };
