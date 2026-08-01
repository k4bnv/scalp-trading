'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function fileForToday() {
  const d = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${d}.log`);
}

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function write(level, msg, meta) {
  const line = `[${ts()}] [${level}] ${msg}${meta !== undefined ? ' ' + safeJson(meta) : ''}`;
  const stream = level === 'ERROR' ? console.error : console.log;
  stream(line);
  try {
    fs.appendFileSync(fileForToday(), line + '\n', 'utf8');
  } catch (_) {
    // логирование в файл не должно ронять процесс
  }
}

function safeJson(meta) {
  try {
    return JSON.stringify(meta);
  } catch (_) {
    return String(meta);
  }
}

module.exports = {
  info: (msg, meta) => write('INFO', msg, meta),
  warn: (msg, meta) => write('WARN', msg, meta),
  error: (msg, meta) => write('ERROR', msg, meta),
  debug: (msg, meta) => {
    if (process.env.DEBUG) write('DEBUG', msg, meta);
  },
  orderLog: (payload) => {
    write('ORDER', 'order-event', payload);
  },
};
