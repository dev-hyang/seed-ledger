/* ============ 会自己长高的文字框（姊妹应用的 AI 输入框共用这一套；baby-log / homeschool / shepherd 在 js/attach.js 里） ============
   给 <textarea data-autosize>：粘贴多少字就长多高，到屏幕一半才出现滚动条；页面重画、表单打开时新出现的也按内容定高。 */
function fit(el){
  const max = Math.max(180, Math.round(window.innerHeight * 0.5));
  el.style.height = "auto";
  const h = el.scrollHeight + 2;
  el.style.height = Math.min(h, max) + "px";
  el.style.overflowY = h > max ? "auto" : "hidden";
}
const fitAll = root => (root || document).querySelectorAll("textarea[data-autosize]").forEach(fit);
document.addEventListener("input", e => { if (e.target && e.target.matches && e.target.matches("textarea[data-autosize]")) fit(e.target); });
new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches && n.matches("textarea[data-autosize]")) fit(n); else if (n.querySelectorAll) fitAll(n); } })
  .observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("resize", () => fitAll());
export { fit, fitAll };
