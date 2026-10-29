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

const ageDays = d => Math.max(0, Math.round((Date.now() - new Date(d + "T00:00:00")) / 864e5));

function renderHome(){
  const m = model(), y = yearNow(), sum = summarize(filterFacts(m, { year: y }));
  const owing = m.sales.filter(s => s.status !== "void" && s.balance > EPS);
  const byCust = new Map(); for (const s of owing) byCust.set(s.customerId, (byCust.get(s.customerId) || 0) + s.balance);
  const marked = new Set(owing.filter(s => s.chase).map(s => s.customerId)), topOwe = sortBy([...byCust], ([id, v]) => (marked.has(id) ? 1e12 : 0) + v, -1).slice(0, 5), late = owing.filter(s => ageDays(s.date) > 180).length;
  const inv = inventory(m, y), left = inv.filter(r => r.onHand > 0.5), over = inv.filter(r => r.oversold);
  const pools = sortBy(m.D.supplier.map(s => ({ s, st: supplierStatement(m, s.id, y) })), x => x.st.closing);
  const empty0 = !m.D.sale.length && !m.D.purchase.length;
  return `<div class="page-head"><h1>${esc(S.settings.name || t("稻种账本"))}</h1><div class="head-tools">${yearSelect(y)}</div></div>
    ${ro() ? "" : `<div class="actions">${btn("＋ 记一笔销售", "sale-new", { cls: "primary" })}${btn("＋ 进货", "purchase-new")}${btn("📷 扫描 / 导入", "scan-open")}${btn("报表", "goto", { data: { tab: "reports" } })}</div>`}
    ${empty0 ? `<div class="card welcome"><h3>${esc(t("开始用：三步"))}</h3><ol class="bul"><li>${esc(t("在「库存 → 种子公司账」添加种子公司"))}</li><li>${esc(t("在「库存 → 品种与价格」添加品种（早稻 / 一晚 / 二晚）和价格"))}</li><li>${esc(t("在「库存 → 进货 / 退货」记进货，然后就可以记销售了"))}</li></ol></div>` : ""}
    ${todoSection(m, y)}
    <div class="kpis big">${kv("销售额", money(sum.net))}<div class="kv hero ${sum.profit < 0 ? "neg" : "pos"}"><span>${esc(t("利润"))}</span><b>${esc(money(sum.profit, { sign: true }))}</b><small>${esc(t("利润率 {p}", { p: pct(sum.margin) }))}</small></div>${kv("已收", money(sum.paid))}${kv("未收", money(sum.owing), sum.owing > EPS ? "neg" : "")}</div>
    <section class="card"><div class="card-head"><h3>${esc(t("待催账：欠款客户"))}</h3>${late ? badge(t("{n} 单超过半年", { n: late }), "bad") : ""}</div>
      ${topOwe.length ? `<ul class="list tight">${topOwe.map(([id, v]) => `<li><button class="row" data-act="customer-view" data-id="${id}"><span class="row-main"><b>${esc(customerName(id))}</b></span><span class="row-side"><b class="neg">${esc(money(v))}</b>${marked.has(id) ? badge(t("待催账"), "bad") : ""}</span></button></li>`).join("")}</ul><button class="link" data-act="goto" data-tab="sales" data-sub="collect">${esc(t("去催账 ›"))}</button>` : `<p class="hint">${esc(t("没有欠款。"))}</p>`}</section>
    <section class="card"><h3>${esc(t("库存提醒"))}</h3>
      ${over.length ? `<p class="neg">${esc(t("卖超了："))}${esc(over.map(r => brandName(r.brandId)).join("、"))}（${esc(t("检查进货记录"))}）</p>` : ""}
      ${left.length ? `<ul class="list tight">${sortBy(left, r => r.value, -1).slice(0, 6).map(r => `<li><div class="row static"><span class="row-main"><b>${esc(brandName(r.brandId))}</b><small>${esc(supplierName(r.supplierId))}</small></span><span class="row-side"><b>${esc(qty(r.onHand))}</b><small>${esc(money(r.value))}</small></span></div></li>`).join("")}</ul><button class="link" data-act="goto" data-tab="stock">${esc(t("库存详情 ›"))}</button>` : `<p class="hint">${esc(inv.length ? t("没有剩余库存。") : t("还没有进货记录。"))}</p>`}</section>
    ${pools.length ? `<p class="hint center appver-line">${esc(t("稻种账本"))} · ${esc(t("版本"))} v${esc(APP_VERSION)}</p>
    <section class="card"><h3>${esc(t("种子公司的钱池"))}</h3><ul class="list tight">${pools.map(({ s, st }) => `<li><button class="row" data-act="supplier-view" data-id="${s.id}"><span class="row-main"><b>${esc(s.name)}</b></span><span class="row-side"><b class="${st.closing < 0 ? "neg" : ""}">${esc(money(st.closing))}</b>${st.state === "owe" ? badge(t("需补款"), "bad") : st.state === "carry" ? badge(t("结转明年"), "good") : ""}</span></button></li>`).join("")}</ul></section>` : ""}`;
}

export { renderHome };
