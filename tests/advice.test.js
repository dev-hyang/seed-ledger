import test from "node:test";
import assert from "node:assert/strict";

const store = { "seedledger.v1.locale": "zh-CN" };
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
globalThis.document = { documentElement: {}, title: "" };
const ai = await import("../js/core/ai.js");
const { askAI, aiAvailable, aiError, SYSTEM } = await import("../js/core/advice.js");

const reply = text => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }), headers: { get: () => null } });
const reset = () => { for (const k of Object.keys(store)) if (k !== "seedledger.v1.locale") delete store[k]; };

test("没填 key：返回 null，并提示去「更多 → AI 助手」设置，不发任何请求", async () => {
  reset(); let called = 0; globalThis.fetch = async () => { called++; return reply("x"); };
  assert.equal(aiAvailable(), false);
  assert.equal(await askAI("negotiate", { a: 1 }, "zh-CN"), null);
  assert.match(aiError(), /更多 → AI 助手/); assert.equal(called, 0);
});

test("成功：带上对应任务的系统提示词和输出语言，用户内容就是脱敏后的 payload", async () => {
  reset(); ai.saveAiSettings({ provider: "openai", key: "k" });
  let sent = null; globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return reply("  建议：按 30 元成交  "); };
  const payload = { grossAmount: 10500, customer: { grade: "B", reasons: ["回款偏慢"] } };
  assert.equal(await askAI("negotiate", payload, "zh-CN"), "建议：按 30 元成交");
  assert.match(sent.messages[0].content, /讨账顾问/); assert.match(sent.messages[0].content, /用简体中文回答/);
  assert.deepEqual(JSON.parse(sent.messages[1].content), payload);
  await askAI("route", {}, "en"); assert.match(sent.messages[0].content, /Answer in English/);
});

test("服务商出错 / 内容太长：返回 null，留下可读原因，不抛错", async () => {
  reset(); ai.saveAiSettings({ provider: "openai", key: "bad" });
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: "nope" } }), headers: { get: () => null } });
  assert.equal(await askAI("customer", { a: 1 }, "zh-CN"), null); assert.match(aiError(), /不接受这个 key/);
  globalThis.fetch = async () => { throw new Error("should not be called"); };
  assert.equal(await askAI("customer", { blob: "x".repeat(7000) }, "zh-CN"), null); assert.match(aiError(), /太长/);
});

test("三个任务都有提示词；未知任务直接报错", async () => {
  assert.deepEqual(Object.keys(SYSTEM).sort(), ["customer", "negotiate", "route"]);
  await assert.rejects(() => askAI("nope", {}, "zh-CN"), /bad task/);
});
