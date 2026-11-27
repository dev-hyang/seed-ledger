/* 进度虚线条（统一控件）：一排短横条，第 n 条亮起 = 现在在第 n 项 / 第 n 步。样式在 shared/ui.css 的 .ui-dashbar。
 * 样子（同一个控件的变体）：
 *   默认（不带序号）：只有横条——今天页顶部的卡片切换；点哪条去哪张（clickable）。
 *   numbered（带序号）：左边多一句「2 / 5」——向导 / 分步表单；通常不可点。
 *   steps：当前之前的横条染成「已完成」色（向导用）；不设 steps 则只有当前那条亮。
 *   nav：两边加 ‹ › 按钮（卡片轮播用）；gear：右边放一个 ⚙ 设置（dashGearHTML）；secs > 0：当前那条像进度条走满（自动换下一张）。
 * 【母版在 home-pantry/shared/】姊妹站各留逐字相同的副本 js/shared/ui-dashbar.js（check-shared.mjs 会比）。文件不引用站内模块：翻译函数由调用方传 t。
 *
 *   dashBarHTML(count, current, { attrs, label, numbered, steps, fill, clickable, text, nav, navAttrs, gear, secs, t })
 *     count = 总条数（只有 1 条又没有 gear 时返回空串）；current = 当前是第几条（从 0 起）
 *     clickable = true：每条是 <button>，带 data-i="下标" 再加 attrs（如 'data-act="hero-go"'）；否则是不可点的 <i>
 *     numbered = true：加序号文字，默认「{n} / {m}」，可用 text 覆盖（已翻译好的整句）
 *     nav = true：‹ › 按钮，带 data-d="-1" / "1" 再加 navAttrs（如 'data-act="hero-nav"'）；gear = dashGearHTML(...) 的结果
 *     secs：自动换的秒数（0 / 不给 = 不走）；label = 读屏名字；fill = 横条拉伸占满一行
 *   dashGearHTML({ secs, extra, t })：⚙ 按钮 + 菜单（5 / 10 / 15 / 30 秒、关闭自动切换；extra = 菜单底部另加的 HTML，如「管理卡片」）
 *   watchDashCycle({ key, next, def })：入口调一次——管自动换（走满就调 next(横条元素)）、⚙ 选秒数（记在这台设备 localStorage[key]）、点外面收起菜单。
 *     手指 / 鼠标停在带 data-dash-host 的容器上、键盘焦点在里面、菜单开着时停住；系统「减少动态效果」时不走。
 *   watchCarouselLoop(selector)：轮播「绕回」变体——入口调一次。在最后一张还往前滑 → 回到第一张；在第一张还往回滑 → 到最后一张（selector = 横向滚动的容器，只管手指滑；‹ › 和自动切换由调用方的 next 自己绕）。
 *   dashSecs(key, def)：读当前设的秒数；markDash(root, i)：把第 i 条设成当前并让进度条从头走（手滑 / 点了以后调）。 */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SECS = [5, 10, 15, 30];
let KEY = "ui.dashSecs", DEF = 10;

export function dashSecs(key = KEY, def = DEF) {
  try { const v = localStorage.getItem(key); if (v === "0") return 0; return SECS.includes(+v) ? +v : def; } catch { return def; }
}

export function dashGearHTML({ secs = 10, extra = "", t = x => x } = {}) {
  const opt = v => { const lab = v ? String(t("{s} 秒", { s: v })).replace("{s}", v) : t("关闭自动切换"); return `<button type="button" class="ui-dash-opt" data-dashsecs="${v}" data-label="${esc(lab)}" aria-pressed="${secs === v}">${esc(lab)}${secs === v ? " ✓" : ""}</button>`; };
  return `<details class="ui-dash-gear"><summary aria-label="${esc(t("自动切换的时间"))}" title="${esc(t("自动切换的时间"))}">⚙</summary><div class="ui-dash-menu">${[...SECS, 0].map(opt).join("")}${extra ? `<hr>${extra}` : ""}</div></details>`;
}

export function dashBarHTML(count, current, { attrs = "", label = "", numbered = false, steps = false, fill = false, clickable = false, text = "", nav = false, navAttrs = "", gear = "", secs = 0, t = x => x } = {}) {
  if (!(count >= 2) && !gear) return "";
  const cur = Math.min(Math.max(0, count - 1), Math.max(0, current | 0)), multi = count >= 2;
  const bars = multi ? Array.from({ length: count }, (_, i) => {
    const st = i === cur ? ' aria-current="true"' : "", dn = steps && i < cur ? " data-done" : "", run = secs > 0 && i === cur ? " is-run" : "";
    return clickable
      ? `<button type="button" class="ui-dash${run}" ${attrs} data-i="${i}" aria-label="${i + 1} / ${count}"${st}${dn}></button>`
      : `<i class="ui-dash${run}"${st}${dn} aria-hidden="true"></i>`;
  }).join("") : "";
  const n = numbered && multi ? `<span class="ui-dashbar-n" role="status">${esc(text || `${cur + 1} / ${count}`)}</span>` : "";
  const arrow = (d, ch, name) => `<button type="button" class="ui-dash-nav" ${navAttrs} data-d="${d}" aria-label="${esc(t(name))}">${ch}</button>`;
  const prev = nav && multi ? arrow(-1, "‹", "上一张") : "", next = nav && multi ? arrow(1, "›", "下一张") : "";
  return `<div class="ui-dashbar"${numbered ? " data-numbered" : ""}${fill ? " data-fill" : ""}${nav ? " data-nav" : ""} role="group"${label ? ` aria-label="${esc(t(label))}"` : ""} style="--dur:${secs > 0 ? secs : 10}s">${n}${prev}${multi ? `<span class="ui-dashbar-bars${secs > 0 ? "" : " is-off"}">${bars}</span>` : ""}${next}${gear}</div>`;
}

export function markDash(root, i) {
  const secs = dashSecs();
  root?.querySelectorAll(".ui-dash").forEach((b, k) => {
    b.setAttribute("aria-current", String(k === i)); b.classList.remove("is-run");
    if (k === i && secs > 0) { void b.offsetWidth; b.classList.add("is-run"); }
  });
}

let watching = false;
export function watchDashCycle({ key = KEY, next, def = DEF } = {}) {
  if (watching || typeof document === "undefined") return; watching = true; KEY = key; DEF = def;
  const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  document.addEventListener("animationend", e => {
    const el = e.target; if (e.animationName !== "ui-dash-prog" || !el.classList?.contains("is-run") || document.hidden || !dashSecs() || reduced()) return;
    const host = el.closest("[data-dash-host]"); if (host && host._down) return;
    next && next(el.closest(".ui-dashbar"));
  }, true);
  document.addEventListener("click", e => {
    const o = e.target.closest?.("[data-dashsecs]");
    if (o) {
      try { localStorage.setItem(KEY, o.dataset.dashsecs); } catch { /* 只是方便，存不了就算了 */ }
      const bar = o.closest(".ui-dashbar"), v = dashSecs();
      bar?.style.setProperty("--dur", `${v || 10}s`);
      bar?.querySelector(".ui-dashbar-bars")?.classList.toggle("is-off", !v);
      bar?.querySelectorAll("[data-dashsecs]").forEach(x => { const on = +x.dataset.dashsecs === v; x.setAttribute("aria-pressed", String(on)); x.textContent = x.dataset.label + (on ? " ✓" : ""); });
      o.closest("details")?.removeAttribute("open");
      const cur = [...(bar?.querySelectorAll(".ui-dash") || [])].findIndex(b => b.getAttribute("aria-current") === "true");
      markDash(bar, Math.max(0, cur)); return;
    }
    document.querySelectorAll(".ui-dash-gear[open]").forEach(d => { if (!d.contains(e.target)) d.removeAttribute("open"); });
    const b = e.target.closest?.(".ui-dash-nav, .ui-dash[data-i]"); if (b && e.detail) setTimeout(() => b.blur(), 0);   // 鼠标 / 手指点的：别把焦点留在按钮上（焦点在里面进度条会停）
  });
  document.addEventListener("pointerdown", e => { const h = e.target.closest?.("[data-dash-host]"); if (h) h._down = true; });
  const up = () => document.querySelectorAll("[data-dash-host]").forEach(h => { h._down = false; });
  document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
}

let looping = false;
export function watchCarouselLoop(selector) {
  if (looping || typeof document === "undefined") return; looping = true;
  let st = null;
  document.addEventListener("touchstart", e => {
    const el = e.target.closest?.(selector); if (!el || e.touches.length !== 1) { st = null; return; }
    st = { el, x: e.touches[0].clientX, y: e.touches[0].clientY, first: el.scrollLeft <= 2, last: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 };   // 按下时停在第一张 / 最后一张吗
  }, { passive: true });
  document.addEventListener("touchend", e => {
    if (!st) return; const { el, x, y, first, last } = st; st = null;
    const c = e.changedTouches[0], dx = c.clientX - x, dy = c.clientY - y;
    if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0 && last) el.scrollTo({ left: 0, behavior: "smooth" });
    else if (dx > 0 && first) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, { passive: true });
}
