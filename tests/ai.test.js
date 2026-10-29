// node --test tests/ai.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
store["seedledger.v1.locale"] = "zh-CN";   // 断言的是中文报错；不固定的话会跟随运行环境的浏览器语言
globalThis.document = { documentElement: {}, title: "" };
const ai = await import("../js/core/ai.js");

const img = [{ mime: "image/jpeg", b64: "QUJD" }];
const reset = () => { for (const k of Object.keys(store)) delete store[k]; };
const resp = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), headers: { get: () => null } });

test("requestFor: 三种接口的请求形状（含图片）", () => {
  const s = { key: "Bearer abc", base: "" };
  const g = ai.requestFor(s, ai.providerOf("gemini"), "gemini-x", { system: "S", user: "U", json: true, images: img });
  assert.match(g.url, /models\/gemini-x:generateContent\?key=abc$/);
  assert.equal(g.body.contents[0].parts[1].inlineData.data, "QUJD");
  assert.equal(g.body.generationConfig.responseMimeType, "application/json");
  const a = ai.requestFor(s, ai.providerOf("anthropic"), "m", { system: "S", user: "U", images: img });
  assert.equal(a.headers["x-api-key"], "abc");
  assert.equal(a.body.messages[0].content[0].type, "image");
  const o = ai.requestFor({ key: "k", base: "https://x.test/v1/" }, ai.providerOf("custom"), "m", { system: "S", user: "U", images: img });
  assert.equal(o.url, "https://x.test/v1/chat/completions");
  assert.match(o.body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,QUJD$/);
});

test("aiSettings: 自己的优先；没有就沿用爱家小助手的 key", () => {
  reset();
  assert.equal(ai.aiReady(), false);
  store["hmh-ai"] = JSON.stringify({ provider: "openai", key: "pk", model: "m1" });
  assert.equal(ai.aiReady(), true);
  assert.deepEqual([ai.aiSettings().provider, ai.aiSettings().key, ai.aiSettings().borrowed], ["openai", "pk", true]);
  ai.saveAiSettings({ provider: "gemini", key: "own", model: "", base: "" });
  assert.deepEqual([ai.aiSettings().provider, ai.aiSettings().key, ai.aiSettings().borrowed], ["gemini", "own", undefined]);
});

test("askText: Gemini 模型 404 → 换下一个；503 → 同一个再试一次", async () => {
  reset(); ai.saveAiSettings({ provider: "gemini", key: "k" });
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url).match(/models\/([^:]+):/)[1]);
    if (calls.length === 1) return resp(404, { error: { message: "gone" } });
    if (calls.length === 2) return resp(503, { error: { message: "busy" } });
    return resp(200, { candidates: [{ content: { parts: [{ text: "你好" }] } }] });
  };
  assert.equal(await ai.askText("s", "u"), "你好");
  assert.equal(calls.length, 3);
  assert.equal(calls[1], calls[2], "503 在同一个模型上重试");
  assert.notEqual(calls[0], calls[1], "404 换了模型");
});

test("askText: 401 / 429 / 网络错误给出可读提示，不乱换模型", async () => {
  reset(); ai.saveAiSettings({ provider: "gemini", key: "k" });
  let n = 0;
  globalThis.fetch = async () => { n++; return resp(401, { error: { message: "bad key" } }); };
  await assert.rejects(ai.askText("s", "u"), /不接受这个 key/);
  assert.equal(n, 1);
  globalThis.fetch = async () => resp(429, { error: { message: "quota" } });
  await assert.rejects(ai.askText("s", "u"), /免费次数/);
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(ai.askText("s", "u"), /无法直连/);
});

test("askText: 没填 key / 自定义地址不是 https", async () => {
  reset();
  await assert.rejects(ai.askText("s", "u"), /还没填 API key/);
  ai.saveAiSettings({ provider: "custom", key: "k", base: "http://x" });
  await assert.rejects(ai.askText("s", "u"), /https/);
});
