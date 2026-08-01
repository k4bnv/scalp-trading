'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ratioToPct, detectCrowding, LsRatioStore } = require('../src/strategy/lsRatio');

test('ratioToPct: ratio=1 -> 50/50', () => {
  const { longPct, shortPct } = ratioToPct(1);
  assert.equal(longPct, 50);
  assert.equal(shortPct, 50);
});

test('ratioToPct: ratio=3 -> 75% long', () => {
  const { longPct, shortPct } = ratioToPct(3);
  assert.ok(Math.abs(longPct - 75) < 1e-9);
  assert.ok(Math.abs(shortPct - 25) < 1e-9);
});

test('detectCrowding: нет данных -> spike=false', () => {
  const res = detectCrowding([]);
  assert.equal(res.spike, false);
});

test('detectCrowding: longPct выше порога -> spike=true', () => {
  const history = [
    { ts: 1, longPct: 60 },
    { ts: 2, longPct: 62 },
    { ts: 3, longPct: 63 },
    { ts: 4, longPct: 79 },
  ];
  const res = detectCrowding(history, { crowdingLongPct: 78, crowdingDeltaPp: 8, lookbackBars: 3 });
  assert.equal(res.spike, true);
});

test('detectCrowding: быстрый рост Δ >= порога -> spike=true даже если абсолютный % не экстремален', () => {
  const history = [
    { ts: 1, longPct: 50 },
    { ts: 2, longPct: 52 },
    { ts: 3, longPct: 55 },
    { ts: 4, longPct: 60 }, // +10пп за 3 бара
  ];
  const res = detectCrowding(history, { crowdingLongPct: 78, crowdingDeltaPp: 8, lookbackBars: 3 });
  assert.equal(res.spike, true);
});

test('detectCrowding: умеренный стабильный longPct -> spike=false', () => {
  const history = [
    { ts: 1, longPct: 50 },
    { ts: 2, longPct: 51 },
    { ts: 3, longPct: 52 },
    { ts: 4, longPct: 53 },
  ];
  const res = detectCrowding(history, { crowdingLongPct: 78, crowdingDeltaPp: 8, lookbackBars: 3 });
  assert.equal(res.spike, false);
});

test('LsRatioStore: копит историю по инструменту и не дублирует одинаковый ts', () => {
  const store = new LsRatioStore(5);
  store.push('BTC-USDT-SWAP', 1000, 1.5);
  store.push('BTC-USDT-SWAP', 1000, 2.0); // тот же ts — игнорируется
  store.push('BTC-USDT-SWAP', 2000, 2.0);
  const hist = store.history('BTC-USDT-SWAP');
  assert.equal(hist.length, 2);
});

test('LsRatioStore: обрезает историю до maxBars', () => {
  const store = new LsRatioStore(3);
  for (let i = 0; i < 10; i++) store.push('X-USDT-SWAP', i, 1);
  assert.equal(store.history('X-USDT-SWAP').length, 3);
});
