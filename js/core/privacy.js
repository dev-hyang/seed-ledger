/* ============ 金额遮挡（隐私，和爱家小助手同一套控制） ============
   两种模式（记在这台设备上）：
     遮挡（外出，默认）：页面上所有金额模糊；点一个金额，它和同一行的金额露 10 秒；单击顶栏的眼睛 = 全部露 10 秒
     常显示（在家）    ：全部显示；单击眼睛 = 马上遮起来（切回遮挡）
   双击或长按眼睛 = 在两种模式之间切换；更多 → 设置里也能选。常显示时页面在后台放了 30 分钟以上，回来自动切回遮挡。
   哪些算金额：页面和弹层里所有「¥ / $ + 数字」的文字（money() / unitPrice() 的输出），自动找出来包成 .amt；
   表单（正在录入的那张单）、下拉框、打印的单据不遮。只是不让旁边的人一眼看到：数字仍在页面里，不是加密。 */
import { esc } from "./util.js";
import { t } from "./i18n.js";
import { LS_PREFIX } from "../config.js";

const KEY = LS_PREFIX + ".moneyMask", AWAY_KEY = LS_PREFIX + ".moneyAway", PEEK_MS = 10e3, AWAY_MS = 30 * 60e3, HOLD_MS = 550;
const AMT = /[-+−]?[¥$]\s?\d[\d,]*(?:\.\d+)?/g;
let toastFn = () => {};

const moneyHidden = () => { try { return localStorage.getItem(KEY) !== "0"; } catch (e) { return true; } };
function setMoneyHidden(hide){
  try { localStorage.setItem(KEY, hide ? "1" : "0"); } catch (e) { /* 隐私模式：只这次有效 */ }
  applyMode(); syncEyes();
}
function applyMode(){ document.documentElement.classList.toggle("money-hide", moneyHidden()); document.documentElement.classList.remove("money-peek"); }

/* 眼睛：闭眼 = 遮挡，睁眼 = 常显示；外圈是「露 10 秒」的倒计时 */
const EYE_OFF = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M3 10c2.2 3 5.4 4.6 9 4.6s6.8-1.6 9-4.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6 13.2 4.6 15.4M12 14.6v2.6M18 13.2l1.4 2.2M9 14.3l-.8 2.4M15 14.3l.8 2.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const EYE_ON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
const eyeLabel = hide => (hide ? t("金额已遮挡（外出）。单击：全部显示 10 秒；双击或长按：切到常显示（在家）") : t("金额常显示（在家）。单击：马上遮起来；双击或长按：切回遮挡（外出）"));
function moneyEye(cls = ""){
  const hide = moneyHidden();
  return `<button type="button" class="money-eye ${cls}" data-moneyeye aria-pressed="${!hide}" aria-label="${esc(eyeLabel(hide))}" title="${esc(eyeLabel(hide))}"><span class="me-ico">${hide ? EYE_OFF : EYE_ON}</span><svg class="me-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16"/></svg></button>`;
}
function syncEyes(){
  const hide = moneyHidden();
  document.querySelectorAll("[data-moneyeye]").forEach(b => { b.setAttribute("aria-pressed", String(!hide)); b.setAttribute("aria-label", eyeLabel(hide)); b.title = eyeLabel(hide); const i = b.querySelector(".me-ico"); if (i) i.innerHTML = hide ? EYE_OFF : EYE_ON; });
  document.querySelectorAll("[data-moneymode]").forEach(x => { x.checked = (x.value === "hide") === hide; });
}

/* ---- 找金额：文字里的「¥123」「$4.50」包成 <span class="amt">；SVG 图表里的文字给整条 <text> 加 .amt ---- */
const SKIP = "script, style, option, select, textarea, form, .amt, [data-nomask], .printarea";
function markMoney(root){
  if (!root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => {
    if (!n.nodeValue || !/[¥$]\s?\d/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
    const p = n.parentElement; if (!p || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  } });
  const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  for (const n of nodes) {
    const p = n.parentElement;
    if (p.closest("svg")) { (p.closest("text") || p).classList.add("amt"); continue; }
    const s = n.nodeValue, frag = document.createDocumentFragment(); let last = 0;
    s.replace(AMT, (m, i) => {
      if (i > last) frag.append(s.slice(last, i));
      const sp = document.createElement("span"); sp.className = "amt"; sp.textContent = m; frag.append(sp);
      last = i + m.length; return m;
    });
    if (last === 0) continue;
    if (last < s.length) frag.append(s.slice(last));
    n.replaceWith(frag);
  }
}
let queued = false;
const markSoon = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; ["main", "sheet"].forEach(id => markMoney(document.getElementById(id))); }); };

/* ---- 交互 ---- */
let peekTimer = 0, clickTimer = 0, holdTimer = 0, held = false;
function peekAll(){
  const root = document.documentElement; root.classList.add("money-peek");
  document.querySelectorAll("[data-moneyeye]").forEach(b => { b.classList.remove("is-counting"); void b.offsetWidth; b.classList.add("is-counting"); });
  clearTimeout(peekTimer); peekTimer = setTimeout(() => { root.classList.remove("money-peek"); document.querySelectorAll("[data-moneyeye]").forEach(b => b.classList.remove("is-counting")); }, PEEK_MS);
}
function switchMode(){
  const hide = !moneyHidden(); setMoneyHidden(hide);
  toastFn(hide ? t("已切回遮挡（外出）：点一个金额看 10 秒") : t("已切到常显示（在家）：页面在后台超过 30 分钟会自动切回遮挡"));
}
function singleTap(){
  if (moneyHidden()) { peekAll(); toastFn(t("显示 10 秒。要一直显示：双击或长按眼睛")); }
  else { setMoneyHidden(true); toastFn(t("已遮起来。要一直显示：双击或长按眼睛")); }
}
/** 点一个金额：露它所在的那一行（表格一行、列表一行、一个数字块）10 秒 */
const PEEK_BOX = "svg, tr, li, .kv, .row, .todo-item, .cp-row, .card-head";
function peekOne(el){
  const box = el.closest(PEEK_BOX), list = box ? box.querySelectorAll(".amt") : [el];
  list.forEach(a => { a.classList.add("is-peek"); clearTimeout(a._peek); a._peek = setTimeout(() => a.classList.remove("is-peek"), PEEK_MS); });
}

function initPrivacy({ toast } = {}){
  toastFn = toast || toastFn; applyMode();
  ["main", "sheet"].forEach(id => { const el = document.getElementById(id); if (el) new MutationObserver(markSoon).observe(el, { childList: true, subtree: true, characterData: true }); });
  markSoon();
  // 眼睛：单击 / 双击（300ms 内第二下）/ 长按（0.55 秒）
  document.addEventListener("pointerdown", e => {
    if (!e.target.closest?.("[data-moneyeye]")) return;
    held = false; clearTimeout(holdTimer); holdTimer = setTimeout(() => { held = true; clearTimeout(clickTimer); clickTimer = 0; switchMode(); }, HOLD_MS);
  });
  const cancelHold = () => clearTimeout(holdTimer);
  document.addEventListener("pointerup", cancelHold); document.addEventListener("pointercancel", cancelHold);
  document.addEventListener("contextmenu", e => { if (e.target.closest?.("[data-moneyeye]")) e.preventDefault(); });   // 长按不弹系统菜单
  document.addEventListener("click", e => {
    const b = e.target.closest?.("[data-moneyeye]");
    if (b) {
      e.preventDefault(); e.stopPropagation();
      if (held) { held = false; return; }
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = 0; switchMode(); return; }
      clickTimer = setTimeout(() => { clickTimer = 0; singleTap(); }, 300);
      return;
    }
    // 遮挡时点一个金额：先只露这一行 10 秒（它在可点的行里也先不打开，再点一次才进去）
    const root = document.documentElement; if (!root.classList.contains("money-hide") || root.classList.contains("money-peek")) return;
    const a = e.target.closest?.(".amt"); if (!a || a.classList.contains("is-peek")) return;
    e.preventDefault(); e.stopPropagation(); peekOne(a);
  }, true);
  // 设置里的单选：遮挡 / 常显示
  document.addEventListener("change", e => { const r = e.target.closest?.("[data-moneymode]"); if (r && r.checked) { e.stopPropagation(); setMoneyHidden(r.value === "hide"); } }, true);
  // 常显示时离开 30 分钟以上：回来自动切回遮挡
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { try { localStorage.setItem(AWAY_KEY, String(Date.now())); } catch (e) { /* 忽略 */ } return; }
    let at = 0; try { at = +localStorage.getItem(AWAY_KEY) || 0; } catch (e) { /* 忽略 */ }
    if (at && Date.now() - at >= AWAY_MS && !moneyHidden()) { setMoneyHidden(true); toastFn(t("离开超过 30 分钟，金额已自动遮挡")); }
  });
}

/** 设置里的一组单选：金额显示 遮挡（外出）/ 常显示（在家） */
const moneyModeHTML = () => { const hide = moneyHidden(); return `<div class="seg" role="radiogroup" aria-label="${esc(t("金额显示"))}"><label><input type="radio" name="moneymode" value="hide" data-moneymode ${hide ? "checked" : ""}><span>${esc(t("遮挡（外出）"))}</span></label><label><input type="radio" name="moneymode" value="show" data-moneymode ${hide ? "" : "checked"}><span>${esc(t("常显示（在家）"))}</span></label></div>`; };

export { initPrivacy, moneyEye, moneyHidden, setMoneyHidden, moneyModeHTML, markMoney };
