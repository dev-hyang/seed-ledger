/* ============ 概览：这一年的数字 + 今天该盯的事（欠款、库存、种子公司账） ============ */
import { S } from "../core/state.js";
import { esc } from "../core/util.js";
import { t, money, qty, pct, dateFmt } from "../core/i18n.js";
import { filterFacts, summarize, inventory, supplierStatement, r2, EPS } from "../logic/ledger.js";
import { model, brandName, customerName, supplierName, sortBy, yearSelect, ro } from "./common.js";
import { kv, btn, badge, empty } from "./kit.js";
import { yearNow } from "./stock.js";
import { todoSection } from "./todo.js";
import { APP_VERSION } from "../config.js";
import { releaseBadgeHTML } from "./releases-ui.js";

/* 常用操作：四个一样大的方块（手机 2×2，电脑一排 4 个），线条图标 + 短文字；记销售是主操作（绿色实心） */
const QA_ICON = {
  sale: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM12 8v6M9 11h6"/>', buy: '<path d="M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8"/>',
  scan: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', rep: '<path d="M4 20V4M4 20h16M8 16v-5M13 16V8M18 16v-8"/>'
};
function quick(){
  const tile = (ic, label, attrs, cls = "") => `<button type="button" class="qa-tile ${cls}" ${attrs}><svg viewBox="0 0 24 24" aria-hidden="true">${QA_ICON[ic]}</svg><span>${esc(t(label))}</span></button>`;
  const w = !ro();
  return `<div class="qa${w ? "" : " qa-ro"}">${w ? tile("sale", "记一笔销售", 'data-act="sale-new"', "primary") + tile("buy", "进货", 'data-act="purchase-new"') + tile("scan", "扫描 / 导入", 'data-act="scan-open"') : ""}${tile("rep", "报表", 'data-act="goto" data-tab="reports"')}</div>`;
}
const ageDays = d => Math.max(0, Math.round((Date.now() - new Date(d + "T00:00:00")) / 864e5));

function renderHome(){
  const m = model(), y = yearNow(), sum = summarize(filterFacts(m, { year: y }));
  const owing = m.sales.filter(s => s.status !== "void" && s.balance > EPS);
  const byCust = new Map(); for (const s of owing) byCust.set(s.customerId, (byCust.get(s.customerId) || 0) + s.balance);
  const marked = new Set(owing.filter(s => s.chase).map(s => s.customerId)), topOwe = sortBy([...byCust], ([id, v]) => (marked.has(id) ? 1e12 : 0) + v, -1).slice(0, 5), late = owing.filter(s => ageDays(s.date) > 180).length;
  const inv = inventory(m, y), left = inv.filter(r => r.onHand > 0.5), over = inv.filter(r => r.oversold);
  const pools = sortBy(m.D.supplier.map(s => ({ s, st: supplierStatement(m, s.id, y) })), x => x.st.closing);
  const empty0 = !m.D.sale.length && !m.D.purchase.length;
  return `${releaseBadgeHTML()}<div class="page-head"><h1>${esc(S.settings.name || t("稻种账本"))}</h1><div class="head-tools">${yearSelect(y)}</div></div>
    ${quick()}
    ${empty0 && !ro() ? `<section class="card"><h3>${esc(t("开始用：三步"))}</h3><p class="hint">${esc(t("按顺序点右边的按钮，每一步都只填几项。"))}</p><ol class="steps">
      <li><span>${esc(t("在「库存 → 种子公司账」添加种子公司"))}</span>${btn("＋ 添加种子公司", "supplier-new", { cls: "sm" })}</li>
      <li><span>${esc(t("在「库存 → 品种与价格」添加品种（早稻 / 一晚 / 二晚）和价格"))}</span>${btn("＋ 添加品种", "brand-new", { cls: "sm" })}</li>
      <li><span>${esc(t("在「库存 → 进货 / 退货」记进货，然后就可以记销售了"))}</span>${btn("＋ 进货", "purchase-new", { cls: "sm" })}</li></ol></section>` : ""}
    ${todoSection(m, y)}
    <div class="kpis big"><div class="kv hero ${sum.profit < 0 ? "neg" : "pos"}"><span>${esc(t("{y} 年利润", { y }))}</span><b>${esc(money(sum.profit, { sign: true }))}</b><small>${esc(t("利润率 {p}", { p: pct(sum.margin) }))}</small></div>${kv("销售额", money(sum.net))}${kv("已收", money(sum.paid))}${kv("未收", money(sum.owing), sum.owing > EPS ? "neg" : "")}</div>
    <section class="card"><div class="card-head"><h3>${esc(t("待催账：欠款客户"))}</h3>${late ? badge(t("{n} 单超过半年", { n: late }), "bad") : ""}</div>
      ${topOwe.length ? `<ul class="list tight">${topOwe.map(([id, v]) => `<li><button class="row" data-act="customer-view" data-id="${id}"><span class="row-main"><b>${esc(customerName(id))}</b></span><span class="row-side"><b class="neg">${esc(money(v))}</b>${marked.has(id) ? badge(t("待催账"), "bad") : ""}</span></button></li>`).join("")}</ul><div class="card-more"><button class="link" data-act="goto" data-tab="sales" data-sub="collect">${esc(t("去催账 ›"))}</button></div>` : `<p class="hint">${esc(t("没有欠款。"))}</p>`}</section>
    <section class="card"><h3>${esc(t("库存提醒"))}</h3>
      ${over.length ? `<p class="neg">${esc(t("卖超了："))}${esc(over.map(r => brandName(r.brandId)).join("、"))}（${esc(t("检查进货记录"))}）</p>` : ""}
      ${left.length ? `<ul class="list tight">${sortBy(left, r => r.value, -1).slice(0, 6).map(r => `<li><div class="row static"><span class="row-main"><b>${esc(brandName(r.brandId))}</b><small>${esc(supplierName(r.supplierId))}</small></span><span class="row-side"><b>${esc(qty(r.onHand))}</b><small>${esc(money(r.value))}</small></span></div></li>`).join("")}</ul><div class="card-more"><button class="link" data-act="goto" data-tab="stock">${esc(t("库存详情 ›"))}</button></div>` : `<p class="hint">${esc(inv.length ? t("没有剩余库存。") : t("还没有进货记录。"))}</p>`}</section>
    ${pools.length ? `<section class="card"><h3>${esc(t("种子公司的钱池"))}</h3><ul class="list tight">${pools.map(({ s, st }) => `<li><button class="row" data-act="supplier-view" data-id="${s.id}"><span class="row-main"><b>${esc(s.name)}</b></span><span class="row-side"><b class="${st.closing < 0 ? "neg" : ""}">${esc(money(st.closing))}</b>${st.state === "owe" ? badge(t("需补款"), "bad") : st.state === "carry" ? badge(t("结转明年"), "good") : ""}</span></button></li>`).join("")}</ul><div class="card-more"><button class="link" data-act="goto" data-tab="stock" data-sub="pool">${esc(t("种子公司账 ›"))}</button></div></section>` : ""}
    <p class="hint center appver-line">${esc(t("稻种账本"))} · <button type="button" class="vlink" data-act="open-releases" aria-label="${esc(t("发布日志"))}">${esc(t("版本"))} v${esc(APP_VERSION)}</button></p>`;
}

export { renderHome };
