import test from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../js/logic/ledger.js";
import { buildTodos, deliveryTodos, collectTodos, teamTodos, dayDiff } from "../js/logic/todos.js";

const empty = () => ({ sale: [], pay: [], adj: [], purchase: [], sreturn: [], spay: [], sfee: [], brand: [], supplier: [], customer: [], trip: [], town: [] });
const TODAY = "2026-10-29";
const base = () => { const D = empty(); D.supplier.push({ id: "s1", name: "富香" }); D.brand.push({ id: "b1", name: "富香977", seasonId: "early", supplierId: "s1" });
  D.customer.push({ id: "c1", name: "小明" }, { id: "c2", name: "老王" }); D.purchase.push({ id: "p", date: "2026-02-01", year: 2026, supplierId: "s1", brandId: "b1", qty: 5000, unitCost: 28 }); return D; };
const sale = (id, o = {}) => ({ id, date: "2026-10-20", customerId: "c1", mode: "credit", lines: [{ brandId: "b1", qty: 100, price: 35 }], delivery: { type: "pickup" }, ...o });
const P = { write: true, approve: true, manage: true };

test("天数差：同一天 0、明天 1、昨天 −1", () => { assert.equal(dayDiff("2026-10-29", TODAY), 0); assert.equal(dayDiff("2026-10-30", TODAY), 1); assert.equal(dayDiff("2026-10-28", TODAY), -1); });

test("送货提醒：要求明天送货的销售单进提醒；今天、已过期更靠前；送达的、作废的、太远的不提醒", () => {
  const D = base();
  D.sale.push(sale("a", { delivery: { type: "deliver", on: "2026-10-30" } }), sale("b", { delivery: { type: "deliver", on: "2026-10-29" } }), sale("c", { delivery: { type: "deliver", on: "2026-10-27" } }),
    sale("d", { delivery: { type: "deliver", on: "2026-10-30", done: "2026-10-29" } }), sale("e", { delivery: { type: "deliver", on: "2026-10-30" }, status: "void" }), sale("f", { delivery: { type: "deliver", on: "2026-11-20" } }),
    sale("g", { delivery: { type: "deliver" } }), sale("h", { delivery: { type: "deliver" } }));
  const t = deliveryTodos(buildModel(D), TODAY);
  const by = Object.fromEntries(t.map(x => [x.id, x]));
  assert.equal(by["dl:a"].code, "deliver-tomorrow"); assert.equal(by["dl:b"].code, "deliver-today"); assert.equal(by["dl:c"].code, "deliver-overdue"); assert.equal(by["dl:c"].params.days, 2);
  assert.deepEqual(["dl:d", "dl:e", "dl:f"].filter(k => by[k]), []);
  assert.equal(by["dl:undated"].params.count, 2);   // 没定日期的合并成一条
  assert.deepEqual(buildTodos({ m: buildModel(D), today: TODAY, year: 2026, perms: P }).items.slice(0, 3).map(x => x.id), ["dl:c", "dl:b", "dl:a"]);   // 过期 → 今天 → 明天
});

test("催账提醒：有约定收款日按约定（到期前 3 天、过期紧急）；没约定的赊账超过 30 天才提醒；按客户合并", () => {
  const D = base();
  D.sale.push(sale("a", { dueOn: "2026-10-30" }), sale("b", { dueOn: "2026-10-20", customerId: "c2" }), sale("c", { dueOn: "2026-12-30" }),
    sale("d", { date: "2026-09-01", customerId: "c2" }), sale("e", { date: "2026-10-25" }));   // e：才 4 天，不提醒
  D.pay.push({ id: "y", saleId: "e", date: "2026-10-25", amount: 3500 });
  const t = collectTodos(buildModel(D), TODAY), by = Object.fromEntries(t.map(x => [x.params.customerId, x]));
  assert.equal(by.c1.code, "collect-soon"); assert.equal(by.c1.tone, "warn");
  assert.equal(by.c2.code, "collect-due"); assert.equal(by.c2.tone, "bad"); assert.equal(by.c2.params.amount, 7000);   // b + d 合并
  assert.equal(t.length, 2);
});

test("成员提醒：创建者 / 合伙人看到待批准和待表决；申请人看到自己的进度；表决过的不再提醒；普通成员看不到管理类", () => {
  const team = { pending: [{ user_id: "u9", name: "新人" }], approvers: ["o", "p1", "p2"], names: { u5: "小张", u6: "老李" },
    requests: [{ id: "r1", kind: "partner", target_user: "u5", requested_by: "u5", status: "open" }, { id: "r2", kind: "remove", target_user: "u6", requested_by: "o", status: "open" }, { id: "r3", kind: "partner", target_user: "u7", requested_by: "u7", status: "done" }],
    votes: [{ request_id: "r1", voter: "o", approve: true }, { request_id: "r2", voter: "o", approve: true }] };
  const mine = teamTodos(team, "p1", P).map(x => x.code).sort();
  assert.deepEqual(mine, ["join", "vote-partner", "vote-remove"]);
  const owner = teamTodos(team, "o", P).map(x => x.code).sort();
  assert.deepEqual(owner, ["join", "remove-wait"]);   // 创建者已经投过：partner 那条不再提醒；自己发起的移出显示进度
  assert.deepEqual(teamTodos(team, "u5", { approve: false }).map(x => x.code), ["partner-wait"]);   // 申请人看到进度，看不到别人的
  assert.deepEqual(teamTodos(team, "u5", { approve: false })[0].params, { agreed: 1, total: 3 });
  assert.deepEqual(teamTodos(team, "u8", { approve: false }), []);
  assert.deepEqual(teamTodos(null, "p1", P), []);
});

test("汇总：库存卖超、种子公司需补款进提醒；超过上限只取前几条并给出总数", () => {
  const D = base(); D.sale.push(sale("a", { lines: [{ brandId: "b1", qty: 9000, price: 35 }] }));   // 卖超
  const r = buildTodos({ m: buildModel(D), today: TODAY, year: 2026, perms: P });
  assert.ok(r.items.some(x => x.code === "oversold")); assert.ok(r.items.some(x => x.code === "pool-owe"));
  const D2 = base(); for (let i = 0; i < 20; i++) D2.sale.push(sale("s" + i, { delivery: { type: "deliver", on: "2026-10-30" } }));
  const r2 = buildTodos({ m: buildModel(D2), today: TODAY, year: 2026, perms: P });
  assert.equal(r2.items.length, 12); assert.ok(r2.total >= 20);
});
