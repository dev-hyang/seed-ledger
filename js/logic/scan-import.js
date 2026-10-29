/* ============ 扫描 / 导入销售记录的核心逻辑（纯函数，有测试） ============
   流程：图片 / PDF / Excel / CSV / 文字 → AI 读成「销售草稿」→ 本地清洗（日期、单位、金额）→ 匹配已有客户和品种 → 用户核对 → 才入库。
   AI 的话一律当不可信：日期、数量、金额、单位都在这里重新校验；认不出的品种不乱猜。
   单据上出现了库里没有的客户 / 品种时，不是报错让用户回头去建，而是在核对页直接补全（新品种要选种子公司、季节，价格可改），
   导入时 planImport 先排好顺序：种子公司 → 品种和价格 → 客户 → 销售，全部校验通过才开始写，避免写到一半失败。
   手抄本历史数据也走这条路：一页上有好几位客户，就会读成好几笔销售草稿。 */
import { r2 } from "./ledger.js";
import { priceOf, tierOf } from "./pricing.js";
import { phoneKey, validPhone } from "./customers.js";

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

/** AI 返回 → 销售草稿数组。每个草稿：{ on, date, noDate, customer, phone, town, village, lines:[{ brandText, brandId, nb, qty, price, note }], paid, note, flags:[] } */
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
      lines.push({ brandText: String(l.brand || "").trim().slice(0, 60), brandId: "", nb: null, qty, price, note: f == null ? String(l.unit) : unit && f !== 1 ? `${qtyRaw}${l.unit}` : "" });
    }
    if (!lines.length) continue;
    const date = isDate(s.date) && +s.date.slice(0, 4) >= 2000 && s.date <= addDays(today, 366) ? s.date : today;
    const paid = num(s.paid);
    out.push({ on: true, date, noDate: !isDate(s.date), customer: String(s.customer || "").trim().slice(0, 40), phone: digits(s.phone).slice(0, 15), town: String(s.town || "").trim().slice(0, 30), village: String(s.village || "").trim().slice(0, 30),
      customerId: "", tier: "retail", lines, paid: paid != null && paid >= 0 ? r2(paid) : null, note: String(s.note || "").trim().slice(0, 120), flags });
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
  const p = phoneKey(phone);
  if (validPhone(phone)) { const hit = customers.find(c => phoneKey(c.phone) === p); if (hit) return hit.id; }   // 手机号相同 = 同一位客户（格式不同也算）
  const n = norm(name); if (!n) return "";
  const hits = customers.filter(c => norm(c.name) === n);
  return hits.length === 1 ? hits[0].id : "";
}

/* ---------- 新品种：单据上有、库里没有 ---------- */
/** 单据上写了季节名（早稻 / 一晚 / 二晚 或自定义的）就用它；否则用第一个季节，用户可改 */
function guessSeason(text, seasons){ const hit = seasons.find(s => s.name && String(text).includes(s.name)); return (hit || seasons[0] || {}).id || ""; }
/** 新品种草稿：名称取单据上写的；零售价取单据上的单价；批发价、进货价留空。种子公司一律不自动选（归属错了会直接影响各公司盈亏报表），必须用户确认 */
function newBrandSpec(line, { seasons = [] } = {}){
  return { name: line.brandText || "", seasonId: guessSeason(line.brandText, seasons), supplierId: "", supplierName: "", buy: null, retail: line.price ?? null, wholesale: null };
}

/** 给草稿填上：匹配到的客户和品种（认不出的变成新品种草稿）、该客户的价格档、缺的单价按价格档补；并标出可能重复的（同客户、同一天、同样的品种和数量已有一笔）
    ctx: { customers, brands, sales, seasons?, suppliers?, priceFor?(brandId, year, tier) } */
function resolveDrafts(drafts, ctx){
  const { customers, brands, sales, seasons = [], suppliers = [] } = ctx;
  const shared = new Map();   // 同名的新品种（多笔销售里都出现）共用一份设置：填一次就够
  for (const d of drafts) {
    d.customerId = matchCustomer(d.customer, d.phone, customers);
    d.tier = tierOf(customers.find(c => c.id === d.customerId)?.tier);
    for (const l of d.lines) {
      l.brandId = matchBrand(l.brandText, brands);
      const k = norm(l.brandText);
      if (l.brandId) l.nb = null;
      else if (k && shared.has(k)) l.nb = shared.get(k);
      else { l.nb = newBrandSpec(l, { seasons, suppliers }); if (k) shared.set(k, l.nb); }
      if (l.brandId && l.price == null && ctx.priceFor) { const p = ctx.priceFor(l.brandId, +d.date.slice(0, 4), d.tier); if (p > 0) { l.price = p; l.note = l.note || "price:tier"; } }
    }
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
/** 导入前校验：返回错误数组（空 = 可以导入）。只检查勾选的草稿。新品种要名称、季节、种子公司（选已有的，或填新公司的名称） */
function validateDrafts(drafts){
  const errs = [];
  drafts.forEach((d, i) => {
    if (!d.on) return;
    const at = i + 1;
    if (!d.customerId && !d.customer.trim()) errs.push({ i, key: "customer", at });
    if (!isDate(d.date)) errs.push({ i, key: "date", at });
    d.lines.forEach(l => {
      if (!l.brandId && !l.nb) errs.push({ i, key: "brand", at, text: l.brandText });
      else if (!l.brandId) {
        const nb = l.nb, text = nb.name || l.brandText;
        if (!nb.name.trim()) errs.push({ i, key: "nbName", at });
        else if (!nb.seasonId) errs.push({ i, key: "nbSeason", at, text });
        else if (!nb.supplierId && !nb.supplierName.trim()) errs.push({ i, key: "nbSupplier", at, text });
      }
      if (!(l.qty > 0)) errs.push({ i, key: "qty", at });
      else if (l.price == null || l.price < 0) errs.push({ i, key: "price", at });
    });
    if (d.paid != null && d.paid > totalOf(d) + 0.005) errs.push({ i, key: "paid", at });
  });
  return errs;
}

/** 导入计划（先校验过再调用）：按依赖顺序列出要建的东西，引用用 { id } 指已有的、{ key } 指本次新建的。
    顺序：种子公司 → 品种（带价格档价格）→ 客户 → 销售。同名的新种子公司 / 新品种 / 新客户只建一次。
    ctx: { counts: { 年: 该年已有销售数 }, suppliers: 已有种子公司 }，用来编号和避免重名建公司 */
function planImport(drafts, ctx){
  const picked = drafts.filter(d => d.on);
  const counts = { ...(ctx.counts || {}) }, existingSup = ctx.suppliers || [];
  const suppliers = [], brands = [], customers = [], sales = [];
  const supKeys = new Map(), brandKeys = new Map(), custKeys = new Map();
  const supplierRef = nb => {
    if (nb.supplierId) return { id: nb.supplierId };
    const name = nb.supplierName.trim(), k = norm(name), exist = existingSup.find(s => norm(s.name) === k);
    if (exist) return { id: exist.id };
    if (!supKeys.has(k)) { supKeys.set(k, `s:${k}`); suppliers.push({ key: `s:${k}`, name }); }
    return { key: supKeys.get(k) };
  };
  for (const d of picked) {
    const year = +d.date.slice(0, 4);
    let customer;
    if (d.customerId) customer = { id: d.customerId };
    else {
      const k = validPhone(d.phone) ? "p:" + phoneKey(d.phone) : "n:" + norm(d.customer);   // 有手机号按手机号去重，没有才按名字
      if (!custKeys.has(k)) { custKeys.set(k, `c:${k}`); customers.push({ key: `c:${k}`, name: d.customer.trim(), phone: d.phone, town: d.town, village: d.village, tier: d.tier }); }
      customer = { key: custKeys.get(k) };
    }
    const lines = d.lines.map(l => {
      if (l.brandId) return { brand: { id: l.brandId }, qty: l.qty, price: l.price };
      const nb = l.nb, k = norm(nb.name);
      if (!brandKeys.has(k)) {
        brandKeys.set(k, `b:${k}`);
        brands.push({ key: `b:${k}`, name: nb.name.trim(), seasonId: nb.seasonId, supplier: supplierRef(nb), buy: nb.buy, retail: nb.retail ?? l.price, wholesale: nb.wholesale, year });
      } else { const b = brands.find(x => x.key === brandKeys.get(k)); b.year = Math.min(b.year, year); }   // 价格从最早用到它的那年起生效
      return { brand: { key: brandKeys.get(k) }, qty: l.qty, price: l.price };
    });
    counts[year] = (counts[year] || 0) + 1;
    const total = totalOf(d), paid = Math.min(d.paid ?? 0, total);
    sales.push({ no: `${year}-${String(counts[year]).padStart(3, "0")}`, date: d.date, customer, lines, mode: modeFor(paid, total), tier: d.tier, note: d.note, paid, total });
  }
  return { suppliers, brands, customers, sales };
}

export { SYSTEM, userPrompt, lenientJson, normalizeAi, matchBrand, matchCustomer, newBrandSpec, guessSeason, resolveDrafts, totalOf, modeFor, validateDrafts, planImport, JIN, priceOf };
