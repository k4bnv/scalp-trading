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

/** Постоянная клавиатура внизу чата — кнопки просто отправляют текст команды. */
const MAIN_KEYBOARD = {
  reply_markup: {
    keyboard: [
      [{ text: '/status' }, { text: '/positions' }],
      [{ text: '/stop' }, { text: '/start' }],
      [{ text: '⚙️ Режим' }, { text: '💰 Риск' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  },
};

const MODE_INLINE_KEYBOARD = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📄 Paper', callback_data: 'mode:paper' },
        { text: '🔴 Live', callback_data: 'mode:live' },
      ],
    ],
  },
};

const RISK_PRESETS = [3, 5, 8, 10, 15];
const RISK_INLINE_KEYBOARD = {
  reply_markup: {
    inline_keyboard: [RISK_PRESETS.map((v) => ({ text: `${v} USDT`, callback_data: `risk:${v}` }))],
  },
};

async function sendText(text, extraOpts = {}) {
  logger.info(`TG: ${text.replace(/\n/g, ' | ')}`);
  if (!bot || !config.telegram.chatId) return;
  try {
    await bot.sendMessage(config.telegram.chatId, text, { parse_mode: 'HTML', ...extraOpts });
  } catch (err) {
    logger.error('Не удалось отправить сообщение в Telegram', { error: err.message });
  }
}

/** Показывает/обновляет постоянную клавиатуру с кнопками команд. */
async function sendMainMenu() {
  await sendText('Меню команд ниже 👇', MAIN_KEYBOARD);
}

async function applyMode(mode) {
  deps.store.setMode(mode);
  await sendText(`Режим переключён на: <b>${mode}</b>. Примечание: реальная торговля также требует AUTO_TRADE=true в .env.`);
}

async function applyRisk(value) {
  deps.store.state.riskUsdOverride = value;
  deps.store.save();
  await sendText(`Риск на сделку установлен: ${value} USDT (override поверх RISK_USD_PER_TRADE).`);
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
    await sendMainMenu();
  });

  bot.onText(/\/mode (paper|live)/, async (msg, match) => {
    await applyMode(match[1]);
  });

  bot.onText(/\/set risk (\d+(\.\d+)?)/, async (msg, match) => {
    await applyRisk(Number(match[1]));
  });

  bot.onText(/^⚙️ Режим$/, async () => {
    await sendText('Выберите режим:', MODE_INLINE_KEYBOARD);
  });

  bot.onText(/^💰 Риск$/, async () => {
    await sendText('Выберите риск на сделку (USDT маржи):', RISK_INLINE_KEYBOARD);
  });

  bot.on('callback_query', async (query) => {
    const data = query.data || '';
    try {
      if (data.startsWith('mode:')) {
        await applyMode(data.split(':')[1]);
      } else if (data.startsWith('risk:')) {
        await applyRisk(Number(data.split(':')[1]));
      }
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      logger.error('Ошибка обработки callback_query', { error: err.message });
      await bot.answerCallbackQuery(query.id, { text: 'Ошибка, см. логи', show_alert: true }).catch(() => {});
    }
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
  sendMainMenu,
  notifySignal,
  notifyOpened,
  notifyTp1,
  notifySl,
  notifyClosed,
  notifyHalt,
  notifyError,
};
