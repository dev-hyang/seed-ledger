/* 记录列表（统一控件）：一天里「几点做了什么」的列表，两种样子——列表（每行：时间 · 色块 · 内容）和时间轴（竖线 + 圆点 + 卡片，两条之间标出间隔）。
 * 外观取自宝宝日志的「今天 / 记录」列表（entry / axis）；样式在 shared/ui.css 的 .ui-rec* / .ui-axis* / .ui-pill2。
 * 【母版在 home-pantry/shared/】姊妹站各留逐字相同的副本 js/shared/ui-reclist.js（check-shared.mjs 会比）。文件不引用站内模块（只用同目录的 ui-viewsw.js）：翻译函数由调用方传 t。
 *
 *   viewToggleHTML(options, current, { attr, attrs, label, t })
 *     视图切换的统一规则：只有两个视图 → 小药丸（并排两个按钮，当前的亮）；两个以上 → 视图切换条（下拉，ui-viewsw）。
 *     options = [[值, 名称], …]；点哪个就是点一个 <button>，值放在 data-{attr}（默认 v），attrs = 每个按钮都带的其他 data-* 串。
 *   recListBarHTML({ left, style, attr, attrs, t })
 *     一条工具栏：左边 left（调用方给的 HTML：标题 / 条数）+ 右边「列表 | 时间轴」切换（两个视图 → 小药丸）。style = "rows"（默认）| "axis"。
 *   recListHTML(items, { style, limit, gapText })
 *     items = [{ id, time, ts, color, icon, title, sub, notes, by, tags, attrs, rowAttrs, swipe, acts, flash }]（新的在前）
 *       time = 显示的时间文字；ts = 毫秒（时间轴用它算两条之间隔多久，没有就不标）
 *       title / sub / by / tags[] / notes[] 都是纯文字（控件负责转义）；icon 是现成的图标 HTML（表情字符或 <svg>，调用方保证安全，用户输入的要先转义）；notes 里可以写 { text, tone: "warn" }；tags = 作者、「仅我」这类附注，接在内容后面
 *       attrs = 点这一行主体（打开编辑）带的 data-* 串；rowAttrs = 整行容器上带的 data-* 串（点时间那一格也算点这一行，左滑删除要从这里读 id）
 *       swipe = 左滑删除的种类（写成容器上的 data-swipe-del，配合各站的 swipe-rows.js）；acts = 行右边的按钮 HTML；flash = 刚保存的那行，淡入高亮
 *     limit = 只画前几条（时间轴下面那条的间隔仍然按后面那条没画出来的算）；gapText(ms) → 两条之间的文字（如「2 小时 5 分」），不给就不标。 */
import { viewSwitchHTML } from "./ui-viewsw.js";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function viewToggleHTML(options, current, { attr = "v", attrs = "", label = "显示方式", t = x => x } = {}) {
  const list = (options || []).filter(Boolean);
  if (list.length < 2) return "";
  if (list.length > 2) return viewSwitchHTML(list, current, { attr, attrs, label, t });
  return `<div class="ui-pill2" role="group" aria-label="${esc(t(label))}">${list.map(o => `<button type="button" ${attrs} data-${attr}="${esc(o[0])}" aria-pressed="${String(o[0]) === String(current)}">${esc(t(o[1]))}</button>`).join("")}</div>`;
}

export function recListBarHTML({ left = "", style = "rows", attr = "v", attrs = "", t = x => x } = {}) {
  return `<div class="ui-recbar"><div class="ui-recbar-l">${left}</div>${viewToggleHTML([["rows", "列表"], ["axis", "时间轴"]], style === "axis" ? "axis" : "rows", { attr, attrs, label: "显示方式", t })}</div>`;
}

const noteHTML = n => { const o = typeof n === "string" ? { text: n } : n; return o && o.text ? `<span class="ui-rec-n ui-rec-note"${o.tone === "warn" ? ' data-tone="warn"' : ""}>${esc(o.text)}</span>` : ""; };
const bodyHTML = it => `<span class="ui-rec-s"><b>${esc(it.title)}</b>${it.sub ? ` · ${esc(it.sub)}` : ""}</span>${[it.by, ...(it.tags || [])].filter(Boolean).map(x => `<span class="ui-rec-n"> · ${esc(x)}</span>`).join("")}${(it.notes || []).map(noteHTML).join("")}`;
const main = it => `<button type="button" class="ui-rec-main" ${it.attrs || "disabled"}>${bodyHTML(it)}</button>`;
const rowAttr = it => `${it.rowAttrs ? ` ${it.rowAttrs}` : ""}${it.swipe ? ` data-swipe-del="${esc(it.swipe)}"` : ""}`;
const colorOf = it => esc(it.color || "var(--muted)");

function rowHTML(it) {
  return `<div class="ui-rec${it.flash ? " flash" : ""}" style="--c:${colorOf(it)}"${rowAttr(it)}><span class="ui-rec-t">${esc(it.time)}</span><span class="ui-rec-c" aria-hidden="true"></span>${main(it)}${it.acts ? `<span class="ui-rec-acts">${it.acts}</span>` : ""}</div>`;
}
function axisHTML(all, n, gapText) {
  return `<div class="ui-axis">${all.slice(0, n).map((it, i) => {
    const older = all[i + 1], gap = gapText && older && it.ts && older.ts ? it.ts - older.ts : 0;
    return `<div class="ui-anode${it.flash ? " flash" : ""}" style="--c:${colorOf(it)}"${rowAttr(it)}><span class="ui-anode-t">${esc(it.time)}</span><span class="ui-anode-dot" aria-hidden="true">${it.icon || ""}</span><div class="ui-anode-card">${main(it)}${it.acts ? `<span class="ui-rec-acts">${it.acts}</span>` : ""}</div></div>${gap >= 60e3 ? `<div class="ui-agap"><span>${esc(gapText(gap))}</span></div>` : ""}`;
  }).join("")}</div>`;
}
export function recListHTML(items, { style = "rows", limit = Infinity, gapText = null } = {}) {
  const all = items || [], n = Math.min(all.length, limit);
  return style === "axis" ? axisHTML(all, n, gapText) : `<div class="ui-reclist">${all.slice(0, n).map(rowHTML).join("")}</div>`;
}
