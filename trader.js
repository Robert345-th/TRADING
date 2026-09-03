/**
 * Built-in Demo trader. Starts with the server.
 * You only open the website — this process reads live gold and paper-trades.
 */

const SYMBOL = 'XAUUSD';
const LOT = 0.1;
const POINT = 100;
const START_BALANCE = 10000;

function round2(n) {
  return Number(Number(n).toFixed(2));
}

async function goldPrice() {
  const res = await fetch('https://xaus.com/api/v1/spot', { signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  const price = Number(data.spot_usd_oz || data.xau && data.xau.price);
  if (!Number.isFinite(price) || price < 100) throw new Error('bad gold price');
  return round2(price);
}

function pnl(pos, price) {
  if (!pos) return 0;
  const diff = pos.type === 'buy' ? price - pos.entryPrice : pos.entryPrice - price;
  return round2(diff * pos.lot * POINT);
}

function startAutoDemo(accountStates, storeHooks) {
  const book = {
    balance: START_BALANCE,
    position: null,
    lastPrice: 0,
    tradesToday: 0,
    winsToday: 0,
    recent: [],
  };

  async function tick() {
    const price = await goldPrice();
    let profit = pnl(book.position, price);

    if (book.position && Math.abs(price - book.position.entryPrice) >= 1.5) {
      book.balance = round2(book.balance + profit);
      book.tradesToday += 1;
      if (profit >= 0) book.winsToday += 1;
      book.recent.unshift({
        symbol: SYMBOL,
        type: book.position.type,
        profit,
        created_at: new Date().toISOString(),
      });
      book.recent = book.recent.slice(0, 10);
      if (storeHooks && storeHooks.onClose) {
        storeHooks.onClose({
          symbol: SYMBOL,
          type: book.position.type,
          lot: LOT,
          openPrice: book.position.entryPrice,
          closePrice: price,
          profit,
        });
      }
      book.position = null;
      profit = 0;
    }

    if (!book.position && book.lastPrice) {
      if (price > book.lastPrice) {
        book.position = { symbol: SYMBOL, type: 'buy', lot: LOT, entryPrice: price };
      } else if (price < book.lastPrice) {
        book.position = { symbol: SYMBOL, type: 'sell', lot: LOT, entryPrice: price };
      }
    }
    if (!book.position) {
      book.position = { symbol: SYMBOL, type: 'buy', lot: LOT, entryPrice: price };
    }

    book.lastPrice = price;
    profit = pnl(book.position, price);
    const equity = round2(book.balance + profit);

    accountStates.demo = {
      connected: true,
      lastUpdated: new Date().toISOString(),
      account: {
        login: 'AUTO-DEMO',
        balance: round2(book.balance),
        equity,
        freeMargin: round2(equity - (book.position ? 1000 : 0)),
        currency: 'USD',
      },
      openPosition: book.position
        ? {
            symbol: book.position.symbol,
            type: book.position.type,
            lot: book.position.lot,
            entryPrice: book.position.entryPrice,
            currentPrice: price,
            pnl: profit,
          }
        : null,
      recentTrades: book.recent,
      stats: {
        tradesToday: book.tradesToday,
        winRateToday: book.tradesToday ? Math.round((book.winsToday / book.tradesToday) * 100) : 0,
      },
    };
  }

  tick().catch((err) => console.error('Demo trader:', err.message));
  setInterval(() => {
    tick().catch((err) => console.error('Demo trader:', err.message));
  }, 5000);
  console.log('Demo auto-trader is running. Open the site and watch — do nothing else.');
}

module.exports = { startAutoDemo };
