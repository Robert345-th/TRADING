# PC bot — your MetaTrader demo

The website cannot log into MetaTrader. **This folder runs on your Windows PC** and uses the Demo account already open in MT5.

Live dashboard: https://trading-production-2c95.up.railway.app

## Every time you want Demo to trade

1. Open **MetaTrader 5** on this computer.
2. File → Login to Trade Account → your **DEMO** login (not Real).
3. Tools → Options → Expert Advisors → turn on **Algo Trading** / automated trading.
4. Double-click **`StartDemo.vbs`** (or `connect-demo.bat`).
5. Leave that black window open.
6. Refresh the website → **Demo**. You should see **your login** and **your balance**, not `AUTO-DEMO`.

Close the black window to stop new orders. MT5 can stay open.

## First time only

Install [Python](https://www.python.org/downloads/) and tick **Add python.exe to PATH**.

You do not need a `.env` file. The script already posts to the Railway site.

Optional `.env` (copy from `.env.example`):

```
LOT=0.10
ENABLE_TRADING=1
ALWAYS_IN=1
```

`ALWAYS_IN=1` keeps a gold position on your demo and closes when price moves `$1.50`. Set `ENABLE_TRADING=0` to only mirror the account (no new orders).

A live (real) MT5 login is shown on the site but **orders are not sent**.

## Paper gold (not your broker)

`StartDemo.js` and `node bot.js` trade a fake local balance. That is **not** your MT5 demo. Use `StartDemo.vbs` for the account on this computer.
