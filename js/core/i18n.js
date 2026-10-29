/* ============ 界面语言、币种、单位 ============
   约定（同姊妹站点）：源码里的界面文字一律写简体中文并用 t("…") 包起来，简体就是字典的键。
   · English 查 data/i18n-en.js，查不到原样显示简体，不报错。 · 繁體先换词（TW_PHRASES）再按字表逐字转换。
   · 用户自己录入的内容（客户名、品种名……）原样显示；内置的季节名（早稻 / 一晚 / 二晚）走 t()，改名后就是用户自己的文字。

   币种和单位：数据永远以「人民币、斤」存储；录入框也固定是 ¥ 和斤（避免来回换算产生误差）。
   显示（列表、报表、导出、打印）按偏好换算：简体 / 繁體默认 ¥ + 斤；English 默认美元（按设置里的汇率）+ 斤，单位可改 kg / lb。 */
import { LS_PREFIX } from "../config.js";
import { s2tChars } from "../data/s2t.js";
import { EN } from "../data/i18n-en.js";

const LOCALES = [["zh-CN", "简体"], ["zh-TW", "繁體"], ["en", "English"]];
const KEY = LS_PREFIX + ".locale";
let cur = "zh-CN";
try { const v = localStorage.getItem(KEY); if (v && LOCALES.some(l => l[0] === v)) cur = v; else if (/^zh-(TW|HK)/i.test(navigator.language)) cur = "zh-TW"; else if (!/^zh/i.test(navigator.language)) cur = "en"; } catch (e) {}

const TW_PHRASES = [["数据库", "資料庫"], ["服务器", "伺服器"], ["设置", "設定"], ["默认", "預設"], ["网络", "網路"], ["软件", "軟體"], ["登录", "登入"], ["账号", "帳號"], ["信息", "資訊"],
  ["界面", "介面"], ["支持", "支援"], ["链接", "連結"], ["邮箱", "電子郵件"], ["密码", "密碼"], ["退出", "登出"], ["保存", "儲存"], ["打印", "列印"], ["导出", "匯出"], ["导入", "匯入"],
  ["云端", "雲端"], ["质量", "品質"], ["屏幕", "螢幕"], ["注册", "註冊"], ["搜索", "搜尋"], ["复制", "複製"], ["日历", "日曆"], ["软件", "軟體"], ["合伙人", "合夥人"], ["库存", "庫存"],
  ["账务", "帳務"], ["账", "帳"], ["赊账", "賒帳"], ["催账", "討帳"], ["发票", "發票"]].sort((a, b) => b[0].length - a[0].length);
const twCache = new Map();
function s2t(s){
  s = String(s); if (twCache.has(s)) return twCache.get(s);
  let o = s; for (const [a, b] of TW_PHRASES) if (o.includes(a)) o = o.split(a).join(b);
  o = s2tChars(o); twCache.set(s, o); return o;
}
/** 英文模式下查不到译文的中文词（排查漏译用：在控制台 import("/js/core/i18n.js").then(m => m.missingKeys())） */
const MISSING = new Set();
const missingKeys = () => [...MISSING];
function t(key, vars){
  let s = String(key);
  if (cur === "en") { const v = EN[s]; if (v != null) s = v; else if (/[一-鿿]/.test(s)) MISSING.add(s); } else if (cur === "zh-TW") s = s2t(s);
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
const locale = () => cur;
function setLocale(l){ if (!LOCALES.some(x => x[0] === l)) return; cur = l; try { localStorage.setItem(KEY, l); } catch (e) {} applyLang(); }
function applyLang(){ document.documentElement.lang = cur; document.title = t("稻种账本"); }

/* ---- 币种 / 单位 ---- */
const P = { currency: "", fx: 0.14, unit: "jin" };   // currency 空 = 跟随语言；fx = 1 人民币兑多少美元
const setPrefs = o => Object.assign(P, o);
const currency = () => P.currency || (cur === "en" ? "USD" : "CNY");
const CUR = { CNY: { rate: () => 1, sym: "¥" }, USD: { rate: () => P.fx, sym: "$" } };
const UNITS = { jin: { f: 1, zh: "斤", en: "jin" }, kg: { f: 0.5, zh: "公斤", en: "kg" }, lb: { f: 1.10231, zh: "磅", en: "lb" } };
const unitLabel = () => { const u = UNITS[P.unit] || UNITS.jin; return cur === "en" ? u.en : cur === "zh-TW" ? s2t(u.zh) : u.zh; };

function money(cny, { sign = false, digits } = {}){
  const c = CUR[currency()] || CUR.CNY, v = (+cny || 0) * c.rate();
  const d = digits ?? (Math.abs(v) >= 1000 ? 0 : 2);
  const s = c.sym + Math.abs(v).toLocaleString(cur === "en" ? "en-US" : "zh-CN", { minimumFractionDigits: d === 0 ? 0 : 2, maximumFractionDigits: d });
  return v < -0.004 ? "-" + s : sign && v > 0.004 ? "+" + s : s;
}
const qty = jin => ((+jin || 0) * (UNITS[P.unit] || UNITS.jin).f).toLocaleString("en-US", { maximumFractionDigits: 1 }) + " " + unitLabel();
const unitPrice = cnyPerJin => money(cnyPerJin / (UNITS[P.unit] || UNITS.jin).f, { digits: 2 }) + "/" + unitLabel();
/** 导出 CSV 用：按当前显示的币种 / 单位换算成纯数字 */
const moneyNum = cny => Math.round((+cny || 0) * (CUR[currency()] || CUR.CNY).rate() * 100) / 100;
const qtyNum = jin => Math.round((+jin || 0) * (UNITS[P.unit] || UNITS.jin).f * 10) / 10;
const pct = n => (+n || 0).toFixed(1).replace(/\.0$/, "") + "%";
const dateFmt = d => !d ? "" : cur === "en" ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : d;

applyLang();
export { missingKeys, LOCALES, t, locale, setLocale, setPrefs, currency, money, moneyNum, qtyNum, qty, unitPrice, unitLabel, pct, dateFmt, UNITS, P as prefs };
