'use strict';

const crypto = require('node:crypto');
const client = require('./client');

/** Короткий уникальный clOrdId (<=32 символов, только буквы/цифры), для идемпотентности входа. */
function genClOrdId(prefix = 'ems') {
  const rand = crypto.randomBytes(6).toString('hex');
  const stamp = Date.now().toString(36);
  return `${prefix}${stamp}${rand}`.slice(0, 32);
}

async function getBalance(ccy = 'USDT') {
  const res = await client.getPrivate('/api/v5/account/balance', { ccy });
  const acc = (res && res.data && res.data[0]) || null;
  if (!acc) return null;
  const detail = (acc.details || []).find((d) => d.ccy === ccy) || null;
  return {
    totalEq: Number(acc.totalEq || 0),
    availEq: Number(acc.availEq || (detail && detail.availEq) || 0),
    detail,
  };
}

async function getPositions(instId) {
  const query = { instType: 'SWAP' };
  if (instId) query.instId = instId;
  const res = await client.getPrivate('/api/v5/account/positions', query);
  return (res && res.data) || [];
}

async function setLeverage(instId, lever, mgnMode = 'isolated', posSide = 'net') {
  const body = { instId, lever: String(lever), mgnMode };
  if (mgnMode === 'isolated' && posSide !== 'net') body.posSide = posSide;
  return client.post('/api/v5/account/set-leverage', body);
}

/**
 * Лимитный вход в LONG (buy).
 * tdMode = mgnMode ('isolated'|'cross'); posSide 'net' т.к. используем net-режим аккаунта.
 */
async function placeLimitOrder({ instId, side, sz, px, tdMode = 'isolated', clOrdId, reduceOnly = false }) {
  const body = {
    instId,
    tdMode,
    side,
    ordType: 'limit',
    sz: String(sz),
    px: String(px),
    clOrdId: clOrdId || genClOrdId(),
    reduceOnly: reduceOnly ? 'true' : 'false',
  };
  return client.post('/api/v5/trade/order', body);
}

async function placeMarketOrder({ instId, side, sz, tdMode = 'isolated', clOrdId, reduceOnly = false }) {
  const body = {
    instId,
    tdMode,
    side,
    ordType: 'market',
    sz: String(sz),
    clOrdId: clOrdId || genClOrdId(),
    reduceOnly: reduceOnly ? 'true' : 'false',
  };
  return client.post('/api/v5/trade/order', body);
}

async function getOrder(instId, ordId) {
  const res = await client.getPrivate('/api/v5/trade/order', { instId, ordId });
  return (res && res.data && res.data[0]) || null;
}

async function cancelOrder(instId, ordId) {
  return client.post('/api/v5/trade/cancel-order', { instId, ordId });
}

/**
 * OCO-алгоордер TP/SL на часть или всю позицию.
 * side='sell' закрывает long. sz — размер контрактов, закрываемых этим алго-ордером.
 */
async function placeTpSlOco({ instId, side, sz, tpTriggerPx, tpOrdPx = '-1', slTriggerPx, slOrdPx = '-1', tdMode = 'isolated', algoClOrdId }) {
  const body = {
    instId,
    tdMode,
    side,
    posSide: 'net',
    ordType: 'oco',
    sz: String(sz),
    reduceOnly: 'true',
    tpTriggerPx: tpTriggerPx !== undefined ? String(tpTriggerPx) : undefined,
    tpOrdPx: tpTriggerPx !== undefined ? String(tpOrdPx) : undefined,
    slTriggerPx: slTriggerPx !== undefined ? String(slTriggerPx) : undefined,
    slOrdPx: slTriggerPx !== undefined ? String(slOrdPx) : undefined,
    algoClOrdId: algoClOrdId || genClOrdId('algo'),
  };
  return client.post('/api/v5/trade/order-algo', body);
}

/** Только SL (используется для move-to-BE и трейлинга через переустановку). */
async function placeStopOrder({ instId, side, sz, slTriggerPx, slOrdPx = '-1', tdMode = 'isolated', algoClOrdId }) {
  const body = {
    instId,
    tdMode,
    side,
    posSide: 'net',
    ordType: 'conditional',
    sz: String(sz),
    reduceOnly: 'true',
    slTriggerPx: String(slTriggerPx),
    slOrdPx: String(slOrdPx),
    algoClOrdId: algoClOrdId || genClOrdId('sl'),
  };
  return client.post('/api/v5/trade/order-algo', body);
}

async function cancelAlgoOrders(instId, algoIds) {
  const body = algoIds.map((algoId) => ({ instId, algoId }));
  return client.post('/api/v5/trade/cancel-algos', body);
}

async function getAlgoOrders(instId, ordType = 'oco') {
  const res = await client.getPrivate('/api/v5/trade/orders-algo-pending', { instId, ordType });
  return (res && res.data) || [];
}

async function closePosition(instId, mgnMode = 'isolated', posSide = 'net') {
  return client.post('/api/v5/trade/close-position', { instId, mgnMode, posSide });
}

module.exports = {
  genClOrdId,
  getBalance,
  getPositions,
  setLeverage,
  placeLimitOrder,
  placeMarketOrder,
  getOrder,
  cancelOrder,
  placeTpSlOco,
  placeStopOrder,
  cancelAlgoOrders,
  getAlgoOrders,
  closePosition,
};
