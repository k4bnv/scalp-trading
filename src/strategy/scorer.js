'use strict';

const config = require('../config');

/**
 * Скоринг кандидата в LONG по правилам Early Momentum Scalp.
 * m — собранные метрики по инструменту (см. scanner.js).
 * Возвращает { score, reasons[], hardSkip, skipReason }.
 */
function scoreCandidate(m) {
  let score = 0;
  const reasons = [];
  let hardSkip = false;
  let skipReason = null;

  // Supertrend 15m
  if (m.st15m && m.st15m.trend === 'up') {
    score += 2;
    reasons.push('Supertrend 15m UP');
  } else {
    reasons.push('Supertrend 15m не UP (штраф)');
    score -= 1;
  }

  // Supertrend 1H — не обязателен строго вверх, но штраф если явный DOWN
  if (m.st1h && m.st1h.trend === 'up') {
    score += 1.5;
    reasons.push('Supertrend 1H UP');
  } else if (m.st1h && m.st1h.trend === 'down') {
    score -= 1;
    reasons.push('Supertrend 1H DOWN (штраф)');
  }

  // RSI14 15m
  if (Number.isFinite(m.rsi15m)) {
    if (m.rsi15m >= 50 && m.rsi15m <= 60) {
      score += 1.5;
      reasons.push(`RSI15m=${m.rsi15m.toFixed(1)} идеальная зона 50-60`);
    } else if (m.rsi15m >= 45 && m.rsi15m <= 65) {
      score += 1;
      reasons.push(`RSI15m=${m.rsi15m.toFixed(1)} в диапазоне 45-65`);
    } else if (m.rsi15m > 70) {
      score -= 3;
      reasons.push(`RSI15m=${m.rsi15m.toFixed(1)} перекуплен (штраф)`);
      if (m.rsi15m > 75) {
        hardSkip = true;
        skipReason = 'RSI15m сильно перекуплен (>75), не догоняем памп';
      }
    }
  }

  // RSI14 1H
  if (Number.isFinite(m.rsi1h)) {
    if (m.rsi1h < 70) {
      score += 1;
      reasons.push(`RSI1H=${m.rsi1h.toFixed(1)} не перегрет`);
    } else {
      score -= 1;
      reasons.push(`RSI1H=${m.rsi1h.toFixed(1)} перегрет (штраф)`);
    }
  }

  // MACD 15m
  if (m.macd15m) {
    if (m.macd15m.bullish) {
      score += 1;
      reasons.push('MACD15m бычий');
    }
    if (m.macd15m.histRising) {
      score += 0.5;
      reasons.push('MACD гистограмма растёт');
    }
  }

  // OI динамика
  if (m.oiTrend === 'up') {
    score += 1.5;
    reasons.push('OI растёт вместе с ценой');
  } else if (m.oiTrend === 'down') {
    score -= 2;
    reasons.push('OI падает при росте цены (штраф)');
  }

  // Откат от 24h high (не chase у хая)
  if (Number.isFinite(m.pullbackFromHighPct)) {
    if (m.pullbackFromHighPct >= 1 && m.pullbackFromHighPct <= 3) {
      score += 1.5;
      reasons.push(`откат ${m.pullbackFromHighPct.toFixed(1)}% от 24h high`);
    } else if (m.pullbackFromHighPct < 0.5) {
      hardSkip = true;
      skipReason = 'цена у 24h high без отката — не догоняем (chase)';
    }
  }

  // Long/Short crowding filter
  if (m.crowding) {
    if (m.crowding.spike) {
      score -= 3;
      reasons.push(`толпа перегрета: ${m.crowding.reason}`);
      if (!config.lsRatio.enableShortFade) {
        hardSkip = true;
        skipReason = skipReason || `crowding spike в лонгах: ${m.crowding.reason}`;
      }
    } else if (Number.isFinite(m.crowding.longPct) && m.crowding.longPct >= 45 && m.crowding.longPct <= 68) {
      score += 1;
      reasons.push(`longPct=${m.crowding.longPct.toFixed(1)}% умеренный — подтверждение`);
    }
  }

  // Funding
  if (Number.isFinite(m.fundingRate)) {
    const limit = config.screener.maxAbsFundingRate;
    if (Math.abs(m.fundingRate) >= limit) {
      score -= 1;
      reasons.push(`funding=${(m.fundingRate * 100).toFixed(3)}% близко к экстремуму (штраф)`);
    }
    if (m.fundingRate >= limit * 1.5) {
      score -= 1;
      reasons.push('funding сильно положительный (штраф)');
    }
  }

  score = Math.max(0, Math.min(10, Number(score.toFixed(2))));

  return { score, reasons, hardSkip, skipReason };
}

module.exports = { scoreCandidate };
