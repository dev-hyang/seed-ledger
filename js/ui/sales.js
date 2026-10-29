/* ============ 销售页：销售单 · 讨账 · 送货路线 ============
   一张销售单 + 若干笔收款 + 若干笔讨账调整，三种售卖方式共用同一个模型：
     当场结清 = 一笔收款等于应收；付定金 = 收款少于应收；纯赊账 = 没有收款。
   价格：「单价」是记在单据上的取货价；「私下价」是当时可能实际给的价，只有自己看得到，不会打印到客户那份上。 */
import { S, save, remove, live } from "../core/state.js";
import { customerLabel, findByPhone, validPhone } from "../logic/customers.js";
import { esc, today, toast } from "../core/util.js";
import { t, money, qty, unitPrice, pct, dateFmt, locale } from "../core/i18n.js";
import { r2, EPS } from "../logic/ledger.js";
import { profileCustomer, anonymizedSummary } from "../logic/profile.js";
import { askAI, aiAvailable, aiError } from "../core/advice.js";
import { model, byId, brandName, customerName, seasonName, sortBy, yearSelect, ro } from "./common.js";
import { show, back, fld, text, num, date, area, select, seg, formData, badge, empty, btn, kv, ask } from "./kit.js";
import { ACT, FORMS, CHG, INP } from "./actions.js";
import { priceFor, brandOpts, yearNow } from "./stock.js";
import { priceOf, tierOf } from "../logic/pricing.js";
import { renderTrips } from "./routes.js";

const subs = [["list", "销售单"], ["collect", "讨账"], ["trips", "送货路线"]];
const STATUS = { settled: ["已结清", "good"], partial: ["部分已付", "warn"], unpaid: ["未付款 / 赊账", "bad"], void: ["已作废", ""] };
const MODES = [["cash", "当场结清"], ["partial", "付定金 / 部分结款"], ["credit", "全部赊账"]];
const METHODS = [["cash", "现金"], ["wechat", "微信"], ["alipay", "支付宝"], ["bank", "银行转账"], ["other", "其它"]];
const ageDays = d => Math.max(0, Math.round((Date.now() - new Date(d + "T00:00:00")) / 864e5));
const brandsOf = s => [...new Set(s.lines.map(l => brandName(l.brandId)))].join("、");
const statusBadge = s => badge(t(STATUS[s.status][0]), STATUS[s.status][1]);

function renderSales(){
  const sub = S.sub.sales || "list";
  const tabs = `<div class="subtabs" role="tablist">${subs.map(([k, l]) => `<button role="tab" aria-selected="${sub === k}" data-act="sales-sub" data-k="${k}">${esc(t(l))}</button>`).join("")}</div>`;
  const body = { list: listView, collect: collectView, trips: renderTrips }[sub]();
  return `<div class="page-head"><h1>${esc(t("销售"))}</h1><div class="head-tools">${sub === "list" ? yearSelect(yearNow()) : ""}${ro() ? "" : btn("📷 扫描 / 导入", "scan-open")}${ro() ? "" : btn("＋ 记一笔销售", "sale-new", { cls: "primary" })}</div></div>${tabs}${body}`;
}
ACT["sales-sub"] = el => { S.sub.sales = el.dataset.k; };

/* ---------- 销售单列表 ---------- */
function saleRow(s){
  return `<li><button class="row" data-act="sale-view" data-id="${s.id}"><span class="row-main"><b>${esc(customerName(s.customerId))}</b><small>${esc(dateFmt(s.date))} · ${esc(brandsOf(s))} · ${esc(qty(s.qty))}</small></span>
    <span class="row-side"><b>${esc(money(s.net))}</b>${s.balance > EPS && s.status !== "void" ? `<small class="neg">${esc(t("欠"))} ${esc(money(s.balance))}</small>` : ""}${statusBadge(s)}</span></button></li>`;
}
function listView(){
  const y = yearNow(), st = S.filters.saleStatus || "", q = (S.filters.saleQ || "").trim();
  let rows = sortBy(model().sales.filter(s => s.year === y), s => s.date + s.id, -1);
  if (st === "owing") rows = rows.filter(s => s.balance > EPS && s.status !== "void");
  if (st === "settled") rows = rows.filter(s => s.status === "settled");
  if (q) rows = rows.filter(s => (customerName(s.customerId) + brandsOf(s) + (s.no || "")).toLowerCase().includes(q.toLowerCase()));
  const chips = [["", "全部"], ["owing", "有欠款"], ["settled", "已结清"]].map(([k, l]) => `<button class="chip" aria-pressed="${st === k}" data-act="sale-filter" data-k="${k}">${esc(t(l))}</button>`).join("");
  const live_ = rows.filter(s => s.status !== "void"), sum = r2(live_.reduce((a, s) => a + s.net, 0)), owe = r2(live_.reduce((a, s) => a + Math.max(s.balance, 0), 0));
  return `<div class="filters"><input type="search" data-input="saleQ" value="${esc(q)}" placeholder="${esc(t("搜客户、品种、单号"))}" aria-label="${esc(t("搜索"))}">${chips}</div>
    <div class="kpis">${kv("销售额", money(sum))}${kv("未收", money(owe), owe > EPS ? "neg" : "")}${kv("单数", String(live_.length))}</div>
    ${rows.length ? `<ul class="list">${rows.map(saleRow).join("")}</ul>` : empty("这一年还没有销售单。", ro() ? "" : btn("＋ 记一笔销售", "sale-new", { cls: "primary" }))}`;
}
ACT["sale-filter"] = el => { S.filters.saleStatus = el.dataset.k; };
INP.saleQ = el => { S.filters.saleQ = el.value; };

/* ---------- 讨账：所有没收齐的单，按客户归拢，欠得多的在前 ---------- */
function collectView(){
  const m = model(), owing = m.sales.filter(s => s.status !== "void" && s.balance > EPS);
  if (!owing.length) return empty("没有欠款，账都收齐了。");
  const by = new Map(); for (const s of owing) { if (!by.has(s.customerId)) by.set(s.customerId, []); by.get(s.customerId).push(s); }
  const groups = sortBy([...by].map(([id, list]) => ({ id, list: sortBy(list, s => s.date), total: r2(list.reduce((a, s) => a + s.balance, 0)) })), g => g.total, -1);
  const total = r2(groups.reduce((a, g) => a + g.total, 0)), late = owing.filter(s => ageDays(s.date) > 180).length;
  return `<div class="kpis">${kv("欠款合计", money(total), "neg")}${kv("欠款客户", String(groups.length))}${kv("超过半年未结", String(late), late ? "neg" : "")}</div>
    ${groups.map(g => `<div class="card"><div class="card-head"><button class="link" data-act="customer-view" data-id="${g.id}"><b>${esc(customerName(g.id))}</b></button><b class="neg">${esc(money(g.total))}</b></div><ul class="list tight">${g.list.map(s => `<li><button class="row" data-act="sale-view" data-id="${s.id}"><span class="row-main"><b>${esc(brandsOf(s))}</b><small>${esc(dateFmt(s.date))} · ${esc(t("{n} 天", { n: ageDays(s.date) }))}${s.lines.some(l => l.hint) ? " · 🔒" : ""}</small></span><span class="row-side"><b class="neg">${esc(money(s.balance))}</b>${ageDays(s.date) > 180 ? badge(t("逾期"), "bad") : ""}</span></button></li>`).join("")}</ul></div>`).join("")}`;
}

/* ---------- 新建 / 修改销售单 ---------- */
function lineRow(l = {}){
  const opts = brandOpts();
  return `<div class="sline" data-line><div class="sline-top">${select("brandId", opts, l.brandId, { change: "sale-brand", blank: t("选品种") })}<button type="button" class="x sm" data-act="sale-line-del" aria-label="${esc(t("删除这一行"))}">×</button></div>
    <div class="grid3">${fld("数量（斤）", num("qty", l.qty, { min: 0 }))}${fld("单价（¥/斤）", num("price", l.price, { min: 0 }))}${fld("私下价 🔒", num("hint", l.hint, { min: 0, ph: t("可不填") }))}</div>
    <small class="stk"></small><small class="lamt"></small></div>`;
}
function saleForm(s){
  const d = s?.date || today(), cust = sortBy(Object.values(Object.fromEntries([...S.data.customer].filter(([, c]) => !c._del))), c => c.name).map(c => [c.id, customerLabel(c, { mask: S.settings.maskPhone })]);
  const edit = !!s, firstLines = s?.lines?.length ? s.lines : [{}];
  const tier = tierOf(s?.tier ?? byId("customer", s?.customerId)?.tier);
  return { title: t(edit ? "修改销售单" : "记一笔销售"),
    body: `<form id="f" data-form="sale" data-id="${s?.id || ""}" data-input-form="sale" data-tier="${tier}">
      ${fld("客户", select("customerId", cust, s?.customerId, { blank: t("— 选客户，或在下面新建 —"), change: "sale-customer" }))}
      <details class="newcust" ${cust.length ? "" : "open"}><summary>${esc(t("＋ 新客户"))}</summary>
        <div class="grid2">${fld("姓名", text("newName"))}${fld("手机号（必填）", text("newPhone", "", { type: "tel", mode: "tel" }))}${fld("镇", text("newTown"))}${fld("村", text("newVillage"))}</div></details>
      ${fld("日期", date("date", d))}
      ${fld("价格档", seg("tier", [["retail", t("零售价")], ["wholesale", t("批发价")]], tier))}
      ${edit ? "" : fld("售卖方式", seg("mode", MODES.map(([k, l]) => [k, t(l)]), s?.mode || "cash"))}
      <div class="lines">${firstLines.map(lineRow).join("")}</div>
      <button type="button" class="btn sm" data-act="sale-line-add">${esc(t("＋ 再加一个品种"))}</button>
      <div class="total-bar"><span>${esc(t("货款合计"))}</span><b data-total>${esc(money(0))}</b></div>
      <fieldset class="box"><legend>${esc(t("取货 / 送货"))}</legend>
        ${seg("dtype", [["pickup", t("客户上门取货")], ["deliver", t("我送货")]], s?.delivery?.type || "pickup")}
        <div class="grid2 dcost">${fld("人工（¥）", num("labor", s?.delivery?.labor, { min: 0 }))}${fld("车费（¥）", num("vehicle", s?.delivery?.vehicle, { min: 0 }))}</div>
        <small>${esc(t("送货成本会计入这张单的成本。同一趟送多家，可在「送货路线」里合并，成本自动按数量分摊。"))}</small></fieldset>
      ${edit ? "" : `<fieldset class="box pay"><legend>${esc(t("本次收款"))}</legend>
        <div class="grid2">${fld("收款金额（¥）", num("payAmount", "", { min: 0 }))}${fld("方式", select("method", METHODS.map(([k, l]) => [k, t(l)]), "cash", { blank: false }))}</div></fieldset>`}
      ${fld("备注", area("note", s?.note))}</form>`,
    foot: `<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn primary" form="f">${esc(t("保存"))}</button>` };
}
ACT["sale-new"] = () => show(() => saleForm());
ACT["sale-edit"] = el => show(() => saleForm(model().saleM.get(el.dataset.id)));
ACT["sale-line-add"] = el => { const box = el.closest("form").querySelector(".lines"); box.insertAdjacentHTML("beforeend", lineRow()); };
ACT["sale-line-del"] = el => { const box = el.closest(".lines"); if (box.children.length > 1) { const f = el.closest("form"); el.closest(".sline").remove(); saleTotals(f); } };
CHG["sale-brand"] = (el, f) => {
  const line = el.closest(".sline"), b = byId("brand", el.value); if (!b) return;
  const price = line.querySelector("[name=price]"), yr = +(f.elements.date.value || today()).slice(0, 4);
  if (!price.value) price.value = priceOf(priceFor(b.id, yr), f.elements.tier.value) || "";
  saleTotals(f);
};
const readLines = f => [...f.querySelectorAll("[data-line]")].map(el => ({ brandId: el.querySelector("[name=brandId]").value, qty: +el.querySelector("[name=qty]").value || 0, price: +el.querySelector("[name=price]").value || 0, hint: el.querySelector("[name=hint]").value === "" ? undefined : +el.querySelector("[name=hint]").value })).filter(l => l.brandId && l.qty > 0);
function saleTotals(f){
  const yr = +(f.elements.date.value || today()).slice(0, 4), editing = f.dataset.id;
  let total = 0;
  for (const el of f.querySelectorAll("[data-line]")) {
    const q = +el.querySelector("[name=qty]").value || 0, p = +el.querySelector("[name=price]").value || 0, id = el.querySelector("[name=brandId]").value;
    total += q * p;
    el.querySelector(".lamt").textContent = q && p ? `= ${money(q * p)}` : "";
    const stk = el.querySelector(".stk");
    if (!id) { stk.textContent = ""; continue; }
    const avail = inventoryOf(id, yr) + (editing ? editQty(editing, id) : 0), over = avail - q < -EPS;   // 修改旧单时，这张单原来占的数量要还回去
    stk.textContent = t("库存还剩 {n}", { n: qty(Math.max(avail, 0)) }) + (over ? " · " + t("会卖超！") : "");
    stk.className = "stk" + (over ? " neg" : "");
  }
  f.querySelector("[data-total]").textContent = money(total);
  const pay = f.elements.payAmount, mode = f.elements.mode?.value;
  if (pay) {
    if (mode === "cash" && !pay.dataset.touched) pay.value = total ? r2(total) : "";
    if (mode === "credit") { pay.value = ""; pay.disabled = true; } else pay.disabled = false;
  }
  f.querySelector(".dcost").hidden = f.elements.dtype.value !== "deliver";
  f._total = r2(total);
}
const editQty = (saleId, brandId) => { const s = model().saleM.get(saleId); return s ? s.lines.filter(l => l.brandId === brandId).reduce((a, l) => a + l.qty, 0) : 0; };
const inventoryOf = (brandId, year) => { const m = model(); let p = 0, r = 0, sold = 0; for (const x of m.D.purchase) if (x.brandId === brandId && x.year === year) p += +x.qty; for (const x of m.D.sreturn) if (x.brandId === brandId && x.year === year) r += +x.qty; for (const s of m.sales) if (s.status !== "void" && s.year === year) for (const l of s.lines) if (l.brandId === brandId) sold += l.qty; return p - r - sold; };
/** 换价格档：单价为空，或还等于上一档的标准价（说明没手改过）的行，换成新档的标准价 */
function retier(f){
  const tier = f.elements.tier.value, prev = f.dataset.tier || "retail", yr = +(f.elements.date.value || today()).slice(0, 4);
  f.dataset.tier = tier;
  for (const el of f.querySelectorAll("[data-line]")) {
    const id = el.querySelector("[name=brandId]").value; if (!id) continue;
    const p = priceFor(id, yr), price = el.querySelector("[name=price]");
    if (!price.value || +price.value === priceOf(p, prev)) price.value = priceOf(p, tier) || "";
  }
  saleTotals(f);
}
CHG["sale-customer"] = (el, f) => {
  const c = byId("customer", el.value); if (!c || !c.tier) return;
  const r = [...f.elements.tier].find(x => x.value === tierOf(c.tier)); if (r && !r.checked) { r.checked = true; retier(f); }
};
INP.sale = (el, f) => { if (el.name === "tier") { retier(f); return; } if (el.name === "payAmount") el.dataset.touched = "1"; if (el.name === "mode") delete f.elements.payAmount.dataset.touched; saleTotals(f); };
CHG["sale-date"] = (el, f) => saleTotals(f);
FORMS.sale = async (d, f) => {
  const lines = readLines(f); if (!lines.length) { toast(t("请至少选一个品种并填数量")); return; }
  let customerId = d.customerId;
  if (!customerId) {
    if (!d.newName) { toast(t("请选客户，或填新客户的姓名")); return; }
    if (!validPhone(d.newPhone)) { toast(t("新客户请填手机号（7–15 位数字）：手机号用来区分同名客户")); return; }
    const same = findByPhone(live("customer"), d.newPhone);
    if (same) { customerId = same.id; toast(t("这个手机号已经是客户「{n}」，直接用他。", { n: same.name })); }   // 手机号相同 = 同一位客户
    else customerId = (await save("customer", { name: d.newName, phone: d.newPhone, town: d.newTown, village: d.newVillage })).id;
  }
  const old = f.dataset.id ? model().saleM.get(f.dataset.id) : null, year = +d.date.slice(0, 4);
  const no = old?.no || `${year}-${String(model().sales.filter(s => s.year === year).length + 1).padStart(3, "0")}`;
  const raw = old ? { ...byId("sale", old.id) } : {};
  const delivery = { type: d.dtype, labor: d.dtype === "deliver" ? d.labor || 0 : 0, vehicle: d.dtype === "deliver" ? d.vehicle || 0 : 0, tripId: d.dtype === "deliver" ? old?.delivery?.tripId : undefined };
  const sale = await save("sale", { ...raw, id: old?.id, no, date: d.date, customerId, mode: old?.mode || d.mode, lines, delivery, tier: d.tier, note: d.note, status: old?.status || "active" });
  if (!old && d.payAmount > 0) await save("pay", { saleId: sale.id, date: d.date, amount: d.payAmount, method: d.method });
  back();
  if (!old) show(() => salePage(sale.id), true);
};

/* ---------- 销售单详情 ---------- */
function salePage(id){
  const s = model().saleM.get(id);
  if (!s) return { title: t("销售单"), body: empty("这张单已不存在。") };
  const void_ = s.status === "void", hasHint = s.lines.some(l => l.hint != null);
  const adjLab = { negotiate: "议价", discount: "折上折", writeoff: "核销坏账" };
  const body = `<div class="detail-head"><button class="link" data-act="customer-view" data-id="${s.customerId}"><b>${esc(customerName(s.customerId))}</b></button><span>${statusBadge(s)}</span></div>
    <p class="meta">${esc(s.no || "")} · ${esc(dateFmt(s.date))} · ${esc(t(tierOf(s.tier) === "wholesale" ? "批发价" : "零售价"))}${s.note ? " · " + esc(s.note) : ""}${void_ ? ` · <b class="neg">${esc(t("作废原因："))}${esc(s.voidReason || "")}</b>` : ""}</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t("品种"))}</th><th class="n">${esc(t("数量"))}</th><th class="n">${esc(t("单价"))}</th><th class="n">${esc(t("金额"))}</th></tr></thead><tbody>
      ${s.lines.map(l => `<tr><td><b>${esc(brandName(l.brandId))}</b><small>${esc(seasonName((byId("brand", l.brandId) || {}).seasonId))}</small>${l.hint != null ? `<small class="priv">🔒 ${esc(t("当时可能给了"))} ${esc(unitPrice(l.hint))}（${esc(t("仅自己可见"))}）</small>` : ""}</td><td class="n">${esc(qty(l.qty))}</td><td class="n">${esc(unitPrice(l.price))}</td><td class="n">${esc(money(l.amount))}</td></tr>`).join("")}</tbody></table></div>
    <div class="stmt">${kv("货款", money(s.gross))}
      ${s.adjs.map(a => `<div class="kv adj"><span>${esc(t(adjLab[a.type]))}${a.pct ? ` ${esc(pct(a.pct))}` : ""} · ${esc(dateFmt(a.date))}${a.reason ? `<small>${esc(a.reason)}</small>` : ""}</span><b class="neg">−${esc(money(a.amount))}${ro() || void_ ? "" : `<button class="x sm" data-act="adj-del" data-id="${a.id}" aria-label="${esc(t("撤销这条调整"))}">×</button>`}</b></div>`).join("")}
      <div class="kv total"><span>${esc(t("应收"))}</span><b>${esc(money(s.net))}</b></div>
      ${s.pays.length ? `<h4>${esc(t("收款"))}</h4>${sortBy(s.pays, p => p.date).map(p => `<div class="kv"><span>${esc(dateFmt(p.date))} · ${esc(t((METHODS.find(m => m[0] === p.method) || [0, "其它"])[1]))}${p.note ? `<small>${esc(p.note)}</small>` : ""}</span><b class="pos">+${esc(money(p.amount))}${ro() || void_ ? "" : `<button class="x sm" data-act="pay-del" data-id="${p.id}" aria-label="${esc(t("撤销这笔收款"))}">×</button>`}</b></div>`).join("")}` : ""}
      <div class="kv total"><span>${esc(s.balance < -EPS ? t("多收") : t("欠款"))}</span><b class="${s.balance > EPS ? "neg" : ""}">${esc(money(Math.abs(s.balance)))}</b></div></div>
    ${hasHint && s.balance > EPS && !void_ && hintTotal(s) < s.net - EPS ? `<p class="hint priv">🔒 ${esc(t("按私下价结算的话，应收约 {a}（比现在少 {b}）。", { a: money(hintTotal(s)), b: money(Math.max(s.net - hintTotal(s), 0)) }))}</p>` : ""}
    <div class="stmt"><h4>${esc(t("这张单的成本与利润（应收口径）"))}</h4>${kv("进货成本", money(s.cogs))}${kv(s.delivery?.type === "deliver" ? "送货成本" : "取货方式", s.delivery?.type === "deliver" ? money(s.deliveryCost) : t("客户上门取货"))}
      <div class="kv total"><span>${esc(t("利润"))}</span><b class="${s.profit < 0 ? "neg" : "pos"}">${esc(money(s.profit, { sign: true }))}</b></div></div>`;
  const foot = ro() || void_ ? btn("打印单据", "print-sale", { data: { id } }) : `${btn("＋ 收款", "pay-new", { cls: "primary", data: { id } })}${btn("讨账 / 议价", "collect-new", { data: { id } })}${btn("打印单据", "print-sale", { data: { id } })}${btn("修改", "sale-edit", { data: { id } })}${btn("作废", "sale-void", { cls: "ghost-danger", data: { id } })}`;
  return { title: t("销售单"), body, foot };
}
const hintTotal = s => r2(s.lines.reduce((a, l) => a + l.qty * (l.hint ?? l.price), 0));
ACT["sale-view"] = el => show(() => salePage(el.dataset.id), true);
ACT["pay-del"] = el => ask(t("撤销这笔收款？"), t("记录会保留在审计日志里。"), () => remove("pay", el.dataset.id), "撤销");
ACT["adj-del"] = el => ask(t("撤销这条调整？"), t("应收会恢复。记录会保留在审计日志里。"), () => remove("adj", el.dataset.id), "撤销");
ACT["sale-void"] = el => show(() => ({ title: t("作废销售单"), body: `<p class="lead">${esc(t("作废的单不计入销售、库存和利润，但记录和原因永久保留，可供查账。"))}</p><form id="f" data-form="void" data-id="${el.dataset.id}">${fld("作废原因", text("reason", "", { req: true, max: 120 }))}</form>`,
  foot: `<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn danger" form="f">${esc(t("作废"))}</button>` }));
FORMS.void = async (d, f) => { const s = byId("sale", f.dataset.id); await save("sale", { ...s, status: "void", voidReason: d.reason, voidAt: today() }); back(); };

/* ---------- 收款 ---------- */
ACT["pay-new"] = el => show(() => { const s = model().saleM.get(el.dataset.id);
  return { title: t("收款"), body: `<form id="f" data-form="pay" data-sale="${s.id}"><p class="lead">${esc(customerName(s.customerId))} · ${esc(t("欠款"))} <b class="neg">${esc(money(Math.max(s.balance, 0)))}</b></p>
    ${fld("日期", date("date", today()))}${fld("金额（¥）", num("amount", s.balance > EPS ? r2(s.balance) : "", { req: true, min: 0 }))}${fld("方式", select("method", METHODS.map(([k, l]) => [k, t(l)]), "cash", { blank: false }))}${fld("备注", area("note"))}</form>`,
    foot: `<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn primary" form="f">${esc(t("保存"))}</button>` }; });
FORMS.pay = async (d, f) => { await save("pay", { saleId: f.dataset.sale, date: d.date, amount: d.amount, method: d.method, note: d.note }); back(); };

/* ---------- 讨账：议价 / 折上折 / 核销 ----------
   议价：填议价后的应收总额，差额记为一笔「议价」调整。
   折上折：在议价之后还没收的欠款上再打折，按当时的欠款 × 百分比算出金额并记下（之后欠款变了也不会跟着变，账可复查）。
   核销：这笔收不回来了，记为坏账（客户画像会用到）。 */
ACT["collect-new"] = el => show(() => collectForm(el.dataset.id));
function collectForm(id){
  const s = model().saleM.get(id), hint = s.lines.some(l => l.hint != null) && hintTotal(s) < s.net - EPS;
  return { title: t("讨账 / 议价"),
    body: `<form id="f" data-form="collect" data-sale="${id}" data-input-form="collect">
      <div class="stmt">${kv("当前应收", money(s.net))}${kv("已收", money(s.paid))}${kv("欠款", money(s.balance), "neg")}${kv("成本（含送货）", money(s.cogs + s.deliveryCost))}</div>
      ${hint ? `<p class="hint priv">🔒 ${esc(t("私下价合计 {a}，对应欠款 {b}", { a: money(hintTotal(s)), b: money(Math.max(hintTotal(s) - s.paid, 0)) }))} <button type="button" class="link" data-act="collect-hint">${esc(t("按私下价议价"))}</button></p>` : ""}
      ${fld("类型", seg("type", [["negotiate", t("议价")], ["discount", t("折上折")], ["writeoff", t("核销坏账")]], "negotiate"))}
      <div data-show="negotiate">${fld("议价后的应收总额（¥）", num("target", r2(s.net), { min: 0 }), t("客户讲价后，双方认可的总金额"))}</div>
      <div data-show="discount" hidden>${fld("再折（%）", num("pct", "", { min: 0 }), t("在当前欠款上再打折"))}</div>
      <div data-show="writeoff" hidden>${fld("核销金额（¥）", num("wo", r2(Math.max(s.balance, 0)), { min: 0 }))}</div>
      ${fld("原因 / 备注", area("reason", "", { ph: "例如 客户反映发芽率一般，同意让利" }))}
      <div class="preview" data-preview></div>
      <div class="ai-box"><button type="button" class="btn sm" data-act="ai-negotiate" data-id="${id}">✨ ${esc(t("AI 议价建议"))}</button><div data-ai class="ai-out"></div><small>${esc(t("AI 只看金额和客户等级（不含姓名电话），用你自己的 key；不可用也不影响记账，利润已按成本和送货算好。"))}</small></div></form>`,
    foot: `<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn primary" form="f">${esc(t("记录"))}</button>` };
}
ACT["collect-hint"] = el => { const f = el.closest("form"), s = model().saleM.get(f.dataset.sale); f.elements.type.value = "negotiate"; [...f.elements.type].forEach(r => { r.checked = r.value === "negotiate"; }); f.elements.target.value = hintTotal(s); collectPreview(f); };
function collectAmount(f){
  const s = model().saleM.get(f.dataset.sale), type = f.elements.type.value || "negotiate";
  const raw = type === "negotiate" ? s.net - (+f.elements.target.value || 0) : type === "discount" ? Math.max(s.balance, 0) * (+f.elements.pct.value || 0) / 100 : +f.elements.wo.value || 0;
  return { s, type, amount: r2(Math.max(raw, 0)) };
}
function collectPreview(f){
  const { s, type, amount } = collectAmount(f);
  for (const box of f.querySelectorAll("[data-show]")) box.hidden = box.dataset.show !== type;
  const net = r2(s.net - amount), bal = r2(net - s.paid), profit = r2(net - s.cogs - s.deliveryCost);
  f.querySelector("[data-preview]").innerHTML = `<div class="stmt">${kv("本次让利", "−" + money(amount), amount ? "neg" : "")}${kv("调整后应收", money(net))}${kv("调整后欠款", money(Math.max(bal, 0)))}<div class="kv total"><span>${esc(t("调整后利润"))}</span><b class="${profit < 0 ? "neg" : "pos"}">${esc(money(profit, { sign: true }))}</b></div></div>${profit < 0 ? `<p class="hint neg">${esc(t("按这个价格这张单会亏本。"))}</p>` : ""}`;
}
INP.collect = (el, f) => collectPreview(f);
FORMS.collect = async (d, f) => {
  const { s, type, amount } = collectAmount(f); if (amount <= 0) { toast(t("让利金额要大于 0")); return; }
  await save("adj", { saleId: s.id, date: today(), type, amount, pct: type === "discount" ? d.pct : undefined, target: type === "negotiate" ? d.target : undefined, reason: d.reason });
  back();
};
ACT["ai-negotiate"] = async el => {
  const f = el.closest("form"), out = f.querySelector("[data-ai]"), s = model().saleM.get(el.dataset.id);
  if (!aiAvailable()) { out.textContent = aiError() + " " + t("不影响记账，上面的利润预览已按成本算好。"); return; }
  out.textContent = t("思考中…");
  const prof = anonymizedSummary(profileCustomer(model(), s.customerId));
  const txt = await askAI("negotiate", { grossAmount: s.gross, currentReceivable: s.net, paid: s.paid, outstanding: s.balance, costInclDelivery: r2(s.cogs + s.deliveryCost), promisedTotal: s.lines.some(l => l.hint != null) ? hintTotal(s) : null, ageDays: ageDays(s.date), customer: prof }, locale());
  out.textContent = txt || aiError() + " " + t("不影响记账，上面的利润预览已按成本算好。");
};

export { renderSales, salePage, saleRow, statusBadge, brandsOf };
