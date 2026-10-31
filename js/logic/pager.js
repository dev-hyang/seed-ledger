/* ============ 列表分页（纯函数，有测试） ============
   每页条数全 App 一个设置，只存在这台设备（localStorage）：5 / 10 / 20 / 50；没设过时手机默认 10、电脑默认 20。
   合计、KPI、「全选未结清」、滚动余额都按完整列表算，只是渲染时取前 shown 条；还有更多就显示一个「继续加载」，每次多加一页。 */
const PAGE_SIZES = [5, 10, 20, 50];
const defaultPageSize = narrow => narrow ? 10 : 20;
/** 存的值不合法（没设过、被改坏）就用默认值 */
const normPageSize = (v, narrow) => PAGE_SIZES.includes(+v) ? +v : defaultPageSize(narrow);
/** 取前 shown 条；more = 后面还有 */
const pageOf = (list, shown) => ({ rows: list.slice(0, shown), more: list.length > shown });

export { PAGE_SIZES, defaultPageSize, normPageSize, pageOf };
