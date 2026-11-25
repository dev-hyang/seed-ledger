/* 可搜索的下拉：选项很多的 <select>（分类下拉有六七十项）换成一个「能打字的下拉」——
 * 看起来和普通下拉一样（显示当前选项 + 右边小箭头），点进去直接在原位打字筛选，下面列出匹配的选项，点一项选中。没有单独的搜索框。
 * 做法：原来的 <select> 留在表单里（提交、现有的 change 处理都照旧），视觉上藏起来；
 * 列表每次打开时按 select 当前的选项重建（选项是动态生成的也没问题），选一项 = 改 select 的值并派发 change。
 * 哪些 select 会变：带 data-search 的，或者选项数超过 8 个（≥ 9，含「全部 / 请选择」那一项）且没有 data-nosearch 的（页面重画后由 MutationObserver 自动接上）。
 * 按需调整：data-search = 不管几个选项都要搜索；data-nosearch = 不要搜索；data-search-min="N" = 这一个 select 改成 N 个及以上才搜索（默认 AUTO_MIN）。
 * 键盘：↑↓ 移动、Enter 选中、Esc 还原并关闭；读屏：输入框是 combobox，列表是 listbox / option。 */
/* 【母版在 home-pantry/shared/】姊妹站各留一份逐字相同的副本（node check-shared.mjs 会比）。样式在 shared/ui.css。
 * 翻译：本文件不引用任何站内模块，入口先调 setSelectT(t) 把本站的翻译函数传进来（不调就原样显示中文）。 */
export let t = (s) => s;
export const setSelectT = (fn) => { if (typeof fn === "function") t = fn; };

export const AUTO_MIN = 9;   // 默认：选项数 ≥ 9（超过 8 个）才自动变成可搜索；少于这个数，直接点选比打字更快
const minOf = (sel) => { const n = parseInt(sel.dataset.searchMin, 10); return n > 0 ? n : AUTO_MIN; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* 触屏（手机 / 平板）不替换：原生下拉在手机上本来就好用（系统滚轮 / 列表）；自制列表在弹键盘、页面滚动的时候，
   手指落下的位置可能已经换成了别的选项（选「通行费」结果填成「餐饮」）。有鼠标的宽屏才换成可搜索的下拉 */
export const touch = () => { try { return matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches; } catch (e) { return false; } };
const want = (sel) => sel.matches("select") && !touch() && sel.dataset.nosearch === undefined && !sel.dataset.sselReady && !sel.multiple && (sel.dataset.search !== undefined || sel.options.length >= minOf(sel));
/* 触屏上带 data-search 的长下拉（物品表单的大类 / 小类 / 存放位置）：点了从底部弹出一个面板——上面一个搜索框、下面整张清单，
   打字只筛选面板里的清单，页面本身不动，所以不会出现上面说的「手指落下时选项换了」。没打字也能直接滑着点。（2026-11-14） */
const wantSheet = (sel) => sel.matches("select") && touch() && sel.dataset.search !== undefined && !sel.dataset.sselReady && !sel.multiple;
let openBox = null;

const label = (sel) => { const o = sel.selectedOptions[0]; return o ? o.textContent.trim() : ""; };
/** select 选上有效值后，撤掉输入框上借来的“必填”错误（不然它自己会一直挡着提交） */
function syncValid(box) { const inp = box.querySelector(".ssel-in"); if (box._sel.validity.valid && inp.validationMessage) { inp.setCustomValidity(""); inp.removeAttribute("aria-invalid"); } }
function enhance(sel) {
  sel.dataset.sselReady = "1";
  const box = document.createElement("div"); box.className = "ssel";
  box.innerHTML = `<input type="text" class="ssel-in" role="combobox" aria-expanded="false" aria-autocomplete="list" autocomplete="off" spellcheck="false" aria-label="${esc(sel.getAttribute("aria-label") || sel.closest("label")?.firstChild?.textContent?.trim() || "")}"><div class="ssel-list" role="listbox" hidden></div>`;
  // 原生 select 只是不让 Tab 走到（tabIndex = -1），不加 aria-hidden：它仍然会被聚焦——点外层 <label>、表单校验跳到没填的 required 字段、
  // 代码 .focus()——aria-hidden 的元素拿到焦点，读屏就“听不到焦点在哪”，Chrome 也会报 Blocked aria-hidden。改成焦点一落到它身上就转给能看见的输入框。
  sel.classList.add("ssel-native"); sel.tabIndex = -1; sel.removeAttribute("aria-hidden");
  sel.after(box); box._sel = sel; sel._ssel = box;
  const inp = box.querySelector(".ssel-in"); inp.value = label(sel); inp.disabled = sel.disabled;
  new MutationObserver(() => { if (!box.classList.contains("is-open")) inp.value = label(sel); }).observe(sel, { childList: true, subtree: true });   // 选项被重建：显示的文字跟着变
  if (sel.required) inp.setAttribute("aria-required", "true");
  sel.addEventListener("focus", () => { if (!inp.disabled) inp.focus(); });
  // required 没选：浏览器要聚焦这个 1px 的隐形 select 并在它旁边弹提示。拦下来，改在输入框上提示（排在表单里第一个没填的才抢焦点，
  // 放到 setTimeout 里是为了在浏览器处理完这一轮校验之后再聚焦，不被后面别的无效字段抢走）
  sel.addEventListener("invalid", (e) => {
    e.preventDefault();
    inp.setCustomValidity(sel.validationMessage || t("请选择一项")); inp.setAttribute("aria-invalid", "true");
    const first = sel.form && [...sel.form.elements].find((el) => !el.classList.contains("ssel-in") && el.willValidate && !el.validity.valid);
    if (!sel.form || first === sel) setTimeout(() => inp.reportValidity(), 0);
  });
  inp.addEventListener("invalid", (e) => { if (sel.validity.valid) { e.preventDefault(); syncValid(box); } });   // select 已经被代码改成有效值（没派发 change）：别再拦提交
  inp.addEventListener("focus", () => open(box));
  inp.addEventListener("click", () => { if (!box.classList.contains("is-open")) open(box); });
  inp.addEventListener("input", () => { box.dataset.typed = "1"; filter(box); });
  inp.addEventListener("keydown", (e) => onKey(e, box));
  inp.addEventListener("blur", () => setTimeout(() => { if (box.classList.contains("is-open") && !box.contains(document.activeElement)) close(box); }, 0));
  const list = box.querySelector(".ssel-list");
  list.addEventListener("pointerdown", (e) => e.preventDefault());   // 点列表时输入框别失焦（否则 blur 先把列表关了）
  list.addEventListener("click", (e) => { e.preventDefault(); const row = e.target.closest(".ssel-opt"); if (row && !row.classList.contains("is-off")) pick(box, row.dataset.v); });   // preventDefault：列表在外层 <label> 里，不拦的话点选项会激活 label、把焦点还给输入框，选完又自己展开
}
function build(box) {
  const sel = box._sel, list = box.querySelector(".ssel-list"), cur = sel.value, parts = [];
  // 组里的选项可带 data-short（组标题已经写了大类，这里只显示小类）；打字筛选仍按完整文字匹配（打「工作」能找到整组）
  const opt = (o, inGrp = false) => `<div class="ui-opt ssel-opt${inGrp ? " in-grp" : ""} ${o.value === cur ? "is-cur" : ""} ${o.disabled ? "is-off" : ""}" role="option" aria-selected="${o.value === cur}" data-v="${esc(o.value)}" data-t="${esc(`${o.textContent.trim()} ${o.dataset.short || ""}`.toLowerCase())}"${inGrp && o.dataset.short ? ` aria-label="${esc(o.textContent.trim())}"` : ""}>${esc((inGrp && o.dataset.short) || o.textContent.trim())}</div>`;
  for (const n of sel.children) {
    if (n.tagName === "OPTGROUP") { parts.push(`<div class="ssel-grp" data-grp role="presentation">${esc(n.label)}</div>`); for (const o of n.children) parts.push(opt(o, true)); }
    else if (n.tagName === "OPTION") parts.push(opt(n));
  }
  list.innerHTML = parts.join("");
}
function filter(box) {
  const q = box.dataset.typed ? box.querySelector(".ssel-in").value.trim().toLowerCase() : "", list = box.querySelector(".ssel-list");
  let any = false;
  list.querySelector(".ssel-empty")?.remove();   // 先清掉上一次的「没有匹配」提示：留着的话，最后一个分组会把它当成自己的可见选项而不收起
  list.querySelectorAll(".ssel-opt").forEach((r) => { const hit = !q || r.dataset.t.includes(q); r.hidden = !hit; any = any || hit; });
  list.querySelectorAll(".ssel-grp").forEach((g) => { let n = g.nextElementSibling, shown = false; while (n && !n.hasAttribute("data-grp")) { if (!n.hidden) shown = true; n = n.nextElementSibling; } g.hidden = !shown; });
  list.querySelectorAll(".is-hl").forEach((r) => r.classList.remove("is-hl"));
  if (!any) list.insertAdjacentHTML("beforeend", `<div class="ssel-empty muted">${esc(t("没有匹配的选项"))}</div>`);
  if (q) { const first = list.querySelector(".ssel-opt:not([hidden]):not(.is-off)"); if (first) first.classList.add("is-hl"); }
}
function open(box) {
  if (openBox && openBox !== box) close(openBox);
  const inp = box.querySelector(".ssel-in"), list = box.querySelector(".ssel-list");
  build(box); delete box.dataset.typed;
  inp.placeholder = label(box._sel) || t("输入几个字筛选…"); inp.value = "";   // 当前选项变成灰色占位，直接打字就是筛选
  box.classList.add("is-open"); list.hidden = false; inp.setAttribute("aria-expanded", "true"); openBox = box;
  filter(box);
  // 只滚列表本身：scrollIntoView 会连整页一起滚，列表在鼠标 / 手指下面跳走
  const cur = list.querySelector(".ssel-opt.is-cur"); if (cur) list.scrollTop = Math.max(0, cur.offsetTop - (list.clientHeight - cur.offsetHeight) / 2);
  box.classList.remove("is-right"); let r = list.getBoundingClientRect();
  if (r.right > window.innerWidth - 8) { box.classList.add("is-right"); r = list.getBoundingClientRect(); }   // 列表比输入框宽、伸出了右边：改成右对齐
  box.classList.toggle("is-up", r.bottom > window.innerHeight - 8 && r.top > r.height + 8);
}
function close(box) {
  const inp = box.querySelector(".ssel-in");
  box.classList.remove("is-open", "is-up", "is-right"); box.querySelector(".ssel-list").hidden = true; inp.setAttribute("aria-expanded", "false");
  inp.value = label(box._sel); inp.placeholder = ""; delete box.dataset.typed; syncValid(box);
  if (openBox === box) openBox = null;
}
function pick(box, v) {
  const sel = box._sel; if (sel.value !== v) { sel.value = v; sel.dispatchEvent(new Event("change", { bubbles: true })); }
  close(box); box.querySelector(".ssel-in").blur();
}
function onKey(e, box) {
  if (e.key === "Escape") { e.preventDefault(); close(box); box.querySelector(".ssel-in").blur(); return; }
  if (!box.classList.contains("is-open")) { if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); open(box); } return; }
  const rows = [...box.querySelectorAll(".ssel-opt:not([hidden]):not(.is-off)")]; if (!rows.length) return;
  let i = rows.findIndex((r) => r.classList.contains("is-hl")); if (i < 0) i = rows.findIndex((r) => r.classList.contains("is-cur"));
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); i = Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))); rows.forEach((r) => r.classList.remove("is-hl")); rows[i].classList.add("is-hl"); rows[i].scrollIntoView({ block: "nearest" }); }
  else if (e.key === "Enter") { e.preventDefault(); pick(box, (rows[i] || rows[0]).dataset.v); }
  else if (e.key === "Tab") close(box);
}

/* ── 触屏：底部面板 ── */
function enhanceSheet(sel) {
  sel.dataset.sselReady = "1";
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "ssel-btn";
  btn.setAttribute("aria-haspopup", "dialog");
  const lbl = sel.getAttribute("aria-label") || sel.closest("label")?.firstChild?.textContent?.trim() || "";
  btn.setAttribute("aria-label", lbl);
  const show = () => { btn.textContent = label(sel) || t("请选择"); btn.disabled = sel.disabled; };
  show();
  sel.classList.add("ssel-native"); sel.tabIndex = -1;
  sel.after(btn); sel._sheetBtn = btn;
  sel.addEventListener("change", show);
  new MutationObserver(show).observe(sel, { childList: true, subtree: true });   // 选项被重建（换了大类，小类跟着换）：按钮上的文字跟着变
  sel.addEventListener("focus", () => btn.focus());
  btn.addEventListener("click", () => openSheet(sel, lbl, show));
}
function openSheet(sel, title, show) {
  const dlg = document.createElement("dialog");
  dlg.className = "ask-dlg sel-sheet";
  dlg.innerHTML = `<div class="ask-form"><h3>${esc(title)}</h3>
    <input type="search" class="sel-sheet-q" placeholder="${esc(t("输入几个字筛选…"))}" aria-label="${esc(t("筛选"))}" autocomplete="off" spellcheck="false">
    <div class="ssel-list sel-sheet-list" role="listbox" aria-label="${esc(title)}"></div>
    <div class="ui-acts ask-acts"><button type="button" class="ui-btn" data-tone="ghost" data-x>${esc(t("取消"))}</button></div></div>`;
  document.body.appendChild(dlg);
  const box = { _sel: sel, querySelector: (q) => dlg.querySelector(q === ".ssel-in" ? ".sel-sheet-q" : q), querySelectorAll: (q) => dlg.querySelectorAll(q), dataset: {} };
  build(box);
  const list = dlg.querySelector(".sel-sheet-list"), q = dlg.querySelector(".sel-sheet-q");
  const done = () => { dlg.close(); dlg.remove(); sel._sheetBtn?.focus(); };
  q.addEventListener("input", () => { box.dataset.typed = q.value ? "1" : ""; if (!q.value) delete box.dataset.typed; filter(box); });
  list.addEventListener("click", (e) => {
    const row = e.target.closest(".ssel-opt"); if (!row || row.classList.contains("is-off")) return;
    if (sel.value !== row.dataset.v) { sel.value = row.dataset.v; sel.dispatchEvent(new Event("change", { bubbles: true })); }
    show(); done();
  });
  dlg.querySelector("[data-x]").addEventListener("click", done);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); done(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) done(); });
  dlg.showModal();
  const cur = list.querySelector(".ssel-opt.is-cur"); if (cur) list.scrollTop = Math.max(0, cur.offsetTop - list.clientHeight / 2);
}

export function initSelectSearch() {
  const scan = (root) => root.querySelectorAll && root.querySelectorAll("select").forEach((s) => { if (wantSheet(s)) enhanceSheet(s); else if (want(s)) enhance(s); });
  scan(document);
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; setTimeout(() => { queued = false; scan(document); }, 0); }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("change", (e) => { const sel = e.target; if (!sel._ssel) return; syncValid(sel._ssel); if (!sel._ssel.classList.contains("is-open")) sel._ssel.querySelector(".ssel-in").value = label(sel); });   // 别处改了 select 的值（自动填表、重置）
  document.addEventListener("pointerdown", (e) => { if (openBox && !openBox.contains(e.target)) close(openBox); }, true);
}
