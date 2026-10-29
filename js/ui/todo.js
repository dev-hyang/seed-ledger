/* ============ 概览顶部的「待处理」 ============
   只提醒，不越界：任务由 logic/todos.js 根据销售单、收款、库存、成员申请算出，这里只负责显示和给一个「去处理」的入口。
   不往应用外发通知；成员管理类只给创建者 / 合伙人；按钮只给有权限的人（只读成员只看得到提醒）。
   版式：一条一张小卡片，左边色条表示紧急程度（红 逾期 / 橙 今明两天 / 蓝 参考），手机上按钮换到下一行，电脑上在右边。 */
import { S, canWrite } from "../core/state.js";
import { esc, today } from "../core/util.js";
import { t, money, qty, dateFmt } from "../core/i18n.js";
import { buildTodos } from "../logic/todos.js";
import { perms } from "../core/auth-msg.js";
import { customerName, brandName, supplierName } from "./common.js";

const ICON = { delivery: "🚚", collect: "💰", team: "👥", stock: "📦", pool: "🏢" };

/** code → { title, sub, label }：文字集中在这里，逻辑层不碰 i18n */
function describe(it){
  const p = it.params, c = p.customerId ? customerName(p.customerId) : "";
  switch (it.code) {
    case "deliver-overdue": return { title: t("送货已逾期 {n} 天：{c}", { n: p.days, c }), sub: `${qty(p.qty)} · ${dateFmt(p.on)}`, label: "查看" };
    case "deliver-today": return { title: t("今天送货：{c}", { c }), sub: qty(p.qty), label: "查看" };
    case "deliver-tomorrow": return { title: t("明天送货：{c}", { c }), sub: `${qty(p.qty)} · ${dateFmt(p.on)}`, label: "查看" };
    case "deliver-soon": return { title: t("{n} 天后送货：{c}", { n: p.days, c }), sub: `${qty(p.qty)} · ${dateFmt(p.on)}`, label: "查看" };
    case "deliver-undated": return { title: t("{n} 张送货单还没定送货日期", { n: p.count }), sub: t("在销售单里填上送货日期，就会按日期提醒；也可以合并成一趟送"), label: "去安排" };
    case "collect-due": return { title: t("收款已到期 {n} 天：{c}", { n: p.days, c }), sub: t("欠款 {a}", { a: money(p.amount) }), label: "去讨账" };
    case "collect-soon": return { title: t("{n} 天后到约定收款日：{c}", { n: p.days, c }), sub: t("欠款 {a}", { a: money(p.amount) }), label: "查看" };
    case "collect-old": return { title: t("{c} 赊账 {n} 天了", { n: p.days, c }), sub: t("欠款 {a}", { a: money(p.amount) }), label: "去讨账" };
    case "join": return { title: t("{n} 申请加入，等你批准", { n: p.name }), sub: t("认识再批准；批准后是只读成员"), label: "去处理" };
    case "vote-partner": return { title: t("{n} 申请成为合伙人，需要全体同意", { n: p.name }), sub: t("已同意 {a}/{b}", { a: p.agreed, b: p.total }), label: "去表决" };
    case "vote-remove": return { title: t("申请移出成员 {n}，需要全体同意", { n: p.name }), sub: t("已同意 {a}/{b}", { a: p.agreed, b: p.total }), label: "去表决" };
    case "partner-wait": return { title: t("你的合伙人申请：等待全体同意"), sub: t("已同意 {a}/{b}", { a: p.agreed, b: p.total }), label: "查看" };
    case "remove-wait": return { title: t("你发起的移出 {n}：等待全体同意", { n: p.name }), sub: t("已同意 {a}/{b}", { a: p.agreed, b: p.total }), label: "查看" };
    case "oversold": return { title: t("{b} 卖超了 {q}", { b: brandName(p.brandId), q: qty(p.qty) }), sub: t("检查进货记录"), label: "去库存" };
    case "pool-owe": return { title: t("{s} 需要补款 {a}", { s: supplierName(p.supplierId), a: money(p.amount) }), sub: t("种子公司账为负：拖欠要补款"), label: "查看" };
    default: return { title: it.code, sub: "", label: "查看" };
  }
}
const attrs = o => Object.entries(o).map(([k, v]) => k === "act" ? `data-act="${esc(v)}"` : `data-${esc(k)}="${esc(v)}"`).join(" ");

function card(it, write){
  const d = describe(it);
  return `<li class="todo-item tone-${it.tone}"><span class="todo-ic" aria-hidden="true">${ICON[it.kind] || "•"}</span>
    <div class="todo-main"><b>${esc(d.title)}</b>${d.sub ? `<small>${esc(d.sub)}</small>` : ""}</div>
    <div class="todo-acts"><button type="button" class="btn sm ${it.tone === "bad" ? "primary" : ""}" ${attrs(it.act)}>${esc(t(d.label))}</button>${it.done && write ? `<button type="button" class="btn sm" ${attrs(it.done)}>${esc(t("已送达"))}</button>` : ""}</div></li>`;
}

function todoSection(m, year){
  const role = S.cloud === "local" ? "owner" : S.role, { items, total } = buildTodos({ m, today: today(), year, perms: perms(role), team: S.team || null, me: S.user?.id || "" });
  const head = `<div class="card-head"><h3>${esc(t("待处理"))}${total ? ` <span class="badge ${items.some(x => x.tone === "bad") ? "bad" : "warn"}">${total}</span>` : ""}</h3></div>`;
  if (!items.length) return `<section class="card todo-card">${head}<p class="hint todo-empty">✓ ${esc(t("今天没有要处理的事"))}</p></section>`;
  return `<section class="card todo-card" aria-label="${esc(t("待处理"))}">${head}<ul class="todos">${items.map(it => card(it, canWrite())).join("")}</ul>${total > items.length ? `<p class="hint">${esc(t("还有 {n} 条没显示：先处理上面的", { n: total - items.length }))}</p>` : ""}</section>`;
}

export { todoSection };
