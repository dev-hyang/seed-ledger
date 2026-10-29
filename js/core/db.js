/* ============ 本机数据库（IndexedDB）：离线时的唯一真相，联网后再同步 ============
   records   业务记录，键 [org, kind, id]；ts = 服务器上次给的 updated_at（冲突检测的 base），rev = 本机每改一次 +1
   outbox    待上传的记录（每条记录最多一项，记下上传时的 rev）
   meta      同步游标等
   audit     本机留痕（本机模式用；联网后以服务器 audit_log 为准）
   conflicts 同步时发现别人先改过：留下被放弃的那份，不丢数据 */
import { LS_PREFIX } from "../config.js";

let dbp = null;
function open(){
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(LS_PREFIX + ".db", 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("records", { keyPath: ["org", "kind", "id"] }).createIndex("org", "org");
      d.createObjectStore("outbox", { keyPath: ["org", "kind", "id"] }).createIndex("org", "org");
      d.createObjectStore("meta", { keyPath: "k" });
      d.createObjectStore("audit", { autoIncrement: true }).createIndex("org", "org");
      d.createObjectStore("conflicts", { autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
async function store(name, mode = "readonly"){ return (await open()).transaction(name, mode).objectStore(name); }

const getAll = async (name, org) => wrap((await store(name)).index("org").getAll(org));
const get = async (name, key) => wrap((await store(name)).get(key));
const put = async (name, val) => wrap((await store(name, "readwrite")).put(val));
const add = async (name, val) => wrap((await store(name, "readwrite")).add(val));
const del = async (name, key) => wrap((await store(name, "readwrite")).delete(key));
const getMeta = async k => (await get("meta", k))?.v;
const setMeta = (k, v) => put("meta", { k, v });
const listAll = async name => wrap((await store(name)).getAll());

export { getAll, get, put, add, del, getMeta, setMeta, listAll };
