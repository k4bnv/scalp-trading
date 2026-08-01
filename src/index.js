'use strict';

const config = require('./config');
const logger = require('./util/logger');
const store = require('./state/store');
const okxClient = require('./okx/client');
const okxTrade = require('./okx/trade');
const scanner = require('./strategy/scanner');
const trader = require('./execution/trader');
const notify = require('./notify/telegram');
const { LsRatioStore } = require('./strategy/lsRatio');

const lsStore = new LsRatioStore(60);

function modeLabel() {
  if (config.autoTrade && !config.dryRun) return 'LIVE (реальная торговля)';
  if (config.autoTrade && config.dryRun) return 'DRY_RUN (ордера не отправляются на биржу)';
  return 'PAPER / SIGNALS-ONLY (симуляция, реальных ордеров нет)';
}

async function getStatusText() {
  const daily = store.state.daily;
  let equityLine = 'equity: н/д (нет API ключей)';
  if (config.okx.apiKey) {
    try {
      const bal = await okxTrade.getBalance('USDT');
      if (bal) equityLine = `equity: ${bal.totalEq.toFixed(2)} USDT`;
    } catch (_) {
      equityLine = 'equity: ошибка запроса';
    }
  }
  const openCount = store.countOpenPositions();
  return [
    `<b>Статус бота</b>`,
    `режим: ${modeLabel()}`,
    equityLine,
    `открытых позиций: ${openCount}/${config.risk.maxOpenPositions}`,
    `сделок сегодня: ${daily.trades}/${config.guards.maxTradesPerDay}`,
    `PnL сегодня: ${daily.pnlUsd.toFixed(2)} USDT`,
    `подряд убытков: ${daily.consecutiveLosses}`,
    `cooldown: ${store.isInCooldown() ? `да, ${store.cooldownRemainingMin()} мин` : 'нет'}`,
    `halt: ${store.isHaltedForToday() ? `да (${daily.haltReason})` : 'нет'}`,
    `STOP: ${store.isStopped() ? 'да' : 'нет'}`,
  ].join('\n');
}

async function getPositionsText() {
  const positions = Object.values(store.getOpenPositions());
  if (!positions.length) return 'Открытых позиций нет.';
  return positions
    .map(
      (p) =>
        `${p.instId} (${p.mode}) вход ${p.entryPrice} sz ${p.sz} плечо ${p.leverage}x SL ${p.sl.toFixed(6)} TP1 ${p.tp1.toFixed(6)} tp1_filled=${p.tp1Filled}`
    )
    .join('\n');
}

async function scanAndEnter() {
  if (okxClient.isHalted()) {
    logger.warn('Пропуск цикла сканирования: серия ошибок API OKX превысила порог');
    return;
  }

  let results;
  try {
    results = await scanner.scan(lsStore);
  } catch (err) {
    logger.error('Ошибка сканирования рынка', { error: err.message });
    return;
  }

  const passing = results.filter((r) => !r.hardSkip && r.score >= config.screener.minEntryScore);
  logger.info(`Скрининг завершён: ${results.length} кандидатов, ${passing.length} прошли порог score>=${config.screener.minEntryScore}`);

  if (store.isStopped()) {
    logger.info('STOP активен — новые входы запрещены, но сигналы продолжаем логировать');
  }
  if (store.countOpenPositions() >= config.risk.maxOpenPositions) {
    return;
  }

  for (const candidate of passing) {
    if (store.isStopped()) break;
    if (store.countOpenPositions() >= config.risk.maxOpenPositions) break;
    if (store.getOpenPosition(candidate.instId)) continue;

    const result = await trader.tryEnter(candidate);
    if (result.entered) {
      logger.info(`Вход выполнен: ${candidate.instId} score=${candidate.score}`);
      break; // одна сделка за цикл сканирования
    } else {
      logger.debug(`Вход по ${candidate.instId} не выполнен: ${result.reason}`);
    }
  }
}

async function manageLoop() {
  try {
    await trader.manageOpenPositions();
  } catch (err) {
    logger.error('Ошибка цикла управления позициями', { error: err.message });
  }
}

async function main() {
  logger.info('========================================');
  logger.info('OKX Early Momentum Scalp Bot — запуск');
  logger.info(`Режим: ${modeLabel()}`);
  logger.info(`OKX_SIMULATED=${config.okx.simulated}, AUTO_TRADE=${config.autoTrade}, DRY_RUN=${config.dryRun}`);
  logger.info('========================================');

  notify.init({
    store,
    getStatusText,
    getPositionsText,
    closeAllPositions: (reason) => trader.closeAllPositions(reason),
  });

  await notify.sendText(
    `🚀 Бот запущен.\nРежим: <b>${modeLabel()}</b>\nСимулированный аккаунт OKX: ${config.okx.simulated ? 'да' : 'нет'}`
  );

  if (!config.autoTrade) {
    await notify.sendText('ℹ️ AUTO_TRADE=false — бот работает в режиме сигналов/paper, реальные ордера отправляться не будут.');
  } else if (config.dryRun) {
    await notify.sendText('ℹ️ DRY_RUN=true — ордера будут только логироваться, без отправки на биржу.');
  } else {
    await notify.sendText('⚠️ LIVE ТОРГОВЛЯ АКТИВНА. Бот будет реально открывать и закрывать позиции на OKX.');
  }

  await scanAndEnter();

  setInterval(() => {
    scanAndEnter().catch((err) => logger.error('Необработанная ошибка scanAndEnter', { error: err.message }));
  }, config.loop.scanIntervalSec * 1000);

  setInterval(() => {
    manageLoop().catch((err) => logger.error('Необработанная ошибка manageLoop', { error: err.message }));
  }, config.loop.manageIntervalSec * 1000);
}

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection', { error: err && err.message });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err && err.message });
});

main().catch((err) => {
  logger.error('Фатальная ошибка при запуске', { error: err.message });
  process.exit(1);
});
