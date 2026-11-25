// 母版在 home-pantry/shared/ui-form.js；改了母版要同步到这里（姊妹站的副本逐字相同，check-shared.mjs 会比）。
/* 表单底部操作条 + ⋯ 菜单的 HTML 生成（shared/ui-form.css 的搭档；纯函数，不依赖页面，姊妹站原样复用）。
 *   formBar("edit", [{ role: "cancel", label: "取消", attrs: 'data-act="close"' }, { role: "save", label: "保存", attrs: 'type="submit"' }])
 *   formMenu([{ label: "删除", attrs: 'data-act="del"', tone: "danger" }], { label: "更多操作" })   // 没有菜单项返回 ""
 * 顺序由这里保证：取消 → 上一步 → 其他 → 下一步 → 保存；保存 / 下一步是主按钮。删除不进操作条，放 ⋯ 菜单。
 * attrs 是原样拼进标签的属性字符串（调用方自己转义）；label 会转义。母版在 home-pantry/shared/，副本要逐字相同。 */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const FORM_VARIANTS = ["edit", "wizard", "dialog", "inline"];
const ORDER = { cancel: 0, back: 1, extra: 2, next: 3, save: 4 };
const TONE = { cancel: "ghost", back: "ghost", extra: "ghost", next: "primary", save: "primary" };

/** 一条操作条；variant 不认识时当 edit；inline 的顺序是 保存 · 取消（设置页习惯），其余是取消在前 */
export function formBar(variant, items) {
  const v = FORM_VARIANTS.includes(variant) ? variant : "edit";
  const list = (items || []).filter(Boolean).map((it, i) => ({ ...it, role: it.role in ORDER ? it.role : "extra", i }));
  const rank = (it) => (v === "inline" && it.role === "save" ? -1 : v === "inline" && it.role === "cancel" ? 9 : ORDER[it.role]);
  list.sort((a, b) => rank(a) - rank(b) || a.i - b.i);
  const btn = (it) => `<button ${/\btype=/.test(it.attrs || "") ? "" : 'type="button" '}class="ui-btn" data-tone="${it.tone || TONE[it.role]}" data-role="${it.role}"${it.attrs ? ` ${it.attrs}` : ""}>${esc(it.label)}</button>`;
  return `<div class="ui-formbar" data-variant="${v}">${list.map(btn).join("")}</div>`;
}

/** 页头右上角的 ⋯ 菜单；菜单项 { label, attrs, tone }（tone = danger 显示成红字）；一项都没有时返回空串 */
export function formMenu(items, { label = "更多操作" } = {}) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return "";
  return `<details class="ui-more"><summary aria-label="${esc(label)}" title="${esc(label)}"><span aria-hidden="true">⋯</span></summary><div class="ui-more-menu">${list.map((it) => `<button type="button" class="ui-opt"${it.tone ? ` data-tone="${esc(it.tone)}"` : ""}${it.attrs ? ` ${it.attrs}` : ""}>${esc(it.label)}</button>`).join("")}</div></details>`;
}

/** 点菜单外面、按 Esc、点了菜单项：把打开着的 ⋯ 菜单关上（入口调用一次） */
export function watchFormMenus() {
  if (typeof document === "undefined") return;
  const closeAll = (except) => document.querySelectorAll(".ui-more[open]").forEach((d) => { if (d !== except) d.removeAttribute("open"); });
  document.addEventListener("click", (e) => { const own = e.target.closest?.(".ui-more"); closeAll(own); if (own && e.target.closest(".ui-more-menu")) own.removeAttribute("open"); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { const o = document.querySelector(".ui-more[open]"); if (o) { o.removeAttribute("open"); o.querySelector("summary")?.focus(); } } });
}
