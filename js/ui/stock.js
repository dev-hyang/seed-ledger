/* ============ 库存页：库存 · 进货 / 退货 · 品种与价格 · 供应商钱池 ============ */
import { S, save, remove, live, canWrite } from "../core/state.js";
import { esc, today } from "../core/util.js";
import { t, money, qty, unitLabel, pct, dateFmt } from "../core/i18n.js";
import { inventory, supplierStatement, suggestReturnFee, r2 } from "../logic/ledger.js";
import { model, byId, brandName, supplierName, seasonName, seasonOpts, sortBy, yearSelect, ro } from "./common.js";
import { show, back, fld, text, num, date, area, select, formData, badge, empty, btn, kv, ask } from "./kit.js";
import { ACT, FORMS, CHG } from "./actions.js";

const subs = [["inv", "库存"], ["flow", "进货 / 退货"], ["brand", "品种与价格"], ["pool", "种子公司账"]];
const yearNow = () => +S.filters.year || new Date().getFullYear();

/** 某品种某年的价格；该年没填就沿用最近一年的 */
function priceFor(brandId, year){
  const rows = sortBy(live("price").filter(p => p.brandId === brandId && +p.year <= year), p => +p.year, -1);
  return rows[0] || { buy: 0, presale: 0 };
}

function renderStock(){
  const sub = S.sub.stock || "inv";
  const tabs = `<div class="subtabs" role="tablist">${subs.map(([k, l]) => `<button role="tab" aria-selected="${sub === k}" data-act="stock-sub" data-k="${k}">${esc(t(l))}</button>`).join("")}</div>`;
  const body = { inv: invView, flow: flowView, brand: brandView, pool: poolView }[sub]();
  return `<div class="page-head"><h1>${esc(t("库存"))}</h1><div class="head-tools">${yearSelect(yearNow())}</div></div>${tabs}${body}`;
}

/* ---------- 库存 ---------- */
function invView(){
  const m = model(), y = yearNow(), rows = inventory(m, y).filter(r => r.purchased || r.returned || r.sold || byId("brand", r.brandId));
  if (!rows.length) return empty("还没有品种。先到「品种与价格」添加，再记进货。", ro() ? "" : btn("＋ 添加品种", "brand-new", { cls: "primary" }));
  const total = r2(rows.reduce((a, r) => a + r.value, 0));
  const bySeason = S.settings.seasons.map(s => ({ s, rows: rows.filter(r => r.seasonId === s.id) })).filter(g => g.rows.length);
  const other = rows.filter(r => !S.settings.seasons.some(s => s.id === r.seasonId));
  if (other.length) bySeason.push({ s: { id: "", name: "其它" }, rows: other });
  const left = rows.filter(r => r.onHand > 0.5);
  return `<div class="kpis">${kv("库存价值", money(total))}${kv("未售完的品种", String(left.length))}</div>
    ${left.length ? `<p class="hint">${esc(t("没卖完的货可以退回种子公司；注意退货比例高时可能被收手续费，在「种子公司账」里看。"))}</p>` : ""}
    ${bySeason.map(g => `<h3 class="grp">${esc(t(g.s.name))}</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t("品种"))}</th><th class="n">${esc(t("进货"))}</th><th class="n">${esc(t("退货"))}</th><th class="n">${esc(t("已售"))}</th><th class="n">${esc(t("库存"))}</th><th class="n">${esc(t("库存价值"))}</th></tr></thead><tbody>
      ${g.rows.map(r => `<tr><td><b>${esc(brandName(r.brandId))}</b><small>${esc(supplierName(r.supplierId))}</small></td><td class="n">${esc(qty(r.purchased))}</td><td class="n">${esc(qty(r.returned))}</td><td class="n">${esc(qty(r.sold))}</td>
      <td class="n ${r.oversold ? "neg" : ""}"><b>${esc(qty(r.onHand))}</b>${r.oversold ? `<small class="neg">${esc(t("卖超了，检查进货记录"))}</small>` : ""}</td><td class="n">${esc(money(r.value))}</td></tr>`).join("")}</tbody></table></div>`).join("")}`;
}

/* ---------- 进货 / 退货 ---------- */
function flowView(){
  const y = yearNow(), m = model();
  const rows = sortBy([...m.D.purchase.filter(p => p.year === y).map(p => ({ ...p, type: "purchase" })), ...m.D.sreturn.filter(p => p.year === y).map(p => ({ ...p, type: "return" }))], r => r.date, -1);
  const head = ro() ? "" : `<div class="actions">${btn("＋ 进货", "purchase-new", { cls: "primary" })}${btn("＋ 退货给种子公司", "return-new")}</div>`;
  if (!rows.length) return head + empty("这一年还没有进货记录。");
  return head + `<ul class="list">${rows.map(r => `<li><button class="row" data-act="${r.type}-edit" data-id="${r.id}"><span class="row-main"><b>${esc(brandName(r.brandId))}</b><small>${esc(supplierName(r.supplierId))} · ${esc(dateFmt(r.date))}</small></span>
    <span class="row-side"><b>${esc(qty(r.qty))}</b><small>${esc(money(r.qty * r.unitCost))}</small>${badge(t(r.type === "purchase" ? "进货" : "退货"), r.type === "purchase" ? "" : "warn")}</span></button></li>`).join("")}</ul>`;
}
const brandOpts = () => {
  const groups = S.settings.seasons.map(s => ({ group: t(s.name), items: sortBy(live("brand").filter(b => b.seasonId === s.id && b.active !== false), b => b.name).map(b => [b.id, `${b.name} · ${supplierName(b.supplierId)}`]) })).filter(g => g.items.length);
  return groups;
};
function flowForm(type, rec){
  const isP = type === "purchase", d = rec?.date || today();
  return { title: t(rec ? (isP ? "修改进货" : "修改退货") : (isP ? "进货" : "退货给种子公司")),
    body: `<form id="f" data-form="${type}" data-id="${rec?.id || ""}">
      ${fld("日期", date("date", d))}
      ${fld("品种", select("brandId", brandOpts(), rec?.brandId, { req: true, change: "flow-brand" }), t("按品种归到种子公司，不用另选公司"))}
      ${fld("数量（斤）", num("qty", rec?.qty, { req: true, min: 0 }))}
      ${fld(isP ? "进货价（¥/斤）" : "退货折价（¥/斤）", num("unitCost", rec?.unitCost, { req: true, min: 0 }), t(isP ? "种子公司给的价格" : "退回时种子公司按多少钱抵扣，通常和进货价一样"))}
      ${fld("记入哪一年", num("year", rec?.year ?? new Date(d).getFullYear(), { req: true, step: 1 }), t("跨年卖的货，按这一季归到哪一年"))}
      ${fld("备注", area("note", rec?.note))}</form>`,
    foot: `${rec ? btn("删除", "del", { cls: "danger", data: { kind: isP ? "purchase" : "sreturn", id: rec.id } }) : ""}<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn primary" form="f">${esc(t("保存"))}</button>` };
}
ACT["purchase-new"] = () => show(() => flowForm("purchase"));
ACT["return-new"] = () => show(() => flowForm("return"));
ACT["purchase-edit"] = el => show(() => flowForm("purchase", byId("purchase", el.dataset.id)));
ACT["return-edit"] = el => show(() => flowForm("return", byId("sreturn", el.dataset.id)));
CHG["flow-brand"] = (el, f) => {   // 选了品种，带出价格
  const b = byId("brand", el.value), box = f.elements.unitCost;
  if (!b || box.value) return;
  const isReturn = f.dataset.form === "return", p = priceFor(b.id, +f.elements.year.value || yearNow());
  box.value = isReturn ? (model().avgCost(b.id, +f.elements.year.value) || p.buy || "") : (p.buy || "");
};
const saveFlow = (kind, form, d) => async () => {
  const b = byId("brand", d.brandId); if (!b) return;
  const rec = await save(kind, { ...(form.dataset.id ? byId(kind, form.dataset.id) : {}), id: form.dataset.id || undefined, date: d.date, year: Math.round(d.year), supplierId: b.supplierId, brandId: b.id, qty: d.qty, unitCost: d.unitCost, note: d.note });
  back();
  if (kind === "sreturn" && !form.dataset.id) {   // 退货后：按这家公司的规则提示可能的手续费
    const s = suggestReturnFee(model(), b.supplierId, rec.year);
    if (s > 0) show(() => feeForm(b.supplierId, { year: rec.year, amount: s, reason: "return" }, true));
  }
};
FORMS.purchase = (d, f) => saveFlow("purchase", f, d)();
FORMS.return = (d, f) => saveFlow("sreturn", f, d)();

/* ---------- 品种与价格 ---------- */
function brandView(){
  const y = yearNow(), brands = live("brand");
  const head = ro() ? "" : `<div class="actions">${btn("＋ 添加品种", "brand-new", { cls: "primary" })}</div>`;
  if (!brands.length) return head + empty("按季节添加稻种品种，例如早稻：富香 977；一晚：美华 303。");
  const groups = S.settings.seasons.map(s => ({ s, rows: sortBy(brands.filter(b => b.seasonId === s.id), b => b.name) })).filter(g => g.rows.length);
  return head + `<p class="hint">${esc(t("价格是 {y} 年的；没单独设置的年份沿用上一年。", { y }))}</p>` + groups.map(g => `<h3 class="grp">${esc(t(g.s.name))}</h3><ul class="list">${g.rows.map(b => { const p = priceFor(b.id, y);
    return `<li><button class="row" data-act="brand-edit" data-id="${b.id}"><span class="row-main"><b>${esc(b.name)}</b><small>${esc(supplierName(b.supplierId))}${b.active === false ? " · " + esc(t("停用")) : ""}</small></span>
    <span class="row-side"><small>${esc(t("进货"))} ${esc(money(p.buy))}</small><small>${esc(t("预售"))} ${esc(money(p.presale))}</small></span></button></li>`; }).join("")}</ul>`).join("");
}
function brandForm(b){
  const y = yearNow(), p = b ? priceFor(b.id, y) : {};
  if (!live("supplier").length) return { title: t("添加品种"), body: `<p class="lead">${esc(t("先添加种子公司，品种要归到某家公司。"))}</p>`, foot: btn("＋ 添加种子公司", "supplier-new", { cls: "primary" }) };
  return { title: t(b ? "修改品种" : "添加品种"),
    body: `<form id="f" data-form="brand" data-id="${b?.id || ""}">
      ${fld("品种名称", text("name", b?.name, { req: true, ph: "例如 富香977" }))}
      ${fld("季节", select("seasonId", seasonOpts(), b?.seasonId || S.settings.seasons[0].id, { req: true, blank: false }))}
      ${fld("种子公司", select("supplierId", live("supplier").map(s => [s.id, s.name]), b?.supplierId, { req: true }))}
      <div class="grid2">${fld(t("{y} 年进货价（¥/斤）", { y }), num("buy", p.buy, { min: 0 }))}${fld(t("{y} 年预售价（¥/斤）", { y }), num("presale", p.presale, { min: 0 }))}</div>
      ${b ? `<label class="chk"><input type="checkbox" name="inactive" ${b.active === false ? "checked" : ""}> ${esc(t("停用（不再出现在进货、销售的选择里）"))}</label>` : ""}
      ${fld("备注", area("note", b?.note))}</form>`,
    foot: `${b ? btn("删除", "del", { cls: "danger", data: { kind: "brand", id: b.id } }) : ""}<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn primary" form="f">${esc(t("保存"))}</button>` };
}
ACT["brand-new"] = () => show(() => brandForm());
ACT["brand-edit"] = el => show(() => brandForm(byId("brand", el.dataset.id)));
FORMS.brand = async (d, f) => {
  const y = yearNow(), old = f.dataset.id ? byId("brand", f.dataset.id) : null;
  const b = await save("brand", { ...(old || {}), id: old?.id, name: d.name, seasonId: d.seasonId, supplierId: d.supplierId, note: d.note, active: !d.inactive });
  if (d.buy != null || d.presale != null) await save("price", { id: `${b.id}:${y}`, brandId: b.id, year: y, buy: d.buy || 0, presale: d.presale || 0 });
  back();
};

/* ---------- 种子公司账（钱池） ---------- */
function poolView(){
  const y = yearNow(), m = model(), sup = sortBy(live("supplier"), s => s.name);
  const head = ro() ? "" : `<div class="actions">${btn("＋ 添加种子公司", "supplier-new", { cls: "primary" })}</div>`;
  if (!sup.length) return head + empty("添加种子公司后，这里按年对账：打款进「钱池」，进货和手续费从池里扣，余额结转明年。");
  return head + `<p class="hint">${esc(t("种子公司不退现金：打的款放在「钱池」里，用于进货；退货和余款都留在池里，结转到明年。拖欠了则要补款。"))}</p><ul class="list">${sup.map(s => {
    const st = supplierStatement(m, s.id, y);
    const tag = st.state === "carry" ? badge(t("余额结转明年"), "good") : st.state === "owe" ? badge(t("需补款"), "bad") : badge(t("已平"));
    return `<li><button class="row" data-act="supplier-view" data-id="${s.id}"><span class="row-main"><b>${esc(s.name)}</b><small>${esc(t("进货"))} ${esc(qty(st.purchasedQty))} · ${esc(t("退货"))} ${esc(qty(st.returnedQty))} (${esc(pct(st.returnRatio))})</small></span>
      <span class="row-side"><b class="${st.closing < 0 ? "neg" : ""}">${esc(money(st.closing))}</b>${tag}</span></button></li>`; }).join("")}</ul>`;
}
function statementPage(id){
  const s = byId("supplier", id), y = yearNow(), m = model();
  if (!s) return { title: "", body: "" };
  const st = supplierStatement(m, id, y), fee = suggestReturnFee(m, id, y);
  const line = (k, v, cls) => kv(k, esc(money(v, { sign: cls === "sign" })), cls === "sign" ? "" : cls);
  const typeLab = { pay: "打款入池", purchase: "进货", return: "退货抵扣", fee: "手续费" };
  return { title: s.name,
    body: `<div class="stmt"><div class="stmt-year">${yearSelect(y)}</div>
      ${line("期初（上年结转）", st.opening)}${line("＋ 本年打款入池", st.paid)}${line("－ 本年进货", st.purchases)}${line("＋ 本年退货抵扣", st.returns)}${line("－ 手续费（拆包 / 退货）", st.fees)}
      <div class="kv total"><span>${esc(t("期末余额"))}</span><b class="${st.closing < 0 ? "neg" : ""}">${esc(money(st.closing))}</b></div>
      <p class="hint">${esc(st.state === "carry" ? t("余额作为明年的进货款，自动结转。") : st.state === "owe" ? t("拖欠种子公司，需要补款：{a}", { a: money(-st.closing) }) : t("账已平。"))}</p>
      ${s.rule ? `<p class="hint">${esc(t("手续费规则：退货比例 ≥ {r}% 时，按退货金额的 {f}% 估算。", { r: s.rule.minRatioPct || 0, f: s.rule.feePct || 0 }))}${fee > 0 ? " " + esc(t("当前建议：{a}", { a: money(fee) })) : ""}</p>` : ""}</div>
      <h3 class="grp">${esc(t("明细"))}</h3>${st.entries.length ? `<ul class="list">${st.entries.map(e => `<li><div class="row static"><span class="row-main"><b>${esc(t(typeLab[e.type]))}${e.ref.brandId ? " · " + esc(brandName(e.ref.brandId)) : ""}</b><small>${esc(dateFmt(e.date))}${e.ref.note ? " · " + esc(e.ref.note) : ""}</small></span><span class="row-side"><b class="${e.amount < 0 ? "neg" : "pos"}">${esc(money(e.amount, { sign: true }))}</b><small>${esc(t("池内"))} ${esc(money(e.balance))}</small></span></div></li>`).join("")}</ul>` : empty("这一年没有往来。")}`,
    foot: ro() ? btn("打印对账单", "print-supplier", { data: { id } }) : `${btn("＋ 打款入池", "pool-pay", { cls: "primary", data: { id } })}${btn("＋ 手续费", "fee-new", { data: { id } })}${btn("打印对账单", "print-supplier", { data: { id } })}${btn("编辑", "supplier-edit", { data: { id } })}` };
}
ACT["supplier-view"] = el => show(() => statementPage(el.dataset.id), true);
function supplierForm(s){
  return { title: t(s ? "修改种子公司" : "添加种子公司"),
    body: `<form id="f" data-form="supplier" data-id="${s?.id || ""}">
      ${fld("公司名称", text("name", s?.name, { req: true }))}${fld("联系人 / 电话", text("contact", s?.contact))}
      <fieldset class="box"><legend>${esc(t("退货手续费规则（可选）"))}</legend>
        <div class="grid2">${fld("退货比例达到（%）", num("minRatioPct", s?.rule?.minRatioPct, { min: 0 }))}${fld("按退货金额收（%）", num("feePct", s?.rule?.feePct, { min: 0 }))}</div>
        <small>${esc(t("例如：拿 5000 斤退 4000 斤（80%），公司可能收一笔手续费。设了规则，退货后会给出建议金额；不设也行，手续费手动填。"))}</small></fieldset>
      ${fld("备注", area("note", s?.note))}</form>`,
    foot: `${s ? btn("删除", "del", { cls: "danger", data: { kind: "supplier", id: s.id } }) : ""}<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn primary" form="f">${esc(t("保存"))}</button>` };
}
ACT["supplier-new"] = () => show(() => supplierForm());
ACT["supplier-edit"] = el => show(() => supplierForm(byId("supplier", el.dataset.id)));
FORMS.supplier = async (d, f) => {
  const old = f.dataset.id ? byId("supplier", f.dataset.id) : null;
  await save("supplier", { ...(old || {}), id: old?.id, name: d.name, contact: d.contact, note: d.note, rule: d.feePct > 0 ? { minRatioPct: d.minRatioPct || 0, feePct: d.feePct } : null });
  back();
};
ACT["pool-pay"] = el => show(() => ({ title: t("打款入池"), body: `<form id="f" data-form="spay" data-supplier="${el.dataset.id}">${fld("日期", date("date", today()))}${fld("金额（¥）", num("amount", "", { req: true, min: 0 }))}${fld("备注", area("note", "", { ph: "例如 预付 2027 年进货款" }))}</form>`,
  foot: `<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn primary" form="f">${esc(t("保存"))}</button>` }));
FORMS.spay = async (d, f) => { await save("spay", { date: d.date, supplierId: f.dataset.supplier, amount: d.amount, note: d.note }); back(); };
function feeForm(supplierId, v = {}, fromReturn = false){
  return { title: t("手续费"),
    body: `<form id="f" data-form="sfee" data-supplier="${supplierId}">${fromReturn ? `<p class="lead">${esc(t("按这家公司的规则，退货比例较高，可能被收手续费。金额可改，不收就取消。"))}</p>` : ""}
      ${fld("日期", date("date", today()))}${fld("记入哪一年", num("year", v.year ?? yearNow(), { req: true, step: 1 }))}
      ${fld("类型", select("reason", [["unpack", t("拆包费")], ["return", t("退货手续费")]], v.reason || "unpack", { blank: false }))}
      ${fld("金额（¥）", num("amount", v.amount, { req: true, min: 0 }))}${fld("备注", area("note"))}</form>`,
    foot: `<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn primary" form="f">${esc(t("保存"))}</button>` };
}
ACT["fee-new"] = el => show(() => feeForm(el.dataset.id, { amount: suggestReturnFee(model(), el.dataset.id, yearNow()) || undefined }));
FORMS.sfee = async (d, f) => { await save("sfee", { date: d.date, year: Math.round(d.year), supplierId: f.dataset.supplier, amount: d.amount, reason: d.reason, note: d.note }); back(); };

/* ---------- 通用删除（软删除，留痕） ---------- */
ACT.del = el => ask(t("确认删除"), t("删除后不会出现在列表里，但「审计日志」仍保留这条记录和删除动作。"), async () => { await remove(el.dataset.kind, el.dataset.id); back(); }, "删除");
ACT["stock-sub"] = el => { S.sub.stock = el.dataset.k; };
CHG.year = el => { S.filters.year = +el.value; };

export { renderStock, priceFor, yearNow, brandOpts };
