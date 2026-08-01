'use strict';

const config = require('../config');

/** Плечо для сделки: по умолчанию, либо максимум при очень высоком score и хорошей ликвидности. */
function chooseLeverage(score, instMaxLever, cfg = config.risk) {
  let lever = cfg.defaultLeverage;
  if (score >= cfg.highLeverageMinScore) {
    lever = cfg.maxLeverage;
  }
  if (Number.isFinite(instMaxLever) && instMaxLever > 0) {
    lever = Math.min(lever, instMaxLever);
  }
  return Math.max(1, Math.floor(lever));
}

/**
 * Размер позиции в контрактах.
 * marginUsd — маржа сделки (RISK_USD_PER_TRADE), leverage — плечо.
 * ctVal — стоимость 1 контракта в базовой валюте (из /public/instruments), entryPrice — цена входа.
 * lotSz/minSz — шаг и минимальный размер контракта у инструмента.
 */
function computeSize({ marginUsd, leverage, entryPrice, ctVal, lotSz = 1, minSz = 1 }) {
  if (!(marginUsd > 0) || !(leverage > 0) || !(entryPrice > 0) || !(ctVal > 0)) {
    return { sz: 0, notionalUsd: 0, ok: false, reason: 'некорректные входные параметры' };
  }
  const notionalUsd = marginUsd * leverage;
  const rawSz = notionalUsd / (ctVal * entryPrice);
  const steps = Math.floor(rawSz / lotSz);
  const sz = steps * lotSz;
  if (sz < minSz || sz <= 0) {
    return { sz: 0, notionalUsd, ok: false, reason: 'размер меньше минимального лота инструмента' };
  }
  return { sz, notionalUsd, ok: true };
}

/** Проверка лимита совокупного риска портфеля (сумма маржи открытых позиций + новой). */
function checkPortfolioRiskCap({ accountEquityUsd, currentOpenMarginUsd, newMarginUsd, maxPortfolioRiskPct = config.risk.maxPortfolioRiskPct }) {
  if (!(accountEquityUsd > 0)) {
    return { allowed: false, reason: 'не удалось определить equity аккаунта' };
  }
  const projectedPct = ((currentOpenMarginUsd + newMarginUsd) / accountEquityUsd) * 100;
  if (projectedPct > maxPortfolioRiskPct) {
    return { allowed: false, reason: `совокупный риск ${projectedPct.toFixed(1)}% превысит лимит ${maxPortfolioRiskPct}%` };
  }
  return { allowed: true, projectedPct };
}

/**
 * Совокупная проверка защит перед входом. store — экземпляр state/store.js.
 * accountEquityUsd нужен для дневного лимита в % и портфельного риска.
 */
function checkGuards(store, accountEquityUsd, cfg = config) {
  if (store.isStopped()) {
    return { allowed: false, reason: 'установлен kill switch (STOP)' };
  }
  if (store.isHaltedForToday()) {
    return { allowed: false, reason: `дневной halt: ${store.state.daily.haltReason || 'лимит убытка/сделок'}` };
  }
  if (store.isInCooldown()) {
    return { allowed: false, reason: `cooldown после серии убытков, осталось ${store.cooldownRemainingMin()} мин` };
  }
  if (store.countOpenPositions() >= cfg.risk.maxOpenPositions) {
    return { allowed: false, reason: `достигнут MAX_OPEN_POSITIONS=${cfg.risk.maxOpenPositions}` };
  }
  if (store.tradesRemainingToday(cfg.guards.maxTradesPerDay) <= 0) {
    return { allowed: false, reason: `достигнут дневной лимит сделок (${cfg.guards.maxTradesPerDay})` };
  }

  const daily = store.state.daily;
  if (daily.pnlUsd <= -cfg.guards.dailyLossLimitUsd) {
    return { allowed: false, reason: `дневной убыток ${daily.pnlUsd.toFixed(2)} USDT достиг лимита -${cfg.guards.dailyLossLimitUsd}` };
  }
  if (accountEquityUsd > 0) {
    const lossPct = (-daily.pnlUsd / accountEquityUsd) * 100;
    if (lossPct >= cfg.guards.dailyLossLimitPct) {
      return { allowed: false, reason: `дневной убыток ${lossPct.toFixed(1)}% достиг лимита ${cfg.guards.dailyLossLimitPct}%` };
    }
  }

  return { allowed: true };
}

/** Вызывать после закрытия сделки — обновляет daily pnl/streak и, если нужно, включает halt/cooldown. */
function onTradeClosed(store, pnlUsd, cfg = config) {
  store.recordTradeClosed({ pnlUsd });

  const daily = store.state.daily;
  if (daily.consecutiveLosses >= cfg.guards.cooldownAfterLosses) {
    store.startCooldown(cfg.guards.cooldownMinutes);
  }
  if (daily.pnlUsd <= -cfg.guards.dailyLossLimitUsd) {
    store.haltForToday(`дневной убыток ${daily.pnlUsd.toFixed(2)} USDT`);
  }
}

module.exports = {
  chooseLeverage,
  computeSize,
  checkPortfolioRiskCap,
  checkGuards,
  onTradeClosed,
};
