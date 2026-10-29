/* ============ 界面小零件：弹层（带返回栈）、表单字段、徽标 ============
   弹层用 show(fn, live)：fn() 返回 { title, body, foot }。live=true 的详情页会在数据变化后自动重画；表单页不重画（免得输入到一半被刷掉）。
   弹层里点「返回」回到上一层（例如：客户 → 某张销售单 → 收款表单，逐层退回）。 */
import { $, esc } from "../core/util.js";
import { t } from "../core/i18n.js";

const stack = [];
const dlg = () => $("#sheet");

function paint(){
  const top = stack[stack.length - 1], d = dlg();
  if (!top) { if (d.open) d.close(); return; }
  const { title, body, foot } = top.fn(), keep = d.querySelector(".sheet-body")?.scrollTop || 0;
  d.innerHTML = `<div class="sheet-in"><div class="sheet-head">${stack.length > 1 ? `<button class="x" data-act="back" aria-label="${esc(t("返回"))}">‹</button>` : ""}<h2 id="sheetTitle">${esc(title)}</h2><button class="x" data-act="close" aria-label="${esc(t("关闭"))}">×</button></div>
    <div class="sheet-body">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ""}</div>`;
  if (!d.open) d.showModal();
  d.querySelector(".sheet-body").scrollTop = top.live ? keep : 0;
}
const show = (fn, live = false) => { stack.push({ fn, live }); paint(); };
const back = () => { stack.pop(); paint(); };
const closeAll = () => { stack.length = 0; paint(); };
const replace = fn => { stack[stack.length - 1] = { fn, live: false }; paint(); };   // 当前这一层换成新内容（向导的下一步 / 上一步用，不关闭再打开，不闪）
const refresh = () => { const top = stack[stack.length - 1]; if (top && top.live && dlg().open) paint(); };
const sheetOpen = () => dlg().open;

/* ---------- 表单字段 ---------- */
const fld = (label, inner, hint = "") => `<label class="fld"><span>${esc(t(label))}</span>${inner}${hint ? `<small>${hint}</small>` : ""}</label>`;
const attr = o => Object.entries(o).filter(([, v]) => v !== undefined && v !== false && v !== "").map(([k, v]) => v === true ? k : `${k}="${esc(v)}"`).join(" ");
const text = (name, v = "", o = {}) => `<input ${attr({ name, value: v ?? "", required: o.req, maxlength: o.max || 80, placeholder: o.ph ? t(o.ph) : "", autocomplete: "off", type: o.type || "text", inputmode: o.mode })}>`;
const num = (name, v = "", o = {}) => `<input ${attr({ name, type: "number", step: o.step || "any", min: o.min, inputmode: "decimal", value: v ?? "", required: o.req, placeholder: o.ph || "", "data-calc": o.calc })}>`;
const date = (name, v = "", o = {}) => `<input ${attr({ name, type: "date", value: v, required: o.req ?? true })}>`;
const area = (name, v = "", o = {}) => `<textarea ${attr({ name, rows: o.rows || 2, maxlength: 400, placeholder: o.ph ? t(o.ph) : "" })}>${esc(v ?? "")}</textarea>`;
/** opts: [[value, label]] 或 [{group, items:[[value,label]]}]；label 已翻译好，不再包 t() */
function select(name, opts, v = "", o = {}){
  const one = ([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v) ? "selected" : ""}>${esc(lab)}</option>`;
  const body = opts.map(x => x.group ? `<optgroup label="${esc(x.group)}">${x.items.map(one).join("")}</optgroup>` : one(x)).join("");
  return `<select ${attr({ name, required: o.req, "data-change": o.change })}>${o.blank === false ? "" : `<option value="">${esc(o.blank || t("— 请选择 —"))}</option>`}${body}</select>`;
}
const seg = (name, opts, v) => `<div class="seg" role="radiogroup">${opts.map(([val, lab]) => `<label><input type="radio" name="${name}" value="${esc(val)}" ${val === v ? "checked" : ""}><span>${esc(lab)}</span></label>`).join("")}</div>`;

/** 把 <form> 里的值取出来：number 转数字（空 = undefined），其余是字符串 */
function formData(form){
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === "radio") { if (el.checked) o[el.name] = el.value; continue; }
    if (el.type === "checkbox") { o[el.name] = el.checked; continue; }
    o[el.name] = el.type === "number" ? (el.value === "" ? undefined : +el.value) : el.value.trim();
  }
  return o;
}

/* ---------- 展示 ---------- */
const badge = (text_, kind = "") => `<span class="badge ${kind}">${esc(text_)}</span>`;
const empty = (msg, action = "") => `<div class="empty"><p>${esc(t(msg))}</p>${action}</div>`;
const btn = (label, act, o = {}) => `<button type="button" class="btn ${o.cls || ""}" data-act="${act}" ${Object.entries(o.data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ")} ${o.disabled ? "disabled" : ""}>${o.raw ? label : esc(t(label))}</button>`;
const kv = (k, v, cls = "") => `<div class="kv ${cls}"><span>${esc(t(k))}</span><b>${v}</b></div>`;

export { show, replace, back, closeAll, refresh, sheetOpen, paint, fld, text, num, date, area, select, seg, formData, badge, empty, btn, kv };

/* ---------- 二次确认（删除、作废） ---------- */
let yes = null;
function ask(title, msg, onYes, label = "确定"){
  yes = onYes;
  show(() => ({ title, body: `<p class="lead">${esc(msg)}</p>`, foot: `<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn danger" data-act="ask-yes">${esc(t(label))}</button>` }));
}
const askYes = async () => { const f = yes; yes = null; back(); if (f) await f(); };
export { ask, askYes };
