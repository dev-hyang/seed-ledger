// 母版在 home-pantry/shared/ui-acts.js；改了母版要同步到这里（四个姊妹站的副本逐字相同，check-shared.mjs 会比）。
/* 按钮条 ui-acts 的排序（shared/ui.css 里 ui-acts 的搭档）：一条按钮条里有两个以上按钮时，
 *  「取消 / 关闭」这类放最前（靠左），主按钮（data-tone="primary"）放最后（靠右），其余按原来的顺序夹在中间。
 * 做法：watchActs() 用一个 MutationObserver 盯着整页，每次页面重画出新的按钮条就排一次（只挪已有的节点，事件和样式不受影响）。
 * 只管 .ui-acts 里直接的 .ui-btn 子节点；每条只排一次（data-sorted）。
 * 母版在 home-pantry/shared/；四个姊妹站各留一份逐字相同的副本（check-shared.mjs 会比）。 */
const CANCEL_TEXT = /^(取消|放弃|稍后再说|关闭|不用了|Cancel|Discard|Later|Close)$/i;

/** 是不是「取消」类按钮：文字是取消 / 关闭…，或 data-act 以 cancel / close 结尾 */
export const isCancelBtn = (el) => CANCEL_TEXT.test(el.textContent.trim()) || /(cancel|close|discard)$/i.test(el.dataset?.act || el.dataset?.action || "");

/** 排一条按钮条：取消类在前、主按钮在后；少于两个按钮不动 */
export function arrangeActs(bar) {
  const btns = [...bar.children].filter((c) => c.classList.contains("ui-btn"));
  if (btns.length < 2) return;
  const cancel = btns.filter(isCancelBtn), main = btns.filter((b) => b.dataset.tone === "primary" && !cancel.includes(b));
  [...cancel].reverse().forEach((b) => bar.prepend(b));
  main.forEach((b) => bar.append(b));
}

const sortAll = (root) => root.querySelectorAll(".ui-acts:not([data-sorted])").forEach((bar) => { bar.dataset.sorted = "1"; arrangeActs(bar); });

/** 开始盯着整页：每次出现新的按钮条就排一次（姊妹站在入口调用一次；爱家小助手由 core/form-actions.js 自己排） */
export function watchActs() {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  let queued = false;
  const run = () => { queued = false; sortAll(document); };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState !== "loading") run(); else document.addEventListener("DOMContentLoaded", run);
}
