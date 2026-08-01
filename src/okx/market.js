'use strict';

const client = require('./client');

const INST_TYPE = 'SWAP';

/** Список всех live USDT-SWAP инструментов. */
async function getInstruments() {
  const res = await client.get('/api/v5/public/instruments', { instType: INST_TYPE });
  return (res && res.data) || [];
}

/** Тикеры по всем SWAP разом (24h change, vol, last, bid/ask). */
async function getAllTickers() {
  const res = await client.get('/api/v5/market/tickers', { instType: INST_TYPE });
  return (res && res.data) || [];
}

async function getTicker(instId) {
  const res = await client.get('/api/v5/market/ticker', { instId });
  return (res && res.data && res.data[0]) || null;
}

/** Свечи. bar: 1m | 5m | 15m | 1H. Возвращает по возрастанию времени. */
async function getCandles(instId, bar = '15m', limit = 100) {
  const res = await client.get('/api/v5/market/candles', { instId, bar, limit });
  const rows = (res && res.data) || [];
  // OKX отдаёт от новых к старым — разворачиваем
  return rows
    .map((c) => ({
      ts: Number(c[0]),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      vol: Number(c[5]),
      volCcyQuote: Number(c[7]),
    }))
    .reverse();
}

async function getFundingRate(instId) {
  const res = await client.get('/api/v5/public/funding-rate', { instId });
  return (res && res.data && res.data[0]) || null;
}

async function getOpenInterest(instId) {
  const res = await client.get('/api/v5/public/open-interest', { instType: INST_TYPE, instId });
  return (res && res.data && res.data[0]) || null;
}

/**
 * История OI (агрегированная по базовой валюте, rubik stat).
 * period: 5m | 1H | 1D
 */
async function getOpenInterestHistory(ccy, period = '1H') {
  const res = await client.get('/api/v5/rubik/stat/contracts/open-interest-volume', { ccy, period });
  const rows = (res && res.data) || [];
  return rows
    .map((r) => ({ ts: Number(r[0]), oiUsd: Number(r[1]), volUsd: Number(r[2]) }))
    .reverse();
}

/** Long/Short Account Ratio по контракту. period: 5m | 15m | 30m | 1H | 2H | 4H | ... */
async function getLongShortAccountRatioContract(instId, period = '5m') {
  const res = await client.get('/api/v5/rubik/stat/contracts/long-short-account-ratio-contract', {
    instId,
    period,
  });
  const rows = (res && res.data) || [];
  return rows.map((r) => ({ ts: Number(r[0]), longShortRatio: Number(r[1]) })).reverse();
}

/** Опционально: соотношение топ-трейдеров по позициям. */
async function getTopTraderPositionRatio(instId, period = '5m') {
  const res = await client.get(
    '/api/v5/rubik/stat/contracts/long-short-account-ratio-contract-top-trader',
    { instId, period }
  );
  const rows = (res && res.data) || [];
  return rows.map((r) => ({ ts: Number(r[0]), longShortRatio: Number(r[1]) })).reverse();
}

module.exports = {
  INST_TYPE,
  getInstruments,
  getAllTickers,
  getTicker,
  getCandles,
  getFundingRate,
  getOpenInterest,
  getOpenInterestHistory,
  getLongShortAccountRatioContract,
  getTopTraderPositionRatio,
};
