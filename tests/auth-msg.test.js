import test from "node:test";
import assert from "node:assert/strict";

const store = { "seedledger.v1.locale": "zh-CN" };
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
globalThis.document = { documentElement: {}, title: "" };
const { authMessage, signupOutcome, hashError } = await import("../js/core/auth-msg.js");

test("注册：邮箱已注册过（共用账号）→ Supabase 返回「成功」但 identities 为空、不发邮件 → 提示直接登录", () => {
  const out = signupOutcome({ user: { identities: [] }, session: null }, null, "a@b.test");
  assert.equal(out.kind, "exists"); assert.match(out.message, /已经注册过/); assert.match(out.message, /直接用它登录/);
});

test("注册：新邮箱 → 邮件已发出；开了免确认 → 直接登录", () => {
  const sent = signupOutcome({ user: { identities: [{ id: "x" }] }, session: null }, null, "new@b.test");
  assert.equal(sent.kind, "confirm"); assert.match(sent.message, /new@b\.test/); assert.match(sent.message, /垃圾邮件/); assert.match(sent.message, /重发确认邮件/);
  assert.equal(signupOutcome({ user: { identities: [{}] }, session: { access_token: "t" } }, null).kind, "signed-in");
});

test("限流（429 / over_email_send_rate_limit）给出可读提示，并引导用已有账号登录", () => {
  for (const e of [{ status: 429, message: "x" }, { code: "over_email_send_rate_limit", message: "email rate limit exceeded" }, { message: "For security purposes, you can only request this after 20 seconds (rate limit)" }])
    assert.match(authMessage(e), /限流/);
  assert.match(signupOutcome(null, { status: 429, message: "email rate limit exceeded" }).message, /注册失败：.*限流/);
});

test("登录常见错误：未确认、密码不对、已注册", () => {
  assert.match(authMessage({ code: "email_not_confirmed", message: "Email not confirmed" }), /重发确认邮件/);
  assert.match(authMessage({ message: "Invalid login credentials" }), /邮箱或密码不对/);
  assert.match(authMessage({ message: "User already registered" }), /直接登录/);
  assert.equal(authMessage({ message: "something else" }), "something else"); assert.equal(authMessage(null), "");
});

test("邮件链接过期跳回来：地址里的错误转成提示；没有错误返回空", () => {
  assert.match(hashError("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid"), /已失效/);
  assert.match(hashError("#error_code=other&error_description=Boom"), /Boom/);
  assert.equal(hashError("#access_token=abc"), ""); assert.equal(hashError(""), "");
});

const { perms, joinOutcome, inviteState } = await import("../js/core/auth-msg.js");

test("权限：创建者管成员，合伙人能录入和批准，只读只能看", () => {
  assert.deepEqual(perms("owner"), { write: true, approve: true, manage: true });
  assert.deepEqual(perms("partner"), { write: true, approve: true, manage: false });
  assert.deepEqual(perms("viewer"), { write: false, approve: false, manage: false });
  assert.deepEqual(perms(undefined), { write: false, approve: false, manage: false });
});
test("加入结果：待批准 / 无效 / 已失效 / 限流 / 太多人在等，各有提示；出错走通用提示", () => {
  assert.equal(joinOutcome({ status: "pending" }).kind, "pending"); assert.match(joinOutcome({ status: "pending" }).message, /看不到任何数据/);
  assert.equal(joinOutcome({ status: "active" }).kind, "active");
  assert.match(joinOutcome({ status: "invalid" }).message, /不对/); assert.match(joinOutcome({ status: "expired" }).message, /失效/);
  assert.match(joinOutcome({ status: "throttled", retry_minutes: 15 }).message, /15 分钟/); assert.match(joinOutcome({ status: "full" }).message, /太多/);
  assert.equal(joinOutcome({ status: "???" }).kind, "error"); assert.match(joinOutcome(null, { status: 429, message: "x" }).message, /限流/);
});
test("邀请码状态：有效（还剩几天）/ 过期 / 已关闭；关闭优先于过期", () => {
  const now = Date.parse("2026-10-29T00:00:00Z");
  assert.deepEqual(inviteState({ expires_at: "2026-11-03T00:00:00Z" }, now), { kind: "valid", days: 5 });
  assert.deepEqual(inviteState({ expires_at: "2026-10-29T06:00:00Z" }, now), { kind: "valid", days: 1 });   // 不足一天算 1 天
  assert.equal(inviteState({ expires_at: "2026-10-28T00:00:00Z" }, now).kind, "expired");
  assert.equal(inviteState({ expires_at: "2026-10-28T00:00:00Z", closed: true }, now).kind, "closed");
  assert.equal(inviteState(null, now).kind, "none");
});
