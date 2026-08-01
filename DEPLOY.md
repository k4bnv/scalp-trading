# Деплой

Бот — обычный долгоживущий Node.js процесс (не веб-сервер, портов не
слушает). Два поддерживаемых варианта: **Docker** (проще всего) или
**systemd на VPS**.

Перед любым из вариантов: заполните `.env` реальными ключами (см.
раздел «Переменные окружения» в README и ниже) и **начните с
`OKX_SIMULATED=true` + `AUTO_TRADE=false`**, пока не убедитесь, что
бот стабильно работает.

## Вариант 1: Docker / docker-compose (рекомендуется)

```bash
git clone https://github.com/k4bnv/scalp-trading.git
cd scalp-trading
cp .env.example .env
# отредактируйте .env — впишите ключи OKX и Telegram
docker compose up -d --build
docker compose logs -f
```

Данные переживают пересоздание контейнера, redeploy и повторный
клон репозитория (например, в Coolify/Dokploy/аналогах) — логи и
`state/store.json` (позиции, дневные лимиты) хранятся в именованных
Docker-томах `bot-logs` и `bot-data`, а не в папке чекаута. Посмотреть
их:

```bash
docker volume ls | grep bot-
docker exec okx-scalp-bot cat /app/data/store.json
```

Тома удаляются только явно (`docker compose down -v`), обычный
`down`/`up` или пересборка их не трогают.

Остановить новые входы без остановки контейнера:

```bash
docker exec okx-scalp-bot touch STOP
```

или командой `/stop` в Telegram (работает всегда, без доступа к
серверу). Полная остановка бота:

```bash
docker compose down
```

Обновление на новую версию кода:

```bash
git pull
docker compose up -d --build
```

## Вариант 2: systemd на VPS (без Docker)

```bash
sudo mkdir -p /opt/scalp-trading
sudo chown $USER:$USER /opt/scalp-trading
git clone https://github.com/k4bnv/scalp-trading.git /opt/scalp-trading
cd /opt/scalp-trading
npm ci --omit=dev
cp .env.example .env
# отредактируйте .env

sudo useradd --system --no-create-home botuser || true
sudo chown -R botuser:botuser /opt/scalp-trading

sudo cp deploy/okx-scalp-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now okx-scalp-bot
sudo systemctl status okx-scalp-bot
journalctl -u okx-scalp-bot -f
```

Kill switch без доступа к процессу:

```bash
sudo -u botuser touch /opt/scalp-trading/STOP
```

## CI

`.github/workflows/ci.yml` гоняет `npm test` на каждый push/PR в
`main` — 26 юнит-тестов (RSI, Supertrend, longPct/crowding, risk
sizing). Держите его зелёным перед деплоем боевой версии.

## Чек-лист перед LIVE

1. `OKX_SIMULATED=true`, `AUTO_TRADE=false` — прогнать несколько часов,
   убедиться что сигналы адекватны и Telegram работает.
2. `AUTO_TRADE=true`, `DRY_RUN=true` — убедиться что логика входа не
   падает с ошибками (ордера не отправляются, только логируются).
3. `AUTO_TRADE=true`, `DRY_RUN=false`, всё ещё `OKX_SIMULATED=true`
   (демо-счёт OKX) — полный цикл с реальными ордерами без риска денег.
4. Только затем `OKX_SIMULATED=false` с боевыми ключами и минимальным
   `RISK_USD_PER_TRADE`.

На каждом шаге проверяйте `/status` в Telegram и `docker compose logs -f`
(вариант Docker) или `journalctl -u okx-scalp-bot -f` / `logs/*.log`
(вариант systemd).
