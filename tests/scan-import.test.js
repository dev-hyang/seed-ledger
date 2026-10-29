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

test("方式与校验：收款 → 售卖方式；新品种缺种子公司 / 缺客户 / 多收会报错；没勾的不检查", () => {
  assert.deepEqual([S.modeFor(0, 100), S.modeFor(30, 100), S.modeFor(100, 100)], ["credit", "partial", "cash"]);
  const ctx = { customers: [], brands: [{ id: "b1", name: "富香977" }], sales: [], seasons: [{ id: "early", name: "早稻" }] };
  const ds = S.resolveDrafts(S.normalizeAi(ai([one({ lines: [{ brand: "不认识", qty: 10, price: 5 }] }), one({ customer: "", lines: [{ brand: "富香977", qty: 10, price: 5 }] }), one({ paid: 999, lines: [{ brand: "富香977", qty: 10, price: 5 }] })]), { today }), ctx);
  assert.deepEqual(S.validateDrafts(ds).map(e => e.key), ["nbSupplier", "customer", "paid"]);   // 不认识的品种变成新品种草稿：还差种子公司
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

/* ---------- 新品种、价格档、导入计划 ---------- */
const seasons = [{ id: "early", name: "早稻" }, { id: "late1", name: "一晚" }];
const baseCtx = (o = {}) => ({ customers: [], brands: [{ id: "b1", name: "富香977" }], sales: [], seasons, suppliers: [], ...o });

test("新品种：库里没有的品种自动成草稿；季节按单据文字猜；种子公司不自动选（哪怕只有一家）；零售价取单据上的单价", () => {
  const sup = [{ id: "s1", name: "富香种业" }];
  const [d] = S.resolveDrafts(S.normalizeAi(ai([one({ lines: [{ brand: "优香7号（一晚）", qty: 100, unit: "斤", price: 38 }] })]), { today }), baseCtx({ suppliers: sup }));
  const nb = d.lines[0].nb;
  assert.equal(d.lines[0].brandId, ""); assert.equal(nb.name, "优香7号（一晚）"); assert.equal(nb.seasonId, "late1");
  assert.equal(nb.supplierId, ""); assert.equal(nb.retail, 38); assert.equal(nb.wholesale, null);
  assert.deepEqual(S.validateDrafts([d]).map(x => x.key), ["nbSupplier"]);   // 只有一家公司也不替用户选：归属要用户确认（影响各公司盈亏报表）
  nb.supplierId = "s1"; assert.equal(S.validateDrafts([d]).length, 0);
  const [e] = S.resolveDrafts(S.normalizeAi(ai([one({ lines: [{ brand: "新种", qty: 1, price: 1 }] })]), { today }), baseCtx({ suppliers: [] }));
  assert.equal(e.lines[0].nb.seasonId, "early");   // 没写季节 → 第一个季节
  assert.deepEqual(S.validateDrafts([e]).map(x => x.key), ["nbSupplier"]);
  e.lines[0].nb.supplierName = "  新公司 "; assert.equal(S.validateDrafts([e]).length, 0);   // 填了新公司名称就行
});

test("价格档：单据没写单价时，按该客户的价格档（批发 / 零售）补；补了的会标记", () => {
  const priceFor = (id, year, tier) => priceOf({ retail: 35, wholesale: tier === "wholesale" ? 32 : null }, tier);
  const mk = tier => S.resolveDrafts(S.normalizeAi(ai([one({ lines: [{ brand: "富香977", qty: 100, unit: "斤" }] })]), { today }), baseCtx({ customers: [{ id: "c1", name: "小明", phone: "18900192299", tier }], priceFor }))[0];
  assert.deepEqual([mk("wholesale").tier, mk("wholesale").lines[0].price], ["wholesale", 32]);
  assert.deepEqual([mk("retail").tier, mk("retail").lines[0].price], ["retail", 35]);
  assert.equal(mk("retail").lines[0].note, "price:tier");
  const withPrice = S.resolveDrafts(S.normalizeAi(ai([one()]), { today }), baseCtx({ priceFor }))[0];
  assert.equal(withPrice.lines[0].price, 35);   // 单据上写了价格就不动
});

import { priceOf } from "../js/logic/pricing.js";
test("导入计划：先建种子公司，再建品种（带价格），再建客户，最后销售；同名只建一次；编号接着已有的", () => {
  const ctx = baseCtx({ sales: [], suppliers: [{ id: "s1", name: "富香种业" }, { id: "s2", name: "美华种业" }] });
  const ds = S.resolveDrafts(S.normalizeAi(ai([
    one({ customer: "张三", phone: "", lines: [{ brand: "优香7号", qty: 100, unit: "斤", price: 38 }, { brand: "富香977", qty: 50, price: 35 }], paid: 0 }),
    one({ customer: "张三", phone: "", date: "2026-05-01", lines: [{ brand: "优香7号", qty: 20, price: 40 }], paid: 500 }),
    one({ customer: "李四", phone: "13900001111", lines: [{ brand: "又一个新种", qty: 10, price: 50 }], paid: null })
  ]), { today }), ctx);
  const [b1, b2] = [ds[0].lines[0].nb, ds[2].lines[0].nb];
  b1.supplierId = "s2"; b1.wholesale = 36; b1.buy = 30;                  // 优香7号：已有公司美华
  b2.supplierId = ""; b2.supplierName = "新公司"; b2.seasonId = "late1";   // 又一个新种：新公司
  assert.equal(S.validateDrafts(ds).length, 0);
  const plan = S.planImport(ds, { counts: { 2026: 4 }, suppliers: ctx.suppliers });
  assert.deepEqual(plan.suppliers.map(s => s.name), ["新公司"]);
  assert.equal(plan.brands.length, 2);                                  // 优香7号只建一次（两笔销售共用）
  const u = plan.brands.find(b => b.name === "优香7号");
  assert.deepEqual([u.supplier, u.seasonId, u.buy, u.retail, u.wholesale, u.year], [{ id: "s2" }, "early", 30, 38, 36, 2026]);
  assert.ok(plan.brands.find(b => b.name === "又一个新种").supplier.key.startsWith("s:"));
  assert.equal(plan.customers.length, 2);                                // 张三两笔只建一个客户
  assert.deepEqual(plan.sales.map(s => s.no), ["2026-005", "2026-006", "2026-007"]);   // 接着已有的 4 笔编号（05-01 那笔也是 2026 年）
  assert.deepEqual(plan.sales.map(s => s.mode), ["credit", "partial", "credit"]);
  assert.deepEqual(plan.sales[0].lines.map(l => Object.keys(l.brand)[0]), ["key", "id"]);   // 新品种用 key，已有的用 id
  assert.equal(plan.sales[0].customer.key, plan.sales[1].customer.key);
});

test("导入计划：新公司名称和库里已有的重名（忽略空格大小写）就复用，不重复建", () => {
  const ctx = baseCtx({ suppliers: [{ id: "s1", name: "富香 种业" }] });
  const ds = S.resolveDrafts(S.normalizeAi(ai([one({ lines: [{ brand: "新种", qty: 1, price: 1 }] })]), { today }), { ...ctx, suppliers: [] });
  ds[0].lines[0].nb.supplierName = "富香种业";
  assert.deepEqual(S.planImport(ds, { suppliers: ctx.suppliers }).suppliers, []);
  assert.deepEqual(S.planImport(ds, { suppliers: ctx.suppliers }).brands[0].supplier, { id: "s1" });
});

test("扫描：单据上写明没收齐（赊账 / 定金）的默认标记待催账；没写收款的不猜；可手动改；导入计划带上标记；已收齐的不会被标记", () => {
  const ctx = baseCtx();
  const ds = S.resolveDrafts(S.normalizeAi(ai([one({ paid: 0 }), one({ paid: 1000, date: "2026-04-01" }), one({ paid: null, date: "2026-05-01" }), one({ paid: 3500, date: "2026-06-01", lines: [{ brand: "富香977", qty: 100, price: 35 }] })]), { today }), ctx);
  assert.deepEqual(ds.map(d => d.chase), [true, true, false, false]);   // 赊账 / 定金 → 标记；没写 → 不猜；收齐 → 不标记
  ds[2].chase = true;   // 用户手动勾上
  ds.forEach(d => { d.supplierId = ""; });
  const plan = S.planImport(ds.map(d => { d.on = true; d.lines.forEach(l => { if (l.nb) { l.nb.supplierName = "公司"; } }); return d; }), { counts: {}, suppliers: [] });
  assert.deepEqual(plan.sales.map(s => s.chase), [true, true, true, false]);
  ds[3].chase = true; assert.equal(S.planImport(ds, { counts: {}, suppliers: [] }).sales[3].chase, false);   // 收齐了还勾着：不会真标记（没有欠款可催）
});
