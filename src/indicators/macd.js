'use strict';

function ema(values, period) {
  const n = values.length;
  const out = new Array(n).fill(NaN);
  if (n < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  seed /= period;
  out[period - 1] = seed;
  let prev = seed;
  for (let i = period; i < n; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * MACD(fast,slow,signal). closes — по возрастанию времени.
 * Возвращает { macdLine, signalLine, histogram } — массивы той же длины (NaN пока не хватает данных).
 */
function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const n = closes.length;
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(emaFast[i]) && Number.isFinite(emaSlow[i])) {
      macdLine[i] = emaFast[i] - emaSlow[i];
    }
  }
  const macdValid = macdLine.filter((v) => Number.isFinite(v));
  const signalOnValid = ema(macdValid, signalPeriod);
  const signalLine = new Array(n).fill(NaN);
  let validIdx = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(macdLine[i])) {
      signalLine[i] = signalOnValid[validIdx];
      validIdx++;
    }
  }
  const histogram = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(macdLine[i]) && Number.isFinite(signalLine[i])) {
      histogram[i] = macdLine[i] - signalLine[i];
    }
  }
  return { macdLine, signalLine, histogram };
}

/** Бычий MACD: линия выше сигнальной, а гистограмма растёт последние 2 бара. */
function isBullish(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const { macdLine, signalLine, histogram } = macd(closes, fast, slow, signalPeriod);
  const n = histogram.length;
  const h0 = histogram[n - 1];
  const h1 = histogram[n - 2];
  const h2 = histogram[n - 3];
  if (![h0, h1, h2].every(Number.isFinite)) return { bullish: false, histRising: false };
  const aboveSignal = macdLine[n - 1] > signalLine[n - 1];
  const histRising = h0 > h1 && h1 >= h2;
  return { bullish: aboveSignal && h0 > 0, histRising, macd: macdLine[n - 1], signal: signalLine[n - 1], histogram: h0 };
}

module.exports = { ema, macd, isBullish };
