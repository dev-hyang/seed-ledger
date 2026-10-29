import test from "node:test";
import assert from "node:assert/strict";
import { phoneKey, validPhone, findByPhone, customerLabel, sameNameCount, maskPhone } from "../js/logic/customers.js";

test("手机号规范化：只留数字，去掉 +86 / 86 前缀；格式不同的同一个号码相等", () => {
  assert.equal(phoneKey("189-0019 2299"), "18900192299"); assert.equal(phoneKey("+86 18900192299"), "18900192299"); assert.equal(phoneKey("8618900192299"), "18900192299");
  assert.equal(phoneKey("0755-8888-6666"), "075588886666"); assert.equal(phoneKey(""), ""); assert.equal(phoneKey(null), "");
});
test("手机号是否合法：7–15 位数字", () => {
  assert.equal(validPhone("18900192299"), true); assert.equal(validPhone("123456"), false); assert.equal(validPhone("abc"), false); assert.equal(validPhone("1".repeat(16)), false);
});
test("按手机号查重：忽略格式；编辑时不和自己比；没填手机号的不参与", () => {
  const cs = [{ id: "a", name: "小明", phone: "18900192299" }, { id: "b", name: "小明", phone: "13800138000" }, { id: "c", name: "老王", phone: "" }];
  assert.equal(findByPhone(cs, "+86 189 0019 2299")?.id, "a");
  assert.equal(findByPhone(cs, "18900192299", "a"), null);   // 编辑 a 自己
  assert.equal(findByPhone(cs, "13900000000"), null); assert.equal(findByPhone(cs, ""), null);
  assert.equal(findByPhone(cs, "  "), null);
});
test("客户小卡片：名字 · 镇村 · 遮住中间的手机号；同名的靠后面的号码区分；没手机号提醒补上", () => {
  assert.equal(customerLabel({ name: "小明", town: "金川镇", village: "一村", phone: "18900192299" }), "小明 · 金川镇一村 · 189****2299");
  assert.equal(customerLabel({ name: "小明", town: "白石镇", phone: "13800138000" }, { mask: false }), "小明 · 白石镇 · 13800138000");
  assert.equal(customerLabel({ name: "老王" }), "老王 · 未填手机号");
  assert.equal(maskPhone("123"), "123");
});
test("同名统计", () => {
  const cs = [{ id: "a", name: "小明" }, { id: "b", name: " 小明 " }, { id: "c", name: "老王" }];
  assert.equal(sameNameCount(cs, cs[0]), 1); assert.equal(sameNameCount(cs, cs[2]), 0);
});
