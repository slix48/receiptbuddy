import { strict as assert } from "node:assert";
import { calculateTip, parseMoney, parseReceiptText } from "./app.mjs";

assert.equal(parseMoney("$1,234.56"), 1234.56);
assert.equal(parseMoney("18.75"), 18.75);

const receipt = `
  Soup 8.50
  Coffee 3.25
  Subtotal 11.75
  Tax 0.97
  Total 12.72
  Visa 12.72
`;

const parsed = parseReceiptText(receipt);
assert.equal(parsed.total, 12.72);
assert.equal(parsed.candidates[0].amount, 12.72);

const split = calculateTip(100, 20, 4, false);
assert.equal(split.tip, 20);
assert.equal(split.grandTotal, 120);
assert.equal(split.perPerson, 30);

const rounded = calculateTip(42, 18, 1, true);
assert.equal(rounded.grandTotal, 50);
assert.equal(rounded.tip, 8);

console.log("Parser and calculator checks passed.");
