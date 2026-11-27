/* 进度虚线条（统一控件）：一排短横条，第 n 条亮起 = 现在在第 n 项 / 第 n 步。样式在 shared/ui.css 的 .ui-dashbar。
 * 两种样子（同一个控件的变体）：
 *   默认（不带序号）：只有横条——今天页顶部的卡片切换；点哪条去哪张（clickable）。
 *   numbered（带序号）：左边多一句「2 / 5」——向导 / 分步表单；通常不可点。
 *   steps：当前之前的横条染成「已完成」色（向导用）；不设 steps 则只有当前那条亮。
 * 【母版在 home-pantry/shared/】姊妹站各留逐字相同的副本 js/shared/ui-dashbar.js（check-shared.mjs 会比）。文件不引用站内模块：翻译函数由调用方传 t。
 *
 *   dashBarHTML(count, current, { attrs, label, numbered, steps, fill, clickable, text, t })
 *     count = 总条数（<2 返回空串）；current = 当前是第几条（从 0 起）
 *     clickable = true：每条是 <button>，带 data-i="下标" 再加 attrs（如 'data-act="hero-go"'）；否则是不可点的 <i>
 *     numbered = true：加序号文字，默认「{n} / {m}」，可用 text 覆盖（已翻译好的整句）
 *     label = 读屏名字；fill = 横条拉伸占满一行 */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function dashBarHTML(count, current, { attrs = "", label = "", numbered = false, steps = false, fill = false, clickable = false, text = "", t = x => x } = {}) {
  if (!(count >= 2)) return "";
  const cur = Math.min(count - 1, Math.max(0, current | 0));
  const bars = Array.from({ length: count }, (_, i) => {
    const st = i === cur ? ' aria-current="true"' : "", dn = steps && i < cur ? " data-done" : "";
    return clickable
      ? `<button type="button" class="ui-dash" ${attrs} data-i="${i}" aria-label="${i + 1} / ${count}"${st}${dn}></button>`
      : `<i class="ui-dash"${st}${dn} aria-hidden="true"></i>`;
  }).join("");
  const n = numbered ? `<span class="ui-dashbar-n" role="status">${esc(text || `${cur + 1} / ${count}`)}</span>` : "";
  return `<div class="ui-dashbar"${numbered ? " data-numbered" : ""}${fill ? " data-fill" : ""} role="group"${label ? ` aria-label="${esc(t(label))}"` : ""}>${n}<span class="ui-dashbar-bars">${bars}</span></div>`;
}
