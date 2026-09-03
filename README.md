# Trade Tracker

Dashboard for the **MetaTrader 5 demo on your computer**. The website shows that account. It does not invent an `AUTO-DEMO` login.

Live: https://trading-production-2c95.up.railway.app

The site cannot open MT5 for you. On the Windows PC:

1. Open MetaTrader 5 and log into **Demo**.
2. Double-click `pc-bot/StartDemo.vbs` — or on the live site tap **Download StartDemo for your PC**.
3. Leave that window open, then refresh the site → **Demo**.

You should see **your demo login and balance**. Gold trades on that account by itself while the window is running.

## Railway

This repo is what Railway deploys. After a push to `main`, the dashboard rebuilds.

- Do **not** set `AUTO_DEMO=1` (that turns the fake paper Demo back on).
- `PORT` is set by Railway.
- `API_KEY` is only required for the **Real** tab.
- `DATABASE_URL` is optional (history). Live snapshot works without it.

## Run the dashboard locally

```bash
npm install
npm start
```

Open http://127.0.0.1:3000. Demo still stays empty until `pc-bot` on Windows is posting.
