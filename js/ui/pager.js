/* 列表「继续加载」：每个列表一个 key，记着现在显示了几条；筛选 / 搜索 / 年份 / 子页一变就 resetPage 回到第一页 */
import { LS_PREFIX } from "../config.js";
import { esc, loadJSON, saveJSON } from "../core/util.js";
import { t } from "../core/i18n.js";
import { PAGE_SIZES, normPageSize, pageOf } from "../logic/pager.js";
import { ACT } from "./actions.js";

const KEY = LS_PREFIX + ".pageSize";
const narrow = () => { try { return matchMedia("(max-width: 640px)").matches; } catch (e) { return false; } };
const pageSize = () => normPageSize(loadJSON(KEY, null), narrow());
const shown = new Map();
/** 清掉某几个列表（不传 = 全部）的「已加载」，回到第一页 */
const resetPage = (...keys) => { if (!keys.length) shown.clear(); else for (const k of keys) shown.delete(k); };
const setPageSize = n => { if (PAGE_SIZES.includes(+n)) saveJSON(KEY, +n); resetPage(); };
/** 返回 { rows, more, btn }：rows 是要渲染的那部分，btn 是「继续加载」按钮（没有更多时为空串） */
function paged(key, list){
  const p = pageOf(list, shown.get(key) ?? pageSize());
  return { ...p, btn: p.more ? `<div class="actions" style="justify-content:center"><button type="button" class="btn" data-act="page-more" data-k="${esc(key)}">${esc(t("继续加载"))}</button></div>` : "" };
}
ACT["page-more"] = el => { const k = el.dataset.k; shown.set(k, (shown.get(k) ?? pageSize()) + pageSize()); };

export { PAGE_SIZES, pageSize, setPageSize, resetPage, paged };
