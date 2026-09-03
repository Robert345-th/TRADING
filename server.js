/**
 * Trade Tracker backend (v2 - with database)
 * --------------------------------------------
 * - Live account snapshot (balance, position, recent trades): kept in memory,
 *   updated every 5s by the bot. This is "what's happening right now".
 * - Decision log (every check the bot makes, trade or not): stored in
 *   PostgreSQL, so it persists permanently and can be reviewed/downloaded
 *   even a month later.
 */

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'change-me';
const { startAutoDemo } = require('./trader');

function isDemoRequest(req) {
  return getAccountKey(req) === 'demo';
}

// DATABASE_URL is injected automatically by whichever host (Render/Railway)
// you've linked a Postgres database to.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS decision_logs (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      symbol TEXT,
      price NUMERIC,
      ema_fast NUMERIC,
      ema_slow NUMERIC,
      atr NUMERIC,
      rsi NUMERIC,
      trend TEXT,
      signal TEXT,
      action TEXT,
      reason TEXT
    );
  `);
  // Add columns if the table already existed from before (safe if already present)
  await pool.query(`ALTER TABLE decision_logs ADD COLUMN IF NOT EXISTS rsi NUMERIC;`);
  await pool.query(`ALTER TABLE decision_logs ADD COLUMN IF NOT EXISTS trend TEXT;`);
  await pool.query(`ALTER TABLE decision_logs ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'demo';`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS closed_trades (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      account_type TEXT DEFAULT 'demo',
      symbol TEXT,
      type TEXT,
      lot NUMERIC,
      open_price NUMERIC,
      close_price NUMERIC,
      profit NUMERIC
    );
  `);
  console.log('Database ready.');
}

initDb().catch((err) => console.error('Failed to initialize DB:', err));

// --- In-memory "right now" state (balance, open position, recent trades) ---
function makeEmptyState() {
  return {
    connected: false,
    lastUpdated: null,
    account: {
      login: null,
      balance: 0,
      equity: 0,
      freeMargin: 0,
      currency: 'USD',
    },
    openPosition: null,
    recentTrades: [],
    stats: {
      tradesToday: 0,
      winRateToday: 0,
    },
  };
}

// Separate live snapshots for demo and real accounts
const accountStates = {
  demo: makeEmptyState(),
  real: makeEmptyState(),
};

function getAccountKey(req) {
  const acc = (req.query.accountType || req.body.accountType || 'demo').toString().toLowerCase();
  return (acc === 'real') ? 'real' : 'demo';
}

function checkApiKey(req, res) {
  // Demo is the MetaTrader account on the PC. Accept its snapshots even if
  // the local .env still has the default key. Real still needs the Railway key.
  if (isDemoRequest(req)) return true;
  const providedKey = req.header('x-api-key');
  if (providedKey !== API_KEY) {
    res.status(401).json({ error: 'Invalid API key' });
    return false;
  }
  return true;
}

// Demo snapshots come from MetaTrader on the PC (pc-bot), not from this server.
app.post('/api/update', (req, res) => {
  if (!checkApiKey(req, res)) return;

  const key = getAccountKey(req);
  const body = req.body;
  const prev = accountStates[key];

  accountStates[key] = {
    connected: true,
    lastUpdated: new Date().toISOString(),
    account: body.account || prev.account,
    openPosition: body.openPosition || null,
    recentTrades: body.recentTrades || prev.recentTrades,
    stats: body.stats || prev.stats,
  };

  res.json({ ok: true });
});

// --- Bot pushes every decision (trade or skip) here ---
app.post('/api/log', async (req, res) => {
  if (!checkApiKey(req, res)) return;

  const accountType = getAccountKey(req);
  const { symbol, price, emaFast, emaSlow, atr, rsi, trend, signal, action, reason } = req.body;

  try {
    await pool.query(
      `INSERT INTO decision_logs (account_type, symbol, price, ema_fast, ema_slow, atr, rsi, trend, signal, action, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [accountType, symbol, price, emaFast, emaSlow, atr, rsi, trend, signal, action, reason]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to insert decision log:', err);
    res.json({ ok: true, stored: false });
  }
});

// --- Bot reports a trade closing (permanent record) ---
app.post('/api/trade-closed', async (req, res) => {
  if (!checkApiKey(req, res)) return;

  const accountType = getAccountKey(req);
  const { symbol, type, lot, openPrice, closePrice, profit } = req.body;

  try {
    await pool.query(
      `INSERT INTO closed_trades (account_type, symbol, type, lot, open_price, close_price, profit)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [accountType, symbol, type, lot, openPrice, closePrice, profit]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to insert closed trade:', err);
    res.json({ ok: true, stored: false });
  }
});

// --- Dashboard reads recent closed trades (from database, survives restarts) ---
app.get('/api/trades', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const accountType = getAccountKey(req);
  try {
    const result = await pool.query(
      `SELECT * FROM closed_trades WHERE account_type = $1 ORDER BY created_at DESC LIMIT $2`,
      [accountType, limit]
    );
    if (result.rows.length) {
      return res.json(result.rows);
    }
    return res.json((accountStates[accountType].recentTrades || []).slice(0, limit));
  } catch (err) {
    console.error('Failed to fetch closed trades:', err);
    return res.json((accountStates[accountType].recentTrades || []).slice(0, limit));
  }
});

// --- One-time cleanup: remove a specific bad entry (visit in browser, then can be deleted) ---
app.get('/api/trades/cleanup', async (req, res) => {
  const providedKey = req.query.key;
  if (providedKey !== API_KEY) {
    return res.status(401).send('Invalid key');
  }
  const accountType = getAccountKey(req);
  try {
    const result = await pool.query(
      `DELETE FROM closed_trades WHERE account_type = $1`,
      [accountType]
    );
    res.send(`Removed ${result.rowCount} bad entries for ${accountType}.`);
  } catch (err) {
    res.status(500).send('Cleanup failed: ' + err.message);
  }
});

// --- Dashboard reads live snapshot ---
app.get('/api/status', (req, res) => {
  const key = getAccountKey(req);
  res.json(accountStates[key]);
});

// --- Dashboard reads recent decision log entries ---
app.get('/api/logs', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const accountType = getAccountKey(req);
  try {
    const result = await pool.query(
      `SELECT * FROM decision_logs WHERE account_type = $1 ORDER BY created_at DESC LIMIT $2`,
      [accountType, limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch logs:', err);
    res.json([]);
  }
});

// --- Download full history as CSV ---
app.get('/api/logs/export', async (req, res) => {
  const accountType = getAccountKey(req);
  try {
    const result = await pool.query(
      `SELECT * FROM decision_logs WHERE account_type = $1 ORDER BY created_at ASC`,
      [accountType]
    );

    // Matches the columns shown on the History page (history.html)
    const headers = ['TIME', 'PRICE', 'RSI', 'TREND', 'SIGNAL', 'ACTION', 'REASON'];

    const fmtNum = (val, decimals = 2) => {
      if (val === null || val === undefined) return '';
      return Number(val).toFixed(decimals);
    };

    const csvField = (val) => {
      const str = String(val ?? '').replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = result.rows.map((row) => {
      const createdAt = new Date(row.created_at);
      const time = createdAt.toISOString().replace('T', ' ').slice(0, 19);

      const fields = [
        time,
        fmtNum(row.price),
        fmtNum(row.rsi, 1),
        (row.trend || '--').toUpperCase(),
        (row.signal || 'NONE').toUpperCase(),
        row.action === 'taken' ? 'TAKEN' : 'SKIP',
        row.reason || '',
      ];

      return fields.map(csvField).join(',');
    });

    const csv = [headers.map(csvField).join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="trade_tracker_history.csv"');
    res.send(csv);
  } catch (err) {
    console.error('Failed to export logs:', err);
    res.status(500).json({ error: 'Failed to export logs' });
  }
});

app.get('/api/logs/export-html', async (req, res) => {
  const accountType = getAccountKey(req);
  try {
    const result = await pool.query(
      `SELECT * FROM decision_logs WHERE account_type = $1 ORDER BY created_at DESC`,
      [accountType]
    );

    const fmtNum = (val, decimals = 2) => (val === null || val === undefined) ? '--' : Number(val).toFixed(decimals);
    const fmtTime = (iso) => new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

    const rows = result.rows.map((row) => {
      const trendClass = row.trend === 'uptrend' ? 'up' : row.trend === 'downtrend' ? 'down' : 'skip';
      const actionClass = row.action === 'taken' ? 'taken' : 'skip';
      return `
        <tr>
          <td>${fmtTime(row.created_at)}</td>
          <td>${fmtNum(row.price)}</td>
          <td>${fmtNum(row.rsi, 1)}</td>
          <td class="${trendClass}">${(row.trend || '--').toUpperCase()}</td>
          <td>${(row.signal || 'NONE').toUpperCase()}</td>
          <td class="${actionClass}">${row.action === 'taken' ? 'TAKEN' : 'SKIP'}</td>
          <td>${row.reason || ''}</td>
        </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Trade Tracker Report</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=JetBrains+Mono:wght@400;500;600&display=swap');
  :root {
    --bg: #14161F; --panel: #1A1D29; --border: #2A2E3D;
    --green: #3FBF7F; --red: #FF5C5C; --purple: #9C8CFF;
    --text: #E8E6E1; --text-dim: #7C839A;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--text); font-family:'Inter',sans-serif; padding:24px; }
  h1 { font-family:'Space Grotesk',sans-serif; margin-bottom:4px; }
  .sub { color:var(--text-dim); font-size:13px; margin-bottom:20px; font-family:'JetBrains Mono',monospace; }
  .grid-wrap { background:var(--panel); border:1px solid var(--border); border-radius:10px; overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-family:'JetBrains Mono',monospace; font-size:12px; white-space:nowrap; }
  th { background:#20232F; color:var(--text-dim); text-align:left; padding:10px 12px; position:sticky; top:0; }
  td { padding:8px 12px; border-top:1px solid var(--border); }
  .up { color:var(--green); } .down { color:var(--red); } .skip { color:var(--text-dim); }
  .taken { color:var(--green); font-weight:600; }
</style>
</head>
<body>
  <h1>Trade Tracker — Full Report (${accountType.toUpperCase()})</h1>
  <div class="sub">${result.rows.length} entries · Generated ${new Date().toISOString().replace('T',' ').slice(0,19)} UTC</div>
  <div class="grid-wrap">
    <table>
      <thead><tr><th>TIME</th><th>PRICE</th><th>RSI</th><th>TREND</th><th>SIGNAL</th><th>ACTION</th><th>REASON</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', 'attachment; filename="trade_tracker_report.html"');
    res.send(html);
  } catch (err) {
    console.error('Failed to generate HTML report:', err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

function startDemoBot() {
  // Off unless AUTO_DEMO=1. Demo is the MT5 account on the owner's PC.
  if (process.env.AUTO_DEMO !== '1') return;
  startAutoDemo(accountStates, {
    onClose: (trade) => {
      if (!process.env.DATABASE_URL) return;
      pool.query(
        `INSERT INTO closed_trades (account_type, symbol, type, lot, open_price, close_price, profit)
         VALUES ('demo', $1, $2, $3, $4, $5, $6)`,
        [trade.symbol, trade.type, trade.lot, trade.openPrice, trade.closePrice, trade.profit]
      ).catch((err) => console.error('Failed to insert closed trade:', err.message));
    },
  });
}

app.listen(PORT, () => {
  console.log(`Trade Tracker backend running on port ${PORT}`);
  if (process.env.AUTO_DEMO === '1') {
    console.log('AUTO_DEMO=1: paper Demo trader on this server');
  } else {
    console.log('Demo waits for MetaTrader on the PC (pc-bot). Set AUTO_DEMO=1 only for paper trading.');
  }
  startDemoBot();
});
