/* ============ 云端：登录、组织（经销商）、成员、同步 ============
   本机优先：录入永远先落 IndexedDB，联网后上传；断网、关页面都不丢，下次打开继续传（outbox）。
   · 上传：逐条调用 put_record(base = 上次的 updated_at)。服务器发现别人先改过就返回 conflict：
     内容一样就当成功（重试造成的），不一样就采用服务器版本，并把自己这份存进 conflicts，不静默覆盖。
   · 下载：按 updated_at 游标分页拉取（用 >=，重复拉到的记录幂等覆盖）；本机还有没传完的记录则不覆盖。
   · 实时：订阅 records 变化，合伙人那边一录入这边几秒内就更新。
   · 云端没配置（config.js 还是 YOUR-）→ 本机模式，一切照常，只是不同步。 */
import { CLOUD_CONFIGURED, DB_PREFIX, LS_PREFIX, SUPABASE_ANON_KEY, SUPABASE_JS, SUPABASE_URL } from "../config.js";
import * as db from "./db.js";
import { S, adoptLocal, loadOrg, notify, setKick, settingsFrom } from "./state.js";
import { debounce, toast } from "./util.js";
import { t } from "./i18n.js";
import { hashError } from "./auth-msg.js";

const T = { orgs: DB_PREFIX + "orgs", members: DB_PREFIX + "org_members", records: DB_PREFIX + "records", audit: DB_PREFIX + "audit_log" };   // 表名（见 config.js 的 DB_PREFIX）
const fn = name => DB_PREFIX + name;   // 函数名
const SB = { client: null, channel: null, timer: null, running: false, again: false };
const isNet = e => !e || /fetch|network|Failed|load/i.test(e.message || "") || e.name === "TypeError";

async function initCloud(){
  if (!CLOUD_CONFIGURED) { S.cloud = "local"; await loadOrg("local"); return; }
  await loadOrg("local");   // 先让页面有东西可看，再等登录结果
  S.cloud = "signedout"; notify();
  const linkErr = hashError(location.hash);   // 点了过期 / 用过的确认链接跳回来：说清楚，并清掉地址里的错误参数
  if (linkErr) { setTimeout(() => toast(linkErr), 400); history.replaceState(null, "", location.pathname + location.search); }
  try {
    await new Promise((res, rej) => { const s = document.createElement("script"); s.src = SUPABASE_JS; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  } catch (e) { S.cloud = "offline"; toast(t("云端组件加载失败，已切到本机模式")); notify(); return; }
  SB.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: LS_PREFIX + ".auth" } });
  SB.client.auth.onAuthStateChange((_e, session) => { S.user = session?.user && !session.user.is_anonymous ? session.user : null; setTimeout(afterAuth, 0); });
  window.addEventListener("online", () => kick());
  window.addEventListener("offline", () => { S.cloud = "offline"; notify(); });
  clearInterval(SB.timer); SB.timer = setInterval(() => kick(), 60e3);
  clearInterval(SB.pendTimer); SB.pendTimer = setInterval(() => { if (S.cloud === "pending" && S.user && navigator.onLine) afterAuth(); }, 15e3);   // 等批准的人：批准后几秒内自动进入
}

async function afterAuth(){
  teardown();
  if (!S.user) { S.cloud = "signedout"; S.role = "owner"; await loadOrg("local"); return; }
  const { data, error } = await SB.client.from(T.members).select(`org_id, role, status, orgs:${T.orgs}(id, name)`).eq("user_id", S.user.id);
  if (error) { S.cloud = "offline"; notify(); return; }
  const rows = data || [], active = rows.find(r => r.status === "active" && r.orgs);
  if (active) return enterOrg(active.orgs.id, active.orgs.name, active.role);
  S.cloud = rows.some(r => r.status === "pending") ? "pending" : "noorg"; notify();
}
async function enterOrg(orgId, name, role){
  S.orgName = name; S.role = role; await loadOrg(orgId);
  S.cloud = navigator.onLine ? "online" : "offline"; notify();
  SB.channel = SB.client.channel("rec-" + orgId)
    .on("postgres_changes", { event: "*", schema: "public", table: T.records, filter: `org_id=eq.${orgId}` }, debounce(() => kick(), 800)).subscribe();
  kick();
}
function teardown(){ if (SB.channel) { SB.client.removeChannel(SB.channel); SB.channel = null; } }

/* ---------- 同步主流程：先上传，再下载；同一时间只跑一个，跑的时候又有新改动就再跑一轮 ---------- */
async function sync(){
  if (!SB.client || !S.user || S.org === "local" || !["online", "offline"].includes(S.cloud)) return;
  if (SB.running) { SB.again = true; return; }
  if (!navigator.onLine) { S.cloud = "offline"; notify(); return; }
  SB.running = true; S.syncing = true; notify();
  try {
    do { SB.again = false; await push(); await pull(); } while (SB.again);
    S.cloud = "online"; S.lastSync = new Date();
  } catch (e) {
    S.cloud = isNet(e) ? "offline" : "online";
    if (!isNet(e)) toast(t("同步出错：") + (e.message || e));
  }
  S.syncing = false; SB.running = false;
  S.pendingOps = (await db.getAll("outbox", S.org)).length; notify();
}
const kick = debounce(sync, 300);
setKick(kick);

async function push(){
  for (const op of await db.getAll("outbox", S.org)) {
    const key = [op.org, op.kind, op.id], rec = await db.get("records", key);
    if (!rec) { await db.del("outbox", key); continue; }
    const { data, error } = await SB.client.rpc(fn("put_record"), { p_org: S.org, p_kind: op.kind, p_id: op.id, p_data: rec.data, p_deleted: rec.deleted, p_base: rec.ts });
    if (error) {
      if (error.code === "42501") { toast(t("没有权限修改（只读成员）")); await db.del("outbox", key); continue; }
      throw error;
    }
    if (data.conflict) { await resolveConflict(rec, data.row); await db.del("outbox", key); continue; }
    const cur = await db.get("records", key);
    await db.put("records", { ...cur, ts: data.updated_at });
    if (cur.rev === op.rev) await db.del("outbox", key);   // 上传期间又改了就留着，下一轮带新的 base 再传
  }
}
async function resolveConflict(mine, row){
  if (JSON.stringify(row.data) === JSON.stringify(mine.data) && row.deleted === mine.deleted) { await applyRow(row); return; }
  await db.add("conflicts", { org: S.org, at: new Date().toISOString(), kind: mine.kind, id: mine.id, mine: mine.data, mineDeleted: mine.deleted, theirs: row.data });
  await applyRow(row);
  toast(t("有一条记录被合伙人先改过，已采用对方的版本；你的版本留在「设置 → 同步冲突」里"));
}

async function pull(){
  let cursor = await db.getMeta("cursor:" + S.org) || "1970-01-01T00:00:00Z", more = true;
  const dirty = new Set((await db.getAll("outbox", S.org)).map(o => o.kind + "|" + o.id));
  while (more) {
    const { data, error } = await SB.client.from(T.records).select("kind, id, data, deleted, updated_at").eq("org_id", S.org).gte("updated_at", cursor).order("updated_at").limit(500);
    if (error) throw error;
    for (const row of data) { if (!dirty.has(row.kind + "|" + row.id)) await applyRow(row); cursor = row.updated_at; }
    more = data.length === 500 && data[data.length - 1].updated_at !== data[0].updated_at;
  }
  await db.setMeta("cursor:" + S.org, cursor);
  await loadOrg(S.org);
}
async function applyRow(row){
  const key = [S.org, row.kind, row.id], old = await db.get("records", key);
  await db.put("records", { org: S.org, kind: row.kind, id: row.id, data: row.data, deleted: row.deleted, ts: row.updated_at, rev: old?.rev || 0 });
}

/* ---------- 登录 / 组织 / 成员（界面调用） ---------- */
const auth = () => SB.client.auth;
const signIn = (email, password) => auth().signInWithPassword({ email, password });
const redirectTo = () => location.origin + location.pathname;   // 邮件里的确认链接跳回这里（要在 Supabase 的 Redirect URLs 里放行）
const signUp = (email, password) => auth().signUp({ email, password, options: { emailRedirectTo: redirectTo() } });
const resendConfirm = email => auth().resend({ type: "signup", email, options: { emailRedirectTo: redirectTo() } });
const signOut = () => auth().signOut();
async function createOrg(name, display, adopt){
  const { data, error } = await SB.client.rpc(fn("create_org"), { p_name: name, p_display: display });
  if (error) throw error;
  if (adopt) await adoptLocal(data.id);
  await afterAuth();
}
/** 凭邀请码申请加入。返回 { data: { status }, error }：status = pending / active / invalid / expired / throttled / full（见 auth-msg.js 的 joinOutcome）；成功申请后立刻刷新，进入「等待批准」 */
async function joinOrg(code, display){
  const res = await SB.client.rpc(fn("join_org"), { p_code: code, p_display: display });
  if (!res.error && ["pending", "active"].includes(res.data?.status)) await afterAuth();
  return res;
}
/** 成员列表（创建者 / 合伙人能看到全部；只读成员只看到自己）+ 邀请码。邀请码只有创建者 / 合伙人读得到，过期了会由数据库自动换新（创建者主动关闭的除外） */
async function listMembers(){
  const m = await SB.client.from(T.members).select("user_id, role, status, name, created_at").eq("org_id", S.org).order("created_at");
  const info = S.role === "owner" || S.role === "partner" ? (await SB.client.rpc(fn("invite_info"), { p_org: S.org })).data : null;
  return { members: m.data || [], invite: info };
}
const setMember = (user, role) => SB.client.rpc(fn("set_member"), { p_org: S.org, p_user: user, p_role: role });   // 只有创建者能调：owner / partner / viewer / remove
const approveMember = user => SB.client.rpc(fn("approve_member"), { p_org: S.org, p_user: user });               // 创建者或合伙人；批准后是只读
const rejectMember = user => SB.client.rpc(fn("reject_member"), { p_org: S.org, p_user: user });
const resetInvite = async (days = 7) => (await SB.client.rpc(fn("reset_invite"), { p_org: S.org, p_days: days })).data;   // 创建者
const closeInvite = () => SB.client.rpc(fn("close_invite"), { p_org: S.org });                                    // 创建者
async function cloudAudit(limit = 300){
  const { data } = await SB.client.from(T.audit).select("seq, kind, rec_id, action, before, after, by_user, at").eq("org_id", S.org).order("seq", { ascending: false }).limit(limit);
  return data || [];
}
async function localAudit(){ return (await db.getAll("audit", S.org)).reverse(); }
const conflictsList = async () => (await db.listAll("conflicts")).filter(c => c.org === S.org).reverse();

const recheck = () => afterAuth();   // 等批准的人点「立即检查」
export { recheck, initCloud, sync, signIn, signUp, resendConfirm, signOut, createOrg, joinOrg, listMembers, setMember, approveMember, rejectMember, resetInvite, closeInvite, cloudAudit, localAudit, conflictsList, settingsFrom };
