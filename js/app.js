/* ============ 入口：导航、渲染、事件分发 ============
   页面模块只负责「返回 HTML」和「往 ACT / FORMS / CHG / INP 登记处理函数」；这里用事件委托统一分发，不给每个按钮单独绑事件。 */
import { S, subscribe, canWrite } from "./core/state.js";
import { initCloud } from "./core/sync.js";
import { $, esc, toast, saveJSON } from "./core/util.js";
import { t, LOCALES, locale, setLocale } from "./core/i18n.js";
import { LS_PREFIX, CLOUD_CONFIGURED, APP_VERSION } from "./config.js";
import { MODULES } from "./modules.js";
import { ACT, FORMS, CHG, INP } from "./ui/actions.js";
import { show, back, closeAll, refresh, paint, formData, sheetOpen, askYes } from "./ui/kit.js";
import { renderHome } from "./ui/home.js";
import { renderSales } from "./ui/sales.js";
import { renderCustomers } from "./ui/customers.js";
import { renderStock } from "./ui/stock.js";
import { renderReports } from "./ui/reports.js";
import { renderMore, importFile } from "./ui/more.js";
import "./ui/print.js";
import "./ui/scan.js";

const ICON = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>', sales: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>', customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-4 3-6 6.5-6s5.900 2 6.500 6M16 5a3.500 3.500 0 010 6.500M18 14c2 .6 3.300 2.400 3.500 6"/>',
  stock: '<path d="M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8"/>', reports: '<path d="M4 20V4M4 20h16M8 16v-5M13 16V8M18 16v-8"/>', more: '<circle cx="5" cy="12" r="1.600"/><circle cx="12" cy="12" r="1.600"/><circle cx="19" cy="12" r="1.600"/>'
};
const TABS = [["home", "概览", renderHome], ["sales", "销售", renderSales], ["customers", "客户", renderCustomers], ["stock", "库存", renderStock], ["reports", "报表", renderReports], ["more", "更多", renderMore]];

function chrome(){
  const lang = `<select id="lang" aria-label="${esc(t("界面语言"))}">${LOCALES.map(([k, l]) => `<option value="${k}" ${k === locale() ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const pill = { local: "本机", signedout: "未登录", noorg: "未加入账本", pending: "待批准", online: S.pendingOps ? "同步中" : "已同步", offline: "离线" }[S.cloud];
  $("#top").innerHTML = `<span class="brand">🌾 ${esc(S.settings.name || t("稻种账本"))} <small class="appver" id="appver">v${esc(APP_VERSION)}</small></span><span class="top-tools">${lang}<button class="pill ${S.cloud}" data-tab="more" aria-label="${esc(t("同步状态"))}"><i></i>${esc(t(pill))}${S.pendingOps ? ` · ${S.pendingOps}` : ""}</button></span>`;
  $("#nav").innerHTML = TABS.map(([k, l]) => `<button data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg><span>${esc(t(l))}</span></button>`).join("");
  document.body.classList.toggle("is-offline", S.cloud === "offline");
}
function banner(){
  if (S.cloud === "signedout" && CLOUD_CONFIGURED) return `<div class="banner"><span>${esc(t("登录后数据会同步给合伙人，并在多台设备间保持一致。"))}</span><button class="btn sm primary" data-act="open-login">${esc(t("登录 / 注册"))}</button></div>`;
  if (S.cloud === "noorg") return `<div class="banner"><span>${esc(t("还没有经销商账本：创建一个，或用邀请码加入合伙人的账本。"))}</span><button class="btn sm primary" data-tab="more">${esc(t("去设置"))}</button></div>`;
  if (S.cloud === "pending") return `<div class="banner warn"><span>${esc(t("已申请加入，等待创建者批准。"))}</span></div>`;
  if (S.cloud === "offline") return `<div class="banner warn"><span>${esc(t("现在离线：可以照常录入，恢复网络后自动同步。"))}</span></div>`;
  if (S.role === "viewer") return `<div class="banner"><span>${esc(t("你是只读成员，只能查看。"))}</span></div>`;
  return "";
}
function render(){
  if (!S.ready) return;
  const main = $("#main"), active = document.activeElement, keep = active?.dataset?.input ? { k: active.dataset.input, s: active.selectionStart } : null, y = window.scrollY;
  chrome();
  main.innerHTML = banner() + (TABS.find(x => x[0] === S.tab) || TABS[0])[2]();
  if (keep) { const el = main.querySelector(`[data-input="${keep.k}"]`); if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.s); } catch (e) {} } }
  window.scrollTo(0, y);
  document.documentElement.lang = locale();
}
subscribe(() => { render(); refresh(); });

function goto(tab, sub){ S.tab = tab; if (sub) S.sub[tab] = sub; saveJSON(LS_PREFIX + ".tab", tab); closeAll(); render(); window.scrollTo(0, 0); }
ACT.goto = el => goto(el.dataset.tab, el.dataset.sub);
ACT.back = () => back();
ACT.close = () => closeAll();
ACT["ask-yes"] = () => askYes();

const guard = async fn => { try { await fn(); } catch (e) { toast(e.message === "readonly" ? t("你是只读成员，不能修改") : t("出错了：") + (e.message || e)); console.error(e); } };

document.addEventListener("click", e => {
  const tab = e.target.closest("[data-tab]:not([data-act])");
  if (tab) { goto(tab.dataset.tab); return; }
  const el = e.target.closest("[data-act]"); if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act]; if (!fn) return;
  e.preventDefault();
  guard(async () => { await fn(el, e); render(); refresh(); });
});
document.addEventListener("submit", e => {
  const f = e.target.closest("form[data-form]"); if (!f) return;
  e.preventDefault();
  const fn = FORMS[f.dataset.form]; if (!fn) return;
  const btn = document.querySelector(`button[form="${f.id}"]`); if (btn) btn.disabled = true;
  guard(async () => { await fn(formData(f), f); }).finally(() => { if (btn) btn.disabled = false; });
});
document.addEventListener("change", e => {
  const el = e.target;
  if (el.id === "lang") { setLocale(el.value); render(); return; }
  if (el.dataset.file === "import") { guard(() => importFile(el.files[0])); return; }
  const name = el.dataset.change; if (!name && !el.dataset.rep) return;
  const fn = el.dataset.rep ? CHG.rep : CHG[name]; if (!fn) return;
  guard(async () => { await fn(el, el.form); render(); refresh(); });
});
document.addEventListener("input", e => {
  const el = e.target, f = el.closest("form[data-input-form]");
  if (f && INP[f.dataset.inputForm]) { INP[f.dataset.inputForm](el, f); return; }
  if (el.dataset.input && INP[el.dataset.input]) { INP[el.dataset.input](el, el.form); if (!el.closest("dialog")) render(); }
});
$("#sheet").addEventListener("click", e => { if (e.target === e.currentTarget) closeAll(); });   // 点遮罩关闭
$("#sheet").addEventListener("close", () => { if (sheetOpen()) return; });
// 表单弹层打开后，跑一次该表单的「输入」处理（销售单的合计、讨账的预览）
new MutationObserver(() => { const f = $("#sheet form[data-input-form]"); if (f && !f.dataset.init) { f.dataset.init = "1"; INP[f.dataset.inputForm]?.(f.elements[0], f); } }).observe($("#sheet"), { childList: true, subtree: true });

if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
window.addEventListener("online", () => render());
window.addEventListener("offline", () => render());

/* 发布后的头几分钟，浏览器可能把新的 index.html 和缓存里的旧模块混在一起：版本不一致就强制重抓所有模块并刷新一次（每个版本只做一次，防循环） */
async function healStaleModules(){
  const want = (document.querySelector('meta[name="app-version"]') || {}).content;
  if (!want || want === APP_VERSION) return false;
  const key = LS_PREFIX + ".reloaded." + want;
  try { if (sessionStorage.getItem(key)) return false; sessionStorage.setItem(key, "1"); } catch (e) { return false; }
  await Promise.all(MODULES.map(u => fetch("js/" + u, { cache: "reload" }).catch(() => null)));
  location.reload(); return true;
}
if (!(await healStaleModules())) initCloud().then(render);
