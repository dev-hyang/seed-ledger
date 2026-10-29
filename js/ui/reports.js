/* ============ 报表：利润、成本、年趋势、热销、种子公司 × 品种、客户 ============
   所有图表和表格都来自同一份「销售行事实表 + 手续费」（logic/ledger.js），筛选一变，合计和明细永远对得上。
   利润 = 应收 − 进货成本 − 送货成本 − 种子公司手续费（应收口径）；「已收」和「未收」另列，避免坏账被当成利润。 */
import { S, live } from "../core/state.js";
import { esc, downloadCSV, toast } from "../core/util.js";
import { t, money, moneyNum, qty, qtyNum, unitLabel, currency, pct } from "../core/i18n.js";
import { filterFacts, summarize, groupBy } from "../logic/ledger.js";
import { model, brandName, customerName, supplierName, seasonName, seasonOpts, sortBy, years, byId } from "./common.js";
import { fld, select, kv, empty } from "./kit.js";
import { columns, line, hbars, costProfit } from "./charts.js";
import { ACT, CHG } from "./actions.js";

const F = () => (S.filters.rep ||= { year: new Date().getFullYear() });
const STATUS_OPTS = () => [["owing", t("有欠款")], ["settled", t("已结清")]];

function filterBar(){
  const f = F(), brands = sortBy(live("brand"), b => b.name).map(b => [b.id, b.name]);
  const sel = (key, label, opts, blank) => `<label class="rf"><span>${esc(t(label))}</span><select data-rep="${key}">${[["", blank], ...opts].map(([v, l]) => `<option value="${esc(v)}" ${String(f[key] ?? "") === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  return `<div class="repfilters">${sel("year", "年份", years().map(y => [y, String(y)]), t("全部年份"))}${sel("seasonId", "季节", seasonOpts(), t("全部"))}${sel("brandId", "品种", brands, t("全部"))}
    ${sel("supplierId", "种子公司", sortBy(live("supplier"), s => s.name).map(s => [s.id, s.name]), t("全部"))}${sel("customerId", "客户", sortBy(live("customer"), c => c.name).map(c => [c.id, c.name]), t("全部"))}${sel("status", "收款状态", STATUS_OPTS(), t("全部"))}
    <label class="rf"><span>${esc(t("从"))}</span><input type="date" data-rep="from" value="${esc(f.from || "")}"></label><label class="rf"><span>${esc(t("到"))}</span><input type="date" data-rep="to" value="${esc(f.to || "")}"></label>
    <button class="btn sm" data-act="rep-reset">${esc(t("清除筛选"))}</button></div>`;
}
CHG.rep = el => { const f = F(); f[el.dataset.rep] = el.value; };
ACT["rep-reset"] = () => { S.filters.rep = { year: new Date().getFullYear() }; };

const row = (label, r) => ({ label, ...r });

function renderReports(){
  const m = model(), f = F(), flt = { ...f, year: f.year || "" };
  const data = filterFacts(m, flt), sum = summarize(data);
  if (!m.sales.length && !m.D.purchase.length) return `<div class="page-head"><h1>${esc(t("报表"))}</h1></div>${empty("还没有数据。记了销售和进货后，这里会自动出报表。")}`;
  const kpis = `<div class="kpis big">${kv("销售额", money(sum.net))}${kv("成本", money(sum.cost))}${kv("送货", money(sum.delivery))}${kv("种子公司手续费", money(sum.fee))}
    <div class="kv hero ${sum.profit < 0 ? "neg" : "pos"}"><span>${esc(t("利润"))}</span><b>${esc(money(sum.profit, { sign: true }))}</b><small>${esc(t("利润率 {p}", { p: pct(sum.margin) }))}</small></div>${kv("已收", money(sum.paid))}${kv("未收", money(sum.owing), sum.owing > 0.5 ? "neg" : "")}</div>`;

  // 年趋势：不受「年份 / 日期」筛选影响，永远看全部年份
  const allYears = filterFacts(m, { ...flt, year: "", from: "", to: "" });
  const trend = groupBy(allYears, "year").sort((a, b) => a.key - b.key);
  const trendHTML = trend.length ? line(trend.map(r => ({ label: String(r.key), value: r.profit })), { label: t("年利润趋势") }) : "";

  const monthly = f.year ? groupBy({ facts: data.facts, fees: [] }, "month").sort((a, b) => a.key - b.key) : [];
  const bySeason = groupBy(data, "seasonId").filter(r => r.key).map(r => row(seasonName(r.key), r));
  const byBrand = groupBy(data, "brandId").filter(r => r.key).map(r => row(brandName(r.key), r));
  const hot = sortBy(byBrand, r => r.qty, -1).slice(0, 10);
  const bySup = groupBy(data, "supplierId").filter(r => r.key);
  const pairs = groupBy(data, x => x.supplierId + "|" + x.brandId);
  const byCust = groupBy({ facts: data.facts, fees: [] }, "customerId").map(r => ({ ...r, name: customerName(r.key) }));

  const supplierBlocks = sortBy(bySup, r => r.profit, -1).map(sr => {
    const items = pairs.filter(p => p.key.startsWith(sr.key + "|"));
    return `<div class="card"><div class="card-head"><b>${esc(supplierName(sr.key))}</b><b class="${sr.profit < 0 ? "neg" : "pos"}">${esc(money(sr.profit, { sign: true }))}${sr.profit < 0 ? " · " + esc(t("亏本")) : ""}</b></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t("品种"))}</th><th class="n">${esc(t("销量"))}</th><th class="n">${esc(t("销售额"))}</th><th class="n">${esc(t("成本"))}</th><th class="n">${esc(t("利润"))}</th></tr></thead><tbody>
      ${items.map(p => { const bid = p.key.split("|")[1]; return `<tr><td>${bid ? esc(brandName(bid)) : `<small>${esc(t("手续费（当年无进货，未摊到品种）"))}</small>`}</td><td class="n">${esc(qty(p.qty))}</td><td class="n">${esc(money(p.net))}</td><td class="n">${esc(money(p.cost + p.delivery + p.fee))}</td><td class="n ${p.profit < 0 ? "neg" : ""}"><b>${esc(money(p.profit, { sign: true }))}</b></td></tr>`; }).join("")}</tbody></table></div></div>`;
  }).join("");

  return `<div class="page-head"><h1>${esc(t("报表"))}</h1><div class="head-tools"><button class="btn sm" data-act="rep-csv">${esc(t("导出明细 CSV"))}</button><button class="btn sm" data-act="rep-csv-sum">${esc(t("导出汇总 CSV"))}</button><button class="btn sm primary" data-act="rep-print">${esc(t("打印"))}</button></div></div>
    ${filterBar()}<div id="rep-print"><p class="print-only">${esc(S.settings.name || t("稻种账本"))} · ${esc(t("经营报表"))} · ${esc(describeFilter(f))} · ${esc(currency())}</p>${kpis}
    ${data.facts.length ? `<section class="card"><h3>${esc(t("年利润趋势"))}</h3>${trendHTML}<small>${esc(t("全部年份，不受上面的年份和日期筛选影响。"))}</small></section>
    ${monthly.length ? `<section class="card"><h3>${esc(t("{y} 年每月利润", { y: f.year }))}</h3>${columns(monthly.map(r => ({ label: String(r.key), value: r.profit })), { label: t("每月利润") })}<small>${esc(t("不含种子公司手续费（手续费按年计）。"))}</small></section>` : ""}
    <section class="card"><h3>${esc(t("成本与利润"))}${bySeason.length ? ` · ${esc(t("按季节"))}` : ""}</h3>${bySeason.length ? costProfit(bySeason) : ""}<h3 class="sub">${esc(t("按品种"))}</h3>${byBrand.length ? costProfit(sortBy(byBrand, r => r.profit, -1)) : ""}</section>
    <section class="card"><h3>${esc(t("热销品种（按销量）"))}</h3>${hbars(hot.map(r => ({ label: r.label, value: r.qty, text: qty(r.qty) })), { cls: "hot" })}</section>
    <section class="card"><h3>${esc(t("哪家种子公司赚钱 / 亏本"))}</h3>${hbars(sortBy(bySup, r => r.profit, -1).map(r => ({ label: supplierName(r.key), value: r.profit, text: money(r.profit, { sign: true }) })))}</section>
    <h3 class="grp">${esc(t("种子公司 × 品种明细"))}</h3>${supplierBlocks}
    <section class="card"><h3>${esc(t("客户（按利润）"))}</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t("客户"))}</th><th class="n">${esc(t("应收"))}</th><th class="n">${esc(t("利润"))}</th><th class="n">${esc(t("未收"))}</th></tr></thead><tbody>
      ${byCust.slice(0, 15).map(r => `<tr><td>${esc(r.name)}</td><td class="n">${esc(money(r.net))}</td><td class="n ${r.profit < 0 ? "neg" : ""}">${esc(money(r.profit, { sign: true }))}</td><td class="n ${r.owing > 0.5 ? "neg" : ""}">${esc(money(r.owing))}</td></tr>`).join("")}</tbody></table></div></section>` : empty("按当前筛选没有销售记录。")}</div>`;
}
function describeFilter(f){
  const bits = [f.year ? f.year + t("年") : t("全部年份")];
  if (f.seasonId) bits.push(seasonName(f.seasonId)); if (f.brandId) bits.push(brandName(f.brandId)); if (f.supplierId) bits.push(supplierName(f.supplierId)); if (f.customerId) bits.push(customerName(f.customerId));
  if (f.status) bits.push(STATUS_OPTS().find(x => x[0] === f.status)[1]); if (f.from || f.to) bits.push(`${f.from || ""} ~ ${f.to || ""}`);
  return bits.join(" · ");
}

/* ---------- 导出 ---------- */
const stamp = () => new Date().toISOString().slice(0, 10);
const unitCol = () => `${t("数量")}(${unitLabel()})`, curCol = k => `${t(k)}(${currency()})`;
ACT["rep-csv"] = () => {
  const m = model(), { facts } = filterFacts(m, { ...F(), year: F().year || "" });
  if (!facts.length) { toast(t("没有可导出的数据")); return; }
  downloadCSV(`seed-ledger-detail-${stamp()}.csv`, [[t("日期"), t("单号"), t("客户"), t("季节"), t("品种"), t("种子公司"), unitCol(), curCol("货款"), curCol("让利"), curCol("应收"), curCol("已收"), curCol("成本"), curCol("送货"), curCol("利润"), t("状态")],
    ...sortBy(facts, x => x.date).map(x => [x.date, m.saleM.get(x.saleId)?.no || "", customerName(x.customerId), seasonName(x.seasonId), brandName(x.brandId), supplierName(x.supplierId), qtyNum(x.qty), moneyNum(x.gross), moneyNum(x.gross - x.net), moneyNum(x.net), moneyNum(x.paid), moneyNum(x.cost), moneyNum(x.delivery), moneyNum(x.profit), t({ settled: "已结清", partial: "部分已付", unpaid: "未付款 / 赊账" }[x.status] || x.status)])]);
};
ACT["rep-csv-sum"] = () => {
  const m = model(), data = filterFacts(m, { ...F(), year: F().year || "" }), pairs = groupBy(data, x => x.supplierId + "|" + x.brandId);
  if (!pairs.length) { toast(t("没有可导出的数据")); return; }
  downloadCSV(`seed-ledger-summary-${stamp()}.csv`, [[t("种子公司"), t("品种"), unitCol(), curCol("销售额"), curCol("成本"), curCol("送货"), curCol("手续费"), curCol("利润"), curCol("已收"), curCol("未收")],
    ...pairs.map(p => { const [sid, bid] = p.key.split("|"); return [supplierName(sid), bid ? brandName(bid) : t("（手续费未摊）"), qtyNum(p.qty), moneyNum(p.net), moneyNum(p.cost), moneyNum(p.delivery), moneyNum(p.fee), moneyNum(p.profit), moneyNum(p.paid), moneyNum(p.owing)]; })]);
};
ACT["rep-print"] = () => { document.body.classList.add("print-report"); window.print(); setTimeout(() => document.body.classList.remove("print-report"), 500); };

export { renderReports };
