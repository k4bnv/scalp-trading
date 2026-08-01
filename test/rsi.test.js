'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rsi, lastRsi } = require('../src/indicators/rsi');

test('RSI возвращает NaN пока не хватает данных', () => {
  const closes = [1, 2, 3, 4, 5];
  const arr = rsi(closes, 14);
  assert.equal(arr.length, closes.length);
  assert.ok(arr.every((v) => Number.isNaN(v)));
});

test('RSI = 100 при непрерывном росте цены', () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
  const value = lastRsi(closes, 14);
  assert.equal(value, 100);
});

test('RSI = 0 при непрерывном падении цены', () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
  const value = lastRsi(closes, 14);
  assert.equal(value, 0);
});

test('RSI = 50 при постоянной цене (нет изменений)', () => {
  const closes = Array.from({ length: 20 }, () => 100);
  const value = lastRsi(closes, 14);
  assert.equal(value, 50);
});

test('RSI находится в диапазоне 0..100 для смешанного ряда', () => {
  const closes = [10, 10.5, 10.2, 10.8, 10.6, 11, 10.9, 11.3, 11.1, 11.5, 11.4, 11.8, 11.6, 12, 11.9, 12.3];
  const value = lastRsi(closes, 14);
  assert.ok(value > 0 && value < 100);
});
