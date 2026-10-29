// 可选的 AI 建议（议价 / 客户画像文字建议 / 送货路线）。没部署这个函数，应用的其它功能完全不受影响。
// 部署：supabase functions deploy ai-advice；supabase secrets set ANTHROPIC_API_KEY=...（密钥只放服务端，绝不放进网页）。
// 隐私：前端只发脱敏后的数字摘要（没有姓名、电话、地址）；这里也限制大小、要求登录、不落库。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const MODEL = Deno.env.get("AI_MODEL") ?? "claude-sonnet-5-5";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SYSTEM: Record<string, string> = {
  negotiate: "你是稻种经销商的讨账顾问。根据给出的应收、已收、客户历史摘要，给 2-3 个具体的议价方案（建议成交价或折扣、先收多少、什么时候收），说明理由和底线。简洁，用要点。不构成法律意见。",
  customer: "你是稻种经销商的风险顾问。根据脱敏的客户画像数据，用通俗的话写出：是否建议明年继续合作、赊账怎么控制、要在单据上注意什么。简洁，用要点。只是记录和风险提示，不构成法律意见。",
  route: "你是乡镇配送调度顾问。根据给出的各镇距离、方向、停靠点和估算里程，建议送货顺序，以及是否拆成几趟、怎样省车费人工。简洁，用要点；说明这是估算。"
};

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await sb.auth.getUser();
    if (!u?.user) return json({ error: "login required" }, 401);

    const { task, payload, lang } = await req.json();
    if (!SYSTEM[task]) return json({ error: "bad task" }, 400);
    const body = JSON.stringify(payload ?? {});
    if (body.length > 6000) return json({ error: "payload too large" }, 413);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 700,
        system: SYSTEM[task] + (lang === "en" ? " Answer in English." : lang === "zh-TW" ? " 請用繁體中文回答。" : " 用简体中文回答。"),
        messages: [{ role: "user", content: body }]
      })
    });
    if (!r.ok) return json({ error: "ai unavailable" }, 502);
    const out = await r.json();
    return json({ text: (out.content ?? []).map((c: { text?: string }) => c.text ?? "").join("") });
  } catch (_e) {
    return json({ error: "ai unavailable" }, 502);
  }
});
