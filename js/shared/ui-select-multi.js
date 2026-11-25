/* 多选下拉：<select multiple> 换成和单选可搜索下拉（select-search.js）同一个外观的「原框 + 勾选面板」。
 * 真实控件还是那个 <select multiple>（提交、校验、change 事件都照旧），选项 = <option>；视觉上藏起来，选一项 = 改 option.selected 并派发 change。
 * 属性：data-search / data-nosearch / data-search-min="N"（同单选，默认 ≥9 项才能打字筛选）；data-empty = 一项都没选时显示的字；
 *       data-summary = 页面自己算好的摘要（例如「2 期 · $300」），改完调用 sel._msRefresh() 刷新；option 的 data-label = 摘要里用的短名（默认是选项文字）；
 *       data-clear = 面板底部「清除」按钮的字（不写就叫「清除」）。
 * 收起规则（和单选相反）：多选不能确定「选好了没有」，所以选一项不收起；点外面 / Esc / Tab / 「完成」才收。
 * 电脑：原框里打字筛选，面板贴在下面。触屏：点了从底部弹出面板（搜索框在面板里，页面不动，避免键盘弹出时手指落下的位置换了选项）。 */
// 【母版在 home-pantry/shared/】副本逐字相同。翻译函数由入口调 setSelectT（见 ui-select.js）。
import { AUTO_MIN, touch, t } from "./ui-select.js";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const minOf = (sel) => { const n = parseInt(sel.dataset.searchMin, 10); return n > 0 ? n : AUTO_MIN; };
const searchable = (sel) => sel.dataset.nosearch === undefined && (sel.dataset.search !== undefined || sel.options.length >= minOf(sel));
const shortOf = (o) => (o.dataset.label || o.textContent).trim();
const summary = (sel) => {
  if (sel.dataset.summary) return sel.dataset.summary;
  const on = [...sel.selectedOptions]; return on.length ? on.map(shortOf).join("、") : (sel.dataset.empty || t("未选"));
};
const rowsHtml = (sel) => [...sel.options].map((o) => `<label class="ui-opt msel-opt${o.disabled ? " is-off" : ""}" title="${esc(o.textContent.trim())}" data-t="${esc(o.textContent.trim().toLowerCase())}"><input type="checkbox" value="${esc(o.value)}"${o.selected ? " checked" : ""}${o.disabled ? " disabled" : ""}><span>${esc(o.textContent.trim())}</span></label>`).join("");
const footHtml = (sel) => `<div class="msel-foot"><button type="button" class="ui-btn" data-size="sm" data-tone="ghost" data-clear>${esc(sel.dataset.clear || t("清除"))}</button><button type="button" class="ui-btn" data-size="sm" data-tone="primary" data-done>${t("完成")}</button></div>`;

/** 列表里的勾选 → option.selected，并通知页面（change 冒泡，页面原来监听 change 的代码照常工作） */
function bindRows(sel, list, onChange) {
  list.addEventListener("change", (e) => {
    const cb = e.target.closest("input[type=checkbox]"); if (!cb) return;
    const o = [...sel.options].find((x) => x.value === cb.value); if (o) o.selected = cb.checked;
    onChange(); sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function clearAll(sel, list, onChange) {
  list.querySelectorAll("input:checked").forEach((c) => { c.checked = false; });
  [...sel.options].forEach((o) => { o.selected = false; }); onChange(); sel.dispatchEvent(new Event("change", { bubbles: true }));
}
function filterRows(list, q) {
  const s = q.trim().toLowerCase(); let any = false;
  list.querySelectorAll(".msel-opt").forEach((r) => { const hit = !s || r.dataset.t.includes(s); r.hidden = !hit; any = any || hit; });
  list.querySelector(".ssel-empty")?.remove();
  if (!any) list.querySelector(".msel-opts").insertAdjacentHTML("beforeend", `<div class="ssel-empty muted">${esc(t("没有匹配的选项"))}</div>`);
}
const labelOf = (sel) => sel.getAttribute("aria-label") || sel.closest("[data-ms-label]")?.dataset.msLabel || "";

let openBox = null;
function enhance(sel) {
  sel.dataset.mselReady = "1";
  const fine = !touch(), canType = fine && searchable(sel);
  const box = document.createElement("div"); box.className = "ssel msel";
  box.innerHTML = `<input type="text" class="ssel-in" role="combobox" aria-haspopup="listbox" aria-expanded="false" autocomplete="off" spellcheck="false" aria-label="${esc(labelOf(sel))}"${canType ? "" : " readonly"}><b class="msel-n ui-badge" data-shape="count" data-size="lg" data-tone="neutral" data-soft hidden></b>
    <div class="ssel-list msel-list" role="listbox" aria-multiselectable="true" hidden><div class="msel-opts">${rowsHtml(sel)}</div>${footHtml(sel)}</div>`;
  sel.classList.add("ssel-native"); sel.tabIndex = -1; sel.after(box); sel._msel = box;
  const inp = box.querySelector(".ssel-in"), list = box.querySelector(".msel-list"), badge = box.querySelector(".msel-n");
  const refresh = () => {
    const n = sel.selectedOptions.length; badge.textContent = n; badge.hidden = !n;
    inp.classList.toggle("is-empty", !n); inp.disabled = sel.disabled;
    if (!box.classList.contains("is-open")) inp.value = summary(sel); else inp.placeholder = summary(sel);
    list.querySelectorAll("input").forEach((c) => { const o = [...sel.options].find((x) => x.value === c.value); if (o) c.checked = o.selected; });
  };
  sel._msRefresh = refresh; refresh();
  new MutationObserver(() => { list.querySelector(".msel-opts").innerHTML = rowsHtml(sel); refresh(); }).observe(sel, { childList: true });
  sel.addEventListener("focus", () => inp.focus());
  bindRows(sel, list, refresh);
  list.addEventListener("pointerdown", (e) => { if (!e.target.closest("button")) e.preventDefault(); });   // 点列表时输入框别失焦
  list.querySelector("[data-clear]").addEventListener("click", () => clearAll(sel, list, refresh));
  list.querySelector("[data-done]").addEventListener("click", () => close(box));
  const show = () => (fine ? open(box) : openSheet(sel, refresh));
  inp.addEventListener("focus", () => { if (fine) open(box); });
  inp.addEventListener("click", () => { if (!fine) show(); else if (!box.classList.contains("is-open")) open(box); });
  inp.addEventListener("input", () => filterRows(list, inp.value));
  inp.addEventListener("keydown", (e) => onKey(e, box, list));
}
function open(box) {
  if (openBox && openBox !== box) close(openBox);
  const inp = box.querySelector(".ssel-in"), list = box.querySelector(".msel-list"), sel = box.previousElementSibling;
  box.classList.add("is-open"); list.hidden = false; inp.setAttribute("aria-expanded", "true"); openBox = box;
  inp.placeholder = summary(sel); inp.value = ""; filterRows(list, "");
  const first = list.querySelector("input:checked")?.closest(".msel-opt"), scroller = list.querySelector(".msel-opts");   // 有勾选的，滚到第一个勾选的那项
  scroller.scrollTop = first ? Math.max(0, first.offsetTop - scroller.offsetTop - 4) : 0;
  box.classList.remove("is-right"); let r = list.getBoundingClientRect();
  if (r.right > window.innerWidth - 8) { box.classList.add("is-right"); r = list.getBoundingClientRect(); }
  box.classList.toggle("is-up", r.bottom > window.innerHeight - 8 && r.top > r.height + 8);
}
function close(box) {
  const inp = box.querySelector(".ssel-in"), sel = box.previousElementSibling;
  box.classList.remove("is-open", "is-up", "is-right"); box.querySelector(".msel-list").hidden = true; inp.setAttribute("aria-expanded", "false");
  inp.placeholder = ""; inp.value = summary(sel); if (openBox === box) openBox = null;
}
function onKey(e, box, list) {
  const inp = box.querySelector(".ssel-in");
  if (e.key === "Escape") { if (box.classList.contains("is-open")) { e.preventDefault(); close(box); } return; }
  if (!box.classList.contains("is-open")) { if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); open(box); } return; }
  if (e.key === "Tab") { close(box); return; }
  const rows = [...list.querySelectorAll(".msel-opt:not([hidden]):not(.is-off)")]; if (!rows.length) return;
  let i = rows.findIndex((r) => r.classList.contains("is-hl"));
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); i = Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))); rows.forEach((r) => r.classList.remove("is-hl")); rows[i].classList.add("is-hl"); rows[i].scrollIntoView({ block: "nearest" }); }
  else if (e.key === "Enter" || (e.key === " " && inp.readOnly)) { e.preventDefault(); const c = (rows[i] || rows[0]).querySelector("input"); c.checked = !c.checked; c.dispatchEvent(new Event("change", { bubbles: true })); }
}

/* ── 触屏：底部面板（勾选马上生效，「完成」只是收起） ── */
function openSheet(sel, refresh) {
  const dlg = document.createElement("dialog"); dlg.className = "ask-dlg sel-sheet";
  const title = labelOf(sel), q = searchable(sel);
  dlg.innerHTML = `<div class="ask-form"><h3>${esc(title)}</h3>
    ${q ? `<input type="search" class="sel-sheet-q" placeholder="${esc(t("输入几个字筛选…"))}" aria-label="${esc(t("筛选"))}" autocomplete="off" spellcheck="false">` : ""}
    <div class="ssel-list sel-sheet-list msel-list" role="listbox" aria-multiselectable="true" aria-label="${esc(title)}"><div class="msel-opts">${rowsHtml(sel)}</div></div>
    <div class="ui-acts ask-acts"><button type="button" class="ui-btn" data-tone="ghost" data-clear>${esc(sel.dataset.clear || t("清除"))}</button><button type="button" class="ui-btn" data-tone="primary" data-done>${t("完成")}</button></div></div>`;
  document.body.appendChild(dlg);
  const list = dlg.querySelector(".msel-list"), done = () => { dlg.close(); dlg.remove(); sel._msel?.querySelector(".ssel-in").focus({ preventScroll: true }); };
  bindRows(sel, list, refresh);
  dlg.querySelector(".sel-sheet-q")?.addEventListener("input", (e) => filterRows(list, e.target.value));
  dlg.querySelector("[data-clear]").addEventListener("click", () => clearAll(sel, list, refresh));
  dlg.querySelector("[data-done]").addEventListener("click", done);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); done(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) done(); });
  dlg.showModal();
}

export function initSelectMulti() {
  const scan = (root) => root.querySelectorAll && root.querySelectorAll("select[multiple]").forEach((s) => { if (!s.dataset.mselReady && s.dataset.native === undefined) enhance(s); });
  scan(document);
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; setTimeout(() => { queued = false; scan(document); }, 0); }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("change", (e) => e.target._msRefresh?.());   // 别处改了 select（重置、自动填表）：外观跟着变
  document.addEventListener("pointerdown", (e) => { if (openBox && !openBox.contains(e.target)) close(openBox); }, true);
}
