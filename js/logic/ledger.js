/* ============ 账务核心（纯函数，不碰界面和存储，方便单独测试） ============
   输入 D = { sale, pay, adj, purchase, sreturn, spay, sfee, brand, supplier, customer, trip, town }，每项是「未删除」记录数组。
   金额一律用人民币、数量一律用斤存储，显示时再换算（core/i18n.js）。

   口径（改这里要同步改 docs/design.md）：
   · 应收 net = 销售单价 × 数量 − 催账调整（议价 / 折上折 / 坏账核销）。收款单独记，余额 = net − 已收。
   · 成本 = 数量 × 该品种当年「进货加权平均价」（只算进货，退货只减库存和对供应商的应付）。
   · 利润（应收口径）= net − 成本 − 送货成本；供应商手续费另算，按当年进货额摊到该公司的品种上。
   · 供应商账是「钱池」：打款进池，进货 / 手续费出池，退货回池；余额为正结转明年，为负要补款。 */

const r2 = n => Math.round((+n || 0) * 100) / 100;
const yearOf = d => +String(d || "").slice(0, 4) || new Date().getFullYear();
const monthOf = d => +String(d || "").slice(5, 7) || 1;
const sum = (arr, f) => r2(arr.reduce((a, x) => a + f(x), 0));
const group = (arr, k) => { const m = new Map(); for (const x of arr) { const a = m.get(x[k]); if (a) a.push(x); else m.set(x[k], [x]); } return m; };
const EPS = 0.005;

function buildModel(D){
  const brandM = new Map(D.brand.map(b => [b.id, b]));
  const supplierM = new Map(D.supplier.map(s => [s.id, s]));
  const customerM = new Map(D.customer.map(c => [c.id, c]));
  const tripM = new Map(D.trip.map(t => [t.id, t]));

  // 进货加权平均价：key = 品种|年
  const acc = new Map(), lastCost = new Map();
  for (const p of [...D.purchase].sort((a, b) => (a.date || "").localeCompare(b.date || ""))) {
    const k = p.brandId + "|" + p.year, a = acc.get(k) || { qty: 0, amt: 0 };
    a.qty += +p.qty; a.amt += p.qty * p.unitCost; acc.set(k, a); lastCost.set(p.brandId, +p.unitCost);
  }
  const avgCost = (brandId, year) => { const a = acc.get(brandId + "|" + year); return a && a.qty > 0 ? a.amt / a.qty : (lastCost.get(brandId) || 0); };

  const paysBy = group(D.pay, "saleId"), adjBy = group(D.adj, "saleId");
  const liveSales = D.sale.filter(s => s.status !== "void");

  const tripQty = new Map();
  for (const s of liveSales) if (s.delivery && s.delivery.tripId) tripQty.set(s.delivery.tripId, (tripQty.get(s.delivery.tripId) || 0) + sum(s.lines, l => +l.qty));
  const tripTotal = t => r2((+t.labor || 0) + (+t.vehicle || 0));
  const deliveryOf = (s, qty) => {
    const d = s.delivery || {};
    if (d.type !== "deliver") return 0;
    if (d.tripId && tripM.has(d.tripId)) { const q = tripQty.get(d.tripId) || 0; return q ? r2(tripTotal(tripM.get(d.tripId)) * qty / q) : 0; }
    return r2((+d.labor || 0) + (+d.vehicle || 0));
  };

  const sales = D.sale.map(s => {
    const year = yearOf(s.date), void_ = s.status === "void";
    const lines = (s.lines || []).map(l => ({ ...l, amount: r2(l.qty * l.price), cost: r2(l.qty * avgCost(l.brandId, year)) }));
    const gross = sum(lines, l => l.amount), qty = sum(lines, l => +l.qty);
    const adjs = adjBy.get(s.id) || [], pays = paysBy.get(s.id) || [];
    const adjTotal = sum(adjs, a => +a.amount), paid = sum(pays, p => +p.amount);
    const net = r2(gross - adjTotal), balance = r2(net - paid);
    const cogs = sum(lines, l => l.cost), delivery = void_ ? 0 : deliveryOf(s, qty);
    const status = void_ ? "void" : balance <= EPS ? "settled" : paid > EPS ? "partial" : "unpaid";
    const lastPay = pays.reduce((m, p) => (p.date > m ? p.date : m), "");
    return { ...s, year, lines, gross, qty, adjs, pays, adjTotal, paid, net, balance, cogs, deliveryCost: delivery, profit: r2(net - cogs - delivery), status, lastPay };
  });
  const saleM = new Map(sales.map(s => [s.id, s]));

  // 手续费按「当年该供应商进货额」摊到它的品种上；该供应商当年没有进货就留在公司层（brandId 为空）
  const purchAmt = new Map();
  for (const p of D.purchase) { const k = p.supplierId + "|" + p.year + "|" + p.brandId; purchAmt.set(k, (purchAmt.get(k) || 0) + p.qty * p.unitCost); }
  const fees = [];
  for (const f of D.sfee) {
    const rows = [...purchAmt].map(([k, v]) => k.split("|").concat(v)).filter(x => x[0] === f.supplierId && +x[1] === +f.year);
    const total = rows.reduce((a, x) => a + x[3], 0);
    if (!total) fees.push({ ...f, brandId: "", seasonId: "", allocated: r2(f.amount) });
    else for (const x of rows) fees.push({ ...f, brandId: x[2], seasonId: (brandM.get(x[2]) || {}).seasonId || "", allocated: r2(f.amount * x[3] / total) });
  }

  // 事实表：每个销售行一条，调整、收款、送货按行摊开，任何筛选 / 分组后的合计都能对上
  const facts = [];
  for (const s of sales) {
    if (s.status === "void") continue;
    const br = s.lines.reduce((a, l) => a + l.amount, 0), qt = s.qty;
    for (const l of s.lines) {
      const sh = br ? l.amount / br : 0, qs = qt ? l.qty / qt : 0, b = brandM.get(l.brandId) || {};
      const net = r2(l.amount - s.adjTotal * sh), deliv = r2(s.deliveryCost * qs);
      facts.push({ saleId: s.id, date: s.date, year: s.year, month: monthOf(s.date), customerId: s.customerId, brandId: l.brandId, seasonId: b.seasonId || "", supplierId: b.supplierId || "",
        qty: +l.qty, gross: l.amount, net, paid: r2(s.paid * sh), cost: l.cost, delivery: deliv, profit: r2(net - l.cost - deliv), status: s.status });
    }
  }
  return { D, brandM, supplierM, customerM, tripM, sales, saleM, fees, facts, avgCost, tripTotal };
}

/* ---------- 筛选 / 汇总 ---------- */
function filterFacts(m, f = {}){
  const inRange = d => (!f.from || d >= f.from) && (!f.to || d <= f.to);
  const common = x => (!f.year || x.year === +f.year) && (!f.seasonId || x.seasonId === f.seasonId) && (!f.brandId || x.brandId === f.brandId) && (!f.supplierId || x.supplierId === f.supplierId);
  const facts = m.facts.filter(x => common(x) && inRange(x.date) && (!f.customerId || x.customerId === f.customerId)
    && (!f.status || (f.status === "owing" ? x.status !== "settled" : x.status === f.status)));
  // 手续费没有客户 / 收款状态这两个维度：按这两项筛选时不计入
  const fees = f.customerId || f.status ? [] : m.fees.filter(x => common(x) && inRange(x.date || ""));
  return { facts, fees };
}
function summarize({ facts, fees }){
  const net = sum(facts, x => x.net), cost = sum(facts, x => x.cost), delivery = sum(facts, x => x.delivery), paid = sum(facts, x => x.paid);
  const fee = sum(fees, x => x.allocated);
  return { qty: sum(facts, x => x.qty), gross: sum(facts, x => x.gross), net, cost, delivery, fee, paid, owing: r2(net - paid), profit: r2(net - cost - delivery - fee), margin: net ? r2((net - cost - delivery - fee) / net * 100) : 0 };
}
/** 按维度分组：by = 函数或字段名；返回按利润从高到低排序的行 */
function groupBy({ facts, fees }, by){
  const key = typeof by === "function" ? by : x => x[by];
  const rows = new Map(), row = k => { if (!rows.has(k)) rows.set(k, { key: k, facts: [], fees: [] }); return rows.get(k); };
  for (const x of facts) row(key(x)).facts.push(x);
  for (const x of fees) { const k = key(x); if (k !== undefined && k !== "") row(k).fees.push(x); }
  return [...rows.values()].map(r => ({ key: r.key, ...summarize(r) })).sort((a, b) => b.profit - a.profit);
}

/* ---------- 库存 ---------- */
function inventory(m, year){
  const { D } = m;
  return D.brand.map(b => {
    const P = D.purchase.filter(p => p.brandId === b.id && p.year === year), R = D.sreturn.filter(p => p.brandId === b.id && p.year === year);
    const purchased = sum(P, p => +p.qty), returned = sum(R, p => +p.qty);
    const sold = sum(m.sales.filter(s => s.status !== "void" && s.year === year), s => sum(s.lines.filter(l => l.brandId === b.id), l => +l.qty));
    const onHand = r2(purchased - returned - sold), avg = m.avgCost(b.id, year);
    return { brandId: b.id, seasonId: b.seasonId, supplierId: b.supplierId, purchased, returned, sold, onHand, avgCost: r2(avg), value: r2(Math.max(onHand, 0) * avg), oversold: onHand < -EPS };
  });
}

/* ---------- 供应商钱池 ---------- */
function supplierLedger(m, supplierId){
  const { D } = m, e = [];
  for (const p of D.spay) if (p.supplierId === supplierId) e.push({ date: p.date, year: yearOf(p.date), type: "pay", amount: +p.amount, ref: p });
  for (const p of D.purchase) if (p.supplierId === supplierId) e.push({ date: p.date, year: p.year, type: "purchase", amount: -p.qty * p.unitCost, ref: p });
  for (const p of D.sreturn) if (p.supplierId === supplierId) e.push({ date: p.date, year: p.year, type: "return", amount: p.qty * p.unitCost, ref: p });
  for (const p of D.sfee) if (p.supplierId === supplierId) e.push({ date: p.date, year: p.year, type: "fee", amount: -p.amount, ref: p });
  e.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  let bal = 0; for (const x of e) { x.amount = r2(x.amount); bal = r2(bal + x.amount); x.balance = bal; }
  return e;
}
/** 年度对账：期初（上年结转）+ 打款 − 进货 + 退货 − 手续费 = 期末。期末为正 = 余额结转明年进货；为负 = 欠种子公司，要补款 */
function supplierStatement(m, supplierId, year){
  const e = supplierLedger(m, supplierId), before = e.filter(x => x.year < year), cur = e.filter(x => x.year === year);
  const t = type => sum(cur.filter(x => x.type === type), x => x.amount);
  const opening = sum(before, x => x.amount), paid = t("pay"), purchases = -t("purchase"), returns = t("return"), fees = -t("fee");
  const closing = r2(opening + paid - purchases + returns - fees);
  const pq = sum(m.D.purchase.filter(p => p.supplierId === supplierId && p.year === year), p => +p.qty);
  const rq = sum(m.D.sreturn.filter(p => p.supplierId === supplierId && p.year === year), p => +p.qty);
  return { opening, paid, purchases, returns, fees, closing, state: closing > EPS ? "carry" : closing < -EPS ? "owe" : "even", purchasedQty: pq, returnedQty: rq, returnRatio: pq ? r2(rq / pq * 100) : 0, entries: cur };
}
/** 退货手续费建议：供应商设了规则（退货比例 ≥ minRatioPct 时，按退货金额 feePct% 收）才给建议，否则 0，由人工填 */
function suggestReturnFee(m, supplierId, year){
  const s = supplierStatement(m, supplierId, year), rule = (m.supplierM.get(supplierId) || {}).rule;
  if (!rule || !(+rule.feePct > 0) || s.returnRatio < (+rule.minRatioPct || 0)) return 0;
  return r2(s.returns * rule.feePct / 100);
}

export { buildModel, filterFacts, summarize, groupBy, inventory, supplierLedger, supplierStatement, suggestReturnFee, r2, yearOf, monthOf, EPS };
