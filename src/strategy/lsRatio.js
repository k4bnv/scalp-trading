'use strict';

const config = require('../config');

/** ratio = longShortAccountRatio (кол-во лонг-аккаунтов / кол-во шорт-аккаунтов). */
function ratioToPct(ratio) {
  const longPct = (ratio / (1 + ratio)) * 100;
  return { longPct, shortPct: 100 - longPct };
}

/**
 * Определяет "перегрев толпы" по истории longPct (по возрастанию времени).
 * lookbackBars — сколько 5m-баров назад сравнивать (10-15 минут = 2-3 бара).
 */
function detectCrowding(history, { crowdingLongPct = config.lsRatio.crowdingLongPct, crowdingDeltaPp = config.lsRatio.crowdingDeltaPp, lookbackBars = 3 } = {}) {
  if (!history || history.length === 0) {
    return { spike: false, longPct: null, deltaPp: null, reason: 'no-data' };
  }
  const last = history[history.length - 1];
  const longPct = last.longPct;

  const refIdx = Math.max(0, history.length - 1 - lookbackBars);
  const ref = history[refIdx];
  const deltaPp = ref ? longPct - ref.longPct : 0;

  const overThreshold = longPct >= crowdingLongPct;
  const fastRise = deltaPp >= crowdingDeltaPp;

  const spike = overThreshold || fastRise;
  let reason = null;
  if (overThreshold && fastRise) reason = `longPct=${longPct.toFixed(1)}% >= ${crowdingLongPct}% и рост Δ${deltaPp.toFixed(1)}п.п.`;
  else if (overThreshold) reason = `longPct=${longPct.toFixed(1)}% >= порога ${crowdingLongPct}%`;
  else if (fastRise) reason = `быстрый рост longPct: Δ${deltaPp.toFixed(1)}п.п. за ${lookbackBars} баров`;

  return { spike, longPct, deltaPp, reason };
}

/** Скользящее хранилище longPct-истории на инструмент, ограниченное maxBars. */
class LsRatioStore {
  constructor(maxBars = 60) {
    this.maxBars = maxBars;
    this.byInst = new Map();
  }

  push(instId, ts, ratio) {
    const { longPct, shortPct } = ratioToPct(ratio);
    const arr = this.byInst.get(instId) || [];
    if (arr.length === 0 || arr[arr.length - 1].ts !== ts) {
      arr.push({ ts, longPct, shortPct, ratio });
      if (arr.length > this.maxBars) arr.shift();
      this.byInst.set(instId, arr);
    }
    return arr;
  }

  history(instId) {
    return this.byInst.get(instId) || [];
  }

  crowding(instId, opts) {
    return detectCrowding(this.history(instId), opts);
  }
}

module.exports = { ratioToPct, detectCrowding, LsRatioStore };
