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
