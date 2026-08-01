'use strict';

const config = require('../config');
const logger = require('../util/logger');
const store = require('../state/store');
const okxTrade = require('../okx/trade');
const okxMarket = require('../okx/market');
const risk = require('./risk');
const notify = require('../notify/telegram');
const { lastSupertrend } = require('../indicators/supertrend');
const { lastRsi } = require('../indicators/rsi');

const pendingEntries = new Set();

function isLiveTrading() {
  return config.autoTrade && !config.dryRun;
}

function swingLow(candles, lookback = 10) {
  const slice = candles.slice(-lookback);
  return Math.min(...slice.map((c) => c.low));
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function computeStops(entryPrice, st15mValue, swingLowPx, cfg = config.risk) {
  const structural = Number.isFinite(st15mValue) && Number.isFinite(swingLowPx) ? Math.min(st15mValue, swingLowPx) : swingLowPx || st15mValue;
  let slPct = cfg.slPct;
  if (Number.isFinite(structural) && structural < entryPrice) {
    const structuralPct = ((entryPrice - structural) / entryPrice) * 100;
    slPct = clamp(structuralPct, 1.5, 3.0);
  }
  const sl = entryPrice * (1 - slPct / 100);
  const tp1 = entryPrice * (1 + cfg.tp1Pct / 100);
  return { sl, tp1, slPct };
}

function getInstMeta(inst) {
  return {
    ctVal: Number(inst.ctVal || 1),
    lotSz: Number(inst.lotSz || 1),
    minSz: Number(inst.minSz || inst.lotSz || 1),
  };
}

async function getEquityUsd() {
  if (!config.okx.apiKey) return null;
  try {
    const bal = await okxTrade.getBalance('USDT');
    return bal ? bal.totalEq : null;
  } catch (err) {
    logger.error('Не удалось получить баланс аккаунта', { error: err.message });
    return null;
  }
}

function sumOpenMarginUsd() {
  const positions = store.getOpenPositions();
  return Object.values(positions).reduce((sum, p) => sum + (p.marginUsd || 0), 0);
}

/** Пытается войти в LONG по кандидату, прошедшему скоринг. */
async function tryEnter(candidate) {
  const { instId } = candidate;

  if (store.getOpenPosition(instId) || pendingEntries.has(instId)) {
    return { entered: false, reason: 'уже есть позиция или вход в процессе' };
  }

  const equityUsd = await getEquityUsd();
  const guardCheck = risk.checkGuards(store, equityUsd || 0);
  if (!guardCheck.allowed) {
    logger.info(`Вход по ${instId} отклонён защитами: ${guardCheck.reason}`);
    return { entered: false, reason: guardCheck.reason };
  }

  pendingEntries.add(instId);
  try {
    const entryPrice = candidate.bidPx || candidate.last;
    const st15mVal = candidate.st15m && candidate.st15m.value;
    let swingLowPx = null;
    try {
      const c15 = await okxMarket.getCandles(instId, '15m', 20);
      swingLowPx = swingLow(c15, 10);
    } catch (_) {
      swingLowPx = null;
    }

    const { sl, tp1 } = computeStops(entryPrice, st15mVal, swingLowPx);

    const marginUsd = store.state.riskUsdOverride || config.risk.riskUsdPerTrade;
    const leverage = risk.chooseLeverage(candidate.score, candidate.maxLever);

    const portfolioCheck = equityUsd
      ? risk.checkPortfolioRiskCap({
          accountEquityUsd: equityUsd,
          currentOpenMarginUsd: sumOpenMarginUsd(),
          newMarginUsd: marginUsd,
        })
      : { allowed: true };
    if (!portfolioCheck.allowed) {
      logger.info(`Вход по ${instId} отклонён: ${portfolioCheck.reason}`);
      return { entered: false, reason: portfolioCheck.reason };
    }

    const meta = getInstMeta(candidate.inst);
    const sizing = risk.computeSize({ marginUsd, leverage, entryPrice, ...meta });
    if (!sizing.ok) {
      logger.info(`Вход по ${instId} отклонён: ${sizing.reason}`);
      return { entered: false, reason: sizing.reason };
    }

    const signalPayload = { ...candidate, entry: entryPrice, sl, tp1, leverage };
    await notify.notifySignal(signalPayload);

    const clOrdId = okxTrade.genClOrdId();
    if (store.hasSeenClOrdId(clOrdId)) {
      return { entered: false, reason: 'дубликат clOrdId (идемпотентность)' };
    }
    store.rememberClOrdId(clOrdId);

    const mode = isLiveTrading() ? 'live' : 'paper';
    let ordId = null;
    let filled = true;
    let filledPrice = entryPrice;
    let algoIds = [];

    if (mode === 'live') {
      await okxTrade.setLeverage(instId, leverage, config.risk.mgnMode);
      const orderRes = await okxTrade.placeLimitOrder({
        instId,
        side: 'buy',
        sz: sizing.sz,
        px: entryPrice,
        tdMode: config.risk.mgnMode,
        clOrdId,
      });
      const orderData = orderRes && orderRes.data && orderRes.data[0];
      if (!orderData || orderData.sCode !== '0') {
        logger.error('Ошибка размещения входного ордера', { instId, orderRes });
        await notify.notifyError(`вход ${instId}`, new Error((orderData && orderData.sMsg) || 'unknown order error'));
        return { entered: false, reason: 'ошибка биржи при размещении ордера' };
      }
      ordId = orderData.ordId;

      filled = await waitForFill(instId, ordId, { attempts: 5, delayMs: 2000, maxChasePct: config.risk.maxEntryChasePct, entryPrice });
      if (!filled) {
        await okxTrade.cancelOrder(instId, ordId).catch(() => {});
        logger.info(`Вход по ${instId} отменён: не исполнился, цена ушла — не догоняем`);
        return { entered: false, reason: 'лимитный ордер не исполнился вовремя' };
      }
      const filledOrder = await okxTrade.getOrder(instId, ordId).catch(() => null);
      filledPrice = filledOrder && Number(filledOrder.avgPx) ? Number(filledOrder.avgPx) : entryPrice;

      const ocoRes = await okxTrade.placeTpSlOco({
        instId,
        side: 'sell',
        sz: sizing.sz,
        tpTriggerPx: tp1,
        slTriggerPx: sl,
        tdMode: config.risk.mgnMode,
      });
      const ocoData = ocoRes && ocoRes.data && ocoRes.data[0];
      if (!ocoData || ocoData.sCode !== '0') {
        logger.error('Не удалось выставить OCO TP/SL', { instId, ocoRes });
        await notify.notifyError(`OCO ${instId}`, new Error((ocoData && ocoData.sMsg) || 'unknown algo error'));
      } else {
        algoIds = [ocoData.algoId];
      }
    }

    const position = {
      instId,
      side: 'long',
      mode,
      entryPrice: filledPrice,
      sz: sizing.sz,
      remainingRatio: 1,
      marginUsd,
      leverage,
      notionalUsd: sizing.notionalUsd,
      sl,
      initialSl: sl,
      tp1,
      tp1Filled: false,
      tp1CloseRatio: config.risk.tp1CloseRatio,
      trailPct: config.risk.trailPct,
      highWaterMark: filledPrice,
      openedAt: Date.now(),
      clOrdId,
      ordId,
      algoIds,
      score: candidate.score,
      ctVal: meta.ctVal,
    };
    store.setOpenPosition(instId, position);
    await notify.notifyOpened(position);
    logger.info(`Открыта позиция ${instId} (${mode})`, position);
    return { entered: true, position };
  } finally {
    pendingEntries.delete(instId);
  }
}

async function waitForFill(instId, ordId, { attempts, delayMs, maxChasePct, entryPrice }) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    const order = await okxTrade.getOrder(instId, ordId).catch(() => null);
    if (order && order.state === 'filled') return true;
    if (order && order.state === 'canceled') return false;
    try {
      const ticker = await okxMarket.getTicker(instId);
      if (ticker) {
        const movedPct = ((Number(ticker.last) - entryPrice) / entryPrice) * 100;
        if (movedPct > maxChasePct) return false;
      }
    } catch (_) {
      // игнорируем, продолжаем ждать
    }
  }
  return false;
}

function pnlUsdForRatio(position, exitPrice, ratio) {
  const pnlPct = (exitPrice - position.entryPrice) / position.entryPrice;
  return position.notionalUsd * ratio * pnlPct;
}

async function closeLive(position, sz, reduceOnly = true) {
  return okxTrade.placeMarketOrder({
    instId: position.instId,
    side: 'sell',
    sz,
    tdMode: config.risk.mgnMode,
    reduceOnly,
  });
}

async function closePositionFully(position, exitPrice, reason) {
  const ratio = position.remainingRatio;
  const pnlUsd = pnlUsdForRatio(position, exitPrice, ratio);

  if (position.mode === 'live') {
    try {
      if (position.algoIds && position.algoIds.length) {
        await okxTrade.cancelAlgoOrders(position.instId, position.algoIds).catch(() => {});
      }
      await closeLive(position, position.sz * ratio);
    } catch (err) {
      logger.error('Ошибка закрытия live-позиции', { instId: position.instId, error: err.message });
      await notify.notifyError(`закрытие ${position.instId}`, err);
    }
  }

  store.removeOpenPosition(position.instId);
  risk.onTradeClosed(store, pnlUsd);
  store.pushHistory({ instId: position.instId, pnlUsd, reason, mode: position.mode, exitPrice });
  await notify.notifyClosed(position, pnlUsd, reason);
  logger.orderLog({ event: 'closed', instId: position.instId, pnlUsd, reason, exitPrice, mode: position.mode });
}

async function closeTp1Portion(position, exitPrice) {
  const ratio = position.tp1CloseRatio;
  const pnlUsd = pnlUsdForRatio(position, exitPrice, ratio);

  if (position.mode === 'live') {
    try {
      const closeSz = position.sz * ratio;
      await closeLive(position, closeSz);
      if (position.algoIds && position.algoIds.length) {
        await okxTrade.cancelAlgoOrders(position.instId, position.algoIds).catch(() => {});
      }
      const stopRes = await okxTrade.placeStopOrder({
        instId: position.instId,
        side: 'sell',
        sz: position.sz * (1 - ratio),
        slTriggerPx: position.entryPrice,
        tdMode: config.risk.mgnMode,
      });
      const stopData = stopRes && stopRes.data && stopRes.data[0];
      position.algoIds = stopData && stopData.sCode === '0' ? [stopData.algoId] : [];
    } catch (err) {
      logger.error('Ошибка частичного закрытия по TP1', { instId: position.instId, error: err.message });
      await notify.notifyError(`TP1 ${position.instId}`, err);
    }
  }

  position.remainingRatio = 1 - ratio;
  position.tp1Filled = true;
  position.sl = position.entryPrice; // move SL to BE
  position.realizedPnlUsd = (position.realizedPnlUsd || 0) + pnlUsd;
  store.setOpenPosition(position.instId, position);
  await notify.notifyTp1(position);
  logger.orderLog({ event: 'tp1', instId: position.instId, pnlUsd, exitPrice });
}

/** Управление всеми открытыми позициями: TP1/SL/трейлинг/таймаут. Вызывается регулярно. */
async function manageOpenPositions() {
  const positions = Object.values(store.getOpenPositions());
  for (const position of positions) {
    try {
      await managePosition(position);
    } catch (err) {
      logger.error(`Ошибка управления позицией ${position.instId}`, { error: err.message });
    }
  }
}

async function managePosition(position) {
  const ticker = await okxMarket.getTicker(position.instId);
  if (!ticker) return;
  const price = Number(ticker.last);
  if (!Number.isFinite(price)) return;

  if (price > position.highWaterMark) {
    position.highWaterMark = price;
    store.setOpenPosition(position.instId, position);
  }

  if (!position.tp1Filled) {
    if (price <= position.sl) {
      await closePositionFully(position, price, 'stop-loss');
      return;
    }
    if (price >= position.tp1) {
      await closeTp1Portion(position, price);
      return;
    }
    const ageMin = (Date.now() - position.openedAt) / 60000;
    if (ageMin >= config.risk.tradeTimeoutMin) {
      const dead = await isMomentumDead(position.instId);
      if (dead) {
        await closePositionFully(position, price, `таймаут ${config.risk.tradeTimeoutMin}м — импульс угас`);
        return;
      }
    }
    return;
  }

  // после TP1: трейлинг стопа + выход по флипу Supertrend 15m вниз
  const trailStop = position.highWaterMark * (1 - position.trailPct / 100);
  const newSl = Math.max(position.sl, trailStop, position.entryPrice);
  if (newSl !== position.sl) {
    position.sl = newSl;
    store.setOpenPosition(position.instId, position);
  }

  if (price <= position.sl) {
    await closePositionFully(position, price, 'трейлинг-стоп после TP1');
    return;
  }

  const stFlippedDown = await isSupertrendFlippedDown(position.instId);
  if (stFlippedDown) {
    await closePositionFully(position, price, 'Supertrend 15m развернулся вниз');
  }
}

async function isMomentumDead(instId) {
  try {
    const candles = await okxMarket.getCandles(instId, '15m', 60);
    const closes = candles.map((c) => c.close);
    const rsi = lastRsi(closes, 14);
    const st = lastSupertrend(candles, 10, 3);
    const rsiFalling = candles.length >= 3 && closes[closes.length - 1] < closes[closes.length - 2];
    return (rsi !== null && rsi < 50 && rsiFalling) || (st && st.trend === 'down');
  } catch (_) {
    return false;
  }
}

async function isSupertrendFlippedDown(instId) {
  try {
    const candles = await okxMarket.getCandles(instId, '15m', 30);
    const st = lastSupertrend(candles, 10, 3);
    return !!st && st.trend === 'down';
  } catch (_) {
    return false;
  }
}

async function closeAllPositions(reason) {
  const positions = Object.values(store.getOpenPositions());
  for (const position of positions) {
    const ticker = await okxMarket.getTicker(position.instId).catch(() => null);
    const price = ticker ? Number(ticker.last) : position.entryPrice;
    await closePositionFully(position, price, reason);
  }
}

module.exports = {
  tryEnter,
  manageOpenPositions,
  closeAllPositions,
  computeStops,
  getInstMeta,
  isLiveTrading,
};
