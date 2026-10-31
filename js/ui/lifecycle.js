/* ============ 销售 / 客户生命周期：行记录表 + 时间线 ============ */
import { S } from "../core/state.js";
import { esc } from "../core/util.js";
import { t, money, qty, unitPrice, dateFmt, pct } from "../core/i18n.js";
import { EPS } from "../logic/ledger.js";
import { brandName } from "./common.js";
import { badge } from "./kit.js";
import { ACT } from "./actions.js";

const KIND_LAB = {
  buy: "下单", pickup: "上门取货", "deliver-plan": "约定送货", delivered: "已送达",
  negotiate: "议价", discount: "折上折", writeoff: "核销坏账", pay: "收款",
  chase: "标记待催账", due: "约定收款日", void: "作废"
};
const METHODS = { cash: "现金", wechat: "微信", alipay: "支付宝", bank: "银行转账", other: "其它" };

function eventTitle(e){
  return t(KIND_LAB[e.kind] || e.kind) + (e.closes ? " · " + t("结清") : "");
}
function eventDetail(e){
  if (e.kind === "buy") return (e.lines || []).map(l => `${brandName(l.brandId)} ${qty(l.qty)} × ${unitPrice(l.price)}`).join("；");
  if (e.kind === "negotiate" && e.adj?.nMode === "unit" && e.adj.prices) return e.adj.prices.map(l => `${brandName(l.brandId)} ${unitPrice(l.price)}`).join("；");
  if (e.kind === "discount" && e.adj?.pct) return t("再折 {p}", { p: pct(e.adj.pct) });
  if (e.kind === "pay") return t(METHODS[e.pay?.method] || "其它") + (e.pay?.note ? " · " + e.pay.note : "");
  if (e.kind === "void") return e.reason || "";
  if (e.adj?.reason) return e.adj.reason;
  return "";
}
function eventAmt(e){
  if (e.kind === "buy") return money(e.amount);
  if (e.kind === "pay") return "+" + money(e.amount);
  if (e.kind === "negotiate" || e.kind === "discount" || e.kind === "writeoff") return "−" + money(e.amount);
  return "";
}
const toneOf = e => e.kind === "void" || e.kind === "writeoff" ? "neg" : e.closes ? "pos" : e.kind === "chase" || e.kind === "due" ? "warn" : "";

function lifeBlock(events, { viewKey, showSale = false, emptyMsg = "还没有记录。" } = {}){
  const view = S.filters[viewKey] || "rows";
  const tabs = `<div class="subtabs" role="tablist">${[["rows", "行记录"], ["time", "时间线"]].map(([k, l]) => `<button type="button" role="tab" aria-selected="${view === k}" data-act="life-view" data-k="${k}" data-filter="${viewKey}">${esc(t(l))}</button>`).join("")}</div>`;
  if (!events.length) return `${tabs}<div class="empty"><p>${esc(t(emptyMsg))}</p></div>`;
  return tabs + (view === "time" ? timeView(events, showSale) : rowView(events, showSale));
}
ACT["life-view"] = el => { S.filters[el.dataset.filter] = el.dataset.k; };

function rowView(events, showSale){
  const bal = e => showSale ? e.custBal : e.balance;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t("日期"))}</th>${showSale ? `<th>${esc(t("销售单"))}</th>` : ""}<th>${esc(t("事项"))}</th><th class="n">${esc(t("金额"))}</th><th class="n">${esc(t("欠款"))}</th></tr></thead><tbody>
    ${events.map(e => `<tr class="${toneOf(e)}${e.closes ? " closes" : ""}"><td>${esc(dateFmt(e.date))}</td>${showSale ? `<td>${e.saleId ? `<button type="button" class="link" data-act="sale-view" data-id="${esc(e.saleId)}">${esc(e.saleNo || t("销售单"))}</button>` : ""}</td>` : ""}<td><b>${esc(eventTitle(e))}</b>${eventDetail(e) ? `<small>${esc(eventDetail(e))}</small>` : ""}${e.closes ? " " + badge(t("结清"), "good") : ""}</td><td class="n">${esc(eventAmt(e))}</td><td class="n">${Math.abs(bal(e)) > EPS ? esc(money(Math.max(bal(e), 0))) : "—"}</td></tr>`).join("")}</tbody></table></div>`;
}

function timeView(events, showSale){
  return `<ol class="tl">${events.map(e => {
    const bal = showSale ? e.custBal : e.balance;
    const amt = eventAmt(e);
    const sale = showSale && e.saleId ? `<button type="button" class="link" data-act="sale-view" data-id="${esc(e.saleId)}">${esc(e.saleNo || t("销售单"))}</button>` : "";
    return `<li class="${toneOf(e)}${e.closes ? " closes" : ""}"><time>${esc(dateFmt(e.date))}</time><div class="tl-body">${sale}<b>${esc(eventTitle(e))}</b>${eventDetail(e) ? `<small>${esc(eventDetail(e))}</small>` : ""}</div><span class="tl-side">${amt ? `<b>${esc(amt)}</b>` : ""}<small>${esc(t("欠款"))} ${esc(money(Math.max(bal, 0)))}</small></span></li>`;
  }).join("")}</ol>`;
}

export { lifeBlock, eventTitle, KIND_LAB };
