"""
Connect the MetaTrader 5 demo on your PC to Trade Tracker (Demo tab).

https://github.com/Robert345-th/TRADING

1. Open MT5 on this PC and log into your DEMO account.
2. pip install MetaTrader5
3. python mt5_demo.py
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None


def load_env():
    path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


load_env()

TRADING_URL = os.environ.get("TRADING_URL", "https://trading-production-2c95.up.railway.app").rstrip("/")
API_KEY = os.environ.get("API_KEY", "change-me")
ACCOUNT_TYPE = "demo"
SYMBOL_HINT = os.environ.get("SYMBOL", "XAUUSD")
LOT = float(os.environ.get("LOT", "0.01"))
ENABLE_TRADING = os.environ.get("ENABLE_TRADING", "1") != "0"
ALWAYS_IN = os.environ.get("ALWAYS_IN", "1") != "0"
CLOSE_MOVE = float(os.environ.get("CLOSE_MOVE", "1.5"))
MAGIC = 345701
POLL_SEC = 5

# MQL5: DEMO=0, CONTEST=1, REAL=2. Never treat DEMO as "not demo".
ACCOUNT_TRADE_MODE_REAL = 2


def post(path, body):
    url = f"{TRADING_URL}{path}?accountType={ACCOUNT_TYPE}"
    payload = json.dumps({**body, "accountType": ACCOUNT_TYPE}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{path} {err.code}: {detail}") from err


def post_quiet(path, body):
    try:
        post(path, body)
        return True
    except Exception as err:
        print(f"warn {err}")
        return False


def pick_symbol():
    wanted = [SYMBOL_HINT, "XAUUSD", "GOLD", "XAUUSDm", "XAUUSD.a", "XAUUSD.m"]
    for name in wanted:
        info = mt5.symbol_info(name)
        if info is None:
            continue
        if not info.visible:
            mt5.symbol_select(name, True)
        return name
    raise RuntimeError(
        f"No gold symbol found. Set SYMBOL in .env (tried {', '.join(wanted)})."
    )


def ema(values, period):
    if len(values) < period:
        return None
    k = 2 / (period + 1)
    seed = sum(values[:period]) / period
    value = seed
    for price in values[period:]:
        value = price * k + value * (1 - k)
    return value


def rsi(values, period=14):
    if len(values) < period + 1:
        return None
    gains = []
    losses = []
    for i in range(1, len(values)):
        delta = values[i] - values[i - 1]
        gains.append(max(delta, 0.0))
        losses.append(max(-delta, 0.0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    return 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)


def atr_from_rates(rates, period=14):
    if len(rates) < period + 1:
        return None
    trs = []
    for i in range(1, len(rates)):
        high = float(rates[i]["high"])
        low = float(rates[i]["low"])
        prev_close = float(rates[i - 1]["close"])
        trs.append(max(high - low, abs(high - prev_close), abs(low - prev_close)))
    value = sum(trs[:period]) / period
    for tr in trs[period:]:
        value = (value * (period - 1) + tr) / period
    return value


def decide(closes, atr_value):
    ema_fast = ema(closes, 9)
    ema_slow = ema(closes, 21)
    rsi_value = rsi(closes)
    if None in (ema_fast, ema_slow, rsi_value, atr_value):
        return None
    trend = "uptrend" if ema_fast > ema_slow else "downtrend" if ema_fast < ema_slow else "range"
    if abs(ema_fast - ema_slow) < atr_value * 0.12:
        trend = "range"
    signal = "none"
    if trend == "uptrend" and 48 <= rsi_value <= 68:
        signal = "buy"
    elif trend == "downtrend" and 32 <= rsi_value <= 52:
        signal = "sell"
    return {
        "emaFast": round(ema_fast, 2),
        "emaSlow": round(ema_slow, 2),
        "rsi": round(rsi_value, 2),
        "atr": round(atr_value, 2),
        "trend": trend,
        "signal": signal,
    }


def filling_mode(info):
    if info.filling_mode & 1:
        return mt5.ORDER_FILLING_FOK
    if info.filling_mode & 2:
        return mt5.ORDER_FILLING_IOC
    return mt5.ORDER_FILLING_RETURN


def send_order(symbol, side, volume, comment):
    info = mt5.symbol_info(symbol)
    tick = mt5.symbol_info_tick(symbol)
    if info is None or tick is None:
        print("warn no tick")
        return False
    order_type = mt5.ORDER_TYPE_BUY if side == "buy" else mt5.ORDER_TYPE_SELL
    price = tick.ask if side == "buy" else tick.bid
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": volume,
        "type": order_type,
        "price": price,
        "deviation": 30,
        "magic": MAGIC,
        "comment": comment,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": filling_mode(info),
    }
    result = mt5.order_send(request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        err = mt5.last_error()
        print(f"warn order failed: {result}  last_error={err}")
        print("If AutoTrading is red in MT5, click the AutoTrading button so it turns green.")
        return False
    print(f"MT5 demo {side} {volume} {symbol} @ {price}")
    return True


def close_position(pos, reason):
    side = "sell" if pos.type == mt5.POSITION_TYPE_BUY else "buy"
    return send_order(pos.symbol, side, pos.volume, reason[:31])


def open_from_mt5(symbol):
    positions = mt5.positions_get(symbol=symbol) or []
    ours = [p for p in positions if p.magic == MAGIC] or list(positions)
    if not ours:
        return None
    pos = ours[0]
    tick = mt5.symbol_info_tick(symbol)
    price = float(tick.bid if pos.type == mt5.POSITION_TYPE_BUY else tick.ask) if tick else float(pos.price_current)
    return {
        "symbol": pos.symbol,
        "type": "buy" if pos.type == mt5.POSITION_TYPE_BUY else "sell",
        "lot": float(pos.volume),
        "entryPrice": float(pos.price_open),
        "currentPrice": price,
        "pnl": float(pos.profit),
        "mt5": pos,
    }


def stats_today():
    now = datetime.now(timezone.utc)
    start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    deals = mt5.history_deals_get(start, now) or []
    closes = [d for d in deals if d.entry == mt5.DEAL_ENTRY_OUT]
    if not closes:
        return {"tradesToday": 0, "winRateToday": 0}
    wins = sum(1 for d in closes if d.profit >= 0)
    return {
        "tradesToday": len(closes),
        "winRateToday": round(100 * wins / len(closes)),
    }


def recent_closes():
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=14)
    deals = mt5.history_deals_get(start, now) or []
    rows = []
    for deal in reversed(list(deals)):
        if deal.entry != mt5.DEAL_ENTRY_OUT:
            continue
        rows.append({
            "symbol": deal.symbol,
            "type": "buy" if deal.type == mt5.DEAL_TYPE_SELL else "sell",
            "lot": float(deal.volume),
            "profit": float(deal.profit),
            "created_at": datetime.fromtimestamp(deal.time, tz=timezone.utc).isoformat(),
        })
        if len(rows) >= 10:
            break
    return rows


def snapshot(account, position):
    return {
        "account": {
            "login": int(account.login),
            "balance": float(account.balance),
            "equity": float(account.equity),
            "freeMargin": float(account.margin_free),
            "currency": account.currency,
        },
        "openPosition": None
        if position is None
        else {
            "symbol": position["symbol"],
            "type": position["type"],
            "lot": position["lot"],
            "entryPrice": position["entryPrice"],
            "currentPrice": position["currentPrice"],
            "pnl": position["pnl"],
        },
        "recentTrades": recent_closes(),
        "stats": stats_today(),
    }


def main():
    if mt5 is None:
        raise SystemExit(
            "MetaTrader5 is not installed. On your Windows PC run:\n"
            "  pip install MetaTrader5\n"
            "Open MT5, log into your DEMO account, then run:\n"
            "  python mt5_demo.py"
        )

    if not mt5.initialize():
        raise SystemExit(
            f"Could not connect to MT5 ({mt5.last_error()}). "
            "Open MetaTrader 5 on this PC and log into your DEMO account first."
        )

    account = mt5.account_info()
    if account is None:
        mt5.shutdown()
        raise SystemExit("MT5 has no account. Log into a DEMO account, then retry.")

    if mt5 is not None:
        try:
            ACCOUNT_TRADE_MODE_REAL = int(mt5.ACCOUNT_TRADE_MODE_REAL)
        except Exception:
            ACCOUNT_TRADE_MODE_REAL = 2

    if account.trade_mode == ACCOUNT_TRADE_MODE_REAL:
        print(
            f"Login {account.login} is a REAL account. "
            "This Demo starter will only report, not send orders."
        )
        trading = False
    else:
        trading = ENABLE_TRADING
        print(
            f"Connected MT5 login {account.login}  server={account.server}  "
            f"trade_mode={account.trade_mode}  trading={'on' if trading else 'off'}"
        )

    symbol = pick_symbol()
    print(f"Symbol {symbol}  -> {TRADING_URL}  tab=Demo  trading={'on' if trading else 'off'}")
    if trading and ALWAYS_IN:
        print(f"Always-in gold on YOUR demo login. Close when move >= {CLOSE_MOVE}")

    last_log_key = ""
    last_price = 0.0

    try:
        while True:
            account = mt5.account_info()
            if account is None:
                print("warn lost MT5 account")
                time.sleep(POLL_SEC)
                continue

            rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M5, 0, 80)
            closes = [float(r["close"]) for r in rates] if rates is not None else []
            atr_value = atr_from_rates(rates) if rates is not None else None
            ind = decide(closes, atr_value) if closes else None
            tick = mt5.symbol_info_tick(symbol)
            price = float(tick.bid) if tick else (closes[-1] if closes else 0.0)

            position = open_from_mt5(symbol)
            action = "skip"
            reason = "Watching demo account"

            def report_close(closed_pos):
                post_quiet(
                    "/api/trade-closed",
                    {
                        "symbol": closed_pos["symbol"],
                        "type": closed_pos["type"],
                        "lot": closed_pos["lot"],
                        "openPrice": closed_pos["entryPrice"],
                        "closePrice": price,
                        "profit": closed_pos["pnl"],
                    },
                )

            if trading and ALWAYS_IN:
                if position and abs(price - position["entryPrice"]) >= CLOSE_MOVE:
                    closed = position
                    close_position(position["mt5"], "auto close")
                    action = "taken"
                    reason = f"Computer closed {closed['type'].upper()} on your demo"
                    report_close(closed)
                    position = open_from_mt5(symbol)
                if position is None:
                    side = "buy"
                    if last_price and price < last_price:
                        side = "sell"
                    elif last_price and price > last_price:
                        side = "buy"
                    if send_order(symbol, side, LOT, "computer demo"):
                        action = "taken"
                        reason = f"Computer {side.upper()} on your demo login"
                    position = open_from_mt5(symbol)
                elif action != "taken":
                    reason = f"Holding your demo {position['type'].upper()}"
            elif trading and ind:
                if position:
                    pos = position["mt5"]
                    move = (
                        price - pos.price_open
                        if pos.type == mt5.POSITION_TYPE_BUY
                        else pos.price_open - price
                    )
                    if move <= -1.5 * ind["atr"]:
                        closed = position
                        close_position(pos, "stop 1.5 ATR")
                        action = "taken"
                        reason = f"Computer closed {closed['type'].upper()} at stop"
                        report_close(closed)
                        position = open_from_mt5(symbol)
                    elif move >= 2 * ind["atr"]:
                        closed = position
                        close_position(pos, "tp 2 ATR")
                        action = "taken"
                        reason = f"Computer closed {closed['type'].upper()} at take-profit"
                        report_close(closed)
                        position = open_from_mt5(symbol)
                if position is None and ind["signal"] in ("buy", "sell"):
                    if send_order(symbol, ind["signal"], LOT, "computer demo"):
                        action = "taken"
                        reason = (
                            f"Computer {ind['signal'].upper()} on demo · "
                            f"{ind['trend']} · RSI {ind['rsi']}"
                        )
                    position = open_from_mt5(symbol)
                elif position is None:
                    reason = (
                        "No clear trend"
                        if ind["trend"] == "range"
                        else f"RSI {ind['rsi']} not in entry band"
                    )
                else:
                    reason = f"Holding demo {position['type'].upper()}"
            elif not trading:
                reason = "Demo connected, trading off"
            elif not ind:
                reason = "Warming up MT5 candles"

            last_price = price or last_price

            post("/api/update", snapshot(account, position))

            log_key = f"{action}|{(ind or {}).get('signal')}|{reason}"
            if log_key != last_log_key:
                last_log_key = log_key
                indicators = ind or {}
                post_quiet(
                    "/api/log",
                    {
                        "symbol": symbol,
                        "price": price,
                        "emaFast": indicators.get("emaFast"),
                        "emaSlow": indicators.get("emaSlow"),
                        "atr": indicators.get("atr"),
                        "rsi": indicators.get("rsi"),
                        "trend": indicators.get("trend"),
                        "signal": indicators.get("signal") or "none",
                        "action": action,
                        "reason": reason,
                    },
                )

            pos_txt = "flat" if position is None else f"{position['type'].upper()} {position['lot']}"
            print(
                f"{datetime.now(timezone.utc).strftime('%H:%M:%S')}  "
                f"demo {account.login}  {symbol} {price:.2f}  {pos_txt}  "
                f"eq {account.equity:.2f}"
            )
            time.sleep(POLL_SEC)
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Stopped.")
