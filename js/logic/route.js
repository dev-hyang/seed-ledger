/* ============ 送货路线（估算 + 建议，人工随时可改） ============
   没有地图数据：每个镇记「离门店多少公里、在哪个方向」，同一个镇内换村按固定里程估。
   这是估算，目的是比较「分开送」和「一趟送」大概省多少、先后怎么排，不是导航。
   AI 推荐（可选）只在这个结果上给建议，不可用时这里的建议照样能用。 */
import { r2 } from "./ledger.js";

const DIRS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
const DEFAULTS = { perKm: 1.2, villageHopKm: 2, laborPerTrip: 0 };

const townOf = (towns, name) => towns.find(t => t.name === name) || { name, distKm: 0, dir: "" };

/** 两个停靠点之间的里程：同镇按换村里程；同方向走差值（顺路）；不同方向要绕回门店 */
function legKm(a, b, towns, o){
  const ta = townOf(towns, a.town), tb = townOf(towns, b.town);
  if (a.town === b.town) return a.village === b.village ? 0 : o.villageHopKm;
  if (ta.dir && ta.dir === tb.dir) return Math.abs(ta.distKm - tb.distKm) + o.villageHopKm;
  return ta.distKm + tb.distKm;
}
/** 门店出发、依次送完、回门店的总里程 */
function routeKm(stops, towns, opt = {}){
  const o = { ...DEFAULTS, ...opt };
  if (!stops.length) return 0;
  let km = townOf(towns, stops[0].town).distKm;
  for (let i = 1; i < stops.length; i++) km += legKm(stops[i - 1], stops[i], towns, o);
  return r2(km + townOf(towns, stops[stops.length - 1].town).distKm);
}
/** 建议顺序：按方向归拢，同方向由近到远一路送出去，镇内按村排；最后回程 */
function suggestOrder(stops, towns){
  const key = s => { const t = townOf(towns, s.town); return [DIRS.indexOf(t.dir) < 0 ? 99 : DIRS.indexOf(t.dir), t.distKm, s.town, s.village || ""]; };
  return [...stops].sort((a, b) => { const x = key(a), y = key(b); for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; });
}
/** 比较「每个客户单独跑」和「按建议顺序一趟送」 */
function compareTrips(stops, towns, opt = {}){
  const o = { ...DEFAULTS, ...opt };
  const separate = r2(stops.reduce((a, s) => a + routeKm([s], towns, o), 0));
  const ordered = suggestOrder(stops, towns), combined = routeKm(ordered, towns, o);
  const cost = km => r2(km * o.perKm);
  return { ordered, separateKm: separate, combinedKm: combined, savedKm: r2(separate - combined), separateCost: cost(separate), combinedCost: cost(combined),
    savedCost: r2(cost(separate) - cost(combined) + (stops.length - 1) * o.laborPerTrip) };
}
/** 同一趟里不同方向的停靠点太多时，提示拆成几趟（每个方向一趟） */
function splitByDirection(stops, towns){
  const g = new Map();
  for (const s of stops) { const d = townOf(towns, s.town).dir || "?"; if (!g.has(d)) g.set(d, []); g.get(d).push(s); }
  return [...g].map(([dir, list]) => ({ dir, stops: suggestOrder(list, towns) }));
}

export { routeKm, suggestOrder, compareTrips, splitByDirection, DIRS, DEFAULTS };
