/* ============ AI 建议：账本里三处用到 AI 的提示词 + 调用 ============
   调用层是 js/core/ai.js（自带 key、浏览器直连，和姊妹应用一样）。这里只管：每个任务的系统提示词、输出语言、出错时给什么提示。
   发进来的 payload 必须已经脱敏（调用方保证：只有金额、比例、等级、镇名村名，没有姓名、电话、详细地址）；这里再限制一次大小。
   没设置 key / 没网 / 服务商出错都返回 null，并留下可读的原因（aiError()）；调用方照常显示规则结果，AI 永远不挡记账。 */
import { askText, aiReady } from "./ai.js";
import { t } from "./i18n.js";

const SYSTEM = {
  negotiate: "你是稻种经销商的讨账顾问。根据给出的应收、已收、客户历史摘要，给 2-3 个具体的议价方案（建议成交价或折扣、先收多少、什么时候收），说明理由和底线。简洁，用要点。不构成法律意见。",
  customer: "你是稻种经销商的风险顾问。根据脱敏的客户画像数据，用通俗的话写出：是否建议明年继续合作、赊账怎么控制、要在单据上注意什么。简洁，用要点。只是记录和风险提示，不构成法律意见。",
  route: "你是乡镇配送调度顾问。根据给出的各镇距离、方向、停靠点和估算里程，建议送货顺序，以及是否拆成几趟、怎样省车费人工。简洁，用要点；说明这是估算。"
};
const LANG = { en: "Answer in English.", "zh-TW": "請用繁體中文回答。", "zh-CN": "用简体中文回答。" };
const MAX_PAYLOAD = 6000;

let lastError = "";
const aiAvailable = aiReady;
const NO_KEY = () => t("还没设置 AI：到「更多 → AI 助手」填你自己的 key。");
const aiError = () => lastError || (aiReady() ? t("AI 暂时不可用。") : NO_KEY());

async function askAI(task, payload, lang){
  lastError = "";
  if (!SYSTEM[task]) throw new Error("bad task");
  if (!aiReady()) { lastError = NO_KEY(); return null; }
  const body = JSON.stringify(payload ?? {});
  if (body.length > MAX_PAYLOAD) { lastError = t("要发的内容太长了。"); return null; }
  try {
    const text = await askText(`${SYSTEM[task]} ${LANG[lang] || LANG["zh-CN"]}`, body, { maxTokens: 700, temperature: 0.3 });
    return String(text || "").trim() || null;
  } catch (e) { lastError = e.message || String(e); return null; }
}

export { askAI, aiAvailable, aiError, SYSTEM };
