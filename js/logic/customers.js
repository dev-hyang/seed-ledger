/* ============ 客户的唯一标识：手机号（纯函数，有测试） ============
   同名客户很常见，所以客户靠「手机号」区分，不靠名字：
   · 新建客户必须填手机号；同一个手机号不能建两个客户（填了已有的号码就直接用那位客户）；
   · 手机号比较前先规范化：只留数字、去掉 +86 / 86 前缀，所以 189-0019-2299 和 +86 18900192299 是同一个；
   · 老数据里没填手机号的客户照常能用，但在列表里会提示补上；
   · 客户的「小卡片」写成：客户名 · 镇村 · 手机号（默认遮住中间 4 位，留前 3 后 4，足够区分同名）。 */

const digits = s => String(s || "").replace(/\D/g, "");

/** 规范化手机号：只留数字；11 位以上且以 86 开头的当作带国家码，去掉 */
function phoneKey(p){
  const d = digits(p);
  return d.length > 11 && d.startsWith("86") ? d.slice(2) : d;
}
const validPhone = p => { const n = phoneKey(p).length; return n >= 7 && n <= 15; };

/** 在已有客户里找这个手机号；exceptId = 正在编辑的那位，不和自己比 */
function findByPhone(customers, phone, exceptId){
  const k = phoneKey(phone); if (!k) return null;
  return customers.find(c => c.id !== exceptId && phoneKey(c.phone) === k) || null;
}
const maskPhone = p => { const s = String(p || ""); return s.length >= 7 ? s.slice(0, 3) + "****" + s.slice(-4) : s; };
const placeOf = c => [c.town, c.village].filter(Boolean).join("");

/** 客户小卡片的一行：客户名 · 镇村 · 手机号（没手机号写「未填手机号」，提醒补上）。mask = 遮住中间 4 位 */
function customerLabel(c, { mask = true, noPhone = "未填手机号" } = {}){
  return [c.name, placeOf(c), c.phone ? (mask ? maskPhone(c.phone) : c.phone) : noPhone].filter(Boolean).join(" · ");
}
/** 同名客户（用来在名字后面补一个「同名」提示） */
const sameNameCount = (customers, c) => customers.filter(x => x.id !== c.id && String(x.name).trim() === String(c.name).trim()).length;

export { phoneKey, validPhone, findByPhone, maskPhone, placeOf, customerLabel, sameNameCount };
