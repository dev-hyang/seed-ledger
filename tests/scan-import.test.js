import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => "zh-CN", setItem() {}, removeItem() {} };
globalThis.document = { documentElement: {}, title: "" };
const S = await import("../js/logic/scan-import.js");
const F = await import("../js/core/file-readers.js");

const today = "2026-10-28";
const ai = (sales) => ({ currency: "CNY", sales });
const one = (o = {}) => ({ date: "2026-03-30", customer: "小明", phone: "189 0019 2299", lines: [{ brand: "富香977", qty: 300, unit: "斤", price: 35, amount: null }], paid: 0, ...o });

test("清洗：单位统一成斤（公斤 ×2，单价 ÷2）；只有总额时算出单价；手机号只留数字", () => {
  const [d] = S.normalizeAi(ai([one({ lines: [{ brand: "美华303", qty: 150, unit: "公斤", price: 70 }, { brand: "优香7号", qty: 100, unit: "斤", price: null, amount: 3600 }] })]), { today });
  assert.equal(d.lines[0].qty, 300); assert.equal(d.lines[0].price, 35); assert.equal(d.lines[0].note, "150公斤");
  assert.equal(d.lines[1].qty, 100); assert.equal(d.lines[1].price, 36);
  assert.equal(d.phone, "18900192299");
});

test("清洗：坏日期用今天并标记；没数量的行和没行的单被丢掉；未知单位只标记不乱换算", () => {
  const out = S.normalizeAi(ai([one({ date: "三月三十" }), one({ lines: [{ brand: "x", qty: 0 }] }), one({ lines: [{ brand: "富香977", qty: 3, unit: "袋", price: 400 }] }), one({ date: "1999-01-01" })]), { today });
  assert.equal(out.length, 3);
  assert.deepEqual([out[0].date, out[0].noDate], [today, true]);
  assert.deepEqual(out[1].flags, ["unit:袋"]); assert.equal(out[1].lines[0].qty, 3);
  assert.equal(out[2].date, today);   // 1999 年不合理 → 今天
});

test("清洗：收款金额 —— 0 = 赊账，null = 没写，负数当没写", () => {
  const [a, b, c] = S.normalizeAi(ai([one({ paid: 0 }), one({ paid: null }), one({ paid: -5 })]), { today });
  assert.deepEqual([a.paid, b.paid, c.paid], [0, null, null]);
});

test("品种匹配：忽略空格 / 标点；包含关系只在唯一时才选；有歧义不猜", () => {
  const brands = [{ id: "b1", name: "富香977" }, { id: "b2", name: "美华303" }, { id: "b3", name: "美华 306" }];
  assert.equal(S.matchBrand("富香 977", brands), "b1");
  assert.equal(S.matchBrand("富香977号", brands), "b1");
  assert.equal(S.matchBrand("美华", brands), "");   // 同时包含于美华303 和美华306，不猜
  assert.equal(S.matchBrand("不认识的种", brands), ""); assert.equal(S.matchBrand("", brands), "");
});

test("客户匹配：手机号优先；姓名唯一才选；同名多人当新客户", () => {
  const cs = [{ id: "c1", name: "小明", phone: "189-0019-2299" }, { id: "c2", name: "老王", phone: "" }, { id: "c3", name: "老王", phone: "" }];
  assert.equal(S.matchCustomer("别名", "18900192299", cs), "c1");
  assert.equal(S.matchCustomer("小明", "", cs), "c1");
  assert.equal(S.matchCustomer("老王", "", cs), "");
  assert.equal(S.matchCustomer("新人", "", cs), "");
});

test("重复检测：同客户、同日、同品种数量已有一笔 → 默认不勾；作废的单不算", () => {
  const ctx = { customers: [{ id: "c1", name: "小明" }], brands: [{ id: "b1", name: "富香977" }], sales: [{ customerId: "c1", date: "2026-03-30", lines: [{ brandId: "b1", qty: 300 }] }] };
  const [d] = S.resolveDrafts(S.normalizeAi(ai([one()]), { today }), ctx);
  assert.equal(d.dup, true); assert.equal(d.on, false);
  ctx.sales[0].status = "void";
  const [e] = S.resolveDrafts(S.normalizeAi(ai([one()]), { today }), ctx);
  assert.equal(e.dup, false); assert.equal(e.on, true);
});

test("方式与校验：收款 → 售卖方式；未选品种 / 缺客户 / 多收会报错；没勾的不检查", () => {
  assert.deepEqual([S.modeFor(0, 100), S.modeFor(30, 100), S.modeFor(100, 100)], ["credit", "partial", "cash"]);
  const ctx = { customers: [], brands: [{ id: "b1", name: "富香977" }], sales: [] };
  const ds = S.resolveDrafts(S.normalizeAi(ai([one({ lines: [{ brand: "不认识", qty: 10, price: 5 }] }), one({ customer: "", lines: [{ brand: "富香977", qty: 10, price: 5 }] }), one({ paid: 999, lines: [{ brand: "富香977", qty: 10, price: 5 }] })]), { today }), ctx);
  assert.deepEqual(S.validateDrafts(ds).map(e => e.key), ["brand", "customer", "paid"]);
  ds.forEach(d => { d.on = false; }); assert.deepEqual(S.validateDrafts(ds), []);
  assert.equal(S.totalOf(ds[2]), 50);
});

test("lenientJson：带代码围栏、前后有废话也能读", () => {
  assert.equal(S.lenientJson('```json\n{"a":1}\n```').a, 1);
  assert.equal(S.lenientJson('好的，结果如下：{"a":2} 完毕').a, 2);
  assert.throws(() => S.lenientJson("没有 json"));
});

test("提示词：带今天日期和已知品种；要求只回 JSON", () => {
  assert.match(S.userPrompt({ today, brands: ["富香977", "美华303"], text: "x" }), /Today is 2026-10-28[\s\S]*富香977, 美华303/);
  assert.match(S.SYSTEM, /ONLY JSON/);
});

test("文件读取：UTF-8 和 GBK（中文 Excel 另存的 CSV）都能解码；BOM 去掉", () => {
  assert.equal(F.decodeText(new TextEncoder().encode("﻿客户,斤").buffer), "客户,斤");
  assert.equal(F.decodeText(new Uint8Array([0xC4, 0xE3, 0xBA, 0xC3]).buffer), "你好");   // GBK 的「你好」
});

test("文字分段不丢行；敏感信息抹掉但保留手机号和姓名", () => {
  const text = Array.from({ length: 50 }, (_, i) => `行${i}`).join("\n");
  const chunks = F.chunkText(text, 60); assert.ok(chunks.length > 1); assert.equal(chunks.join("\n"), text);
  const r = F.redactSensitive("小明 18900192299 a@b.test 身份证 110101199001011234 卡 6222 0212 3456 7890 123");
  assert.match(r, /小明 18900192299/); assert.match(r, /\[邮箱\]/); assert.ok(!/110101199001011234/.test(r)); assert.ok(!/6222 0212/.test(r));
});
