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
