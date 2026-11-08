/* ============ 统一的「筛选 · 排序」 ============
   每个有筛选 / 排序的列表都用这一个零件：
     一行：左边「筛选 · 排序」按钮（带已选条数），右边可放搜索框；
     点按钮在下面展开条件框：每项一个带小标题的下拉（日期范围是并排两个日期框）+ 排序下拉 + 「重置」「完成」；
     已选的条件在按钮下面显示成小标签，点 ✕ 单独去掉，不用打开也知道现在筛了什么。
   状态还是放在各页原来的地方（S.filters / 审计的 AUD.f 等）：页面每次渲染时把配置交给 filterUI，这里只负责显示和改值。
   配置：{ state, fields: [{ k, label, opts: [[v, 已翻译的标签]], blank, def } | { type: "range", from, to, label }], sort: { k, opts, def }, search, extra, onChange } */
import { esc } from "../core/util.js";
import { t } from "../core/i18n.js";
import { ACT, CHG } from "./actions.js";

const REG = {}, OPEN = new Set();
const str = v => v === undefined || v === null ? "" : String(v);
const isOn = (c, f) => str(c.state[f.k]) !== str(f.def);
/** 已选的条件 → [{ id, text }]（id 用来单独清掉） */
function activeChips(c){
  const out = [];
  for (const f of c.fields || []) {
    if (f.type === "range") {
      const a = c.state[f.from], b = c.state[f.to];
      if (a || b) out.push({ id: "range:" + f.from, text: `${t(f.label)}：${a || "…"} ~ ${b || "…"}` });
    } else if (isOn(c, f)) {
      const hit = f.opts.find(([v]) => str(v) === str(c.state[f.k]));
      out.push({ id: f.k, text: `${t(f.label)}：${hit ? hit[1] : f.blank || t("全部")}` });
    }
  }
  if (c.sort && isOn(c, c.sort)) { const hit = c.sort.opts.find(([v]) => str(v) === str(c.state[c.sort.k])); if (hit) out.push({ id: c.sort.k, text: `${t("排序")}：${hit[1]}` }); }
  return out;
}
const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>`;

function filterUI(key, c){
  REG[key] = c;
  const chips = activeChips(c), n = chips.length, open = OPEN.has(key), id = "fb-" + key;
  const sel = f => `<label class="ff"><span>${esc(t(f.label))}</span><select data-change="fb" data-fb="${esc(key)}" data-k="${esc(f.k)}">${f.blank === false ? "" : `<option value="">${esc(f.blank || t("全部"))}</option>`}${f.opts.map(([v, l]) => `<option value="${esc(v)}" ${str(v) === str(c.state[f.k] ?? (f.blank === false ? f.def : "")) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  const range = f => `<div class="fbar-range" role="group" aria-label="${esc(t(f.label))}"><span class="fbar-lab">${esc(t(f.label))}</span>
    <div class="fbar-dates"><input type="date" data-change="fb" data-fb="${esc(key)}" data-k="${esc(f.from)}" value="${esc(c.state[f.from] || "")}" max="${esc(c.state[f.to] || "")}" aria-label="${esc(t("开始日期"))}"><span aria-hidden="true">—</span><input type="date" data-change="fb" data-fb="${esc(key)}" data-k="${esc(f.to)}" value="${esc(c.state[f.to] || "")}" min="${esc(c.state[f.from] || "")}" aria-label="${esc(t("结束日期"))}"></div>${f.quick || ""}</div>`;
  const dropdowns = (c.fields || []).filter(f => f.type !== "range").map(sel).join("") + (c.sort ? sel({ ...c.sort, label: c.sort.label || "排序", blank: false }) : "");
  const panel = open ? `<div class="fbar" id="${id}">
      ${dropdowns ? `<div class="fbar-row">${dropdowns}</div>` : ""}${(c.fields || []).filter(f => f.type === "range").map(range).join("")}${c.extra || ""}
      <div class="fbar-foot"><button type="button" class="btn sm" data-act="fb-reset" data-fb="${esc(key)}" ${n ? "" : "disabled"}>${esc(t("重置"))}</button><button type="button" class="btn sm primary" data-act="fb-done" data-fb="${esc(key)}">${esc(t("完成"))}</button></div></div>` : "";
  return `<div class="fb">
    <div class="fb-row"><button type="button" class="fb-btn${n ? " on" : ""}" data-act="fb-toggle" data-fb="${esc(key)}" aria-expanded="${open}" aria-controls="${id}">${ICON}<span>${esc(t(c.sort ? "筛选 · 排序" : "筛选"))}</span>${n ? `<b class="fb-n">${n}</b>` : ""}</button>${c.search || ""}</div>
    ${n ? `<div class="fb-chips">${chips.map(x => `<button type="button" class="fb-chip" data-act="fb-clear" data-fb="${esc(key)}" data-k="${esc(x.id)}" aria-label="${esc(t("去掉条件：{x}", { x: x.text }))}"><span>${esc(x.text)}</span><i aria-hidden="true">✕</i></button>`).join("")}</div>` : ""}
    ${panel}</div>`;
}

/* 改值：清空 = 回到默认；然后交给页面的 onChange（翻回第一页、重新取数据等） */
function setVal(c, k, v){ c.state[k] = v === "" || v === undefined ? undefined : v; }
function defOf(c, k){ const f = [...(c.fields || []), c.sort].find(x => x && x.k === k); return f ? f.def : undefined; }
CHG.fb = async el => { const c = REG[el.dataset.fb]; if (!c) return; await setVal(c, el.dataset.k, el.value); await c.onChange?.(); };
ACT["fb-toggle"] = el => { const k = el.dataset.fb; if (OPEN.has(k)) OPEN.delete(k); else OPEN.add(k); };
ACT["fb-done"] = el => { OPEN.delete(el.dataset.fb); };
ACT["fb-clear"] = async el => {
  const c = REG[el.dataset.fb]; if (!c) return; const id = el.dataset.k;
  if (id.startsWith("range:")) { const f = c.fields.find(x => x.type === "range" && x.from === id.slice(6)); await setVal(c, f.from); await setVal(c, f.to); }
  else await setVal(c, id, defOf(c, id) ?? "");
  await c.onChange?.();
};
ACT["fb-reset"] = async el => {
  const c = REG[el.dataset.fb]; if (!c) return;
  for (const f of [...(c.fields || []), c.sort].filter(Boolean)) { if (f.type === "range") { await setVal(c, f.from); await setVal(c, f.to); } else await setVal(c, f.k, f.def ?? ""); }
  await c.onChange?.();
};

export { filterUI };
