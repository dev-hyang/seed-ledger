/* ============ 图表（手写 SVG / HTML，无依赖，离线可用） ============
   每张图都同时给出数字（柱旁标注或表格），不只靠颜色区分：红 = 亏，绿 = 赚；盲人读屏用 role=img + aria-label 的汇总。 */
import { esc } from "../core/util.js";
import { money, t } from "../core/i18n.js";

const short = v => { const a = Math.abs(v); const s = a >= 1e8 ? (a / 1e8).toFixed(1) + "亿" : a >= 1e4 ? (a / 1e4).toFixed(1) + "万" : Math.round(a) + ""; return (v < 0 ? "-" : "") + s; };
const shortMoney = v => { const m = money(v, { digits: 0 }); return m.length > 9 ? (v < 0 ? "-" : "") + short(Math.abs(v)) : m; };

/** 竖柱（可含负数）：rows = [{ label, value }]；赚的画绿、亏的画红 */
function columns(rows, { height = 170, label = "" } = {}){
  if (!rows.length) return "";
  const W = Math.max(rows.length * 44, 280), padT = 20, padB = 24, H = height;
  const max = Math.max(0, ...rows.map(r => r.value)), min = Math.min(0, ...rows.map(r => r.value)), span = (max - min) || 1;
  const y = v => padT + (max - v) / span * (H - padT - padB), zero = y(0), bw = Math.min(26, W / rows.length * 0.6);
  const bars = rows.map((r, i) => {
    const cx = (i + 0.5) * W / rows.length, y1 = y(r.value), top = Math.min(y1, zero), h = Math.max(Math.abs(y1 - zero), 1);
    return `<rect x="${cx - bw / 2}" y="${top}" width="${bw}" height="${h}" rx="3" class="${r.value < 0 ? "bar-neg" : "bar-pos"}"/>
      <text x="${cx}" y="${r.value < 0 ? top + h + 11 : top - 4}" text-anchor="middle" class="ch-val">${esc(shortMoney(r.value))}</text>
      <text x="${cx}" y="${H - 6}" text-anchor="middle" class="ch-lab">${esc(r.label)}</text>`;
  }).join("");
  return `<div class="chart-scroll"><svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:${W}px;height:auto" role="img" aria-label="${esc(label)}"><line x1="0" x2="${W}" y1="${zero}" y2="${zero}" class="ch-axis"/>${bars}</svg></div>`;
}
/** 折线：rows = [{ label, value }]，至少两个点才画线 */
function line(rows, { height = 170, label = "" } = {}){
  if (!rows.length) return "";
  const W = Math.max(rows.length * 70, 300), padT = 24, padB = 24, padX = 36, H = height;
  const max = Math.max(0, ...rows.map(r => r.value)), min = Math.min(0, ...rows.map(r => r.value)), span = (max - min) || 1;
  const x = i => rows.length === 1 ? W / 2 : padX + i * (W - padX * 2) / (rows.length - 1), y = v => padT + (max - v) / span * (H - padT - padB);
  const pts = rows.map((r, i) => `${x(i)},${y(r.value)}`).join(" ");
  const dots = rows.map((r, i) => `<circle cx="${x(i)}" cy="${y(r.value)}" r="4" class="${r.value < 0 ? "dot-neg" : "dot-pos"}"/><text x="${x(i)}" y="${y(r.value) - 9}" text-anchor="middle" class="ch-val">${esc(shortMoney(r.value))}</text><text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="ch-lab">${esc(r.label)}</text>`).join("");
  return `<div class="chart-scroll"><svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:${W}px;height:auto" role="img" aria-label="${esc(label)}"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="ch-axis"/>${rows.length > 1 ? `<polyline points="${pts}" class="ch-line" fill="none"/>` : ""}${dots}</svg></div>`;
}
/** 横条：rows = [{ label, value, text }]，宽度按最大值 */
function hbars(rows, { cls = "" } = {}){
  const max = Math.max(1, ...rows.map(r => Math.abs(r.value)));
  return `<div class="hbars">${rows.map(r => `<div class="hb"><span class="hb-l">${esc(r.label)}</span><span class="hb-t"><i class="${r.value < 0 ? "neg" : cls}" style="width:${Math.max(2, Math.abs(r.value) / max * 100)}%"></i></span><b class="hb-v ${r.value < 0 ? "neg" : ""}">${esc(r.text)}</b></div>`).join("")}</div>`;
}
/** 成本 / 利润构成：每行一条横向堆叠条（成本 · 送货与手续费 · 利润），长度按销售额 */
function costProfit(rows){
  const max = Math.max(1, ...rows.map(r => r.net));
  const seg = (v, cls) => v > 0 ? `<i class="${cls}" style="width:${v / max * 100}%"></i>` : "";
  return `<div class="cp">${rows.map(r => {
    const other = r.delivery + r.fee, loss = r.profit < 0;
    return `<div class="cp-row"><div class="cp-head"><span>${esc(r.label)}</span><b class="${loss ? "neg" : ""}">${esc(money(r.profit, { sign: true }))}</b></div>
      <div class="cp-bar" role="img" aria-label="${esc(r.label)}">${seg(r.cost, "s-cost")}${seg(other, "s-other")}${loss ? "" : seg(r.profit, "s-profit")}</div>
      <div class="cp-sub">${esc(t("销售额"))} ${esc(money(r.net))} · ${esc(t("成本"))} ${esc(money(r.cost))} · ${esc(t("送货与手续费"))} ${esc(money(other))}${loss ? ` · <b class="neg">${esc(t("亏本"))}</b>` : ""}</div></div>`;
  }).join("")}<div class="legend"><span><i class="s-cost"></i>${esc(t("成本"))}</span><span><i class="s-other"></i>${esc(t("送货与手续费"))}</span><span><i class="s-profit"></i>${esc(t("利润"))}</span></div></div>`;
}

export { columns, line, hbars, costProfit };
