import test from "node:test";
import assert from "node:assert/strict";
import { buildModel, filterFacts, summarize, groupBy, inventory, supplierStatement, suggestReturnFee } from "../js/logic/ledger.js";
import { profileCustomer, anonymizedSummary } from "../js/logic/profile.js";
import { compareTrips, routeKm, suggestOrder } from "../js/logic/route.js";

const empty = () => ({ sale: [], pay: [], adj: [], purchase: [], sreturn: [], spay: [], sfee: [], brand: [], supplier: [], customer: [], trip: [], town: [] });
const base = () => {
  const D = empty();
  D.supplier.push({ id: "s1", name: "富香种业", rule: { minRatioPct: 50, feePct: 2 } });
  D.brand.push({ id: "b1", name: "富香977", seasonId: "early", supplierId: "s1" });
  D.customer.push({ id: "c1", name: "小明", town: "金川镇", village: "一村" });
  D.purchase.push({ id: "p1", date: "2026-02-01", year: 2026, supplierId: "s1", brandId: "b1", qty: 5000, unitCost: 28 });
  return D;
};

test("赊账 300 斤 × 35：议价到 30，再折上折 5%，部分付款", () => {
  const D = base();
  D.sale.push({ id: "a", date: "2026-03-30", customerId: "c1", mode: "credit", lines: [{ brandId: "b1", qty: 300, price: 35, hint: 33 }], delivery: { type: "deliver", labor: 50, vehicle: 30 } });
  D.adj.push({ id: "j1", saleId: "a", type: "negotiate", amount: 1500 });   // 35 → 30
  D.adj.push({ id: "j2", saleId: "a", type: "discount", pct: 5, amount: 450 });   // 9000 × 5%
  D.pay.push({ id: "y1", saleId: "a", date: "2026-12-20", amount: 3000 });
  const s = buildModel(D).sales[0];
  assert.equal(s.gross, 10500); assert.equal(s.net, 8550); assert.equal(s.paid, 3000); assert.equal(s.balance, 5550);
  assert.equal(s.status, "partial");
  assert.equal(s.cogs, 8400); assert.equal(s.deliveryCost, 80); assert.equal(s.profit, 70);   // 8550 − 8400 − 80
});

test("当场结清：状态 settled，余额 0", () => {
  const D = base();
  D.sale.push({ id: "a", date: "2026-03-30", customerId: "c1", mode: "cash", lines: [{ brandId: "b1", qty: 100, price: 35 }], delivery: { type: "pickup" } });
  D.pay.push({ id: "y1", saleId: "a", date: "2026-03-30", amount: 3500 });
  const s = buildModel(D).sales[0];
  assert.equal(s.status, "settled"); assert.equal(s.balance, 0); assert.equal(s.deliveryCost, 0);
});

test("作废的单不计入销售、库存、利润", () => {
  const D = base();
  D.sale.push({ id: "a", date: "2026-03-30", customerId: "c1", lines: [{ brandId: "b1", qty: 100, price: 35 }], status: "void" });
  const m = buildModel(D);
  assert.equal(m.facts.length, 0); assert.equal(inventory(m, 2026)[0].sold, 0);
});

test("同一趟送货的成本按数量摊给各单", () => {
  const D = base();
  D.trip.push({ id: "t1", labor: 100, vehicle: 100 });
  for (const [id, q] of [["a", 100], ["b", 300]]) D.sale.push({ id, date: "2026-04-01", customerId: "c1", lines: [{ brandId: "b1", qty: q, price: 35 }], delivery: { type: "deliver", tripId: "t1" } });
  const [a, b] = buildModel(D).sales;
  assert.equal(a.deliveryCost, 50); assert.equal(b.deliveryCost, 150);
});

test("库存 = 进货 − 退货 − 已售；卖超会标记", () => {
  const D = base();
  D.sreturn.push({ id: "r1", date: "2026-08-01", year: 2026, supplierId: "s1", brandId: "b1", qty: 4000, unitCost: 28 });
  D.sale.push({ id: "a", date: "2026-03-30", customerId: "c1", lines: [{ brandId: "b1", qty: 500, price: 35 }] });
  let inv = inventory(buildModel(D), 2026)[0];
  assert.equal(inv.onHand, 500); assert.equal(inv.oversold, false);
  D.sale[0].lines[0].qty = 1500;
  inv = inventory(buildModel(D), 2026)[0];
  assert.equal(inv.onHand, -500); assert.equal(inv.oversold, true);
});

test("钱池：拿 5000 斤退 4000 斤，收手续费，余额结转 / 要补款", () => {
  const D = base();
  D.sreturn.push({ id: "r1", date: "2026-08-01", year: 2026, supplierId: "s1", brandId: "b1", qty: 4000, unitCost: 28 });
  D.spay.push({ id: "z1", date: "2026-02-01", supplierId: "s1", amount: 140000 });
  let m = buildModel(D);
  assert.equal(suggestReturnFee(m, "s1", 2026), 2240);   // 退货 112000 × 2%，退货比例 80% ≥ 50%
  D.sfee.push({ id: "f1", date: "2026-08-02", year: 2026, supplierId: "s1", amount: 2240, reason: "return" });
  m = buildModel(D);
  const st = supplierStatement(m, "s1", 2026);
  assert.equal(st.purchases, 140000); assert.equal(st.returns, 112000); assert.equal(st.returnRatio, 80);
  assert.equal(st.closing, 109760); assert.equal(st.state, "carry");
  const next = supplierStatement(m, "s1", 2027);   // 余额自动成为明年期初
  assert.equal(next.opening, 109760);
  D.spay.length = 0;   // 没打款：欠款
  assert.equal(supplierStatement(buildModel(D), "s1", 2026).state, "owe");
});

test("退货比例不到门槛，不建议收手续费", () => {
  const D = base();
  D.sreturn.push({ id: "r1", date: "2026-08-01", year: 2026, supplierId: "s1", brandId: "b1", qty: 1000, unitCost: 28 });
  assert.equal(suggestReturnFee(buildModel(D), "s1", 2026), 0);
});

test("手续费摊到品种，利润和筛选合计对得上", () => {
  const D = base();
  D.sale.push({ id: "a", date: "2026-03-30", customerId: "c1", lines: [{ brandId: "b1", qty: 100, price: 35 }] });
  D.sfee.push({ id: "f1", date: "2026-08-02", year: 2026, supplierId: "s1", amount: 100 });
  const m = buildModel(D), all = summarize(filterFacts(m, { year: 2026 }));
  assert.equal(all.net, 3500); assert.equal(all.cost, 2800); assert.equal(all.fee, 100); assert.equal(all.profit, 600);
  const rows = groupBy(filterFacts(m, { year: 2026 }), "brandId");
  assert.equal(rows[0].profit, 600);
  assert.equal(summarize(filterFacts(m, { year: 2026, customerId: "c1" })).fee, 0);   // 按客户筛选不含手续费
});

test("客户画像：逾期 + 坏账 → C 级，不建议续签", () => {
  const D = base();
  D.sale.push({ id: "a", date: "2025-03-30", customerId: "c1", mode: "credit", lines: [{ brandId: "b1", qty: 100, price: 35 }] });
  D.adj.push({ id: "j", saleId: "a", type: "writeoff", amount: 1000 });
  const p = profileCustomer(buildModel(D), "c1", "2026-10-28");
  assert.equal(p.grade, "C"); assert.equal(p.renew, "no"); assert.equal(p.deposit, 100); assert.equal(p.creditLimit, 0);
  const anon = JSON.stringify(anonymizedSummary(p));
  assert.ok(!anon.includes("小明") && !anon.includes("金川镇"));   // 脱敏：不含姓名和地址
});

test("客户画像：全部按时结清 → A 级；新客户 → N 级", () => {
  const D = base();
  D.sale.push({ id: "a", date: "2025-03-30", customerId: "c1", mode: "cash", lines: [{ brandId: "b1", qty: 100, price: 35 }] });
  D.pay.push({ id: "y", saleId: "a", date: "2025-03-30", amount: 3500 });
  assert.equal(profileCustomer(buildModel(D), "c1", "2026-10-28").grade, "A");
  assert.equal(profileCustomer(buildModel(base()), "c1", "2026-10-28").grade, "N");
});

test("路线：同方向顺路，一趟比分开跑省里程", () => {
  const towns = [{ name: "金川镇", distKm: 10, dir: "东" }, { name: "白石镇", distKm: 18, dir: "东" }, { name: "南湾镇", distKm: 12, dir: "南" }];
  const stops = [{ town: "白石镇", village: "二村" }, { town: "金川镇", village: "一村" }];
  assert.deepEqual(suggestOrder(stops, towns).map(s => s.town), ["金川镇", "白石镇"]);   // 由近到远
  assert.equal(routeKm(suggestOrder(stops, towns), towns), 10 + (8 + 2) + 18);
  const c = compareTrips(stops, towns);
  assert.equal(c.separateKm, 56); assert.equal(c.combinedKm, 38); assert.equal(c.savedKm, 18);
});

test("模型保留销售单的送货信息（对象），送货成本是另一个数字字段", () => {
  const D = base();
  D.sale.push({ id: "a", date: "2026-03-30", customerId: "c1", lines: [{ brandId: "b1", qty: 100, price: 35 }], delivery: { type: "deliver", labor: 20, vehicle: 10 } });
  const s = buildModel(D).sales[0];
  assert.equal(s.delivery.type, "deliver"); assert.equal(s.deliveryCost, 30);
});
