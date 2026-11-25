/* 可输入的下拉（输入框 + <datalist> 建议）：电脑上换成和下拉统一的建议面板；原来的 <input>、name、值、事件都不变，页面不用改。
 * 看起来：还是那个输入框（右边多一个小箭头），点进去 / 聚焦就列出所有以前的选择（当前值高亮），打字就按文字筛选，点一项填进框里并收起；
 * 可以填列表以外的值（和 <select> 的区别）。键盘：↑↓ 移动、Enter 选中（没有高亮就照常提交表单）、Esc / Tab 收起。
 * 触屏（手机 / 平板）不替换：浏览器自带的建议条贴着键盘，手指不会因为页面滚动点错；自制面板在键盘弹出时位置会跳。
 * 不想换的输入框加 data-native。面板是一个全局的、position: fixed 的列表（不改输入框所在的布局；在 <dialog> 里就放进该 dialog，否则会被压在弹窗下面）。 */
// 【母版在 home-pantry/shared/】副本逐字相同。
import { touch } from "./ui-select.js";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let panel = null, cur = null;   // 全局只有一个面板；cur = 当前打开它的输入框
const want = (el) => el.matches?.("input[list]") && !el.dataset.native && !el.dataset.sugReady && !touch();

const optsOf = (inp) => [...(document.getElementById(inp.dataset.sugList)?.options || [])].filter((o) => o.value);
function ensurePanel() {
  if (panel) return panel;
  panel = document.createElement("div"); panel.className = "ssel-list sug-list"; panel.setAttribute("role", "listbox"); panel.hidden = true;
  panel.addEventListener("pointerdown", (e) => e.preventDefault());   // 点列表时输入框别失焦
  panel.addEventListener("click", (e) => { const row = e.target.closest(".ssel-opt"); if (row && cur) pick(cur, row.dataset.v); });
  return panel;
}
function place(inp) {
  const p = ensurePanel(), host = inp.closest("dialog[open]") || document.body;
  if (p.parentNode !== host) host.appendChild(p);
  const r = inp.getBoundingClientRect(), w = Math.min(Math.max(r.width, 220), window.innerWidth - 16);
  const below = window.innerHeight - r.bottom - 12, above = r.top - 12, up = below < 160 && above > below;
  p.style.width = w + "px"; p.style.maxHeight = Math.max(120, Math.min(300, up ? above : below)) + "px";
  const wantL = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), wantT = up ? r.top - p.offsetHeight - 4 : r.bottom + 4;
  p.style.left = wantL + "px"; p.style.top = wantT + "px";
  const m = p.getBoundingClientRect();   // 在有 transform 的弹窗里 fixed 是相对弹窗的：量一下实际位置，补上差值
  if (Math.abs(m.left - wantL) > 1) p.style.left = wantL + (wantL - m.left) + "px";
  if (Math.abs(m.top - wantT) > 1) p.style.top = wantT + (wantT - m.top) + "px";
}
function render(inp, typed) {
  const q = typed ? inp.value.trim().toLowerCase() : "", v = inp.value.trim();
  const rows = optsOf(inp).filter((o) => !q || o.value.toLowerCase().includes(q) || (o.label || "").toLowerCase().includes(q));
  panel.innerHTML = rows.map((o) => `<div class="ui-opt ssel-opt${o.value === v ? " is-cur" : ""}" role="option" aria-selected="${o.value === v}" data-v="${esc(o.value)}">${esc(o.value)}${o.label && o.label !== o.value ? ` <small class="muted">${esc(o.label)}</small>` : ""}</div>`).join("");
  return rows.length;
}
function open(inp, typed = false) {
  if (inp.readOnly || inp.disabled) return;
  cur = inp; ensurePanel();
  if (!render(inp, typed)) { close(); return; }
  panel.hidden = false; place(inp); inp.setAttribute("aria-expanded", "true");
  const c = panel.querySelector(".is-cur"); if (c && !typed) panel.scrollTop = Math.max(0, c.offsetTop - (panel.clientHeight - c.offsetHeight) / 2);
}
function close() { if (!panel) return; panel.hidden = true; cur?.setAttribute("aria-expanded", "false"); cur = null; }
function pick(inp, v) {
  inp.value = v; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true }));
  close(); inp.focus({ preventScroll: true });
}
function onKey(e) {
  const inp = e.target;
  if (e.key === "Escape") { if (cur === inp && !panel.hidden) { e.preventDefault(); close(); } return; }
  if (e.key === "Tab") { close(); return; }
  if (e.key === "ArrowDown" && (cur !== inp || panel.hidden)) { e.preventDefault(); open(inp); return; }
  if (cur !== inp || panel.hidden) return;
  const rows = [...panel.querySelectorAll(".ssel-opt")]; if (!rows.length) return;
  let i = rows.findIndex((r) => r.classList.contains("is-hl"));
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); i = Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))); rows.forEach((r) => r.classList.remove("is-hl")); rows[i].classList.add("is-hl"); rows[i].scrollIntoView({ block: "nearest" }); }
  else if (e.key === "Enter" && i >= 0) { e.preventDefault(); pick(inp, rows[i].dataset.v); }   // 没有高亮：照常提交表单
}
function enhance(inp) {
  inp.dataset.sugReady = "1"; inp.dataset.sugList = inp.getAttribute("list"); inp.removeAttribute("list");   // 去掉 list：不然浏览器自带的建议会和这个面板一起出现
  inp.classList.add("sug-in"); inp.setAttribute("role", "combobox"); inp.setAttribute("aria-autocomplete", "list"); inp.setAttribute("aria-expanded", "false");
  inp.addEventListener("focus", () => open(inp));
  inp.addEventListener("click", () => { if (cur !== inp || panel.hidden) open(inp); });
  inp.addEventListener("input", () => open(inp, true));
  inp.addEventListener("keydown", onKey);
  inp.addEventListener("blur", () => setTimeout(() => { if (cur === inp && document.activeElement !== inp) close(); }, 0));
}

export function initInputSuggest() {
  if (touch()) return;
  const scan = (root) => root.querySelectorAll && root.querySelectorAll("input[list]").forEach((el) => { if (want(el)) enhance(el); });
  scan(document);
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; setTimeout(() => { queued = false; scan(document); }, 0); }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("pointerdown", (e) => { if (cur && e.target !== cur && !panel.contains(e.target)) close(); }, true);
  window.addEventListener("resize", close);
  document.addEventListener("scroll", (e) => { if (cur && !panel.contains(e.target)) close(); }, true);   // 页面 / 容器滚动：收起（比跟着重新定位简单，也不会飘在原地）
}
