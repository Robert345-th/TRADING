/**
 * PC trading bot for Trade Tracker
 * https://github.com/Robert345-th/TRADING
 *
 * Runs on your computer. Reads live XAUUSD, decides with EMA/RSI,
 * paper-trades locally, and posts to the dashboard every 5 seconds.
 * There is no buy/sell UI — this process is the trader.
 */

const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const TRADING_URL = (process.env.TRADING_URL || 'http://127.0.0.1:43147').replace(/\/$/, '');
const API_KEY = process.env.API_KEY || 'change-me';
const ACCOUNT_TYPE = (process.env.ACCOUNT_TYPE || 'demo').toLowerCase() === 'real' ? 'real' : 'demo';
const SYMBOL = process.env.SYMBOL || 'XAUUSD';
const LOT = Number(process.env.LOT || 0.1);
const STARTING_BALANCE = Number(process.env.STARTING_BALANCE || 10000);
const LOGIN = Number(process.env.LOGIN || 880214);
const POINT_VALUE = 100; // $10 per $1 gold move at 0.10 lot
const UPDATE_MS = 5000;
const STATE_FILE = path.join(__dirname, 'state.json');

function round2(n) {
  return Number(Number(n).toFixed(2));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function defaultState() {
  return {
    balance: STARTING_BALANCE,
    openPosition: null,
    dayKey: todayKey(),
    tradesToday: 0,
    winsToday: 0,
    closes: [],
  };
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return { ...defaultState(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
    }
  } catch (err) {
    console.warn('Could not read state.json:', err.message);
  }
  return defaultState();
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function liveGold() {
  try {
    const data = await fetchJson('https://xaus.com/api/v1/spot');
    const price = Number(data.spot_usd_oz || data.xau?.price);
    if (!Number.isFinite(price) || price < 100) throw new Error('bad spot');
    return round2(price);
  } catch (err) {
    const data = await fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d');
    const result = data.chart?.result?.[0];
    const price = Number(result?.meta?.regularMarketPrice);
    if (!Number.isFinite(price) || price < 100) throw new Error(`gold feed failed (${err.message})`);
    return round2(price);
  }
}

async function goldHistory() {
  try {
    const data = await fetchJson('https://xaus.com/api/v1/intraday?symbol=xau&hours=24');
    return (data.points || [])
      .map((row) => Number(row.p))
      .filter((price) => Number.isFinite(price) && price > 100);
  } catch {
    return [];
  }
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((sum, n) => sum + n, 0) / period;
  for (let i = period; i < values.length; i += 1) {
    value = values[i] * k + value * (1 - k);
  }
  return value;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function atrFromCloses(values, period = 14) {
  if (values.length < period + 1) return null;
  const tr = [];
  for (let i = 1; i < values.length; i += 1) {
    tr.push(Math.abs(values[i] - values[i - 1]));
  }
  let value = tr.slice(0, period).reduce((sum, n) => sum + n, 0) / period;
  for (let i = period; i < tr.length; i += 1) {
    value = (value * (period - 1) + tr[i]) / period;
  }
  return value;
}

function pnlOf(position, price) {
  if (!position) return 0;
  const diff = position.type === 'buy' ? price - position.entryPrice : position.entryPrice - price;
  return round2(diff * position.lot * POINT_VALUE);
}

function decide(closes) {
  const emaFast = ema(closes, 9);
  const emaSlow = ema(closes, 21);
  const rsiValue = rsi(closes);
  const atrValue = atrFromCloses(closes);
  if (emaFast == null || emaSlow == null || rsiValue == null || atrValue == null) {
    return { ready: false, emaFast, emaSlow, rsi: rsiValue, atr: atrValue, trend: null, signal: 'none' };
  }
  let trend = emaFast > emaSlow ? 'uptrend' : emaFast < emaSlow ? 'downtrend' : 'range';
  if (Math.abs(emaFast - emaSlow) < atrValue * 0.12) trend = 'range';
  let signal = 'none';
  if (trend === 'uptrend' && rsiValue >= 48 && rsiValue <= 68) signal = 'buy';
  else if (trend === 'downtrend' && rsiValue >= 32 && rsiValue <= 52) signal = 'sell';
  return {
    ready: true,
    emaFast: round2(emaFast),
    emaSlow: round2(emaSlow),
    rsi: round2(rsiValue),
    atr: round2(atrValue),
    trend,
    signal,
  };
}

async function post(pathname, body) {
  const url = `${TRADING_URL}${pathname}?accountType=${ACCOUNT_TYPE}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify({ ...body, accountType: ACCOUNT_TYPE }),
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${pathname} ${res.status}: ${text}`);
  return text;
}

async function postQuiet(pathname, body) {
  try {
    await post(pathname, body);
    return true;
  } catch (err) {
    console.warn(err.message);
    return false;
  }
}

function snapshot(state, price, positionPnl) {
  const equity = round2(state.balance + positionPnl);
  return {
    account: {
      login: LOGIN,
      balance: round2(state.balance),
      equity,
      freeMargin: round2(equity - (state.openPosition ? 1000 : 0)),
      currency: 'USD',
    },
    openPosition: state.openPosition
      ? {
          symbol: state.openPosition.symbol,
          type: state.openPosition.type,
          lot: state.openPosition.lot,
          entryPrice: state.openPosition.entryPrice,
          currentPrice: price,
          pnl: positionPnl,
        }
      : null,
    stats: {
      tradesToday: state.tradesToday,
      winRateToday: state.tradesToday ? Math.round((state.winsToday / state.tradesToday) * 100) : 0,
    },
  };
}

async function main() {
  const state = loadState();
  if (state.dayKey !== todayKey()) {
    state.dayKey = todayKey();
    state.tradesToday = 0;
    state.winsToday = 0;
  }
  if (!Array.isArray(state.closes) || state.closes.length < 30) {
    const history = await goldHistory();
    if (history.length) state.closes = history.slice(-400);
  }

  console.log(`PC bot -> ${TRADING_URL} (${ACCOUNT_TYPE})`);
  console.log('Computer-only paper trading on live gold. Ctrl+C to stop.');

  let lastLogKey = '';

  async function tick() {
    const price = await liveGold();
    if (!state.closes.length || Math.abs(state.closes[state.closes.length - 1] - price) > 0.001) {
      state.closes.push(price);
      if (state.closes.length > 400) state.closes = state.closes.slice(-400);
    } else {
      state.closes[state.closes.length - 1] = price;
    }

    const ind = decide(state.closes);
    let reason = 'Warming up candles';
    let action = 'skip';
    let closedThisTick = false;

    if (ind.ready && state.openPosition) {
      const pos = state.openPosition;
      const move = pos.type === 'buy' ? price - pos.entryPrice : pos.entryPrice - price;
      if (move <= -1.5 * ind.atr) {
        const profit = pnlOf(pos, price);
        state.balance = round2(state.balance + profit);
        state.tradesToday += 1;
        if (profit >= 0) state.winsToday += 1;
        await postQuiet('/api/trade-closed', {
          symbol: pos.symbol,
          type: pos.type,
          lot: pos.lot,
          openPrice: pos.entryPrice,
          closePrice: price,
          profit,
        });
        reason = `Closed ${pos.type.toUpperCase()} at stop (1.5 ATR)`;
        action = 'taken';
        state.openPosition = null;
        closedThisTick = true;
      } else if (move >= 2 * ind.atr) {
        const profit = pnlOf(pos, price);
        state.balance = round2(state.balance + profit);
        state.tradesToday += 1;
        if (profit >= 0) state.winsToday += 1;
        await postQuiet('/api/trade-closed', {
          symbol: pos.symbol,
          type: pos.type,
          lot: pos.lot,
          openPrice: pos.entryPrice,
          closePrice: price,
          profit,
        });
        reason = `Closed ${pos.type.toUpperCase()} at take-profit (2 ATR)`;
        action = 'taken';
        state.openPosition = null;
        closedThisTick = true;
      }
    }

    if (ind.ready && !state.openPosition && !closedThisTick && ind.signal !== 'none') {
      state.openPosition = {
        symbol: SYMBOL,
        type: ind.signal,
        lot: LOT,
        entryPrice: price,
      };
      action = 'taken';
      reason = `${ind.signal.toUpperCase()} · ${ind.trend} · RSI ${ind.rsi}`;
    } else if (!state.openPosition) {
      action = 'skip';
      reason = !ind.ready
        ? 'Warming up candles'
        : ind.trend === 'range'
          ? 'No clear trend'
          : `RSI ${ind.rsi} not in entry band`;
    } else {
      action = 'skip';
      reason = `Holding ${state.openPosition.type.toUpperCase()}`;
    }

    const positionPnl = pnlOf(state.openPosition, price);
    await post('/api/update', snapshot(state, price, positionPnl));

    const logKey = `${action}|${ind.signal}|${reason}`;
    if (logKey !== lastLogKey) {
      lastLogKey = logKey;
      await postQuiet('/api/log', {
        symbol: SYMBOL,
        price,
        emaFast: ind.emaFast,
        emaSlow: ind.emaSlow,
        atr: ind.atr,
        rsi: ind.rsi,
        trend: ind.trend,
        signal: ind.signal,
        action,
        reason,
      });
    }

    saveState(state);
    const pos = state.openPosition
      ? `${state.openPosition.type.toUpperCase()} @ ${state.openPosition.entryPrice}`
      : 'flat';
    console.log(`${new Date().toISOString()}  ${SYMBOL} ${price}  ${pos}  eq ${round2(state.balance + positionPnl)}`);
  }

  await tick();
  setInterval(() => {
    tick().catch((err) => console.error('Tick failed:', err.message));
  }, UPDATE_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
