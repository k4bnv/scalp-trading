'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { atr, lastSupertrend } = require('../src/indicators/supertrend');

function makeTrendingCandles(n, startPrice, stepPct, rangePct = 0.5) {
  const candles = [];
  let close = startPrice;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = open * (1 + stepPct / 100);
    const high = Math.max(open, close) * (1 + rangePct / 100);
    const low = Math.min(open, close) * (1 - rangePct / 100);
    candles.push({ open, high, low, close });
  }
  return candles;
}

test('ATR положителен и определён после периода прогрева', () => {
  const candles = makeTrendingCandles(30, 100, 1);
  const arr = atr(candles, 10);
  assert.ok(Number.isNaN(arr[5]));
  assert.ok(Number.isFinite(arr[15]));
  assert.ok(arr[15] > 0);
});

test('Supertrend распознаёт устойчивый аптренд', () => {
  const candles = makeTrendingCandles(40, 100, 1.2);
  const st = lastSupertrend(candles, 10, 3);
  assert.ok(st);
  assert.equal(st.trend, 'up');
  assert.ok(st.value < candles[candles.length - 1].close);
});

test('Supertrend распознаёт устойчивый даунтренд', () => {
  const candles = makeTrendingCandles(40, 100, -1.2);
  const st = lastSupertrend(candles, 10, 3);
  assert.ok(st);
  assert.equal(st.trend, 'down');
  assert.ok(st.value > candles[candles.length - 1].close);
});

test('Supertrend возвращает null пока не хватает данных на ATR', () => {
  const candles = makeTrendingCandles(5, 100, 1);
  const st = lastSupertrend(candles, 10, 3);
  assert.equal(st.trend, null);
});
