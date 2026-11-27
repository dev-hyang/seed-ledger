/* 记录列表（统一控件）：一天里「几点做了什么」的列表，两种样子——列表（每行：时间 · 色块 · 内容）和时间轴（竖线 + 圆点 + 卡片，两条之间标出间隔）。
 * 外观取自宝宝日志的「今天 / 记录」列表（entry / axis）；样式在 shared/ui.css 的 .ui-rec* / .ui-axis*。
 * 【母版在 home-pantry/shared/】姊妹站各留逐字相同的副本 js/shared/ui-reclist.js（check-shared.mjs 会比）。文件不引用站内模块：翻译函数由调用方传 t。
 *
 *   recListBarHTML({ left, style, attrs, t })
 *     一条工具栏：左边 left（调用方给的 HTML：标题 / 条数）+ 右边「列表 | 时间轴」视图切换（视图切换条 ui-vsw）。
 *     style = "rows"（默认）| "axis"；attrs = 切换项上带的 data-* 串（如 'data-act="rec-style"'），选项值在 data-v。
 *   recListHTML(items, { style, gapText, t })
 *     items = [{ id, time, ts, color, icon, title, sub, notes, by, attrs, acts, flash }]（新的在前）
 *       time = 显示的时间文字；ts = 毫秒（时间轴用它算两条之间隔多久，没有就不标）
 *       title / sub / notes[] / by / icon 都是纯文字（控件负责转义）；notes 里可以写 { text, tone: "warn" }
 *       attrs = 点这一行主体（打开编辑）要带的 data-* 串；acts = 行右边的按钮 HTML（编辑 / 删除，调用方给）；flash = 刚保存的那行，淡入高亮
 *     gapText(ms) → 两条之间的文字（如「2 小时 5 分」）；不给就不标。 */
import { viewSwitchHTML } from "./ui-viewsw.js";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function recListBarHTML({ left = "", style = "rows", attrs = "", t = x => x } = {}) {
  return `<div class="ui-recbar"><div class="ui-recbar-l">${left}</div>${viewSwitchHTML([["rows", "列表"], ["axis", "时间轴"]], style === "axis" ? "axis" : "rows", { attrs, label: "显示方式", t })}</div>`;
}

const notesHTML = (it, cls) => (it.notes || []).filter(Boolean).map(n => { const o = typeof n === "string" ? { text: n } : n; return `<span class="${cls} ui-rec-note"${o.tone === "warn" ? ' data-tone="warn"' : ""}>${esc(o.text)}</span>`; }).join("");
const bodyHTML = (it, cls) => `<span class="ui-rec-s"><b>${esc(it.title)}</b>${it.sub ? ` · ${esc(it.sub)}` : ""}</span>${it.by ? `<span class="${cls}"> · ${esc(it.by)}</span>` : ""}${notesHTML(it, cls)}`;
const mainAttrs = it => `${it.attrs || ""}${it.attrs ? "" : " disabled"}`;

function rowHTML(it) {
  return `<div class="ui-rec${it.flash ? " flash" : ""}" style="--c:${esc(it.color || "var(--muted)")}"><span class="ui-rec-t">${esc(it.time)}</span><span class="ui-rec-c" aria-hidden="true"></span><button type="button" class="ui-rec-main" ${mainAttrs(it)}>${bodyHTML(it, "ui-rec-n")}</button>${it.acts ? `<span class="ui-rec-acts">${it.acts}</span>` : ""}</div>`;
}
function axisHTML(items, gapText) {
  return `<div class="ui-axis">${items.map((it, i) => {
    const older = items[i + 1], gap = gapText && older && it.ts && older.ts ? it.ts - older.ts : 0;
    return `<div class="ui-anode${it.flash ? " flash" : ""}" style="--c:${esc(it.color || "var(--muted)")}"><span class="ui-anode-t">${esc(it.time)}</span><span class="ui-anode-dot" aria-hidden="true">${esc(it.icon || "")}</span><div class="ui-anode-card"><button type="button" class="ui-rec-main" ${mainAttrs(it)}>${bodyHTML(it, "ui-rec-n")}</button>${it.acts ? `<span class="ui-rec-acts">${it.acts}</span>` : ""}</div></div>${gap >= 60e3 ? `<div class="ui-agap"><span>${esc(gapText(gap))}</span></div>` : ""}`;
  }).join("")}</div>`;
}
export function recListHTML(items, { style = "rows", gapText = null } = {}) {
  const list = items || [];
  return style === "axis" ? axisHTML(list, gapText) : `<div class="ui-reclist">${list.map(rowHTML).join("")}</div>`;
}
