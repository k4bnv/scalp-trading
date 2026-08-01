'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseLeverage, computeSize, checkPortfolioRiskCap } = require('../src/execution/risk');

test('chooseLeverage: обычный score -> дефолтное плечо', () => {
  const lever = chooseLeverage(7.5, 50, { defaultLeverage: 8, maxLeverage: 20, highLeverageMinScore: 8.5 });
  assert.equal(lever, 8);
});

test('chooseLeverage: высокий score -> максимальное плечо', () => {
  const lever = chooseLeverage(9, 50, { defaultLeverage: 8, maxLeverage: 20, highLeverageMinScore: 8.5 });
  assert.equal(lever, 20);
});

test('chooseLeverage: ограничено максимальным плечом инструмента', () => {
  const lever = chooseLeverage(9, 12, { defaultLeverage: 8, maxLeverage: 20, highLeverageMinScore: 8.5 });
  assert.equal(lever, 12);
});

test('computeSize: считает размер контрактов по марже и плечу', () => {
  const res = computeSize({ marginUsd: 5, leverage: 10, entryPrice: 2, ctVal: 1, lotSz: 1, minSz: 1 });
  // notional = 50 USD, sz = 50 / (1*2) = 25 контрактов
  assert.equal(res.ok, true);
  assert.equal(res.sz, 25);
  assert.equal(res.notionalUsd, 50);
});

test('computeSize: округляет вниз до шага лота', () => {
  const res = computeSize({ marginUsd: 5, leverage: 10, entryPrice: 3, ctVal: 1, lotSz: 5, minSz: 5 });
  // notional = 50, raw sz = 16.67 -> округление до шага 5 -> 15
  assert.equal(res.ok, true);
  assert.equal(res.sz, 15);
});

test('computeSize: возвращает ok=false если размер меньше минимального лота', () => {
  const res = computeSize({ marginUsd: 1, leverage: 5, entryPrice: 1000, ctVal: 1, lotSz: 1, minSz: 10 });
  assert.equal(res.ok, false);
});

test('checkPortfolioRiskCap: разрешает вход в пределах лимита', () => {
  const res = checkPortfolioRiskCap({ accountEquityUsd: 100, currentOpenMarginUsd: 5, newMarginUsd: 5, maxPortfolioRiskPct: 15 });
  assert.equal(res.allowed, true);
});

test('checkPortfolioRiskCap: запрещает вход, превышающий лимит', () => {
  const res = checkPortfolioRiskCap({ accountEquityUsd: 100, currentOpenMarginUsd: 12, newMarginUsd: 5, maxPortfolioRiskPct: 15 });
  assert.equal(res.allowed, false);
});

test('checkPortfolioRiskCap: без equity — запрет с понятной причиной', () => {
  const res = checkPortfolioRiskCap({ accountEquityUsd: 0, currentOpenMarginUsd: 0, newMarginUsd: 5, maxPortfolioRiskPct: 15 });
  assert.equal(res.allowed, false);
  assert.match(res.reason, /equity/);
});
