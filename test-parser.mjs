import { strict as assert } from "node:assert";
import { calculateTip, parseMoney, parseReceiptText } from "./app.mjs";

assert.equal(parseMoney("$1,234.56"), 1234.56);
assert.equal(parseMoney("18.75"), 18.75);
assert.equal(parseMoney("1.234,56"), 1234.56);
assert.equal(parseMoney("12 72"), 12.72);
assert.equal(parseMoney("$84"), 84);

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

const realReceipt = `
  Lorem Ipsum 48.0
  Lorem 9.30
  Lorem I 11.90
  Subtotal 76.80
  Sales Tax 8.00
  AMOUNT 84.80
`;
const actualTotal = parseReceiptText(realReceipt);
assert.equal(actualTotal.total, 84.80);
assert.equal(actualTotal.candidates[0].amount, 84.80);
assert.equal(actualTotal.candidates.length, 1);

const oneDecimalTotal = parseReceiptText(`
  Subtotal 76.80
  Sales Tax 8.00
  TOTAL 84.8
`);
assert.equal(oneDecimalTotal.total, 84.8);

const spacedDecimalTotal = parseReceiptText(`
  Burger 8.50
  Tax 0.97
  TOTAL 12 72
`);
assert.equal(spacedDecimalTotal.total, 12.72);

const wholeDollarTotal = parseReceiptText(`
  Sandwich 16.00
  Balance Due $18
`);
assert.equal(wholeDollarTotal.total, 18);

const amountTenderedOnly = parseReceiptText(`
  CASH TENDERED 20.00
  CHANGE 4.00
`);
assert.equal(amountTenderedOnly.total, 0);

const split = calculateTip(100, 20, 4, false);
assert.equal(split.tip, 20);
assert.equal(split.grandTotal, 120);
assert.equal(split.perPerson, 30);

const rounded = calculateTip(42, 18, 1, true);
assert.equal(rounded.grandTotal, 50);
assert.equal(rounded.tip, 8);

console.log("Parser and calculator checks passed.");
