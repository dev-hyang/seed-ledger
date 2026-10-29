/* ============ 打印：销售单（客户联 + 存根联）、客户对账单、种子公司对账单 ============
   这是自己的销售单 / 送货单 / 对账单，不是税务发票。
   客户联绝不印「私下价」和内部成本利润；对账单会列出收款和让利（客户本来就知道），不含私下价。 */
import { S } from "../core/state.js";
import { esc } from "../core/util.js";
import { t, money, qty, unitPrice, dateFmt, pct } from "../core/i18n.js";
import { supplierStatement, EPS } from "../logic/ledger.js";
import { model, byId, brandName, customerName, supplierName, sortBy } from "./common.js";
import { ACT } from "./actions.js";

function printHTML(html){
  document.getElementById("printarea").innerHTML = html;
  document.body.classList.add("print-doc");
  const done = () => { document.body.classList.remove("print-doc"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done); window.print();
}
const shop = () => esc(S.settings.name || t("稻种账本"));
const NOT_INVOICE = () => `<p class="p-note">${esc(t("本单据为销售单 / 送货单，不是税务发票。"))}</p>`;

function slip(s, copy){
  const c = byId("customer", s.customerId) || {};
  return `<section class="slip"><header><h2>${shop()} · ${esc(t("销售单"))} <small>${esc(copy)}</small></h2><p>${esc(t("单号"))} ${esc(s.no || "")} · ${esc(dateFmt(s.date))}</p></header>
    <p><b>${esc(t("客户"))}：</b>${esc(c.name || "")} ${esc(c.phone || "")} ${esc([c.town, c.village].filter(Boolean).join(" "))}</p>
    <table><thead><tr><th>${esc(t("品种"))}</th><th>${esc(t("数量"))}</th><th>${esc(t("单价"))}</th><th>${esc(t("金额"))}</th></tr></thead><tbody>
    ${s.lines.map(l => `<tr><td>${esc(brandName(l.brandId))}</td><td>${esc(qty(l.qty))}</td><td>${esc(unitPrice(l.price))}</td><td>${esc(money(l.amount))}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="3">${esc(t("货款合计"))}</td><td>${esc(money(s.gross))}</td></tr>
    ${s.adjTotal > EPS ? `<tr><td colspan="3">${esc(t("让利"))}</td><td>−${esc(money(s.adjTotal))}</td></tr><tr><td colspan="3">${esc(t("应收"))}</td><td>${esc(money(s.net))}</td></tr>` : ""}
    <tr><td colspan="3">${esc(t("已收"))}</td><td>${esc(money(s.paid))}</td></tr><tr><td colspan="3"><b>${esc(t("欠款"))}</b></td><td><b>${esc(money(Math.max(s.balance, 0)))}</b></td></tr></tfoot></table>
    <p>${esc(s.delivery?.type === "deliver" ? t("送货上门") : t("客户上门取货"))}${s.note ? " · " + esc(s.note) : ""}</p>${NOT_INVOICE()}
    <div class="sign"><span>${esc(t("客户签字："))}</span><span>${esc(t("经办人："))}</span><span>${esc(t("日期："))}</span></div></section>`;
}
ACT["print-sale"] = el => { const s = model().saleM.get(el.dataset.id); if (s) printHTML(slip(s, t("客户联")) + '<hr class="cut">' + slip(s, t("存根联"))); };

ACT["print-customer"] = el => {
  const m = model(), c = byId("customer", el.dataset.id); if (!c) return;
  const sales = sortBy(m.sales.filter(s => s.customerId === c.id && s.status !== "void"), s => s.date);
  const tot = k => sales.reduce((a, s) => a + s[k], 0), adjLab = { negotiate: "议价", discount: "折上折", writeoff: "核销坏账" };
  printHTML(`<section class="slip"><header><h2>${shop()} · ${esc(t("客户对账单"))}</h2><p>${esc(c.name)} ${esc(c.phone || "")} ${esc([c.town, c.village].filter(Boolean).join(" "))} · ${esc(t("打印日期"))} ${esc(dateFmt(new Date().toISOString().slice(0, 10)))}</p></header>
    <table><thead><tr><th>${esc(t("日期"))}</th><th>${esc(t("品种"))}</th><th>${esc(t("货款"))}</th><th>${esc(t("让利"))}</th><th>${esc(t("应收"))}</th><th>${esc(t("已收"))}</th><th>${esc(t("欠款"))}</th></tr></thead><tbody>
    ${sales.map(s => `<tr><td>${esc(dateFmt(s.date))}<br><small>${esc(s.no || "")}</small></td><td>${esc(s.lines.map(l => brandName(l.brandId) + " " + qty(l.qty) + " × " + unitPrice(l.price)).join("；"))}</td><td>${esc(money(s.gross))}</td><td>${s.adjTotal ? "−" + esc(money(s.adjTotal)) : ""}${s.adjs.map(a => `<br><small>${esc(t(adjLab[a.type]))}${a.reason ? "：" + esc(a.reason) : ""}</small>`).join("")}</td><td>${esc(money(s.net))}</td><td>${esc(money(s.paid))}${s.pays.map(p => `<br><small>${esc(dateFmt(p.date))} ${esc(money(p.amount))}</small>`).join("")}</td><td>${esc(money(Math.max(s.balance, 0)))}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="2"><b>${esc(t("合计"))}</b></td><td>${esc(money(tot("gross")))}</td><td>−${esc(money(tot("adjTotal")))}</td><td>${esc(money(tot("net")))}</td><td>${esc(money(tot("paid")))}</td><td><b>${esc(money(sales.reduce((a, s) => a + Math.max(s.balance, 0), 0)))}</b></td></tr></tfoot></table>
    ${NOT_INVOICE()}<div class="sign"><span>${esc(t("客户确认签字："))}</span><span>${esc(t("经办人："))}</span><span>${esc(t("日期："))}</span></div></section>`);
};

ACT["print-supplier"] = el => {
  const m = model(), y = +S.filters.year || new Date().getFullYear(), st = supplierStatement(m, el.dataset.id, y), typeLab = { pay: "打款入池", purchase: "进货", return: "退货抵扣", fee: "手续费" };
  printHTML(`<section class="slip"><header><h2>${shop()} · ${esc(supplierName(el.dataset.id))} · ${y} ${esc(t("年对账单"))}</h2></header>
    <table><tbody>${[["期初（上年结转）", st.opening], ["＋ 本年打款入池", st.paid], ["－ 本年进货", st.purchases], ["＋ 本年退货抵扣", st.returns], ["－ 手续费（拆包 / 退货）", st.fees]].map(([k, v]) => `<tr><td>${esc(t(k))}</td><td>${esc(money(v))}</td></tr>`).join("")}
    <tr><td><b>${esc(t("期末余额"))}</b></td><td><b>${esc(money(st.closing))}</b></td></tr></tbody></table>
    <p>${esc(t("进货"))} ${esc(qty(st.purchasedQty))} · ${esc(t("退货"))} ${esc(qty(st.returnedQty))}（${esc(pct(st.returnRatio))}）</p>
    <table><thead><tr><th>${esc(t("日期"))}</th><th>${esc(t("项目"))}</th><th>${esc(t("金额"))}</th><th>${esc(t("池内余额"))}</th></tr></thead><tbody>${st.entries.map(e => `<tr><td>${esc(dateFmt(e.date))}</td><td>${esc(t(typeLab[e.type]))}${e.ref.brandId ? " · " + esc(brandName(e.ref.brandId)) : ""} ${e.ref.note ? esc(e.ref.note) : ""}</td><td>${esc(money(e.amount, { sign: true }))}</td><td>${esc(money(e.balance))}</td></tr>`).join("")}</tbody></table>
    <div class="sign"><span>${esc(t("经办人："))}</span><span>${esc(t("对方确认："))}</span><span>${esc(t("日期："))}</span></div></section>`);
};
