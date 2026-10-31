/* ============ 催账让利算法 + 销售 / 客户生命周期（纯函数） ============
   议价：一口价（填议价后总额）或按单价（各行新单价 × 数量，系统算总额）；差额相对当前应收固化成一笔调整。
   折上折：按当时欠款 × 百分比，或直接减一笔金额；金额当场记下，之后欠款变了也不跟着变。
   生命周期：把一笔（或一位客户全部）销售按时间摊成事件，每步带当时的应收 / 已收 / 欠款。 */

import { r2, EPS } from "./ledger.js";

function collectConcession(s, input = {}){
  const type = input.type || "negotiate";
  if (type === "negotiate") {
    const nMode = input.nMode === "unit" ? "unit" : "lump";
    let target, prices;
    if (nMode === "unit") {
      prices = (s.lines || []).map((l, i) => {
        const p = input.prices && input.prices[i];
        const price = p != null && p !== "" ? +p : +l.price;
        return { brandId: l.brandId, qty: +l.qty, price };
      });
      target = r2(prices.reduce((a, l) => a + l.qty * l.price, 0));
    } else target = r2(+input.target || 0);
    return { type, nMode, amount: r2(Math.max(s.net - target, 0)), target, prices };
  }
  if (type === "discount") {
    const dMode = input.dMode === "amt" ? "amt" : "pct";
    if (dMode === "amt") return { type, dMode, amount: r2(Math.max(+input.off || 0, 0)) };
    const pct = +input.pct || 0;
    return { type, dMode, amount: r2(Math.max(s.balance, 0) * pct / 100), pct };
  }
  return { type: "writeoff", amount: r2(Math.max(+input.wo || 0, 0)) };
}

const ORD = { buy: 0, pickup: 1, "deliver-plan": 2, negotiate: 3, discount: 4, writeoff: 5, pay: 6, delivered: 7, chase: 8, due: 9, void: 10 };

function saleLifecycle(s){
  const events = [];
  let net = 0, paid = 0, open = true;
  const snap = () => ({ net: r2(net), paid: r2(paid), balance: r2(net - paid) });
  const add = (partial) => {
    const e = { saleId: s.id, saleNo: s.no || "", customerId: s.customerId, date: partial.date, kind: partial.kind, ord: ORD[partial.kind] ?? 50, deltaNet: r2(partial.deltaNet || 0), deltaPaid: r2(partial.deltaPaid || 0), amount: r2(partial.amount || 0), ...partial };
    net = r2(net + e.deltaNet); paid = r2(paid + e.deltaPaid);
    Object.assign(e, snap());
    if (open && e.kind !== "void" && e.balance <= EPS) { e.closes = true; open = false; }
    events.push(e);
  };

  add({ date: s.date, kind: "buy", amount: s.gross, deltaNet: s.gross, qty: s.qty, lines: s.lines, mode: s.mode });
  if ((s.delivery || {}).type !== "deliver") add({ date: s.date, kind: "pickup" });

  const extra = [];
  for (const a of s.adjs || []) extra.push({ date: a.date || s.date, kind: a.type || "negotiate", amount: +a.amount, deltaNet: -Math.abs(+a.amount), adj: a });
  for (const p of s.pays || []) extra.push({ date: p.date || s.date, kind: "pay", amount: +p.amount, deltaPaid: +p.amount, pay: p });
  const d = s.delivery || {};
  if (d.type === "deliver" && d.on) extra.push({ date: d.on, kind: "deliver-plan" });
  if (d.type === "deliver" && d.done) extra.push({ date: d.done, kind: "delivered" });
  if (s.chase && s.chaseAt) extra.push({ date: s.chaseAt, kind: "chase" });
  if (s.dueOn) extra.push({ date: s.dueOn, kind: "due" });
  if (s.status === "void") extra.push({ date: s.voidAt || s.date, kind: "void", reason: s.voidReason, deltaNet: -s.net, deltaPaid: -s.paid });
  extra.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (ORD[a.kind] - ORD[b.kind]));
  for (const x of extra) add(x);
  return events;
}

function customerLifecycle(sales){
  const all = (sales || []).flatMap(s => saleLifecycle(s));
  all.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.ord - b.ord) || String(a.saleNo).localeCompare(String(b.saleNo)) || String(a.saleId).localeCompare(String(b.saleId)));
  let net = 0, paid = 0;
  for (const e of all) {
    net = r2(net + e.deltaNet); paid = r2(paid + e.deltaPaid);
    e.custNet = net; e.custPaid = paid; e.custBal = r2(net - paid);
  }
  return all;
}

export { collectConcession, saleLifecycle, customerLifecycle };
