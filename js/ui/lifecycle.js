/* ============ 销售 / 客户生命周期：行记录表 + 时间线 ============ */
import { S } from "../core/state.js";
import { esc } from "../core/util.js";
import { t, money, qty, unitPrice, dateFmt, pct } from "../core/i18n.js";
import { EPS } from "../logic/ledger.js";
import { brandName } from "./common.js";
import { badge, segBtns } from "./kit.js";
import { ACT } from "./actions.js";
import { paged, resetPage } from "./pager.js";

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

/** pageKey：给了就分页（客户的销售历史会越来越长）；欠款滚动余额在 events 里已按完整列表算好，这里只截取要显示的部分。
    newestFirst：倒过来显示（最新的在第一页），余额仍是按时间正序算出来的那一刻的值 */
function lifeBlock(events, { viewKey, showSale = false, emptyMsg = "还没有记录。", pageKey = "", newestFirst = false } = {}){
  const view = S.filters[viewKey] || "rows";
  const tabs = segBtns([["rows", "行记录"], ["time", "时间线"]], view, "life-view", { filter: viewKey, page: pageKey });
  if (!events.length) return `${tabs}<div class="empty"><p>${esc(t(emptyMsg))}</p></div>`;
  const list = newestFirst ? [...events].reverse() : events;
  const pg = pageKey ? paged(pageKey, list) : { rows: list, btn: "" };
  return tabs + (view === "time" ? timeView(pg.rows, showSale) : rowView(pg.rows, showSale)) + pg.btn;
}
ACT["life-view"] = el => { S.filters[el.dataset.filter] = el.dataset.k; if (el.dataset.page) resetPage(el.dataset.page); };

function rowView(events, showSale){
  const bal = e => showSale ? e.custBal : e.balance;
  return `<div class="tbl-wrap"><table class="tbl stack"><thead><tr><th>${esc(t("日期"))}</th>${showSale ? `<th>${esc(t("销售单"))}</th>` : ""}<th>${esc(t("事项"))}</th><th class="n">${esc(t("金额"))}</th><th class="n">${esc(t("欠款"))}</th></tr></thead><tbody>
    ${events.map(e => `<tr class="${toneOf(e)}${e.closes ? " closes" : ""}"><td data-l="${esc(t("日期"))}">${esc(dateFmt(e.date))}</td>${showSale ? `<td data-l="${esc(t("销售单"))}">${e.saleId ? `<button type="button" class="link" data-act="sale-view" data-id="${esc(e.saleId)}">${esc(e.saleNo || t("销售单"))}</button>` : ""}</td>` : ""}<td class="lead"><b>${esc(eventTitle(e))}${e.closes ? " " + badge(t("结清"), "good") : ""}</b>${eventDetail(e) ? `<small>${esc(eventDetail(e))}</small>` : ""}</td><td class="n" data-l="${esc(t("金额"))}">${esc(eventAmt(e))}</td><td class="n" data-l="${esc(t("欠款"))}">${Math.abs(bal(e)) > EPS ? esc(money(Math.max(bal(e), 0))) : "—"}</td></tr>`).join("")}</tbody></table></div>`;
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
