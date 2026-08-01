'use strict';

const fs = require('node:fs');
const path = require('node:path');
const logger = require('../util/logger');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const STOP_FLAG_PATH = path.join(__dirname, '..', '..', 'STOP');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function defaultState() {
  return {
    stop: false,
    closeOnStop: false,
    mode: 'paper',
    riskUsdOverride: null,
    daily: {
      date: todayStr(),
      trades: 0,
      wins: 0,
      losses: 0,
      pnlUsd: 0,
      consecutiveLosses: 0,
      cooldownUntilTs: null,
      haltedUntilTomorrow: false,
    },
    lastDailySummary: null,
    openPositions: {},
    history: [],
    seenClOrdIds: [],
  };
}

class Store {
  constructor() {
    this.state = this._load();
    this._rolloverDayIfNeeded();
  }

  _load() {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const raw = fs.readFileSync(STORE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return { ...defaultState(), ...parsed, daily: { ...defaultState().daily, ...(parsed.daily || {}) } };
      }
    } catch (err) {
      logger.error('Не удалось прочитать state/store.json, создаю новый', { error: err.message });
    }
    return defaultState();
  }

  save() {
    try {
      const tmp = `${STORE_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tmp, STORE_PATH);
    } catch (err) {
      logger.error('Не удалось сохранить state/store.json', { error: err.message });
    }
  }

  _rolloverDayIfNeeded() {
    const today = todayStr();
    if (this.state.daily.date !== today) {
      this.state.lastDailySummary = this.state.daily;
      this.state.daily = { ...defaultState().daily, date: today };
      this.save();
      logger.info('Новый торговый день — дневные счётчики сброшены');
    }
  }

  /** Забирает сводку по последнему завершившемуся дню (один раз — для отчёта в Telegram). */
  consumeLastDailySummary() {
    const summary = this.state.lastDailySummary;
    if (summary) {
      this.state.lastDailySummary = null;
      this.save();
    }
    return summary;
  }

  // --- kill switch ---
  isStopped() {
    if (fs.existsSync(STOP_FLAG_PATH)) return true;
    return !!this.state.stop;
  }

  setStop(value, closeOnStop) {
    this.state.stop = value;
    if (closeOnStop !== undefined) this.state.closeOnStop = closeOnStop;
    this.save();
  }

  // --- mode ---
  setMode(mode) {
    this.state.mode = mode;
    this.save();
  }

  // --- daily counters ---
  isHaltedForToday() {
    this._rolloverDayIfNeeded();
    return !!this.state.daily.haltedUntilTomorrow;
  }

  haltForToday(reason) {
    this.state.daily.haltedUntilTomorrow = true;
    this.state.daily.haltReason = reason;
    this.save();
  }

  isInCooldown() {
    const until = this.state.daily.cooldownUntilTs;
    return !!until && Date.now() < until;
  }

  cooldownRemainingMin() {
    const until = this.state.daily.cooldownUntilTs;
    if (!until) return 0;
    return Math.max(0, Math.round((until - Date.now()) / 60000));
  }

  startCooldown(minutes) {
    this.state.daily.cooldownUntilTs = Date.now() + minutes * 60000;
    this.save();
  }

  recordTradeClosed({ pnlUsd }) {
    this._rolloverDayIfNeeded();
    this.state.daily.trades += 1;
    this.state.daily.pnlUsd += pnlUsd;
    if (pnlUsd < 0) {
      this.state.daily.losses += 1;
      this.state.daily.consecutiveLosses += 1;
    } else {
      this.state.daily.wins += 1;
      this.state.daily.consecutiveLosses = 0;
    }
    this.save();
  }

  tradesRemainingToday(maxTradesPerDay) {
    this._rolloverDayIfNeeded();
    return Math.max(0, maxTradesPerDay - this.state.daily.trades);
  }

  // --- positions ---
  getOpenPositions() {
    return this.state.openPositions;
  }

  getOpenPosition(instId) {
    return this.state.openPositions[instId] || null;
  }

  countOpenPositions() {
    return Object.keys(this.state.openPositions).length;
  }

  setOpenPosition(instId, data) {
    this.state.openPositions[instId] = data;
    this.save();
  }

  removeOpenPosition(instId) {
    delete this.state.openPositions[instId];
    this.save();
  }

  // --- идемпотентность ---
  hasSeenClOrdId(id) {
    return this.state.seenClOrdIds.includes(id);
  }

  rememberClOrdId(id) {
    this.state.seenClOrdIds.push(id);
    if (this.state.seenClOrdIds.length > 500) {
      this.state.seenClOrdIds = this.state.seenClOrdIds.slice(-500);
    }
    this.save();
  }

  // --- история ---
  pushHistory(entry) {
    this.state.history.push({ ts: Date.now(), ...entry });
    if (this.state.history.length > 200) {
      this.state.history = this.state.history.slice(-200);
    }
    this.save();
  }

  getRecentHistory(n = 10) {
    return this.state.history.slice(-n);
  }
}

module.exports = new Store();
module.exports.Store = Store;
