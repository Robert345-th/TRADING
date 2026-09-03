/**
 * Double-click this file on Windows.
 * Windows Script Host (wscript.exe / cscript.exe) runs it.
 * No Node, no Python, no install.
 *
 * It paper-trades Demo XAUUSD and posts to Trade Tracker.
 */

var fso = new ActiveXObject("Scripting.FileSystemObject");
var sh = new ActiveXObject("WScript.Shell");
var scriptDir = fso.GetParentFolderName(WScript.ScriptFullName);

if (WScript.FullName.toLowerCase().indexOf("wscript") >= 0) {
  sh.Run(
    'cscript.exe //nologo "' + WScript.ScriptFullName + '"',
    1,
    false
  );
  WScript.Quit(0);
}

function readFile(path) {
  if (!fso.FileExists(path)) return "";
  var f = fso.OpenTextFile(path, 1);
  var t = f.ReadAll();
  f.Close();
  return t;
}

function writeFile(path, text) {
  var f = fso.OpenTextFile(path, 2, true);
  f.Write(text);
  f.Close();
}

function loadEnv() {
  var env = {
    TRADING_URL: "https://trading-production-2c95.up.railway.app",
    API_KEY: "change-me",
    ACCOUNT_TYPE: "demo",
    SYMBOL: "XAUUSD",
    LOT: 0.1,
    STARTING_BALANCE: 10000,
    LOGIN: 880214
  };
  var lines = readFile(scriptDir + "\\.env").split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/^\s+|\s+$/g, "");
    if (!line || line.charAt(0) === "#") continue;
    var eq = line.indexOf("=");
    if (eq < 1) continue;
    env[line.substr(0, eq)] = line.substr(eq + 1);
  }
  env.TRADING_URL = String(env.TRADING_URL).replace(/\/$/, "");
  env.LOT = parseFloat(env.LOT);
  env.STARTING_BALANCE = parseFloat(env.STARTING_BALANCE);
  env.LOGIN = parseInt(env.LOGIN, 10);
  return env;
}

function http(method, url, body, apiKey) {
  var xhr = new ActiveXObject("MSXML2.ServerXMLHTTP.6.0");
  xhr.setTimeouts(5000, 5000, 10000, 15000);
  xhr.open(method, url, false);
  if (apiKey) xhr.setRequestHeader("x-api-key", apiKey);
  if (body) xhr.setRequestHeader("Content-Type", "application/json");
  try {
    xhr.send(body || null);
  } catch (e) {
    throw new Error("Network error: " + e.message + "\n" + url);
  }
  return { status: xhr.status, text: xhr.responseText };
}

function grabNumber(text, key) {
  var re = new RegExp('"' + key + '"\\s*:\\s*([0-9.]+)');
  var m = re.exec(text);
  return m ? parseFloat(m[1]) : NaN;
}

function liveGold() {
  var r = http("GET", "https://xaus.com/api/v1/spot", null, null);
  var price = grabNumber(r.text, "spot_usd_oz");
  if (!isFinite(price) || price < 100) {
    throw new Error("Could not read gold price");
  }
  return Math.round(price * 100) / 100;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function loadState(env) {
  var raw = readFile(scriptDir + "\\wscript-state.txt");
  if (!raw) {
    return { balance: env.STARTING_BALANCE, side: "", entry: 0, trades: 0, last: 0 };
  }
  var parts = raw.split("|");
  return {
    balance: parseFloat(parts[0]) || env.STARTING_BALANCE,
    side: parts[1] || "",
    entry: parseFloat(parts[2]) || 0,
    trades: parseInt(parts[3], 10) || 0,
    last: parseFloat(parts[4]) || 0
  };
}

function saveState(s) {
  writeFile(
    scriptDir + "\\wscript-state.txt",
    s.balance + "|" + s.side + "|" + s.entry + "|" + s.trades + "|" + s.last
  );
}

function pnl(s, price) {
  if (!s.side) return 0;
  var diff = s.side === "buy" ? price - s.entry : s.entry - price;
  return round2(diff * 0.1 * 100);
}

function postUpdate(env, s, price, profit) {
  var equity = round2(s.balance + profit);
  var pos = "null";
  if (s.side) {
    pos =
      '{"symbol":"' + env.SYMBOL + '","type":"' + s.side + '","lot":' + env.LOT +
      ',"entryPrice":' + s.entry + ',"currentPrice":' + price + ',"pnl":' + profit + "}";
  }
  var body =
    '{"accountType":"demo","account":{"login":' + env.LOGIN +
    ',"balance":' + round2(s.balance) + ',"equity":' + equity +
    ',"freeMargin":' + round2(equity - (s.side ? 1000 : 0)) +
    ',"currency":"USD"},"openPosition":' + pos +
    ',"stats":{"tradesToday":' + s.trades + ',"winRateToday":0}}';
  var r = http("POST", env.TRADING_URL + "/api/update?accountType=demo", body, env.API_KEY);
  if (r.status === 401) {
    throw new Error(
      "Wrong API_KEY.\nOpen Railway → Variables, copy API_KEY into pc-bot\\.env"
    );
  }
  if (r.status < 200 || r.status >= 300) {
    throw new Error("Dashboard " + r.status + ": " + r.text);
  }
}

function tick(env, s) {
  var price = liveGold();
  var profit = pnl(s, price);

  if (s.side && Math.abs(price - s.entry) >= 2) {
    s.balance = round2(s.balance + profit);
    s.trades += 1;
    s.side = "";
    s.entry = 0;
    profit = 0;
  }

  if (!s.side && s.last) {
    if (price > s.last) {
      s.side = "buy";
      s.entry = price;
    } else if (price < s.last) {
      s.side = "sell";
      s.entry = price;
    }
  }

  s.last = price;
  saveState(s);
  postUpdate(env, s, price, pnl(s, price));
  var pos = s.side ? s.side.toUpperCase() + " @ " + s.entry : "flat";
  WScript.Echo(new Date().toUTCString() + "  " + env.SYMBOL + " " + price + "  " + pos);
}

var env = loadEnv();
WScript.Echo("Demo trading started (Windows Script Host).");
WScript.Echo("Dashboard: " + env.TRADING_URL);
WScript.Echo("Close this window to stop.");
WScript.Echo("");

var state = loadState(env);
while (true) {
  try {
    tick(env, state);
  } catch (e) {
    WScript.Echo("Error: " + e.message);
  }
  WScript.Sleep(5000);
}
