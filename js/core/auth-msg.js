/* ============ 登录 / 注册结果的解释（纯函数，有测试） ============
   「注册收不到邮件」在共用账号体系里有几种完全不同的原因，Supabase 返回的却都像成功：
   · 这个邮箱已经注册过（小月亮等姊妹应用共用同一套账号）：为防止探测邮箱，signUp 返回「成功」但 user.identities 是空数组，不发任何邮件 → 应该直接登录。
   · 发信被限流（内置发信服务额度很低）：返回 429 / over_email_send_rate_limit。
   · 邮箱没确认就登录：email_not_confirmed → 可以重发确认邮件。
   这里把它们翻译成人话，告诉用户下一步该做什么。 */
import { t } from "./i18n.js";

const RATE = /rate limit|too many|over_email_send_rate_limit/i;

function authMessage(error){
  if (!error) return "";
  const code = error.code || "", msg = error.message || "";
  if (error.status === 429 || RATE.test(code) || RATE.test(msg)) return t("发邮件太频繁，被限流了。过一会儿再试；如果你已经在小月亮等姊妹应用注册过，直接用同一个邮箱和密码登录即可。");
  if (code === "user_already_exists" || /already (been )?registered/i.test(msg)) return t("这个邮箱已经注册过了（姊妹应用共用同一个账号），请直接登录。");
  if (code === "email_not_confirmed" || /not confirmed/i.test(msg)) return t("这个邮箱还没确认：请点确认邮件里的链接，或点「重发确认邮件」。");
  if (code === "invalid_credentials" || /invalid login/i.test(msg)) return t("邮箱或密码不对。（小月亮等姊妹应用的账号也可以直接在这里登录）");
  if (code === "weak_password") return t("密码太简单，请换一个更长、更复杂的。");
  return msg;
}

/** signUp 的返回 → { kind, message }：error 出错 / exists 邮箱已注册（没发邮件）/ signed-in 已直接登录 / confirm 邮件已发出，等用户点链接 */
function signupOutcome(data, error, email = ""){
  if (error) return { kind: "error", message: t("注册失败：") + authMessage(error) };
  if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0)
    return { kind: "exists", message: t("这个邮箱已经注册过了，所以没有发新邮件。请直接用它登录（小月亮等姊妹应用共用同一个账号）；忘记密码的话先在小月亮里重置。") };
  if (data?.session) return { kind: "signed-in", message: t("注册成功") };
  return { kind: "confirm", message: t("确认邮件已发到 {email}。收不到的话：先看垃圾邮件箱；如果你在小月亮等应用注册过，直接用同一个邮箱和密码登录；还是没有，点「重发确认邮件」（太频繁会被限流，隔几分钟再试）。", { email }) };
}

/** 邮件里的链接跳回来时地址里带的错误（过期 / 已用过）→ 提示文字；没有错误返回空 */
function hashError(hash){
  const hp = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  const code = hp.get("error_code"); if (!code) return "";
  return code === "otp_expired" ? t("确认链接已失效：请直接用邮箱和密码登录试试，不行点「重发确认邮件」") : t("登录链接有问题：") + (hp.get("error_description") || code);
}

export { authMessage, signupOutcome, hashError };

/* ============ 角色权限、加入结果、邀请码状态（纯函数，有测试） ============
   角色：owner 创建者（管成员：提升 / 降级 / 移出、重新生成 / 关闭邀请码）· partner 合伙人（录入 + 批准 / 拒绝加入申请）· viewer 只读。
   凭邀请码加入的人批准后是只读；只有创建者能把别人提升为合伙人 / 创建者。界面只用来决定显示哪些按钮，真正的拦截在数据库函数里。 */
const perms = role => ({ write: role === "owner" || role === "partner", approve: role === "owner" || role === "partner", manage: role === "owner" });

/** sl_join_org / join_org 返回的 { status } → { kind, message } */
function joinOutcome(res, error){
  if (error) return { kind: "error", message: t("申请失败：") + authMessage(error) };
  switch (res?.status) {
    case "pending": return { kind: "pending", message: t("已申请，等待创建者或合伙人批准。批准前你只能看到申请状态，看不到任何数据。") };
    case "active": return { kind: "active", message: "" };
    case "invalid": return { kind: "error", message: t("邀请码不对，请核对后再试。") };
    case "expired": return { kind: "error", message: t("邀请码已失效（过期或被关闭），请联系创建者重新发一个。") };
    case "throttled": return { kind: "error", message: t("猜错次数太多了，{n} 分钟后再试。", { n: res.retry_minutes || 15 }) };
    case "full": return { kind: "error", message: t("等待批准的人太多了，请先联系创建者处理。") };
    default: return { kind: "error", message: t("申请失败，请稍后再试。") };
  }
}
/** 邀请码当前状态：valid（还有 n 天）/ expired / closed / none */
function inviteState(info, now = Date.now()){
  if (!info) return { kind: "none" };
  if (info.closed) return { kind: "closed" };
  const ms = new Date(info.expires_at).getTime() - now;
  return ms > 0 ? { kind: "valid", days: Math.max(1, Math.ceil(ms / 864e5)) } : { kind: "expired" };
}
export { perms, joinOutcome, inviteState };
