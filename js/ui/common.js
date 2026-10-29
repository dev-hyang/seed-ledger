/* 各页面共用：账务模型（数据没变就复用）、名称查找、年份、手机号遮挡 */
import { S, live, subscribe, canWrite } from "../core/state.js";
import { buildModel, yearOf } from "../logic/ledger.js";
import { t } from "../core/i18n.js";
import { esc } from "../core/util.js";

let cache = null;
subscribe(() => { cache = null; });
const KEYS = ["sale", "pay", "adj", "purchase", "sreturn", "spay", "sfee", "brand", "supplier", "customer", "trip", "town"];
function model(){
  if (!cache) cache = buildModel(Object.fromEntries(KEYS.map(k => [k, live(k)])));
  return cache;
}
const byId = (kind, id) => S.data[kind].get(id) && !S.data[kind].get(id)._del ? S.data[kind].get(id) : null;
const brandName = id => byId("brand", id)?.name || t("（已删除）");
const customerName = id => byId("customer", id)?.name || t("（已删除）");
const supplierName = id => byId("supplier", id)?.name || t("（已删除）");
const seasonName = id => { const s = S.settings.seasons.find(x => x.id === id); return s ? t(s.name) : ""; };
const seasonOpts = () => S.settings.seasons.map(s => [s.id, t(s.name)]);
const sortBy = (arr, f, dir = 1) => [...arr].sort((a, b) => { const x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });

/** 数据里出现过的年份（含今年），新的在前 */
function years(){
  const set = new Set([new Date().getFullYear()]), m = model();
  for (const s of m.D.sale) set.add(yearOf(s.date));
  for (const k of ["purchase", "sreturn", "sfee"]) for (const r of m.D[k]) set.add(+r.year);
  return [...set].sort((a, b) => b - a);
}
const maskPhone = p => { const s = String(p || ""); return s.length >= 7 ? s.slice(0, 3) + "****" + s.slice(-4) : s; };
const phoneHTML = p => !p ? "" : S.settings.maskPhone ? `<a class="tel" href="tel:${esc(p)}">${esc(maskPhone(p))}</a>` : `<a class="tel" href="tel:${esc(p)}">${esc(p)}</a>`;
const yearSelect = (cur, name = "year", cls = "") => `<select class="${cls}" data-change="${name}" aria-label="${esc(t("年份"))}">${years().map(y => `<option value="${y}" ${+cur === y ? "selected" : ""}>${y}</option>`).join("")}</select>`;
const ro = () => !canWrite();

export { model, byId, brandName, customerName, supplierName, seasonName, seasonOpts, sortBy, years, maskPhone, phoneHTML, yearSelect, ro };
