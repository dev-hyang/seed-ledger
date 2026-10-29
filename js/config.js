/* ============ 云端配置 ============
   必须是「自己新建的、独立的」Supabase 项目（不要用家庭应用那个：这里有客户个人信息和账务，合伙人也不该进到家庭数据里）。
   只能填 anon / publishable 公开 key（设计上就是给浏览器用的，安全靠 supabase/001_schema.sql 里的行级权限）。
   绝对不要填 service_role / secret key。留着 YOUR- 时应用进入「本机模式」：数据只存在这台设备，功能完整，只是不同步。 */
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
const AI_FUNCTION = "ai-advice";   // supabase/functions/ai-advice；没部署时 AI 按钮会提示不可用，不影响其它功能
const LS_PREFIX = "seedledger.v1";
const APP_VERSION = "2026-10-28.1";

const CLOUD_CONFIGURED = /^https:\/\/(?!YOUR-)/.test(SUPABASE_URL) && !SUPABASE_ANON_KEY.includes("YOUR-");

export { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JS, AI_FUNCTION, LS_PREFIX, APP_VERSION, CLOUD_CONFIGURED };
