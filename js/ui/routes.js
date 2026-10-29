/* ============ 送货路线：几家客户合成一趟、先后顺序、成本分摊 ============
   选要送的销售单 → 系统按「方向归拢、由近到远」给出建议顺序，并估算比「各送各的」省多少里程和车费；
   也可以手动上下调整顺序。保存后，这一趟的人工 + 车费按数量分摊到各张销售单（成本自动算进利润）。
   里程是估算（镇的距离在 设置 → 镇与距离 里填一次），AI 建议是可选的，没有它这里照样能用。 */
import { S, save, live, remove } from "../core/state.js";
import { esc, today, toast } from "../core/util.js";
import { t, money, qty, dateFmt, locale } from "../core/i18n.js";
import { compareTrips, routeKm, suggestOrder, splitByDirection } from "../logic/route.js";
import { r2 } from "../logic/ledger.js";
import { askAI, aiAvailable, aiError } from "../core/advice.js";
import { model, byId, customerName, brandName, sortBy, ro } from "./common.js";
import { show, back, fld, text, num, date, area, badge, empty, btn, kv, ask } from "./kit.js";
import { ACT, FORMS, CHG, INP } from "./actions.js";

let plan = null;   // 正在编辑的一趟：{ id, date, name, vehicle, labor, order: [saleId…] }（order 里的就是被选中的，顺序即送货顺序）

function renderTrips(){
  const trips = sortBy(live("trip"), x => x.date, -1), m = model();
  const head = ro() ? "" : `<div class="actions">${btn("＋ 安排一趟送货", "trip-new", { cls: "primary" })}</div>`;
  const pending = m.sales.filter(s => s.status !== "void" && s.delivery?.type === "deliver" && !s.delivery.tripId);
  return head + (pending.length ? `<p class="hint">${esc(t("有 {n} 张「我送货」的单还没安排到某一趟。", { n: pending.length }))}</p>` : "")
    + (trips.length ? `<ul class="list">${trips.map(x => { const ids = (x.saleIds || []).filter(id => m.saleM.has(id));
      return `<li><button class="row" data-act="trip-edit" data-id="${x.id}"><span class="row-main"><b>${esc(x.name || t("送货"))} · ${esc(dateFmt(x.date))}</b><small>${esc(t("{n} 家", { n: ids.length }))} · ${esc(ids.map(id => stopOf(m.saleM.get(id)).village || stopOf(m.saleM.get(id)).town).filter(Boolean).join(" → "))}</small></span>
      <span class="row-side"><b>${esc(money(m.tripTotal(x)))}</b><small>${esc(t("人工 + 车费"))}</small></span></button></li>`; }).join("")}</ul>` : empty("还没有送货记录。把同一趟顺路的几家合在一起送，可以省车费和人工。"));
}
const stopOf = s => { const c = byId("customer", s.customerId) || {}; return { town: c.town || "", village: c.village || "", customerId: s.customerId, saleId: s.id }; };
const towns = () => live("town");
const opts = () => ({ perKm: +S.settings.perKm || 1.2, villageHopKm: +S.settings.villageHopKm || 2, laborPerTrip: +S.settings.laborPerTrip || 0 });

function newPlan(x){ plan = x ? { id: x.id, date: x.date, name: x.name || "", vehicle: x.vehicle || 0, labor: x.labor || 0, order: [...(x.saleIds || [])] } : { id: "", date: today(), name: "", vehicle: 0, labor: 0, order: [] }; }
ACT["trip-new"] = () => { newPlan(); show(tripPage, true); };
ACT["trip-edit"] = el => { newPlan(byId("trip", el.dataset.id)); show(tripPage, true); };

function tripPage(){
  const m = model(), cand = m.sales.filter(s => s.status !== "void" && s.delivery?.type === "deliver" && (!s.delivery.tripId || s.delivery.tripId === plan.id));
  const sel = plan.order.map(id => m.saleM.get(id)).filter(Boolean), stops = sel.map(stopOf);
  const missing = stops.filter(s => !s.town).length, unknownTown = stops.filter(s => s.town && !towns().some(x => x.name === s.town)).length;
  const cmp = stops.length ? compareTrips(stops, towns(), opts()) : null, km = stops.length ? routeKm(stops, towns(), opts()) : 0;
  const dirs = stops.length > 1 ? splitByDirection(stops, towns()).filter(g => g.dir !== "?") : [];
  const body = `<div class="grid2">${fld("日期", date("tdate", plan.date).replace('name="tdate"', 'name="tdate" data-input="trip-date"'))}${fld("名称（可不填）", text("tname", plan.name).replace('name="tname"', 'name="tname" data-input="trip-name"'))}</div>
    <h3 class="grp">${esc(t("选要送的单"))}</h3>
    ${cand.length ? `<ul class="list tight">${cand.map(s => { const st = stopOf(s), on = plan.order.includes(s.id);
      return `<li><label class="row pick"><input type="checkbox" data-change="trip-toggle" data-id="${s.id}" ${on ? "checked" : ""}><span class="row-main"><b>${esc(customerName(s.customerId))}</b><small>${esc([st.town, st.village].filter(Boolean).join(" ") || t("（客户没填镇 / 村）"))} · ${esc(brandName(s.lines[0].brandId))}${s.lines.length > 1 ? "…" : ""} ${esc(qty(s.qty))}</small></span></label></li>`; }).join("")}</ul>` : `<p class="hint">${esc(t("没有「我送货」的待送销售单。记销售单时选「我送货」就会出现在这里。"))}</p>`}
    ${sel.length ? `<h3 class="grp">${esc(t("送货顺序"))}<button class="link sm" data-act="trip-suggest">${esc(t("按建议排序"))}</button></h3>
      <ol class="order">${sel.map((s, i) => { const st = stopOf(s); return `<li><span class="no">${i + 1}</span><span class="row-main"><b>${esc(customerName(s.customerId))}</b><small>${esc([st.town, st.village].filter(Boolean).join(" "))}</small></span>
        <button class="x sm" data-act="trip-up" data-i="${i}" ${i ? "" : "disabled"} aria-label="${esc(t("上移"))}">↑</button><button class="x sm" data-act="trip-down" data-i="${i}" ${i < sel.length - 1 ? "" : "disabled"} aria-label="${esc(t("下移"))}">↓</button></li>`; }).join("")}</ol>
      ${missing || unknownTown ? `<p class="hint warn">${esc(t("有客户没填镇，或镇还没设距离，估算会偏差。到 设置 → 镇与距离 补上。"))}</p>` : ""}
      <div class="stmt">${kv("一趟估算里程（含回程）", `${km} km`)}${cmp ? kv("各送各的合计", `${cmp.separateKm} km`) : ""}
        ${cmp && stops.length > 1 ? `<div class="kv total"><span>${esc(t("合成一趟大约省"))}</span><b class="${cmp.savedKm > 0 ? "pos" : ""}">${esc(`${cmp.savedKm} km · ${money(cmp.savedCost)}`)}</b></div>` : ""}</div>
      ${dirs.length > 1 ? `<p class="hint">${esc(t("这几家分布在 {n} 个方向：{d}。顺路的放一趟，反方向的可以考虑另一趟。", { n: dirs.length, d: dirs.map(g => g.dir + "（" + g.stops.length + "）").join("、") }))}</p>` : ""}` : ""}
    <div class="grid2">${fld("车费（¥）", num("vehicle", plan.vehicle || "", { min: 0 }).replace('name="vehicle"', 'name="vehicle" data-input="trip-vehicle"'), cmp ? `<button type="button" class="link" data-act="trip-est">${esc(t("用估算 {a}", { a: money(r2(km * opts().perKm)) }))}</button>` : "")}${fld("人工（¥）", num("labor", plan.labor || "", { min: 0 }).replace('name="labor"', 'name="labor" data-input="trip-labor"'))}</div>
    <p class="hint">${esc(t("这一趟的人工 + 车费会按数量分摊到每张单，计入各自的成本。"))}</p>
    <div class="ai-box"><button type="button" class="btn sm" data-act="ai-route" ${sel.length < 2 ? "disabled" : ""}>✨ ${esc(t("AI 路线建议"))}</button><div data-ai class="ai-out"></div></div>`;
  return { title: t(plan.id ? "修改这一趟" : "安排一趟送货"), body,
    foot: `${plan.id ? btn("删除", "trip-del", { cls: "danger" }) : ""}<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn primary" data-act="trip-save">${esc(t("保存"))}</button>` };
}
INP["trip-date"] = el => { plan.date = el.value; }; INP["trip-name"] = el => { plan.name = el.value; };
INP["trip-vehicle"] = el => { plan.vehicle = +el.value || 0; }; INP["trip-labor"] = el => { plan.labor = +el.value || 0; };
CHG["trip-toggle"] = el => { const id = el.dataset.id; plan.order = el.checked ? [...plan.order, id] : plan.order.filter(x => x !== id); };
const swap = (i, j) => { const o = plan.order; if (o[j] !== undefined) [o[i], o[j]] = [o[j], o[i]]; };
ACT["trip-up"] = el => swap(+el.dataset.i, +el.dataset.i - 1);
ACT["trip-down"] = el => swap(+el.dataset.i, +el.dataset.i + 1);
ACT["trip-suggest"] = () => { const m = model(), stops = plan.order.map(id => stopOf(m.saleM.get(id))); plan.order = suggestOrder(stops, towns()).map(s => s.saleId); };
ACT["trip-est"] = () => { const m = model(), stops = plan.order.map(id => stopOf(m.saleM.get(id))); plan.vehicle = r2(routeKm(stops, towns(), opts()) * opts().perKm); };
ACT["ai-route"] = async el => {
  const out = el.closest(".ai-box").querySelector("[data-ai]"), m = model(), stops = plan.order.map(id => stopOf(m.saleM.get(id)));
  if (!aiAvailable()) { out.textContent = aiError() + " " + t("上面的建议顺序和里程估算不受影响。"); return; }
  out.textContent = t("思考中…");
  const cmp = compareTrips(stops, towns(), opts());
  const txt = await askAI("route", { towns: towns().map(x => ({ name: x.name, distKm: x.distKm, dir: x.dir })), stops: stops.map(s => ({ town: s.town, village: s.village })), currentOrder: stops.map(s => s.town + s.village), suggested: cmp.ordered.map(s => s.town + s.village), separateKm: cmp.separateKm, combinedKm: cmp.combinedKm, perKm: opts().perKm }, locale());
  out.textContent = txt || aiError() + " " + t("上面的建议顺序和里程估算不受影响。");
};
ACT["trip-save"] = async () => {
  if (!plan.order.length) { toast(t("请先选要送的单")); return; }
  const m = model(), old = plan.id ? byId("trip", plan.id) : null;
  const trip = await save("trip", { ...(old || {}), id: old?.id, date: plan.date, name: plan.name, vehicle: plan.vehicle, labor: plan.labor, saleIds: plan.order });
  const kept = new Set(plan.order);
  for (const id of plan.order) { const s = byId("sale", id); if (s && s.delivery?.tripId !== trip.id) await save("sale", { ...s, delivery: { ...s.delivery, tripId: trip.id, labor: 0, vehicle: 0 } }); }
  for (const id of old?.saleIds || []) if (!kept.has(id)) { const s = byId("sale", id); if (s) await save("sale", { ...s, delivery: { ...s.delivery, tripId: undefined } }); }
  back();
};
ACT["trip-del"] = () => ask(t("确认删除这一趟？"), t("里面的销售单会回到「待安排」，送货成本需要重新填。"), async () => {
  const old = byId("trip", plan.id); for (const id of old?.saleIds || []) { const s = byId("sale", id); if (s) await save("sale", { ...s, delivery: { ...s.delivery, tripId: undefined } }); }
  await remove("trip", plan.id); back();
}, "删除");

export { renderTrips };
