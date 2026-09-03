# PC bot for Trade Tracker

This folder is the trading program you run **on your PC**. It connects to the dashboard in [Robert345-th/TRADING](https://github.com/Robert345-th/TRADING).

## Double-click on Windows (like wscript.exe)

You do **not** need Node or Python.

1. Copy the `pc-bot` folder to the PC.
2. Copy `.env.example` to `.env` and paste your Railway `API_KEY`.
3. Double-click **`StartDemo.vbs`** (or `StartDemo.js`).

Windows Script Host opens a black window and starts **Demo** paper trading into:

`https://trading-production-2c95.up.railway.app`

Close that window to stop. Then refresh the Railway site → **Demo**.

## Connect your MT5 demo account (Windows PC)

This is the path that uses **your real demo login** from MetaTrader 5.

1. Install [MetaTrader 5](https://www.metatrader5.com/).
2. Open MT5 and log into your **DEMO** account (File → Login to Trade Account).
3. In MT5: Tools → Options → Expert Advisors → allow **Algo Trading**.
4. Copy `pc-bot` to the PC, then:

```bat
cd pc-bot
copy .env.example .env
```

Edit `.env`:

```
TRADING_URL=https://trading-production-2c95.up.railway.app
API_KEY=change-me
ACCOUNT_TYPE=demo
SYMBOL=XAUUSD
LOT=0.10
ENABLE_TRADING=1
```

Point `TRADING_URL` at your running Trade Tracker, for example:

`https://trading-production-2c95.up.railway.app`

`API_KEY` must match the `API_KEY` variable on that host (Railway → Variables). The default `change-me` is rejected there.

5. Double-click `connect-demo.bat`, or:

```bat
pip install MetaTrader5
python mt5_demo.py
```

Leave that window open. Open Trade Tracker → **Demo**. It should show **Live**, your demo login, balance, and any gold position.

The computer only trades if MT5 is on a **demo** login. A real login is reported to the dashboard but orders are not sent.

Set `ENABLE_TRADING=0` if you only want the demo account mirrored (no new orders).

## Paper bot (no MetaTrader)

If you do not have MT5, `node bot.js` still posts a paper demo to the same Demo tab using live gold prices. That is not your broker demo login.

```bash
cd pc-bot
node bot.js
```

## Postgres

`/api/log` and `/api/trade-closed` need Postgres on the dashboard host. Live balance and open position still work without it.
