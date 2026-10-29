import test from "node:test";
import assert from "node:assert/strict";
import { normalizePrice, priceOf, tierOf } from "../js/logic/pricing.js";

test("旧记录只有 presale：当零售价；批发价为空", () => {
  assert.deepEqual(normalizePrice({ buy: 28, presale: 35 }), { buy: 28, retail: 35, wholesale: null });
  assert.deepEqual(normalizePrice(undefined), { buy: 0, retail: 0, wholesale: null });
});
test("新记录：零售 / 批发各自独立；retail 优先于 presale", () => {
  assert.deepEqual(normalizePrice({ buy: 28, retail: 36, wholesale: 32, presale: 35 }), { buy: 28, retail: 36, wholesale: 32 });
  assert.equal(normalizePrice({ wholesale: "" }).wholesale, null);
});
test("按档取价：批发档没设批发价就用零售价", () => {
  assert.equal(priceOf({ retail: 36, wholesale: 32 }, "wholesale"), 32);
  assert.equal(priceOf({ retail: 36, wholesale: 32 }, "retail"), 36);
  assert.equal(priceOf({ retail: 36, wholesale: null }, "wholesale"), 36);
  assert.equal(tierOf("wholesale"), "wholesale"); assert.equal(tierOf("x"), "retail"); assert.equal(tierOf(undefined), "retail");
});
