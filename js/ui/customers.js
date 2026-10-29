/* ============ 客户页：客户表 + 自动画像 ============
   画像是规则打分（logic/profile.js），每一条扣分都写明原因；只是记录和风险提示，不构成法律意见。
   手机号默认遮挡显示（设置里可关），AI 建议只发脱敏数字（无姓名电话地址）。 */
import { S, save, live, remove } from "../core/state.js";
import { esc, toast } from "../core/util.js";
import { t, money, pct, dateFmt, locale } from "../core/i18n.js";
import { profileCustomer, anonymizedSummary } from "../logic/profile.js";
import { r2, EPS } from "../logic/ledger.js";
import { askAI, aiAvailable, aiError } from "../core/advice.js";
import { model, byId, sortBy, phoneHTML, ro } from "./common.js";
import { show, back, fld, text, area, seg, formData, badge, empty, btn, kv, ask } from "./kit.js";
import { tierOf } from "../logic/pricing.js";
import { customerLabel, findByPhone, maskPhone, placeOf, sameNameCount, validPhone } from "../logic/customers.js";
import { ACT, FORMS, INP } from "./actions.js";
import { saleRow } from "./sales.js";

const GRADE = { A: ["A 优", "good"], B: ["B 一般", "warn"], C: ["C 谨慎", "bad"], N: ["新客户", ""] };
const RENEW = { yes: "建议明年继续合作", careful: "可以继续，但要收紧条件", no: "不建议明年继续赊账 / 签约", new: "新客户：先小额、现款或高定金" };

function renderCustomers(){
  const m = model(), q = (S.filters.custQ || "").trim().toLowerCase();
  let rows = live("customer").map(c => ({ c, p: profileCustomer(m, c.id) }));
  if (q) rows = rows.filter(({ c }) => `${c.name}${c.town || ""}${c.village || ""}${c.phone || ""}`.toLowerCase().includes(q));
  rows = sortBy(rows, r => -r.p.stats.owing || r.c.name);
  return `<div class="page-head"><h1>${esc(t("客户"))}</h1><div class="head-tools">${ro() ? "" : btn("＋ 新客户", "customer-new", { cls: "primary" })}</div></div>
    <div class="filters"><input type="search" data-input="custQ" value="${esc(S.filters.custQ || "")}" placeholder="${esc(t("搜姓名、镇、村、电话"))}" aria-label="${esc(t("搜索"))}"></div>
    ${rows.length ? `<ul class="list">${rows.map(({ c, p }) => `<li><button class="row" data-act="customer-view" data-id="${c.id}"><span class="row-main"><b>${esc(c.name)}</b>${sameNameCount(live("customer"), c) ? ` <span class="badge">${esc(t("同名"))}</span>` : ""}<small>${esc([placeOf(c), c.phone ? (S.settings.maskPhone ? maskPhone(c.phone) : c.phone) : t("未填手机号，请补上")].filter(Boolean).join(" · "))}</small></span>
      <span class="row-side">${p.stats.owing > EPS ? `<b class="neg">${esc(t("欠"))} ${esc(money(p.stats.owing))}</b>` : `<small>${esc(money(p.stats.net))}</small>`}${badge(t(GRADE[p.grade][0]), GRADE[p.grade][1])}</span></button></li>`).join("")}</ul>` : empty("还没有客户。记第一笔销售时可以直接新建客户。", ro() ? "" : btn("＋ 新客户", "customer-new", { cls: "primary" }))}`;
}
INP.custQ = el => { S.filters.custQ = el.value; };
const maskedPhone = p => S.settings.maskPhone ? String(p).replace(/^(.{3}).*(.{4})$/, "$1****$2") : p;

function customerPage(id){
  const c = byId("customer", id), m = model();
  if (!c) return { title: t("客户"), body: empty("这位客户已不存在。") };
  const p = profileCustomer(m, id), s = p.stats, sales = sortBy(m.sales.filter(x => x.customerId === id), x => x.date, -1);
  const body = `<div class="detail-head"><div><b class="big">${esc(c.name)}</b><p class="meta">${esc([c.town, c.village, c.address].filter(Boolean).join(" · "))}</p>${c.phone ? `<p class="meta">${phoneHTML(c.phone)}</p>` : ""}${c.note ? `<p class="meta">${esc(c.note)}</p>` : ""}</div>${badge(t(GRADE[p.grade][0]), GRADE[p.grade][1])}</div>
    <div class="kpis">${kv("累计应收", money(s.net))}${kv("已收", money(s.paid))}${kv("欠款", money(s.owing), s.owing > EPS ? "neg" : "")}${kv("合作年数", String(s.years.length))}</div>
    <div class="card profile"><h3>${esc(t("客户画像"))} <small>${esc(t("规则打分 {n}/100", { n: p.score }))}${p.grade === "N" ? "" : ""}</small></h3>
      <p class="verdict ${p.renew}"><b>${esc(t(RENEW[p.renew]))}</b></p>
      ${p.grade === "N" ? "" : `<div class="grid2">${kv("建议定金", pct(p.deposit))}${kv("建议赊账上限", p.creditLimit ? money(p.creditLimit) : t("不赊账"))}</div>`}
      ${p.reasons.length ? `<h4>${esc(t("扣分原因"))}</h4><ul class="bul">${p.reasons.map(r => `<li class="neg">${esc(t(r.replace(/(\d+) 单超过 (\d+) 天未结清/, (_, a, b) => t("{a} 单超过 {b} 天未结清", { a, b }))))}</li>`).join("")}</ul>` : ""}
      ${p.good.length ? `<ul class="bul">${p.good.map(r => `<li class="pos">${esc(t(r))}</li>`).join("")}</ul>` : ""}
      ${s.concessionPct > 0 ? `<p class="hint">${esc(t("催账时让利合计占货款 {p}%（议价 {a}，折上折 {b}）", { p: s.concessionPct, a: money(s.negotiated), b: money(s.discounted) }))}</p>` : ""}
      ${p.guard.length ? `<h4>${esc(t("建议的保障措施"))}</h4><ul class="bul">${p.guard.map(g => `<li>${esc(t(g))}</li>`).join("")}</ul>` : ""}
      <div class="ai-box"><button class="btn sm" data-act="ai-customer" data-id="${id}">✨ ${esc(t("AI 写成建议"))}</button><div data-ai class="ai-out"></div></div>
      <small class="disc">${esc(t("以上只是根据交易记录的风险提示，不构成法律意见；重大纠纷请咨询律师，并保留全部单据。"))}</small></div>
    <h3 class="grp">${esc(t("交易记录"))}</h3>${sales.length ? `<ul class="list">${sales.map(saleRow).join("")}</ul>` : empty("还没有交易。")}`;
  return { title: c.name, body, foot: `${btn("打印对账单", "print-customer", { cls: "primary", data: { id } })}${ro() ? "" : btn("修改", "customer-edit", { data: { id } })}` };
}
ACT["customer-view"] = el => show(() => customerPage(el.dataset.id), true);
ACT["ai-customer"] = async el => {
  const out = el.closest(".ai-box").querySelector("[data-ai]");
  if (!aiAvailable()) { out.textContent = aiError() + " " + t("上面的规则建议不受影响。"); return; }
  out.textContent = t("思考中…");
  const txt = await askAI("customer", anonymizedSummary(profileCustomer(model(), el.dataset.id)), locale());
  out.textContent = txt || aiError() + " " + t("上面的规则建议不受影响。");
};

function customerForm(c){
  return { title: t(c ? "修改客户" : "新客户"),
    body: `<form id="f" data-form="customer" data-id="${c?.id || ""}">
      ${fld("姓名", text("name", c?.name, { req: true }))}${fld("手机号", text("phone", c?.phone, { type: "tel", mode: "tel", req: !c }), t("手机号用来区分同名客户，不能重复"))}
      <div class="grid2">${fld("镇", text("town", c?.town))}${fld("村", text("village", c?.village))}</div>
      ${fld("默认价格档", seg("tier", [["retail", t("零售价")], ["wholesale", t("批发价")]], tierOf(c?.tier)), t("记销售单时按这个档预选单价，随时可改"))}
      ${fld("详细地址", text("address", c?.address, { max: 120 }))}${fld("备注", area("note", c?.note))}
      <small>${esc(t("只填做生意必要的信息。客户个人信息请妥善保管，导出的文件不要随意转发。"))}</small></form>`,
    foot: `${c ? btn("删除", "customer-del", { cls: "danger", data: { id: c.id } }) : ""}<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn primary" form="f">${esc(t("保存"))}</button>` };
}
ACT["customer-new"] = () => show(() => customerForm());
ACT["customer-edit"] = el => show(() => customerForm(byId("customer", el.dataset.id)));
FORMS.customer = async (d, f) => {
  const old = f.dataset.id ? byId("customer", f.dataset.id) : null;
  if (!old || d.phone) {   // 新建必须填手机号；老客户没填的可以先不填，填了就要合法且不重复
    if (!validPhone(d.phone)) { toast(t("请填手机号（7–15 位数字）：手机号用来区分同名客户")); return; }
    const dup = findByPhone(live("customer"), d.phone, old?.id);
    if (dup) { toast(t("这个手机号已经是客户「{n}」了，不能重复建。", { n: customerLabel(dup) })); return; }
  }
  await save("customer", { ...(old || {}), id: old?.id, name: d.name, phone: d.phone, town: d.town, village: d.village, address: d.address, tier: d.tier, note: d.note }); back(); };
ACT["customer-del"] = el => {
  if (model().sales.some(s => s.customerId === el.dataset.id)) { toast(t("这位客户有销售记录，不能删除（账要留着）")); return; }
  ask(t("确认删除这位客户？"), t("记录会保留在审计日志里。"), async () => { await remove("customer", el.dataset.id); back(); back(); }, "删除");
};

export { renderCustomers, customerPage };
