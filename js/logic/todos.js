/* ============ 概览「待处理」任务的生成（纯函数，有测试） ============
   只做「提醒」：根据已有的销售、收款、库存、成员申请算出今天该处理什么，不自动做任何事，也不往应用外发通知。
   每条是 { id, kind, code, tone, rank, params, act } —— 文字由界面按 code 翻译（这里不碰 i18n），tone 决定颜色：bad 紧急 / warn 今明两天 / info 参考。
   按角色只给他够得着的：成员管理类（批准加入、表决）只给创建者和合伙人；申请合伙人的人看得到自己申请的进度。
   送货：销售单选了「我送货」并填了送货日期，到期前 3 天进提醒；没送达（delivery.done 为空）才算。
   催账：有「约定收款日」的，到期前 3 天起提醒、过期变紧急；没约定的，赊账超过 30 天才提醒；按客户合并成一条。 */
import { EPS, inventory, supplierStatement } from "./ledger.js";

const DAY = 864e5;
const dayDiff = (a, b) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / DAY);   // a − b（天）
const SOON = 3, OLD_DAYS = 30, MAX = 12;

/* ---------- 送货 ---------- */
function deliveryTodos(m, today){
  const out = []; let undated = 0;
  for (const s of m.sales) {
    const d = s.delivery || {};
    if (s.status === "void" || d.type !== "deliver" || d.done) continue;
    if (!d.on) { undated++; continue; }
    const n = dayDiff(d.on, today);
    if (n > SOON) continue;
    const code = n < 0 ? "deliver-overdue" : n === 0 ? "deliver-today" : n === 1 ? "deliver-tomorrow" : "deliver-soon";
    out.push({ id: "dl:" + s.id, kind: "delivery", code, tone: n < 0 ? "bad" : n <= 1 ? "warn" : "info", rank: n < 0 ? 0 : n === 0 ? 1 : n === 1 ? 4 : 6, params: { customerId: s.customerId, days: Math.abs(n), qty: s.qty, on: d.on }, act: { act: "sale-view", id: s.id }, done: { act: "delivered", id: s.id } });
  }
  if (undated) out.push({ id: "dl:undated", kind: "delivery", code: "deliver-undated", tone: "info", rank: 9, params: { count: undated }, act: { act: "goto", tab: "sales", sub: "trips" } });
  return out;
}

/* ---------- 催账：按客户合并 ---------- */
function collectTodos(m, today){
  const by = new Map();
  for (const s of m.sales) {
    if (s.status === "void" || s.balance <= EPS) continue;
    const age = dayDiff(today, s.date), due = s.dueOn ? dayDiff(s.dueOn, today) : null;   // due：距约定收款日还有几天（负数 = 已过期）
    let urgency = null;
    if (due != null) { if (due <= SOON) urgency = { code: due < 0 ? "collect-due" : "collect-soon", days: Math.abs(due), over: due < 0 }; }   // 有约定收款日：按约定
    else if (s.chase) urgency = { code: "collect-marked", days: age, over: age >= OLD_DAYS };   // 手动标记了「待催账」：马上提醒，不等 30 天
    else if (age >= OLD_DAYS) urgency = { code: "collect-old", days: age, over: age >= 90 };
    if (!urgency) continue;
    const c = by.get(s.customerId) || { customerId: s.customerId, amount: 0, worst: null };
    c.amount += s.balance;
    if (!c.worst || urgency.over > c.worst.over || (urgency.over === c.worst.over && urgency.days > c.worst.days)) c.worst = { ...urgency, saleId: s.id };
    by.set(s.customerId, c);
  }
  return [...by.values()].map(c => ({ id: "co:" + c.customerId, kind: "collect", code: c.worst.code, tone: c.worst.over ? "bad" : c.worst.code === "collect-soon" || c.worst.code === "collect-marked" ? "warn" : "info",
    rank: c.worst.code === "collect-due" ? 2 : c.worst.code === "collect-marked" ? (c.worst.over ? 2.5 : 4.5) : c.worst.code === "collect-soon" ? 5 : c.worst.over ? 3 : 7, params: { customerId: c.customerId, amount: Math.round(c.amount * 100) / 100, days: c.worst.days }, act: { act: "customer-view", id: c.customerId } }));
}

/* ---------- 成员：批准加入、表决、我的申请进度 ---------- */
function teamTodos(team, me, perms){
  if (!team || !me) return [];
  const out = [], approvers = team.approvers || [], name = id => (team.names || {})[id] || "?";
  const votesOf = id => (team.votes || []).filter(v => v.request_id === id);
  if (perms.approve) for (const p of team.pending || []) out.push({ id: "tm:join:" + p.user_id, kind: "team", code: "join", tone: "warn", rank: 1.5, params: { name: p.name || "?" }, act: { act: "open-members" } });
  for (const r of (team.requests || []).filter(x => x.status === "open")) {
    const voters = approvers.filter(u => u !== r.target_user), votes = votesOf(r.id), agreed = votes.filter(v => v.approve).length;
    const iVote = voters.includes(me), voted = votes.some(v => v.voter === me);
    if (iVote && !voted) out.push({ id: "tm:vote:" + r.id, kind: "team", code: r.kind === "partner" ? "vote-partner" : "vote-remove", tone: "warn", rank: 1.6, params: { name: name(r.target_user), agreed, total: voters.length }, act: { act: "open-members" } });
    else if (r.kind === "partner" && r.target_user === me) out.push({ id: "tm:wait:" + r.id, kind: "team", code: "partner-wait", tone: "info", rank: 8, params: { agreed, total: voters.length }, act: { act: "open-members" } });
    else if (r.kind === "remove" && r.requested_by === me && voted) out.push({ id: "tm:rwait:" + r.id, kind: "team", code: "remove-wait", tone: "info", rank: 8, params: { name: name(r.target_user), agreed, total: voters.length }, act: { act: "open-members" } });
  }
  return out;
}

/* ---------- 库存、种子公司账 ---------- */
function stockTodos(m, year){
  const out = [];
  for (const r of inventory(m, year)) if (r.oversold) out.push({ id: "st:" + r.brandId, kind: "stock", code: "oversold", tone: "warn", rank: 7, params: { brandId: r.brandId, qty: Math.abs(r.onHand) }, act: { act: "goto", tab: "stock" } });
  for (const s of m.D.supplier) { const st = supplierStatement(m, s.id, year); if (st.state === "owe") out.push({ id: "sp:" + s.id, kind: "pool", code: "pool-owe", tone: "warn", rank: 8, params: { supplierId: s.id, amount: -st.closing }, act: { act: "supplier-view", id: s.id } }); }
  return out;
}

/** ctx: { m: 账务模型, today: "YYYY-MM-DD", year, perms, team, me } → 按紧急程度排好的任务（最多 MAX 条；total = 总条数，用来显示「还有 n 条」） */
function buildTodos({ m, today, year, perms, team, me }){
  const all = [...deliveryTodos(m, today), ...collectTodos(m, today), ...teamTodos(team, me, perms), ...stockTodos(m, year)]
    .sort((a, b) => a.rank - b.rank || String(a.id).localeCompare(String(b.id)));
  const col = all.filter(x => x.kind === "collect");
  return { items: all.slice(0, MAX), total: all.length, collect: { customers: col.length, amount: Math.round(col.reduce((a, x) => a + x.params.amount, 0) * 100) / 100 } };   // collect：待催账的客户数和金额，概览顶部汇总用
}

export { buildTodos, deliveryTodos, collectTodos, teamTodos, stockTodos, dayDiff, SOON, OLD_DAYS, MAX };
