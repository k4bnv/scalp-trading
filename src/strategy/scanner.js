'use strict';

const config = require('../config');
const logger = require('../util/logger');
const market = require('../okx/market');
const { rsi: rsiSeries, lastRsi } = require('../indicators/rsi');
const { isBullish } = require('../indicators/macd');
const { lastSupertrend } = require('../indicators/supertrend');
const { scoreCandidate } = require('./scorer');
const { mapPool } = require('../util/pool');

const STABLE_BASES = new Set(['USDC', 'DAI', 'TUSD', 'FDUSD', 'USDD', 'PYUSD', 'USDE', 'EUR', 'USDK']);

function pct(a, b) {
  if (!b) return null;
  return ((a - b) / b) * 100;
}

/** Первичный отбор вселенной по мгновенным тикерам/инструментам, без тяжёлых запросов. */
async function buildHardFilteredUniverse(lsStore) {
  const [instruments, tickers] = await Promise.all([market.getInstruments(), market.getAllTickers()]);

  const instMap = new Map(instruments.map((i) => [i.instId, i]));
  const cfg = config.screener;
  const candidates = [];

  for (const t of tickers) {
    const inst = instMap.get(t.instId);
    if (!inst) continue;
    if (inst.state !== 'live') continue;
    if (!t.instId.endsWith('-USDT-SWAP')) continue;

    const base = t.instId.split('-')[0];
    if (STABLE_BASES.has(base)) continue;
    if (cfg.symbolBlacklist.includes(t.instId) || cfg.symbolBlacklist.includes(base)) continue;

    const last = Number(t.last);
    const open24h = Number(t.open24h);
    const askPx = Number(t.askPx);
    const bidPx = Number(t.bidPx);
    if (!last || !open24h || !askPx || !bidPx) continue;

    const change24hPct = pct(last, open24h);
    if (change24hPct === null || change24hPct < cfg.min24hChangePct || change24hPct > cfg.max24hChangePct) continue;

    const mid = (askPx + bidPx) / 2;
    const spreadPct = (askPx - bidPx) / mid;
    if (spreadPct > cfg.maxSpreadPct) continue;

    const volCcy24h = Number(t.volCcy24h || 0);
    const quoteVolumeUsdt = volCcy24h * last;
    if (quoteVolumeUsdt < cfg.minQuoteVolumeUsdt) continue;

    const maxLever = Number(inst.lever || 0);
    if (maxLever && maxLever < cfg.minMaxLever) continue;

    candidates.push({
      instId: t.instId,
      base,
      inst,
      ticker: t,
      last,
      open24h,
      high24h: Number(t.high24h),
      low24h: Number(t.low24h),
      askPx,
      bidPx,
      spreadPct,
      change24hPct,
      quoteVolumeUsdt,
      maxLever,
    });
  }

  logger.debug(`Скрининг: ${tickers.length} тикеров -> ${candidates.length} прошли hard filters`);
  return candidates;
}

/** Тяжёлое обогащение кандидата: свечи, индикаторы, OI, funding, long/short ratio. */
async function enrichCandidate(c, lsStore) {
  const [c15, c1h, oi, funding, lsHist] = await Promise.all([
    market.getCandles(c.instId, '15m', 100),
    market.getCandles(c.instId, '1H', 100),
    market.getOpenInterest(c.instId),
    market.getFundingRate(c.instId),
    market.getLongShortAccountRatioContract(c.instId, config.lsRatio.period).catch(() => []),
  ]);

  if (c15.length < 30 || c1h.length < 30) return null;

  const closes15 = c15.map((x) => x.close);
  const closes1h = c1h.map((x) => x.close);

  const st15m = lastSupertrend(c15, 10, 3);
  const st1h = lastSupertrend(c1h, 10, 3);
  const rsi15m = lastRsi(closes15, 14);
  const rsi1h = lastRsi(closes1h, 14);
  const macd15m = isBullish(closes15);

  let oiUsd = null;
  if (oi) {
    oiUsd = Number(oi.oiUsd) || Number(oi.oiCcy || 0) * c.last;
  }

  let fundingRate = funding ? Number(funding.fundingRate) : null;

  // OI тренд: сравниваем текущий OI% против ~1ч назад по 15m свечам объёма как прокси,
  // и через историю OI (агрегированную по базовой валюте), если доступна.
  let oiTrend = null;
  try {
    const oiHist = await market.getOpenInterestHistory(c.base, '1H');
    if (oiHist.length >= 2) {
      const now = oiHist[oiHist.length - 1].oiUsd;
      const before = oiHist[Math.max(0, oiHist.length - 5)].oiUsd;
      if (Number.isFinite(now) && Number.isFinite(before) && before > 0) {
        const delta = ((now - before) / before) * 100;
        if (delta > 1) oiTrend = 'up';
        else if (delta < -1) oiTrend = 'down';
        else oiTrend = 'flat';
      }
    }
  } catch (_) {
    // OI history опционален — недоступность не блокирует скоринг
  }

  let crowding = null;
  if (lsHist.length) {
    for (const row of lsHist) lsStore.push(c.instId, row.ts, row.longShortRatio);
    crowding = lsStore.crowding(c.instId);
  }

  const pullbackFromHighPct = c.high24h ? pct(c.high24h, c.last) === null ? null : ((c.high24h - c.last) / c.high24h) * 100 : null;

  const metrics = {
    ...c,
    st15m,
    st1h,
    rsi15m,
    rsi1h,
    macd15m,
    oiUsd,
    oiTrend,
    fundingRate,
    crowding,
    pullbackFromHighPct,
  };

  if (oiUsd !== null && oiUsd < config.screener.minOiUsd) return null;
  if (fundingRate !== null && Math.abs(fundingRate) >= config.screener.maxAbsFundingRate * 3) return null; // явный экстрим — сразу мимо

  return metrics;
}

/** Полный проход скрининга: hard filters -> обогащение -> скоринг -> сортировка по score desc. */
async function scan(lsStore) {
  const universe = await buildHardFilteredUniverse(lsStore);
  const enriched = await mapPool(universe, 2, (c) => enrichCandidate(c, lsStore));

  const results = [];
  for (const m of enriched) {
    if (!m || m.__error) continue;
    const { score, reasons, hardSkip, skipReason } = scoreCandidate(m);
    results.push({ ...m, score, reasons, hardSkip, skipReason });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

module.exports = { scan, buildHardFilteredUniverse, enrichCandidate, STABLE_BASES };
