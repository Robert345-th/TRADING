# Trade Tracker

Open the site. **Demo trades by itself** on live gold. You do not click Buy/Sell and you do not run a second program.

Live: https://trading-production-2c95.up.railway.app

The server reads XAUUSD from `https://xaus.com/api/v1/spot` every 5 seconds, opens a paper position, and closes when gold moves $1.50. It always re-enters. Starting Demo balance is $10,000.

## Railway

This repo is what Railway deploys. After a push to `main`, Railway rebuilds automatically if the project is connected to [Robert345-th/TRADING](https://github.com/Robert345-th/TRADING).

- `PORT` is set by Railway. Do not add `AUTO_DEMO=0` (that would stop the trader).
- `API_KEY` is unused by auto-Demo. Real-tab updates still need it if you send `/api/update`.
- `DATABASE_URL` is optional (trade history only). Live snapshot works in memory.

## Run locally

```bash
npm install
npm start
```

Open http://127.0.0.1:3000 (or `PORT`).
