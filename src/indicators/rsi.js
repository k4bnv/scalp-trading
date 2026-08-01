'use strict';

/**
 * Wilder's RSI. closes — массив цен закрытия по возрастанию времени.
 * Возвращает массив той же длины, первые `period` значений — NaN.
 */
function rsi(closes, period = 14) {
  const n = closes.length;
  const out = new Array(n).fill(NaN);
  if (n <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += -diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = computeRsi(avgGain, avgLoss);

  for (let i = period + 1; i < n; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = computeRsi(avgGain, avgLoss);
  }
  return out;
}

function computeRsi(avgGain, avgLoss) {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Последнее значение RSI (или null, если данных не хватает). */
function lastRsi(closes, period = 14) {
  const arr = rsi(closes, period);
  const v = arr[arr.length - 1];
  return Number.isFinite(v) ? v : null;
}

module.exports = { rsi, lastRsi };
