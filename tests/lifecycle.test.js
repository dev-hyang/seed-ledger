import test from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../js/logic/ledger.js";
import { collectConcession, saleLifecycle, customerLifecycle } from "../js/logic/lifecycle.js";

const empty = () => ({ sale: [], pay: [], adj: [], purchase: [], sreturn: [], spay: [], sfee: [], brand: [], supplier: [], customer: [], trip: [], town: [] });
const base = () => {
  const D = empty();
  D.supplier.push({ id: "s1", name: "富香种业" });
  D.brand.push({ id: "b1", name: "富香977", seasonId: "early", supplierId: "s1" });
  D.customer.push({ id: "c1", name: "小明" });
  D.purchase.push({ id: "p1", date: "2026-02-01", year: 2026, supplierId: "s1", brandId: "b1", qty: 5000, unitCost: 28 });
  return D;
};

test("议价：一口价按总额；按单价由数量算出总额", () => {
  const D = base();
  D.sale.push({ id: "a", date: "2026-03-30", customerId: "c1", lines: [{ brandId: "b1", qty: 300, price: 35 }] });
  const s = buildModel(D).sales[0];
  const lump = collectConcession(s, { type: "negotiate", nMode: "lump", target: 9000 });
  assert.equal(lump.amount, 1500); assert.equal(lump.target, 9000);   // 10500 − 9000
  const unit = collectConcession(s, { type: "negotiate", nMode: "unit", prices: [30] });
  assert.equal(unit.amount, 1500); assert.equal(unit.target, 9000); assert.equal(unit.prices[0].price, 30);
});

test("折上折：比例按当时欠款；金额是直接少一笔", () => {
  const D = base();
  D.sale.push({ id: "a", date: "2026-03-30", customerId: "c1", lines: [{ brandId: "b1", qty: 300, price: 35 }] });
  D.adj.push({ id: "j1", saleId: "a", type: "negotiate", amount: 1500 });
  const s = buildModel(D).sales[0];   // net 9000, unpaid
  const pct = collectConcession(s, { type: "discount", dMode: "pct", pct: 5 });
  assert.equal(pct.amount, 450);
  const amt = collectConcession(s, { type: "discount", dMode: "amt", off: 500 });
  assert.equal(amt.amount, 500);
});

test("一笔销售的过程：下单 → 送货 → 议价 → 收款结清", () => {
  const D = base();
  D.sale.push({ id: "a", no: "2026-001", date: "2026-03-30", customerId: "c1", mode: "credit", lines: [{ brandId: "b1", qty: 100, price: 35 }], delivery: { type: "deliver", on: "2026-04-02", done: "2026-04-03" } });
  D.adj.push({ id: "j1", saleId: "a", date: "2026-04-10", type: "negotiate", amount: 500 });
  D.pay.push({ id: "y1", saleId: "a", date: "2026-05-01", amount: 3000 });
  const ev = saleLifecycle(buildModel(D).sales[0]);
  assert.deepEqual(ev.map(e => e.kind), ["buy", "deliver-plan", "delivered", "negotiate", "pay"]);
  assert.equal(ev[0].balance, 3500);
  assert.equal(ev.find(e => e.kind === "delivered").balance, 3500);
  assert.equal(ev.find(e => e.kind === "negotiate").balance, 3000);
  const pay = ev.find(e => e.kind === "pay");
  assert.equal(pay.balance, 0); assert.equal(pay.closes, true);
});

test("客户历史：两笔单按时间穿插，作废的单从欠款里拿掉", () => {
  const D = base();
  D.sale.push({ id: "a", no: "1", date: "2026-03-01", customerId: "c1", lines: [{ brandId: "b1", qty: 100, price: 35 }] });
  D.sale.push({ id: "b", no: "2", date: "2026-03-10", customerId: "c1", lines: [{ brandId: "b1", qty: 50, price: 35 }], status: "void", voidAt: "2026-03-12" });
  D.pay.push({ id: "y1", saleId: "a", date: "2026-03-20", amount: 3500 });
  const m = buildModel(D);
  const ev = customerLifecycle(m.sales.filter(s => s.customerId === "c1"));
  const kinds = ev.map(e => e.kind);
  assert.ok(kinds.includes("buy") && kinds.includes("void") && kinds.includes("pay"));
  const afterVoid = ev.find(e => e.kind === "void");
  assert.equal(afterVoid.custBal, 3500);   // 第二笔作废后只剩第一笔欠款
  const last = ev[ev.length - 1];
  assert.equal(last.kind, "pay"); assert.equal(last.custBal, 0); assert.equal(last.closes, true);
});
