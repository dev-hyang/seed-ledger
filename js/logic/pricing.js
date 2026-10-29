/* ============ 价格档：零售价 / 批发价（纯函数，有测试） ============
   每个品种每年有三个价：进货价、零售价、批发价。批发价可以不设（没设就按零售价）。
   旧数据里的「预售价」（presale）就是现在的零售价，读的时候自动沿用，不需要迁移。
   销售单有一个价格档（tier）：新建销售时按客户的默认档预选，也可以手动切换；切换后，还没手改过的单价会跟着换。 */

const TIERS = ["retail", "wholesale"];
const num = v => (v === "" || v == null || !Number.isFinite(+v) ? null : +v);

/** 一条价格记录 → { buy, retail, wholesale }；兼容只有 presale 的旧记录 */
function normalizePrice(rec){
  const r = rec || {};
  return { buy: num(r.buy) ?? 0, retail: num(r.retail) ?? num(r.presale) ?? 0, wholesale: num(r.wholesale) };
}
/** 某个档的单价：批发档没设批发价就用零售价 */
function priceOf(p, tier){ return tier === "wholesale" && p.wholesale > 0 ? p.wholesale : p.retail; }
const tierOf = v => (TIERS.includes(v) ? v : "retail");

export { TIERS, normalizePrice, priceOf, tierOf };
