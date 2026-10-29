/* ============ 扫描 / 导入销售记录 ============
   拍单据、选照片 / PDF / Excel / CSV、或粘贴文字 → AI 读成销售草稿 → 逐笔核对（客户、品种、数量、单价、收款都能改）→ 才入库。
   和爱家小助手「拍小票识别花费」同一套做法：先同意再发、不保存原图、识别结果只是草稿、疑似重复的默认不勾。
   手抄本历史数据也走这里：拍一页，一页上有几位客户就读成几笔。
   隐私：单据上的客户姓名、电话会发给你在「更多 → AI 助手」里选的服务商（这是识别客户的前提）；邮箱、长数字串（身份证 / 银行卡）发送前已抹掉。 */
import { S, save, live } from "../core/state.js";
import { esc, today, toast } from "../core/util.js";
import { t, money, qty, dateFmt } from "../core/i18n.js";
import { LS_PREFIX } from "../config.js";
import { askText, aiReady, aiSettings, providerOf } from "../core/ai.js";
import { readAnyFile, chunkText, redactSensitive, ACCEPT } from "../core/file-readers.js";
import { SYSTEM, userPrompt, lenientJson, normalizeAi, resolveDrafts, totalOf, modeFor, validateDrafts } from "../logic/scan-import.js";
import { model, byId, sortBy } from "./common.js";
import { show, back, closeAll, refresh, badge, btn } from "./kit.js";
import { ACT, CHG, INP } from "./actions.js";

const CONSENT = LS_PREFIX + ".scan-ok", MAX_FILES = 8, MAX_IMAGES = 6, MAX_CHUNKS = 8, MAX_DRAFTS = 200;
const sc = { files: [], text: "", busy: false, reading: 0, error: "", drafts: null };
const consent = () => { try { return localStorage.getItem(CONSENT) === "1"; } catch (e) { return false; } };
const reset = () => Object.assign(sc, { files: [], text: "", busy: false, reading: 0, error: "", drafts: null });
let askFn = askText;   // 测试时可替换
export const _setAsk = fn => { askFn = fn || askText; };

/* ---------- 页面 ---------- */
function scanPage(){
  return { title: t("扫描 / 导入销售"), body: sc.drafts ? reviewBody() : inputBody(), foot: sc.drafts ? reviewFoot() : inputFoot() };
}
function inputBody(){
  const ready = aiReady(), p = providerOf(aiSettings().provider);
  const files = sc.files.map((f, i) => `<li class="scan-file">${f.images?.[0]?.url ? `<img src="${f.images[0].url}" alt="">` : `<span class="scan-ico" aria-hidden="true">📄</span>`}
    <span class="row-main"><b>${esc(f.name)}</b><small>${esc(f.images ? t("{n} 张图", { n: f.images.length }) : t("{n} 个字", { n: f.text.length }))}</small></span>
    <button type="button" class="x sm" data-act="scan-file-del" data-i="${i}" aria-label="${esc(t("移除这个文件"))}">×</button></li>`).join("");
  return `<p class="hint">${esc(t("销售单、送货单、手抄账本的一页、客户对账表、微信 / 支付宝收款截图都行。识别出来先是草稿，你核对后才入库。"))}</p>
    ${ready ? "" : `<div class="banner warn"><span>${esc(t("需要先设置 AI（用你自己的 key）。"))}</span><button type="button" class="btn sm primary" data-act="open-ai">${esc(t("设置 AI"))}</button></div>`}
    <div class="actions"><label class="btn">${esc(t("📷 拍照"))}<input type="file" accept="image/*" capture="environment" data-change="scan-files" hidden></label>
      <label class="btn">${esc(t("📁 选文件 / 相册"))}<input type="file" accept="${ACCEPT}" multiple data-change="scan-files" hidden></label></div>
    <p class="hint">${esc(t("支持：图片、PDF、Excel（xlsx / xls）、CSV / 文本。最多 {n} 个。", { n: MAX_FILES }))}</p>
    ${sc.reading ? `<p class="hint" role="status">${esc(t("正在读取文件…"))}</p>` : ""}
    ${files ? `<ul class="list tight">${files}</ul>` : ""}
    <label class="fld"><span>${esc(t("或粘贴文字（聊天记录、记账文字、表格内容）"))}</span><textarea rows="4" maxlength="20000" data-input="scan-text">${esc(sc.text)}</textarea></label>
    <label class="chk"><input type="checkbox" data-change="scan-consent" ${consent() ? "checked" : ""}><span>${esc(t("我同意把这些图片 / 文字（包含单据上的客户姓名、电话）发给 {p}。不保存原图。", { p: t(p.name) }))}</span></label>
    <p class="hint">${esc(t("邮箱和长数字串（身份证、银行卡）发送前会自动抹掉。拍之前可以遮住不需要的信息。"))}</p>
    ${sc.error ? `<p class="neg" role="alert">${esc(sc.error)}</p>` : ""}`;
}
const canRun = () => aiReady() && consent() && !sc.busy && !sc.reading && (sc.files.length || sc.text.trim());
const inputFoot = () => `<button class="btn" data-act="close">${esc(t("取消"))}</button><button class="btn primary" data-act="scan-run" ${canRun() ? "" : "disabled"}>${esc(sc.busy ? t("正在识别…（几十秒）") : t("识别"))}</button>`;

const customerOpts = () => sortBy(live("customer"), c => c.name).map(c => `<option value="${esc(c.id)}">${esc(c.name)}${c.town ? " · " + esc(c.town) : ""}</option>`).join("");
const brandOpts = () => S.settings.seasons.map(s => { const bs = sortBy(live("brand").filter(b => b.seasonId === s.id && b.active !== false), b => b.name); return bs.length ? `<optgroup label="${esc(t(s.name))}">${bs.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")}</optgroup>` : ""; }).join("");
const selected = (html, v) => html.replace(`value="${esc(v)}"`, `value="${esc(v)}" selected`);

function reviewBody(){
  const on = sc.drafts.filter(d => d.on).length, cOpts = customerOpts(), bOpts = brandOpts();
  return `<p class="hint">${esc(t("共读到 {n} 笔，已勾选 {m} 笔。逐笔核对，不对的直接改；不想导入的取消勾选。", { n: sc.drafts.length, m: on }))}</p>
    ${sc.error ? `<p class="neg" role="alert">${esc(sc.error)}</p>` : ""}
    ${sc.drafts.map((d, i) => `<div class="card scan-d ${d.on ? "" : "off"}">
      <div class="card-head"><label class="chk" style="margin:0"><input type="checkbox" data-change="scan-on" data-i="${i}" ${d.on ? "checked" : ""}> <b>${esc(t("第 {n} 笔", { n: i + 1 }))}</b></label><b data-total="${i}">${esc(money(totalOf(d)))}</b></div>
      ${d.dup ? `<p class="hint warn">${esc(t("疑似重复：已有一笔同客户、同一天、同品种数量的销售，所以默认没勾选。"))}</p>` : ""}
      ${d.noDate ? `<p class="hint warn">${esc(t("没读到日期，先用了今天，请改成单据上的日期。"))}</p>` : ""}
      ${d.flags.filter(f => f.startsWith("unit:")).map(f => `<p class="hint warn">${esc(t("不认识的单位「{u}」，数量先按斤算，请核对。", { u: f.slice(5) }))}</p>`).join("")}
      <div class="grid2"><label class="fld"><span>${esc(t("日期"))}</span><input type="date" value="${esc(d.date)}" data-input="scan-d" data-i="${i}" data-k="date"></label>
        <label class="fld"><span>${esc(t("本次已收（¥）"))}</span><input type="number" step="any" min="0" value="${d.paid ?? ""}" placeholder="${esc(t("没写 = 0"))}" data-input="scan-d" data-i="${i}" data-k="paid"></label></div>
      <label class="fld"><span>${esc(t("客户"))}</span><select data-change="scan-cust" data-i="${i}"><option value="">${esc(t("＋ 新客户：{n}", { n: d.customer || t("（没读到姓名）") }))}</option>${d.customerId ? selected(cOpts, d.customerId) : cOpts}</select></label>
      ${d.customerId ? "" : `<div class="grid2"><label class="fld"><span>${esc(t("姓名"))}</span><input type="text" value="${esc(d.customer)}" maxlength="40" data-input="scan-d" data-i="${i}" data-k="customer"></label>
        <label class="fld"><span>${esc(t("电话"))}</span><input type="tel" value="${esc(d.phone)}" inputmode="tel" maxlength="20" data-input="scan-d" data-i="${i}" data-k="phone"></label>
        <label class="fld"><span>${esc(t("镇"))}</span><input type="text" value="${esc(d.town)}" maxlength="30" data-input="scan-d" data-i="${i}" data-k="town"></label>
        <label class="fld"><span>${esc(t("村"))}</span><input type="text" value="${esc(d.village)}" maxlength="30" data-input="scan-d" data-i="${i}" data-k="village"></label></div>`}
      ${d.lines.map((l, j) => `<div class="sline"><label class="fld"><span>${esc(l.brandText ? t("品种（单据上写的：{x}）", { x: l.brandText }) : t("品种"))}</span>
          <select data-change="scan-brand" data-i="${i}" data-l="${j}"><option value="">${esc(t("— 选品种（没有的话先到 库存 → 品种与价格 添加）—"))}</option>${l.brandId ? selected(bOpts, l.brandId) : bOpts}</select></label>
        <div class="grid2"><label class="fld"><span>${esc(t("数量（斤）"))}</span><input type="number" step="any" min="0" value="${l.qty}" data-input="scan-d" data-i="${i}" data-l="${j}" data-k="qty"></label>
          <label class="fld"><span>${esc(t("单价（¥/斤）"))}</span><input type="number" step="any" min="0" value="${l.price ?? ""}" data-input="scan-d" data-i="${i}" data-l="${j}" data-k="price"></label></div>
        ${l.note ? `<small>${esc(t("单据上写的：{x}", { x: l.note }))}</small>` : ""}</div>`).join("")}
      <label class="fld"><span>${esc(t("备注"))}</span><input type="text" value="${esc(d.note)}" maxlength="120" data-input="scan-d" data-i="${i}" data-k="note"></label></div>`).join("")}`;
}
const reviewFoot = () => { const n = sc.drafts.filter(d => d.on).length;
  return `<button class="btn" data-act="scan-back">${esc(t("返回重新识别"))}</button><button class="btn primary" data-act="scan-import" ${n ? "" : "disabled"}>${esc(t("导入 {n} 笔", { n }))}</button>`; };

/* ---------- 事件 ---------- */
ACT["scan-open"] = () => { reset(); show(scanPage, true); };
ACT["scan-back"] = () => { sc.drafts = null; sc.error = ""; };
ACT["scan-file-del"] = el => { sc.files.splice(+el.dataset.i, 1); };
INP["scan-text"] = el => { sc.text = el.value; const b = document.querySelector('#sheet [data-act="scan-run"]'); if (b) b.disabled = !canRun(); };
CHG["scan-consent"] = el => { try { localStorage.setItem(CONSENT, el.checked ? "1" : "0"); } catch (e) { /* 忽略 */ } };
CHG["scan-files"] = async el => {
  const list = [...el.files]; el.value = ""; if (!list.length) return;
  sc.error = ""; sc.reading++; refresh();
  for (const f of list) {
    if (sc.files.length >= MAX_FILES) { sc.error = t("最多 {n} 个文件。", { n: MAX_FILES }); break; }
    try { sc.files.push(await readAnyFile(f)); } catch (e) { sc.error = `${f.name}：${e.message}`; }
  }
  sc.reading--;
};
CHG["scan-on"] = el => { sc.drafts[+el.dataset.i].on = el.checked; };
CHG["scan-cust"] = el => { sc.drafts[+el.dataset.i].customerId = el.value; };
CHG["scan-brand"] = el => { sc.drafts[+el.dataset.i].lines[+el.dataset.l].brandId = el.value; };
const NUM = new Set(["paid", "qty", "price"]);
INP["scan-d"] = el => {   // 输入时只改数据，不重画（免得输入到一半丢焦点）
  const d = sc.drafts[+el.dataset.i], k = el.dataset.k, v = NUM.has(k) ? (el.value === "" ? null : +el.value) : el.value;
  if (el.dataset.l != null) d.lines[+el.dataset.l][k] = v; else d[k] = v;
  if (k === "date") d.noDate = false;
  const tot = document.querySelector(`#sheet [data-total="${el.dataset.i}"]`); if (tot) tot.textContent = money(totalOf(d));
};

/* ---------- 识别 ---------- */
async function recognize(){
  const brands = live("brand").map(b => b.name), day = today();
  const images = sc.files.flatMap(f => f.images || []).slice(0, MAX_IMAGES);
  const text = [sc.text, ...sc.files.filter(f => f.text).map(f => `# ${f.name}\n${f.text}`)].filter(x => x && x.trim()).join("\n\n");
  const parts = [];
  if (images.length) parts.push({ text: "", images });
  for (const c of chunkText(redactSensitive(text), 7000).slice(0, MAX_CHUNKS)) if (c.trim()) parts.push({ text: c, images: [] });
  const drafts = [];
  for (const p of parts) {
    const raw = await askFn(SYSTEM, userPrompt({ today: day, brands, text: p.text, imageCount: p.images.length }), { json: true, images: p.images, temperature: 0.1, maxTokens: 6000 });
    let json; try { json = lenientJson(raw); } catch (e) { throw new Error(t("没能读出内容，换一张更清楚的图，或补充文字再试。")); }
    drafts.push(...normalizeAi(json, { today: day }));
  }
  if (!drafts.length) throw new Error(t("没读到销售记录。换一张更清楚的图，或补充文字再试。"));
  return resolveDrafts(drafts.slice(0, MAX_DRAFTS), { customers: live("customer"), brands: live("brand"), sales: model().sales });
}
ACT["scan-run"] = async () => {
  if (!canRun()) return;
  sc.error = ""; sc.busy = true; refresh();
  try { sc.drafts = await recognize(); } catch (e) { sc.error = e.message || String(e); }
  sc.busy = false;
};

/* ---------- 导入 ---------- */
const problem = e => ({
  customer: t("第 {at} 笔：缺客户姓名", e), date: t("第 {at} 笔：日期不对", e), qty: t("第 {at} 笔：数量要大于 0", e), price: t("第 {at} 笔：缺单价", e),
  paid: t("第 {at} 笔：已收超过了货款", e), brand: t("第 {at} 笔：「{text}」还没选品种（没有的话先到 库存 → 品种与价格 添加）", { at: e.at, text: e.text || "—" })
}[e.key]);
ACT["scan-import"] = async () => {
  const errs = validateDrafts(sc.drafts);
  if (errs.length) { sc.error = problem(errs[0]) + (errs.length > 1 ? " " + t("（还有 {n} 处）", { n: errs.length - 1 }) : ""); return; }
  const picked = sc.drafts.filter(d => d.on); if (!picked.length) { sc.error = t("没有勾选要导入的记录"); return; }
  const counts = {}; for (const s of model().sales) counts[s.year] = (counts[s.year] || 0) + 1;
  const made = new Map(); let n = 0;
  for (const d of picked) {
    let customerId = d.customerId;
    if (!customerId) {
      const key = `${d.customer.trim()}|${d.phone}`;
      if (!made.has(key)) made.set(key, (await save("customer", { name: d.customer.trim(), phone: d.phone, town: d.town, village: d.village })).id);
      customerId = made.get(key);
    }
    const year = +d.date.slice(0, 4); counts[year] = (counts[year] || 0) + 1;
    const total = totalOf(d), paid = Math.min(d.paid ?? 0, total);
    const sale = await save("sale", { no: `${year}-${String(counts[year]).padStart(3, "0")}`, date: d.date, customerId, mode: modeFor(paid, total),
      lines: d.lines.map(l => ({ brandId: l.brandId, qty: l.qty, price: l.price })), delivery: { type: "pickup" }, note: d.note, source: "scan", status: "active" });
    if (paid > 0) await save("pay", { saleId: sale.id, date: d.date, amount: paid, method: "cash", note: t("扫描导入") });
    n++;
  }
  const years = [...new Set(picked.map(d => +d.date.slice(0, 4)))].sort();
  reset(); closeAll();
  S.filters.year = years[years.length - 1]; S.tab = "sales"; S.sub.sales = "list";   // 跳到销售单，并切到刚导入的那一年
  toast(t("已导入 {n} 笔销售", { n }));
};

export { scanPage, sc as _state };
