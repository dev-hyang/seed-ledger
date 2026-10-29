/* ============ 扫描 / 导入销售记录的核心逻辑（纯函数，有测试） ============
   流程：图片 / PDF / Excel / CSV / 文字 → AI 读成「销售草稿」→ 本地清洗（日期、单位、金额）→ 匹配已有客户和品种 → 用户核对 → 才入库。
   AI 的话一律当不可信：日期、数量、金额、单位都在这里重新校验；认不出的品种不乱猜，留给用户选。
   手抄本历史数据也走这条路：一页上有好几位客户，就会读成好几笔销售草稿。 */
import { r2 } from "./ledger.js";

const SYSTEM = [
  "You extract SALES records of a rice-seed dealer from photos, scans, spreadsheets or text of: sales slips / delivery notes / receipts, handwritten ledger notebook pages, customer statements, WeChat / Alipay payment screenshots.",
  "Return ONLY JSON and never invent anything: copy names, dates and numbers exactly as written; use null when something is not visible.",
  'Return {"currency":"CNY"|null,"sales":[{"date":"YYYY-MM-DD"|null,"customer":"name as written","phone":string|null,"town":string|null,"village":string|null,"lines":[{"brand":"variety name as written","qty":number,"unit":"unit exactly as written, e.g. 斤 / 公斤 / kg / 袋"|null,"price":number|null,"amount":number|null}],"paid":number|null,"note":string|null}]}',
  "price = unit price as written (per the written unit); amount = that line's total as written. One sale = one customer on one date; several varieties bought together are lines of the same sale. A page that lists several customers or dates gives several sales.",
  "If only month/day are written, use the year from the prompt. paid = money received on that sale: 0 when marked 赊账 / 欠 / 未付, the full total when marked 已付 / 结清 / 付清, the written amount for a deposit (定金 / 预付), otherwise null.",
  "Ignore totals rows, headers, page numbers and anything that is not a sale. Do not output account or ID numbers."
].join("\n");

const userPrompt = ({ today, brands = [], text = "", imageCount = 0 }) =>
  `Today is ${today}.\nKnown varieties (use these exact names when the written name clearly refers to one): ${brands.length ? brands.join(", ") : "(none yet)"}.\n`
  + (imageCount ? `${imageCount} image(s) attached.\n` : "") + (text ? `Content:\n${text}` : "");

/* ---------- 单位：统一换成斤 ---------- */
const JIN = { "斤": 1, "市斤": 1, jin: 1, "公斤": 2, "千克": 2, kg: 2, kgs: 2, "吨": 2000, t: 2000, ton: 2000, tons: 2000, "磅": 0.9072, lb: 0.9072, lbs: 0.9072, "两": 0.1 };
const num = v => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.\-]/g, "")); return Number.isFinite(n) ? n : null; };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(s));
const digits = s => String(s || "").replace(/\D/g, "");

function lenientJson(text){
  const c = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(c); } catch (e) { /* 再试截取 */ }
  const a = c.indexOf("{"), b = c.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(c.slice(a, b + 1));
  throw new Error("no json");
}

/** AI 返回 → 销售草稿数组。每个草稿：{ on, date, noDate, customer, phone, town, village, lines:[{ brandText, brandId, qty, price, note }], paid, note, flags:[] } */
function normalizeAi(json, { today }){
  const sales = Array.isArray(json?.sales) ? json.sales : [];
  const out = [];
  for (const s of sales) {
    const flags = [], lines = [];
    for (const l of Array.isArray(s?.lines) ? s.lines : []) {
      const qtyRaw = num(l.qty), unit = String(l.unit || "").trim().toLowerCase();
      if (!qtyRaw || qtyRaw <= 0) continue;
      const f = !unit ? 1 : JIN[unit] ?? null;
      if (f == null) flags.push(`unit:${l.unit}`);
      const factor = f ?? 1, qty = r2(qtyRaw * factor);
      let price = num(l.price) != null ? r2(num(l.price) / factor) : null;
      const amount = num(l.amount);
      if (price == null && amount != null && qty > 0) price = r2(amount / qty);
      lines.push({ brandText: String(l.brand || "").trim().slice(0, 60), brandId: "", qty, price, note: f == null ? String(l.unit) : unit && f !== 1 ? `${qtyRaw}${l.unit}` : "" });
    }
    if (!lines.length) continue;
    const date = isDate(s.date) && +s.date.slice(0, 4) >= 2000 && s.date <= addDays(today, 366) ? s.date : today;
    const paid = num(s.paid);
    out.push({ on: true, date, noDate: !isDate(s.date), customer: String(s.customer || "").trim().slice(0, 40), phone: digits(s.phone).slice(0, 15), town: String(s.town || "").trim().slice(0, 30), village: String(s.village || "").trim().slice(0, 30),
      customerId: "", lines, paid: paid != null && paid >= 0 ? r2(paid) : null, note: String(s.note || "").trim().slice(0, 120), flags });
  }
  return out;
}
function addDays(iso, n){ const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

/* ---------- 匹配 ---------- */
const norm = s => String(s || "").toLowerCase().replace(/[\s·.\-_()（）\[\]【】,，、/]/g, "");
/** 品种匹配：规范化后完全相同 → 选中；一个包含另一个（至少 2 个字）→ 选中；否则不猜，返回空 */
function matchBrand(text, brands){
  const n = norm(text); if (!n) return "";
  const exact = brands.find(b => norm(b.name) === n); if (exact) return exact.id;
  const hits = brands.filter(b => { const m = norm(b.name); return m.length >= 2 && n.length >= 2 && (m.includes(n) || n.includes(m)); });
  return hits.length === 1 ? hits[0].id : "";   // 有歧义就不选
}
/** 客户匹配：手机号相同 → 选中；姓名规范化后相同（且唯一）→ 选中；否则当新客户 */
function matchCustomer(name, phone, customers){
  const p = digits(phone);
  if (p.length >= 7) { const hit = customers.find(c => digits(c.phone) === p); if (hit) return hit.id; }
  const n = norm(name); if (!n) return "";
  const hits = customers.filter(c => norm(c.name) === n);
  return hits.length === 1 ? hits[0].id : "";
}
/** 给草稿填上匹配到的客户和品种，并标出可能重复的（同客户、同一天、同样的品种和数量已经有一笔） */
function resolveDrafts(drafts, { customers, brands, sales }){
  for (const d of drafts) {
    d.customerId = matchCustomer(d.customer, d.phone, customers);
    for (const l of d.lines) l.brandId = matchBrand(l.brandText, brands);
    d.dup = !!d.customerId && sales.some(s => s.status !== "void" && s.customerId === d.customerId && s.date === d.date && sameLines(s.lines, d.lines));
    if (d.dup) d.on = false;   // 疑似重复的默认不勾，防止同一张单导入两次
  }
  return drafts;
}
const sig = ls => ls.map(l => `${l.brandId}:${r2(l.qty)}`).sort().join("|");
const sameLines = (a, b) => b.every(l => l.brandId) && sig(a) === sig(b);

/* ---------- 汇总、方式、校验 ---------- */
const totalOf = d => r2(d.lines.reduce((a, l) => a + (+l.qty || 0) * (+l.price || 0), 0));
/** 收款情况 → 售卖方式：没收 = 赊账；收齐 = 当场结清；否则付定金 */
function modeFor(paid, total){ const p = +paid || 0; return p <= 0.005 ? "credit" : p >= total - 0.005 ? "cash" : "partial"; }
/** 导入前校验：返回错误数组（空 = 可以导入）。只检查勾选的草稿 */
function validateDrafts(drafts){
  const errs = [];
  drafts.forEach((d, i) => {
    if (!d.on) return;
    const at = i + 1;
    if (!d.customerId && !d.customer.trim()) errs.push({ i, key: "customer", at });
    if (!isDate(d.date)) errs.push({ i, key: "date", at });
    d.lines.forEach(l => { if (!l.brandId) errs.push({ i, key: "brand", at, text: l.brandText }); else if (!(l.qty > 0)) errs.push({ i, key: "qty", at }); else if (l.price == null || l.price < 0) errs.push({ i, key: "price", at }); });
    if (d.paid != null && d.paid > totalOf(d) + 0.005) errs.push({ i, key: "paid", at });
  });
  return errs;
}

export { SYSTEM, userPrompt, lenientJson, normalizeAi, matchBrand, matchCustomer, resolveDrafts, totalOf, modeFor, validateDrafts, JIN };
