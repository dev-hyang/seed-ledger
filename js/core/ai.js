import { LS_PREFIX } from "../config.js";
import { t } from "./i18n.js";

/* ============ AI 助手 · 调用层（复制自牧羊人 js/ai.js；和家庭学堂、爱家小助手同一套思路：自带 key、浏览器直连，没有服务器） ============
   用户把自己的 API key 填在 更多 → AI 助手，只存本机浏览器（localStorage），不进仓库、不进数据库、不同步给合伙人（各人用各人的）。
   爱家小助手（同一个域名）里已经填过的 key（localStorage "hmh-ai"）这里直接沿用，不用再填一遍。
   账本只在三处用到 AI：讨账议价建议、客户画像写成口语建议、送货路线建议（都是文字一问一答，见 js/core/advice.js）。
   发出去的只有脱敏后的数字摘要（金额、等级、扣分原因、镇名和村名），不含客户姓名、电话、详细地址。 */
const KEY = LS_PREFIX + ".ai", PANTRY_KEY = "hmh-ai";

const PROVIDERS = [
  { id: "gemini", name: "Google Gemini", kind: "gemini", base: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-3.5-flash-lite", vision: true, signup: "https://aistudio.google.com/apikey",
    fallback: ["gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"], hint: "AI Studio 有免费额度（每天有次数上限），读图和文字都行；推荐。" },
  { id: "openai", name: "OpenAI", kind: "openai", base: "https://api.openai.com/v1", model: "gpt-4o-mini", vision: true, signup: "https://platform.openai.com/api-keys", hint: "gpt-4o-mini 够用，读图便宜。" },
  { id: "anthropic", name: "Claude（Anthropic）", kind: "anthropic", base: "https://api.anthropic.com/v1", model: "claude-haiku-4-5", vision: true, signup: "https://console.anthropic.com/", hint: "Haiku 档最便宜，读图准。" },
  { id: "groq", name: "Groq（免费档）", kind: "openai", base: "https://api.groq.com/openai/v1", model: "meta-llama/llama-4-scout-17b-16e-instruct", vision: true, signup: "https://console.groq.com/keys", hint: "免费档有每日次数上限。" },
  { id: "custom", name: "自定义（OpenAI 兼容接口）", kind: "openai", base: "", model: "", vision: true, signup: "", hint: "填接口地址（到 /v1 为止）、模型名和 key；要能读图才能拍照识字。" }
];
const providerOf = id => PROVIDERS.find(p => p.id === id) || PROVIDERS[0];

function read(k){ try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
function aiSettings(){
  const def = { provider: "gemini", key: "", model: "", base: "" };
  const own = read(KEY), pantry = read(PANTRY_KEY);
  // 自己填过就用自己的；没有就沿用爱家小助手里的（只取服务商、key、模型、地址）
  if (own && own.key) return { ...def, ...own };
  if (pantry && pantry.key) return { ...def, provider: pantry.provider || def.provider, key: pantry.key, model: pantry.model || "", base: pantry.base || "", borrowed: true };
  return { ...def, ...(own || {}) };
}
function saveAiSettings(s){ try { localStorage.setItem(KEY, JSON.stringify({ provider: s.provider, key: s.key, model: s.model || "", base: s.base || "" })); } catch (e) { /* 忽略 */ } }
const aiReady = () => !!String(aiSettings().key || "").trim();
const cleanKey = s => String(s || "").trim().replace(/^Bearer\s+/i, "");

/** 一次请求的地址、头、体：不发网络，方便单测。images = [{ mime, b64 }] */
function requestFor(s, p, model, { system, user, json = false, images = [], maxTokens = 2000, temperature = 0.2 }){
  const key = cleanKey(s.key), base = String(p.id === "custom" ? s.base : p.base).replace(/\/+$/, "");
  if (p.kind === "gemini") {
    const parts = [{ text: user }, ...images.map(i => ({ inlineData: { mimeType: i.mime, data: i.b64 } }))];
    return { url: `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, headers: { "Content-Type": "application/json" },   // 与爱家小助手一样，key 放在查询串里
      body: { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts }], generationConfig: { temperature, maxOutputTokens: maxTokens, ...(json ? { responseMimeType: "application/json" } : {}) } } };
  }
  if (p.kind === "anthropic") {
    return { url: `${base}/messages`, headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: { model, max_tokens: maxTokens, temperature, system, messages: [{ role: "user", content: images.length ? [...images.map(i => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.b64 } })), { type: "text", text: user }] : user }] } };
  }
  return { url: `${base}/chat/completions`, headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: { model, temperature, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: images.length ? [{ type: "text", text: user }, ...images.map(i => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.b64}` } }))] : user }] } };
}
function textFrom(kind, j){
  if (kind === "gemini") return (j.candidates?.[0]?.content?.parts || []).map(x => x.text || "").join("");
  if (kind === "anthropic") return (j.content || []).map(x => x.text || "").join("");
  return j.choices?.[0]?.message?.content || "";
}
async function readJson(r){
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) { /* 下面报错 */ }
  if (!r.ok) { const e = new Error(`${r.status} ${j?.error?.message || j?.message || txt.slice(0, 200)}`); e.status = r.status; e.body = txt.slice(0, 1500); throw e; }
  if (!j) throw new Error(t("模型返回的不是 JSON"));
  return j;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function explain(e){
  if (e.explained) return e;
  if (e.name === "AbortError") return Object.assign(new Error(t("模型超时，稍后再试")), { explained: true });
  if (e instanceof TypeError) return Object.assign(new Error(t("浏览器无法直连这个接口（跨域或网络被拒）。可以换 Gemini，或者手动输入文字。")), { explained: true });
  if (e.status === 401 || e.status === 403) return Object.assign(new Error(t("{code}：这个服务不接受这个 key。检查 key 是否填对、有没有过期或多了空格，服务商选得对不对。", { code: e.status })), { explained: true });
  if (e.status === 429) return Object.assign(new Error(t("今天的免费次数用完了，或请求太快。过一会儿再试，或换一个服务商。")), { explained: true });
  if (e.status === 413) return Object.assign(new Error(t("照片太大了，换一张小一点的再试")), { explained: true });
  if (e.status >= 500) return Object.assign(new Error(t("服务商那边现在很忙（{code}），等一两分钟再试。", { code: e.status })), { explained: true });
  if (e.status === 400 && /image|vision|multimodal/i.test(e.message)) return Object.assign(new Error(t("这个模型不能读图片。请换成 Gemini 或 Claude，或手动输入文字。")), { explained: true });
  return e;
}
/** 一问一答：system + user（可带图片）→ 文本。json = true 时要求模型只回 JSON */
async function askText(system, user, { json = false, images = [], maxTokens = 2000, temperature = 0.2, signal } = {}){
  const s = aiSettings(), p = providerOf(s.provider), key = cleanKey(s.key);
  if (!key) throw new Error(t("还没填 API key，去「更多 → AI 助手」填"));
  if (p.id === "custom" && !/^https:\/\//i.test(String(s.base || ""))) throw new Error(t("接口地址要以 https:// 开头，填到 /v1 为止"));
  const models = p.kind === "gemini" ? [...new Set([/^gemini/i.test(s.model || "") ? s.model : p.model, ...p.fallback])] : [s.model || p.model];
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), images.length ? 120000 : 60000);
  if (signal) signal.addEventListener("abort", () => ctl.abort(), { once: true });
  try {
    let lastErr = null;
    for (const model of models) {
      const rq = requestFor(s, p, model, { system, user, json, images, maxTokens, temperature });
      for (let n = 0; n < 2; n++) {
        try {
          const j = await readJson(await fetch(rq.url, { method: "POST", signal: ctl.signal, headers: rq.headers, body: JSON.stringify(rq.body) }));
          const text = textFrom(p.kind, j);
          if (!text && p.kind === "gemini" && j.promptFeedback?.blockReason) throw Object.assign(new Error(t("Google 的安全策略拦下了这次请求，换一张图再试。")), { explained: true });
          return text;
        } catch (e) {
          lastErr = e;
          if (e.status === 503 && n === 0) { await sleep(1500); continue; }   // 临时繁忙：同一个模型再试一次
          break;
        }
      }
      if (!(lastErr && lastErr.status === 404 && p.kind === "gemini")) break;   // Gemini 模型名经常换代：404 就换下一个，其余错误直接报
    }
    throw explain(lastErr);
  } finally { clearTimeout(timer); }
}
/** 测试连接：问一句最短的 */
async function testAi(){ const text = await askText("Reply with the single word: ok", "ping", { maxTokens: 20 }); return text; }

export { PROVIDERS, providerOf, aiSettings, saveAiSettings, aiReady, requestFor, textFrom, askText, testAi };
