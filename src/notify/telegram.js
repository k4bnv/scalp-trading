'use strict';

const config = require('../config');
const logger = require('../util/logger');

let TelegramBot = null;
try {
  TelegramBot = require('node-telegram-bot-api');
} catch (_) {
  // модуль опционален на случай, если telegram не настроен и пакет ещё не установлен
}

let bot = null;
let deps = null; // { store, getStatusText, getPositionsText, closeAllPositions, setAutoTradeOverride, setRiskOverride }

function fmt(n, digits = 2) {
  return Number(n).toFixed(digits);
}

/** Форматирует цену с числом знаков, адекватным её порядку (важно для дешёвых альтов). */
function fmtPrice(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  const abs = Math.abs(v);
  let digits = 2;
  if (abs < 0.001) digits = 8;
  else if (abs < 0.1) digits = 6;
  else if (abs < 10) digits = 4;
  return v.toFixed(digits);
}

async function sendText(text) {
  logger.info(`TG: ${text.replace(/\n/g, ' | ')}`);
  if (!bot || !config.telegram.chatId) return;
  try {
    await bot.sendMessage(config.telegram.chatId, text, { parse_mode: 'HTML' });
  } catch (err) {
    logger.error('Не удалось отправить сообщение в Telegram', { error: err.message });
  }
}

function init(injected) {
  deps = injected;

  if (!config.telegram.botToken || !TelegramBot) {
    logger.warn('Telegram не настроен (нет токена или пакета) — уведомления будут только в логах');
    return;
  }

  bot = new TelegramBot(config.telegram.botToken, { polling: true });

  bot.on('polling_error', (err) => logger.error('Telegram polling error', { error: err.message }));

  bot.onText(/\/status/, async () => {
    const text = deps.getStatusText ? await deps.getStatusText() : 'status недоступен';
    await sendText(text);
  });

  bot.onText(/\/positions/, async () => {
    const text = deps.getPositionsText ? await deps.getPositionsText() : 'нет открытых позиций';
    await sendText(text);
  });

  bot.onText(/\/stop/, async () => {
    deps.store.setStop(true);
    await sendText(
      `🛑 STOP активирован. Новые входы запрещены.${
        config.risk && deps.store.state.closeOnStop ? ' Все позиции будут закрыты.' : ' Открытые позиции НЕ закрываются автоматически (CLOSE_ON_STOP=false).'
      }`
    );
    if (deps.store.state.closeOnStop && deps.closeAllPositions) {
      await deps.closeAllPositions('/stop команда с CLOSE_ON_STOP=true');
    }
  });

  bot.onText(/\/start/, async () => {
    deps.store.setStop(false);
    await sendText('▶️ Бот снова разрешает новые входы (STOP снят).');
  });

  bot.onText(/\/mode (paper|live)/, async (msg, match) => {
    const mode = match[1];
    deps.store.setMode(mode);
    await sendText(`Режим переключён на: <b>${mode}</b>. Примечание: реальная торговля также требует AUTO_TRADE=true в .env.`);
  });

  bot.onText(/\/set risk (\d+(\.\d+)?)/, async (msg, match) => {
    const value = Number(match[1]);
    deps.store.state.riskUsdOverride = value;
    deps.store.save();
    await sendText(`Риск на сделку установлен: ${value} USDT (override поверх RISK_USD_PER_TRADE).`);
  });

  logger.info('Telegram бот запущен и слушает команды');
}

async function notifySignal(c) {
  const lines = [
    `📡 <b>СИГНАЛ</b> ${c.instId}`,
    `score: <b>${c.score}</b>/10`,
    `вход: ${fmtPrice(c.entry)}  стоп: ${fmtPrice(c.sl)}  тейк1: ${fmtPrice(c.tp1)}`,
    `плечо: ${c.leverage}x, long%: ${c.crowding && Number.isFinite(c.crowding.longPct) ? fmt(c.crowding.longPct, 1) : 'н/д'}`,
    `OI тренд: ${c.oiTrend || 'н/д'}`,
    `почему: ${c.reasons.slice(0, 6).join('; ')}`,
  ];
  await sendText(lines.join('\n'));
}

async function notifyOpened(pos) {
  await sendText(
    `✅ <b>ОТКРЫТО</b> ${pos.instId}\nвход: ${fmtPrice(pos.entryPrice)} sz: ${pos.sz} плечо: ${pos.leverage}x\nSL: ${fmtPrice(pos.sl)}  TP1: ${fmtPrice(pos.tp1)}`
  );
}

async function notifyTp1(pos) {
  await sendText(`🎯 <b>TP1 достигнут</b> ${pos.instId}\nзакрыто ${fmt(pos.tp1CloseRatio * 100, 0)}%, SL перенесён в БУ`);
}

async function notifySl(pos, pnlUsd) {
  await sendText(`🛑 <b>SL</b> ${pos.instId}\nPnL: ${fmt(pnlUsd)} USDT`);
}

async function notifyClosed(pos, pnlUsd, reason) {
  const emoji = pnlUsd >= 0 ? '💰' : '📉';
  await sendText(`${emoji} <b>ЗАКРЫТО</b> ${pos.instId}\nPnL: ${fmt(pnlUsd)} USDT\nпричина: ${reason}`);
}

async function notifyHalt(reason) {
  await sendText(`⛔ <b>HALT</b>: ${reason}`);
}

async function notifyError(context, err) {
  await sendText(`⚠️ Ошибка (${context}): ${err.message || err}`);
}

module.exports = {
  init,
  sendText,
  notifySignal,
  notifyOpened,
  notifyTp1,
  notifySl,
  notifyClosed,
  notifyHalt,
  notifyError,
};
