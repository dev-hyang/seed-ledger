/* ============ 客户画像（规则打分，可解释，离线可用） ============
   只依据这位客户自己的交易、收款、讨账记录，给出：风险等级、是否建议明年继续签约、建议的定金比例和赊账上限，以及要注意的保障事项。
   这是记录和风险提示，不构成法律意见；AI 只负责把这些结果写成更口语的建议，没有 AI 画像照样完整。
   规则里的数字是起点，经销商可以按自己的行情在 RULES 里调整。 */
import { r2, EPS } from "./ledger.js";

const RULES = {
  overdueDays: 180,        // 超过这么多天还没结清，算逾期
  slowSettleDays: 60,      // 已结清的单，平均超过这么多天才收齐，算回款慢
  heavyDiscountPct: 8,     // 议价 + 折上折占应收的比例超过这个，算讨价还价重
  carryRatioLow: 0.5,      // 往年未收齐比例超过这个，不建议赊账
  limitFactor: { A: 0.8, B: 0.5, C: 0 }   // 赊账上限 = 往年已收回的年均销售额 × 系数
};

const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 864e5));

function profileCustomer(m, customerId, today = new Date().toISOString().slice(0, 10)){
  const mine = m.sales.filter(s => s.customerId === customerId && s.status !== "void");
  const years = [...new Set(mine.map(s => s.year))].sort();
  const gross = r2(mine.reduce((a, s) => a + s.gross, 0)), net = r2(mine.reduce((a, s) => a + s.net, 0));
  const paid = r2(mine.reduce((a, s) => a + s.paid, 0)), owing = r2(mine.reduce((a, s) => a + Math.max(s.balance, 0), 0));
  const adj = t => r2(mine.reduce((a, s) => a + s.adjs.filter(x => x.type === t).reduce((b, x) => b + (+x.amount), 0), 0));
  const negotiated = adj("negotiate"), discounted = adj("discount"), writtenOff = adj("writeoff");
  const concessionPct = gross ? r2((negotiated + discounted) / gross * 100) : 0;
  const overdue = mine.filter(s => s.balance > EPS && daysBetween(s.date, today) > RULES.overdueDays);
  const settled = mine.filter(s => s.status === "settled" && s.lastPay && s.net > EPS);
  const avgSettleDays = settled.length ? Math.round(settled.reduce((a, s) => a + daysBetween(s.date, s.lastPay), 0) / settled.length) : null;
  const creditSales = mine.filter(s => s.mode !== "cash" && s.net > EPS);
  const priorYears = years.filter(y => y < +today.slice(0, 4));
  const priorNet = r2(mine.filter(s => priorYears.includes(s.year)).reduce((a, s) => a + s.net, 0));
  const priorOwing = r2(mine.filter(s => priorYears.includes(s.year)).reduce((a, s) => a + Math.max(s.balance, 0), 0));
  const carryRatio = priorNet ? priorOwing / priorNet : 0;

  // 扣分制，满分 100；每一项都留下原因，界面上原样展示
  let score = 100; const reasons = [], good = [];
  const hit = (pts, text) => { score -= pts; reasons.push(text); };
  if (writtenOff > EPS) hit(Math.min(35, 15 + writtenOff / Math.max(net, 1) * 100), "有坏账核销记录");
  if (overdue.length) hit(Math.min(30, 12 * overdue.length), `${overdue.length} 单超过 ${RULES.overdueDays} 天未结清`);
  if (carryRatio > RULES.carryRatioLow) hit(20, "往年欠款比例高");
  else if (carryRatio > 0.15) hit(8, "往年有部分欠款没收齐");
  if (concessionPct > RULES.heavyDiscountPct) hit(10, "讨账时议价 / 折上折幅度大");
  if (avgSettleDays != null && avgSettleDays > RULES.slowSettleDays) hit(8, "回款偏慢");
  if (!reasons.length && settled.length) good.push("历史单据都按时结清");
  if (years.length >= 2 && !reasons.length) good.push("连续合作多年");
  score = Math.max(0, Math.round(score));
  const isNew = !mine.length;
  const grade = isNew ? "N" : score >= 80 ? "A" : score >= 55 ? "B" : "C";

  const renew = isNew ? "new" : grade === "A" ? "yes" : grade === "B" ? "careful" : "no";
  const deposit = isNew ? 50 : grade === "A" ? 20 : grade === "B" ? 40 : 100;
  const base = priorYears.length ? priorNet / priorYears.length * (1 - Math.min(carryRatio, 1)) : 0;
  const creditLimit = isNew ? 0 : Math.round(base * (RULES.limitFactor[grade] || 0) / 100) * 100;

  const guard = [];   // 保障事项（界面上翻译）
  if (isNew) guard.push("新客户：先现款或高定金，小额起步，观察一季");
  if (grade === "B" || grade === "C") guard.push("赊账请让客户在销售单上签字，并拍照留存");
  if (grade === "B") guard.push("分批供货，上一批结清再供下一批");
  if (grade === "C") guard.push("明年建议只做现款；如要赊账，须有书面欠条（写明金额、还款日期）");
  if (owing > EPS) guard.push("往年仍有欠款：先清旧账再签新单");
  if (concessionPct > RULES.heavyDiscountPct) guard.push("提前约定「按时付款才享受折扣」，并写在单据上");
  if (writtenOff > EPS || overdue.length) guard.push("保留全部销售单、收款和讨账记录，必要时可导出对账单交法务");
  return { grade, score, renew, deposit, creditLimit, reasons, good, guard,
    stats: { years, gross, net, paid, owing, negotiated, discounted, writtenOff, concessionPct, overdue: overdue.length, avgSettleDays, creditCount: creditSales.length, orders: mine.length } };
}

/** 发给 AI 的脱敏摘要：不含姓名、电话、地址，只有数字和等级 */
function anonymizedSummary(p){
  const s = p.stats;
  return { grade: p.grade, score: p.score, yearsActive: s.years.length, orders: s.orders, netAmount: s.net, owing: s.owing, concessionPct: s.concessionPct,
    writtenOff: s.writtenOff, overdueOrders: s.overdue, avgSettleDays: s.avgSettleDays, reasons: p.reasons };
}

export { profileCustomer, anonymizedSummary, RULES };
