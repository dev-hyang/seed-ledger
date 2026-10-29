/* ============ 云端配置 ============
   两种部署二选一（见 supabase/README.md）：
   A. 新建独立的 Supabase 项目 → 执行 supabase/001_schema.sql，DB_PREFIX 保持 ""。
   B. 并入已有的 baby-log 数据库 → 按顺序执行 supabase/shared-db/sl_001…sl_004，DB_PREFIX 改成 "sl_"，
      URL 和 anon key 填 baby-log 那个项目的（同一个项目，所以和家庭应用共用邮箱账号体系，但数据表、权限、登录会话互相独立）。
   只能填 anon / publishable 公开 key（设计上就是给浏览器用的，安全靠数据库的行级权限）。
   绝对不要填 service_role / secret key。留着 YOUR- 时应用进入「本机模式」：数据只存在这台设备，功能完整，只是不同步。 */
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
/* 数据库对象的前缀：
   ""    = 独立的新 Supabase 项目（supabase/001_schema.sql，表叫 orgs / records …）
   "sl_" = 并入已有的 baby-log 数据库（supabase/shared-db/sl_001…sl_004，表叫 sl_orgs / sl_records …）
   两套二选一，前缀要和你实际执行的 SQL 一致。 */
const DB_PREFIX = "";
const AI_FUNCTION = "ai-advice";   // supabase/functions/ai-advice；没部署时 AI 按钮会提示不可用，不影响其它功能
const LS_PREFIX = "seedledger.v1";
const APP_VERSION = "2026-10-28.1";

const CLOUD_CONFIGURED = /^https:\/\/(?!YOUR-)/.test(SUPABASE_URL) && !SUPABASE_ANON_KEY.includes("YOUR-");

export { DB_PREFIX, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JS, AI_FUNCTION, LS_PREFIX, APP_VERSION, CLOUD_CONFIGURED };
