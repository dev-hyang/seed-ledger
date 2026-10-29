/* ============ 内存里的数据 + 读写入口 ============
   所有页面只通过这里读写：save() 先落本机（离线也成功），再通知同步层上传；remove() 是软删除，记录永远不真正消失。
   业务记录种类（kind）：setting brand price supplier purchase sreturn spay sfee customer sale pay adj trip town */
import { LS_PREFIX } from "../config.js";
import * as db from "./db.js";
import { newId, loadJSON, saveJSON } from "./util.js";
import { setPrefs } from "./i18n.js";

const KINDS = ["brand", "price", "supplier", "purchase", "sreturn", "spay", "sfee", "customer", "sale", "pay", "adj", "trip", "town"];
const DEFAULT_SEASONS = [{ id: "early", name: "早稻" }, { id: "late1", name: "一晚" }, { id: "late2", name: "二晚" }];
const DEFAULT_SETTINGS = { name: "", seasons: DEFAULT_SEASONS, fx: 0.14, unit: "jin", currency: "", perKm: 1.2, villageHopKm: 2, laborPerTrip: 0, maskPhone: true };

const S = {
  org: "local", role: "owner", user: null, ready: false,
  cloud: "local",   // local 本机模式 | signedout | noorg | pending | online | offline
  syncing: false, pendingOps: 0, lastSync: null, orgName: "",
  tab: loadJSON(LS_PREFIX + ".tab", "home"), sub: {}, filters: {},
  data: Object.fromEntries(KINDS.map(k => [k, new Map()])), settings: { ...DEFAULT_SETTINGS }
};
const listeners = new Set();
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => { applySettings(); for (const f of listeners) f(); };
const canWrite = () => ["owner", "partner", "staff"].includes(S.role);   // 只读成员不能写；录入员能写但不能管成员（见 auth-msg.js 的 perms）

function applySettings(){
  const st = S.settings;
  setPrefs({ currency: st.currency || "", fx: +st.fx > 0 ? +st.fx : 0.14, unit: st.unit || "jin" });
}
const live = kind => [...S.data[kind].values()].filter(r => !r._del);
const find = (kind, id) => { const r = S.data[kind].get(id); return r && !r._del ? r : null; };
const settingsFrom = r => ({ ...DEFAULT_SETTINGS, ...(r || {}) });

/* 载入某个组织的本机数据到内存 */
async function loadOrg(org){
  S.org = org;
  for (const k of KINDS) S.data[k] = new Map();
  S.settings = { ...DEFAULT_SETTINGS };
  for (const r of await db.getAll("records", org)) {
    if (r.kind === "setting") { if (!r.deleted) S.settings = settingsFrom(r.data); continue; }
    if (S.data[r.kind]) S.data[r.kind].set(r.id, { ...r.data, id: r.id, _del: r.deleted, _ts: r.ts });
  }
  S.pendingOps = (await db.getAll("outbox", org)).length;
  S.ready = true; notify();
}

/* 新增 / 修改：obj 带 id 就是改，不带就是新增。返回保存后的记录 */
async function save(kind, obj){
  if (!canWrite()) throw new Error("readonly");
  const id = obj.id || newId(), key = [S.org, kind, id];
  const old = await db.get("records", key);
  const data = { ...obj }; delete data.id; delete data._del; delete data._ts;
  const rec = { org: S.org, kind, id, data, deleted: false, ts: old?.ts ?? null, rev: (old?.rev || 0) + 1 };
  await db.put("records", rec);
  await db.put("outbox", { org: S.org, kind, id, rev: rec.rev });
  await db.add("audit", { org: S.org, at: new Date().toISOString(), kind, id, action: old ? (old.deleted ? "restore" : "update") : "create", before: old?.data ?? null, after: data });
  if (kind === "setting") S.settings = settingsFrom(data);
  else S.data[kind].set(id, { ...data, id, _ts: rec.ts });
  S.pendingOps++; notify(); kick();
  return { ...data, id };
}
async function saveSettings(patch){ return save("setting", { id: "main", ...S.settings, ...patch }); }
async function remove(kind, id){
  if (!canWrite()) throw new Error("readonly");
  const key = [S.org, kind, id], old = await db.get("records", key);
  if (!old) return;
  const rec = { ...old, deleted: true, rev: old.rev + 1 };
  await db.put("records", rec);
  await db.put("outbox", { org: S.org, kind, id, rev: rec.rev });
  await db.add("audit", { org: S.org, at: new Date().toISOString(), kind, id, action: "delete", before: old.data, after: old.data });
  const cur = S.data[kind].get(id); if (cur) cur._del = true;
  S.pendingOps++; notify(); kick();
}

/* 同步层挂钩：由 sync.js 注册，避免循环依赖 */
let kickFn = () => {};
const setKick = f => { kickFn = f; };
const kick = () => kickFn();

/* 把本机模式下录的数据整体搬进云端组织（第一次建组织时用） */
async function adoptLocal(toOrg){
  const rows = await db.getAll("records", "local");
  for (const r of rows) {
    await db.put("records", { ...r, org: toOrg, ts: null, rev: 1 });
    await db.del("records", ["local", r.kind, r.id]);
    await db.put("outbox", { org: toOrg, kind: r.kind, id: r.id, rev: 1 });
  }
  for (const o of await db.getAll("outbox", "local")) await db.del("outbox", ["local", o.kind, o.id]);
  return rows.length;
}

export { S, KINDS, DEFAULT_SEASONS, subscribe, notify, canWrite, live, find, loadOrg, save, saveSettings, remove, setKick, adoptLocal, settingsFrom };
