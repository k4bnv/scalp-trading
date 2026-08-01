'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function bool(v, def) {
  if (v === undefined || v === null || v === '') return def;
  return String(v).trim().toLowerCase() === 'true';
}

function num(v, def) {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function list(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const env = process.env;

const config = {
  okx: {
    apiKey: env.OKX_API_KEY || '',
    secretKey: env.OKX_SECRET_KEY || '',
    passphrase: env.OKX_PASSPHRASE || '',
    simulated: bool(env.OKX_SIMULATED, true),
    baseUrl: env.OKX_BASE_URL || 'https://www.okx.com',
  },

  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN || '',
    chatId: env.TELEGRAM_CHAT_ID || '',
  },

  autoTrade: bool(env.AUTO_TRADE, false),
  dryRun: bool(env.DRY_RUN, true),

  screener: {
    symbolBlacklist: list(env.SYMBOL_BLACKLIST),
    minQuoteVolumeUsdt: num(env.MIN_24H_QUOTE_VOLUME_USDT, 3_000_000),
    minOiUsd: num(env.MIN_OI_USD, 500_000),
    min24hChangePct: num(env.MIN_24H_CHANGE_PCT, 3),
    max24hChangePct: num(env.MAX_24H_CHANGE_PCT, 18),
    maxAbsFundingRate: num(env.MAX_ABS_FUNDING_RATE, 0.0005),
    minMaxLever: num(env.MIN_MAX_LEVER, 10),
    maxSpreadPct: num(env.MAX_SPREAD_PCT, 0.0015),
    minEntryScore: num(env.MIN_ENTRY_SCORE, 7.5),
  },

  lsRatio: {
    period: env.LS_RATIO_PERIOD || '5m',
    crowdingLongPct: num(env.LS_CROWDING_LONG_PCT, 78),
    crowdingDeltaPp: num(env.LS_CROWDING_DELTA_PP, 8),
    enableShortFade: bool(env.ENABLE_CROWDING_SHORT_FADE, false),
  },

  risk: {
    riskUsdPerTrade: num(env.RISK_USD_PER_TRADE, 5),
    maxPortfolioRiskPct: num(env.MAX_PORTFOLIO_RISK_PCT, 15),
    maxOpenPositions: num(env.MAX_OPEN_POSITIONS, 1),
    defaultLeverage: num(env.DEFAULT_LEVERAGE, 8),
    maxLeverage: num(env.MAX_LEVERAGE, 20),
    highLeverageMinScore: num(env.HIGH_LEVERAGE_MIN_SCORE, 8.5),
    mgnMode: env.MGN_MODE || 'isolated',

    tp1Pct: num(env.TP1_PCT, 2.0),
    tp1CloseRatio: num(env.TP1_CLOSE_RATIO, 0.6),
    slPct: num(env.SL_PCT, 2.0),
    trailPct: num(env.TRAIL_PCT, 1.0),
    maxEntryChasePct: num(env.MAX_ENTRY_CHASE_PCT, 0.4),
    tradeTimeoutMin: num(env.TRADE_TIMEOUT_MIN, 25),
  },

  guards: {
    dailyLossLimitUsd: num(env.DAILY_LOSS_LIMIT_USD, 20),
    dailyLossLimitPct: num(env.DAILY_LOSS_LIMIT_PCT, 10),
    maxTradesPerDay: num(env.MAX_TRADES_PER_DAY, 10),
    cooldownAfterLosses: num(env.COOLDOWN_AFTER_LOSSES, 2),
    cooldownMinutes: num(env.COOLDOWN_MINUTES, 45),
    apiErrorStreakHalt: num(env.API_ERROR_STREAK_HALT, 5),
  },

  loop: {
    scanIntervalSec: num(env.SCAN_INTERVAL_SEC, 90),
    manageIntervalSec: num(env.MANAGE_INTERVAL_SEC, 15),
  },
};

module.exports = config;
