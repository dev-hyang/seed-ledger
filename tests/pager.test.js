import test from "node:test";
import assert from "node:assert/strict";
import { PAGE_SIZES, defaultPageSize, normPageSize, pageOf } from "../js/logic/pager.js";
import { nameCounts } from "../js/logic/customers.js";

test("每页条数：只认 5 / 10 / 20 / 50；没设过或存坏了，手机 10、电脑 20", () => {
  assert.deepEqual(PAGE_SIZES, [5, 10, 20, 50]);
  assert.equal(defaultPageSize(true), 10); assert.equal(defaultPageSize(false), 20);
  assert.equal(normPageSize(null, true), 10); assert.equal(normPageSize(undefined, false), 20);
  assert.equal(normPageSize(7, false), 20); assert.equal(normPageSize("abc", true), 10);
  assert.equal(normPageSize(50, true), 50); assert.equal(normPageSize("5", false), 5);
});
test("分页：只取前 shown 条，后面还有才 more", () => {
  const list = Array.from({ length: 23 }, (_, i) => i);
  assert.deepEqual(pageOf(list, 10), { rows: list.slice(0, 10), more: true });
  assert.equal(pageOf(list, 20).more, true); assert.equal(pageOf(list, 30).rows.length, 23); assert.equal(pageOf(list, 23).more, false);
  assert.deepEqual(pageOf([], 10), { rows: [], more: false });
});
test("同名计数：一次数完，名字前后空格不算", () => {
  const m = nameCounts([{ name: "张三" }, { name: " 张三 " }, { name: "李四" }]);
  assert.equal(m.get("张三"), 2); assert.equal(m.get("李四"), 1);
});
