/* 折叠目录树（统一控件）：「目录」面板里的页面列表——按大类折叠，点 › 展开一项、看一项（同一层只展开一个）；当前页所在的那条路径默认展开，其余收起。
 * 外观取自爱家小助手的嵌套目录（treePop）；样式在 shared/ui.css 的 .ui-tree。
 * 【母版在 home-pantry/shared/】姊妹站各留逐字相同的副本 js/shared/ui-tree.js（check-shared.mjs 会比）。文件不引用站内模块：翻译函数由调用方传 t。
 *
 *   treeHTML(nodes, { label, t })
 *     nodes = [{ label, attrs, on?, children? }]：attrs = 点这一项做什么的 data-* 属性字符串（如 data-go="#/tasks"）；on = 正停在这一页（高亮 + ✓）
 *     有 children 的结点：点文字 = 去这一页，点右边的 › = 展开 / 收起下一层；当前页所在的大类，文字用强调色提示。
 *   watchTree()：入口调一次——处理 › 的展开 / 收起（手风琴）。控件本身不管打开 / 关闭面板，面板由调用方（筛选 / 目录弹层）负责。 */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hasCur = n => !!(n.on || (n.children || []).some(hasCur));

function node(n, lv, t) {
  const cur = n.on ? ' aria-current="page"' : "", ck = n.on ? '<span class="ui-tree-ck" aria-hidden="true">✓</span>' : "";
  const item = `<button type="button" role="menuitem" class="ui-tree-item${!n.on && hasCur(n) ? " has-cur" : ""}" ${n.attrs || ""}${cur}><span class="ui-tree-lbl">${esc(n.label)}</span>${ck}</button>`;
  if (!n.children || !n.children.length) return `<div class="ui-tree-node" data-lv="${lv}"><div class="ui-tree-row">${item}</div></div>`;
  const open = hasCur(n);   // 当前页所在的那一层默认展开
  return `<div class="ui-tree-node" data-lv="${lv}"><div class="ui-tree-row">${item}<button type="button" class="ui-tree-tg" data-tree-toggle aria-expanded="${open}" aria-label="${esc(t(n.label))}"><span aria-hidden="true">›</span></button></div>
    <div class="ui-tree-kids"${open ? "" : " hidden"}>${n.children.map(c => node(c, lv + 1, t)).join("")}</div></div>`;
}
export function treeHTML(nodes, { label = "目录", t = x => x } = {}) {
  return `<nav class="ui-tree" aria-label="${esc(t(label))}">${nodes.map(n => node(n, 0, t)).join("")}</nav>`;
}

let watching = false;
export function watchTree() {
  if (watching || typeof document === "undefined") return; watching = true;
  document.addEventListener("click", e => {
    const b = e.target.closest?.("[data-tree-toggle]"); if (!b) return;
    const nd = b.closest(".ui-tree-node"), kids = nd.querySelector(":scope > .ui-tree-kids"), on = kids.hidden;
    if (on) nd.parentElement.querySelectorAll(":scope > .ui-tree-node").forEach(s => { if (s !== nd) { const k = s.querySelector(":scope > .ui-tree-kids"); if (k) k.hidden = true; s.querySelectorAll(":scope > .ui-tree-row > [data-tree-toggle]").forEach(x => x.setAttribute("aria-expanded", "false")); } });
    kids.hidden = !on; b.setAttribute("aria-expanded", String(on));
  });
}
