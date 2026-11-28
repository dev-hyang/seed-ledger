/* 视图切换（统一控件）：靠右的深色圆角按钮「切换 [切换图标] 当前视图名」（前面的小字「切换」提示这里可以切换），点开列出几种视图（当前的打 ✓），选中后收起，只显示当前的。
 * 外观取自爱家小助手的「物品 / 分类」视图切换；样式在 shared/ui.css 的 .ui-vsw。
 * 【母版在 home-pantry/shared/】姊妹站各留逐字相同的副本 js/shared/ui-viewsw.js（check-shared.mjs 会比）。文件不引用站内模块：翻译函数由调用方传 t。
 *
 *   viewSwitchHTML(options, current, { attr, attrs, label, t })
 *     options = [[值, 名称], …]（少于 2 项返回空串）；current = 当前值
 *     attr    = 值放在哪个 data-xx（默认 v，即 data-v="值"）；attrs = 每个选项上都带的其他属性字符串（如 'data-hl="vf" data-k="mode"'）
 *     label   = 读屏名字（默认「视图」）；t = 翻译函数（默认原样）
 *   watchViewSwitch()：入口调一次——点外面 / Esc / 点了某一项会把打开的菜单收起（页面重画时本来就收起）。
 *   点选项就是点一个 <button>：页面自己的点击处理读 data-xx 即可，控件本身不管状态。 */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/** 统一的「切换」图标（2×2 方块）：不随视图变，只提示「这里可以切换」 */
const ICON = '<svg class="ui-vsw-ic" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.4"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1.4"/><rect x="1.5" y="9" width="5.5" height="5.5" rx="1.4"/><rect x="9" y="9" width="5.5" height="5.5" rx="1.4"/></svg>';

export function viewSwitchHTML(options, current, { attr = "v", attrs = "", label = "视图", t = x => x } = {}) {
  const list = (options || []).filter(Boolean);
  if (list.length < 2) return "";
  const cur = list.find(o => String(o[0]) === String(current)) || list[0];
  return `<details class="ui-vsw"><summary aria-label="${esc(`${t(label)}：${t(cur[1])}`)}" title="${esc(t(label))}"><span class="ui-vsw-hint">${esc(t("切换"))}</span>${ICON}<span class="ui-vsw-cur">${esc(t(cur[1]))}</span><span class="ui-vsw-caret" aria-hidden="true">▾</span></summary>
    <div class="ui-vsw-menu" role="menu" aria-label="${esc(t(label))}">${list.map(o => `<button type="button" class="ui-vsw-item" role="menuitemradio" aria-checked="${String(o[0]) === String(cur[0])}" ${attrs} data-${attr}="${esc(o[0])}"><span>${esc(t(o[1]))}</span>${String(o[0]) === String(cur[0]) ? '<span class="ui-vsw-ok" aria-hidden="true">✓</span>' : ""}</button>`).join("")}</div></details>`;
}

let watching = false;
export function watchViewSwitch() {
  if (watching || typeof document === "undefined") return; watching = true;
  const closeAll = except => document.querySelectorAll("details.ui-vsw[open]").forEach(d => { if (d !== except) d.open = false; });
  document.addEventListener("click", e => closeAll(e.target.closest?.("details.ui-vsw")?.querySelector("summary") && !e.target.closest(".ui-vsw-item") ? e.target.closest("details.ui-vsw") : null));
  document.addEventListener("keydown", e => { if (e.key === "Escape") { const d = document.querySelector("details.ui-vsw[open]"); if (d) { d.open = false; d.querySelector("summary").focus(); } } });
}
