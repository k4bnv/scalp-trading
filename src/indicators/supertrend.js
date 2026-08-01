'use strict';

/** True Range / ATR (Wilder smoothing). candles: [{high, low, close}] по возрастанию времени. */
function atr(candles, period = 10) {
  const n = candles.length;
  const tr = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tr[i] = candles[i].high - candles[i].low;
      continue;
    }
    const prevClose = candles[i - 1].close;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose)
    );
  }
  const out = new Array(n).fill(NaN);
  if (n < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += tr[i];
  seed /= period;
  out[period - 1] = seed;
  let prev = seed;
  for (let i = period; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/**
 * Supertrend. candles: [{high, low, close}] по возрастанию времени.
 * Возвращает массив { value, trend } где trend = 'up' | 'down' | null (пока не хватает данных).
 */
function supertrend(candles, period = 10, multiplier = 3) {
  const n = candles.length;
  const atrArr = atr(candles, period);
  const result = new Array(n).fill(null);

  let finalUpper = NaN;
  let finalLower = NaN;
  let trend = null; // 'up' | 'down'
  let stValue = NaN;

  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(atrArr[i])) {
      result[i] = { value: null, trend: null };
      continue;
    }
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const basicUpper = hl2 + multiplier * atrArr[i];
    const basicLower = hl2 - multiplier * atrArr[i];
    const close = candles[i].close;
    const prevClose = i > 0 ? candles[i - 1].close : close;

    if (!Number.isFinite(finalUpper)) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      trend = close >= hl2 ? 'up' : 'down';
      stValue = trend === 'up' ? finalLower : finalUpper;
      result[i] = { value: stValue, trend };
      continue;
    }

    finalUpper = basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
    finalLower = basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;

    if (trend === 'up') {
      trend = close < finalLower ? 'down' : 'up';
    } else {
      trend = close > finalUpper ? 'up' : 'down';
    }
    stValue = trend === 'up' ? finalLower : finalUpper;
    result[i] = { value: stValue, trend };
  }

  return result;
}

/** Последнее состояние Supertrend: { value, trend } или null. */
function lastSupertrend(candles, period = 10, multiplier = 3) {
  const arr = supertrend(candles, period, multiplier);
  return arr[arr.length - 1];
}

module.exports = { atr, supertrend, lastSupertrend };
