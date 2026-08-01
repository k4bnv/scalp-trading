'use strict';

const crypto = require('node:crypto');
const axios = require('axios');
const config = require('../config');
const logger = require('../util/logger');

class ApiErrorTracker {
  constructor(threshold) {
    this.threshold = threshold;
    this.streak = 0;
  }
  ok() {
    this.streak = 0;
  }
  fail() {
    this.streak += 1;
    return this.streak;
  }
  isHalted() {
    return this.streak >= this.threshold;
  }
}

const errorTracker = new ApiErrorTracker(config.guards.apiErrorStreakHalt);

function sign(timestamp, method, requestPath, body, secretKey) {
  const prehash = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
  return crypto.createHmac('sha256', secretKey).update(prehash).digest('base64');
}

class OkxClient {
  constructor() {
    this.http = axios.create({
      baseURL: config.okx.baseUrl,
      timeout: 15000,
    });
  }

  _headers(method, requestPath, bodyStr) {
    const timestamp = new Date().toISOString();
    const headers = {
      'Content-Type': 'application/json',
    };
    if (config.okx.apiKey) {
      headers['OK-ACCESS-KEY'] = config.okx.apiKey;
      headers['OK-ACCESS-SIGN'] = sign(timestamp, method, requestPath, bodyStr, config.okx.secretKey);
      headers['OK-ACCESS-TIMESTAMP'] = timestamp;
      headers['OK-ACCESS-PASSPHRASE'] = config.okx.passphrase;
    }
    if (config.okx.simulated) {
      headers['x-simulated-trading'] = '1';
    }
    return headers;
  }

  async request(method, requestPath, { query = null, body = null, isPublic = false, retries = 3 } = {}) {
    let path = requestPath;
    if (query && Object.keys(query).length) {
      const qs = new URLSearchParams(
        Object.entries(query).filter(([, v]) => v !== undefined && v !== null)
      ).toString();
      if (qs) path += `?${qs}`;
    }
    const bodyStr = body ? JSON.stringify(body) : '';

    for (let attempt = 0; attempt <= retries; attempt++) {
      const headers = isPublic && !config.okx.apiKey ? {} : this._headers(method, path, bodyStr);
      try {
        const res = await this.http.request({
          method,
          url: path,
          headers,
          data: body || undefined,
        });
        const data = res.data;
        if (data && data.code !== undefined && data.code !== '0') {
          errorTracker.fail();
          logger.warn('OKX API вернул ошибку', { path, code: data.code, msg: data.msg });
        } else {
          errorTracker.ok();
        }
        return data;
      } catch (err) {
        const status = err.response && err.response.status;
        if (status === 429 && attempt < retries) {
          const backoffMs = 400 * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        const streak = errorTracker.fail();
        const detail = err.response ? { status: err.response.status, data: err.response.data } : { message: err.message };
        logger.error('OKX HTTP запрос упал', { path, streak, ...detail });
        throw Object.assign(new Error(`OKX request failed: ${path}`), { cause: err, streak });
      }
    }
  }

  get(path, query) {
    return this.request('GET', path, { query, isPublic: true });
  }

  getPrivate(path, query) {
    return this.request('GET', path, { query });
  }

  post(path, body) {
    return this.request('POST', path, { body });
  }

  isHalted() {
    return errorTracker.isHalted();
  }

  resetErrorStreak() {
    errorTracker.streak = 0;
  }
}

module.exports = new OkxClient();
module.exports.OkxClient = OkxClient;
module.exports.errorTracker = errorTracker;
