const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const sqlite3 = require('sqlite3').verbose();
const { generateSync } = require('otplib');

dotenv.config({ path: './.env' }); // Load .env from backend folder

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// CORS Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, access-token, client-id');
  next();
});

// Global state for token
let dhanAccessToken = process.env.DHAN_ACCESS_TOKEN;

// Helper to get Dhan Headers
const getDhanHeaders = () => ({
  'Content-Type': 'application/json',
  'access-token': dhanAccessToken,
  'client-id': process.env.DHAN_CLIENT_ID
});

// Rate-limiting queue for Dhan API calls to prevent 429 errors
const dhanQueue = [];
let isProcessingQueue = false;
let lastDhanCallTime = 0;
const MIN_DELAY_BETWEEN_CALLS = 500; // 500ms spacing

const queuedDhanRequest = (config) => {
  return new Promise((resolve, reject) => {
    dhanQueue.push({ config, resolve, reject });
    processDhanQueue();
  });
};

const processDhanQueue = async () => {
  if (isProcessingQueue || dhanQueue.length === 0) return;
  isProcessingQueue = true;

  while (dhanQueue.length > 0) {
    const { config, resolve, reject } = dhanQueue.shift();
    const now = Date.now();
    const elapsed = now - lastDhanCallTime;
    if (elapsed < MIN_DELAY_BETWEEN_CALLS) {
      await new Promise(r => setTimeout(r, MIN_DELAY_BETWEEN_CALLS - elapsed));
    }
    lastDhanCallTime = Date.now();

    try {
      const res = await axios(config);
      resolve(res);
    } catch (err) {
      reject(err);
    }
  }

  isProcessingQueue = false;
};

// Function to refresh Dhan Token automatically
const refreshDhanToken = async () => {
  const secret = process.env.DHAN_TOTP_SECRET;
  const pin = process.env.DHAN_PIN;
  const clientId = process.env.DHAN_CLIENT_ID;

  if (!secret || !pin || pin === 'xxxx') {
    console.log('Auto token refresh skipped: DHAN_TOTP_SECRET or DHAN_PIN not set in .env');
    return;
  }

  try {
    const totp = generateSync({ secret });
    console.log(`[${new Date().toLocaleTimeString()}] Generating new Dhan token with TOTP...`);
    
    const url = `https://auth.dhan.co/app/generateAccessToken?dhanClientId=${clientId}&pin=${pin}&totp=${totp}`;
    const response = await axios.post(url);
    
    const token = response.data?.access_token || response.data?.data?.access_token || response.data?.accessToken || response.data?.data?.accessToken;
    if (token) {
      dhanAccessToken = token;
      console.log('Dhan Access Token refreshed successfully!');
      
      // Save new token to .env file so it persists across restarts
      try {
        const env = readEnvFile();
        env.DHAN_ACCESS_TOKEN = token;
        writeEnvFile(env);
        process.env.DHAN_ACCESS_TOKEN = token;
      } catch (e) {
        console.log('Error saving token to .env:', e.message);
      }
    } else {
      console.error('Failed to refresh Dhan token. Response:', response.data);
    }
  } catch (error) {
    console.error('Error refreshing Dhan token:', error.message);
    if (error.response) {
      console.error('Error response from Dhan:', error.response.data);
    }
  }
};

// Refresh on startup (Uncommented to make it fully automatic)
refreshDhanToken();

// Refresh every 20 hours to be safe
setInterval(refreshDhanToken, 20 * 60 * 60 * 1000);

// Initialize SQLite Database
const db = new sqlite3.Database('./option_chain.db', (err) => {
  if (err) {
    console.error('Database opening error:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS option_chain_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      spot_price REAL,
      expiry TEXT,
      data TEXT
    )`, () => {
      // Run cleanup on startup
      cleanupDatabaseHistory();
    });

    db.run(`CREATE TABLE IF NOT EXISTS ai_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT,
      type TEXT,
      entry_price REAL,
      target_price REAL,
      stoploss_price REAL,
      source TEXT DEFAULT 'OPTION_CHAIN',
      status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, () => {
      // Safe migration check for existing databases
      db.run(`ALTER TABLE ai_signals ADD COLUMN source TEXT DEFAULT 'OPTION_CHAIN'`, (alterErr) => {
        if (alterErr) {
          // Column probably already exists, which is expected
        } else {
          console.log("Successfully migrated database: added 'source' column to ai_signals.");
        }
      });
    });

    db.run(`CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
  }
});

// Helper to clean up database history (off-market records and records older than 7 days)
const cleanupDatabaseHistory = () => {
  console.log(`[${new Date().toLocaleTimeString()}] Running database history cleanup...`);
  
  // Clean up off-market hours history records (keeping strictly 9:15 AM to 3:30 PM IST)
  db.run(`
    DELETE FROM option_chain_history 
    WHERE time(timestamp, '+5.5 hours') < '09:15:00' 
       OR time(timestamp, '+5.5 hours') > '15:30:00'
  `, function(cleanErr) {
    if (cleanErr) {
      console.error('Error cleaning up off-hours history:', cleanErr.message);
    } else if (this.changes > 0) {
      console.log(`Cleaned up ${this.changes} off-market hours history records from database.`);
    }
  });

  // Clean up records older than 7 days (7 * 24 hours)
  db.run(`
    DELETE FROM option_chain_history 
    WHERE timestamp < datetime('now', '-7 days')
  `, function(cleanErr) {
    if (cleanErr) {
      console.error('Error cleaning up history older than 7 days:', cleanErr.message);
    } else if (this.changes > 0) {
      console.log(`Cleaned up ${this.changes} records older than 7 days from option_chain_history database.`);
    }
  });
};

// Periodic database cleanup every 12 hours
setInterval(cleanupDatabaseHistory, 12 * 60 * 60 * 1000);

// Cache store to prevent Dhan API rate limit issues
const dhanCache = {
  optionChain: {},
  chartsIntraday: {},
  chartsHistorical: {}
};

const CACHE_DURATION_MS = 30000; // Cache duration: 30 seconds for live data
const HISTORICAL_CACHE_DURATION_MS = 3600000; // Cache duration: 1 hour for historical daily charts

function getCachedData(type, key, duration = CACHE_DURATION_MS) {
  const entry = dhanCache[type]?.[key];
  if (entry && (Date.now() - entry.timestamp < duration)) {
    return entry.data;
  }
  return null;
}

function setCachedData(type, key, data) {
  if (!dhanCache[type]) dhanCache[type] = {};
  dhanCache[type][key] = {
    data,
    timestamp: Date.now()
  };
}

// Scrip Mapping for Indices
const scripMap = {
  'NIFTY': 13,
  'BANKNIFTY': 25,
  'FINNIFTY': 27,
  'MIDCPNIFTY': 442
};

// Global cache for latest spot prices
const latestSpotPrices = {
  'NIFTY': 0,
  'BANKNIFTY': 0,
  'FINNIFTY': 0,
  'MIDCPNIFTY': 0
};

// Global cache for latest ATR values (initialized with reasonable defaults)
const latestAtrValues = {
  'NIFTY': 15,
  'BANKNIFTY': 40,
  'FINNIFTY': 18,
  'MIDCPNIFTY': 10
};

// Robust helper to parse Dhan API timestamps with IST (+05:30) offset
const parseDhanTimestamp = (ts) => {
  if (ts === null || ts === undefined) return 0;
  if (typeof ts === 'string') {
    const trimmed = ts.trim();
    if (trimmed.includes('-') || trimmed.includes('T') || trimmed.includes(':')) {
      let dateStr = trimmed;
      if (!dateStr.includes('+') && !dateStr.includes('Z') && !dateStr.includes('GMT')) {
        dateStr = dateStr.replace(' ', 'T') + '+05:30';
      }
      const timeMs = new Date(dateStr).getTime();
      return isNaN(timeMs) ? 0 : Math.floor(timeMs / 1000);
    }
    const val = parseInt(trimmed, 10);
    return isNaN(val) ? 0 : (val > 2000000000 ? Math.floor(val / 1000) : val);
  } else if (typeof ts === 'number') {
    return ts > 2000000000 ? Math.floor(ts / 1000) : ts;
  }
  return 0;
};

// Helper to check if Indian Stock Market is open strictly for live trading hours (Monday to Friday, 9:15 AM to 3:30 PM IST)
const isIndianMarketOpen = () => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const parts = formatter.formatToParts(new Date());
    const getValue = (type) => parts.find(p => p.type === type)?.value;
    
    const weekday = getValue('weekday'); // "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"
    const hour = parseInt(getValue('hour'), 10);
    const minute = parseInt(getValue('minute'), 10);
    
    if (!weekday || isNaN(hour) || isNaN(minute)) return false;
    if (['Sat', 'Sun'].includes(weekday)) return false;
    
    const timeInMinutes = hour * 60 + minute;
    // 9:15 AM is 555 minutes, 3:30 PM is 930 minutes
    return timeInMinutes >= 555 && timeInMinutes <= 930;
  } catch (err) {
    console.error('Error in isIndianMarketOpen:', err.message);
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const ist = new Date(utc + (3600000 * 5.5));
    const day = ist.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const hours = ist.getHours();
    const minutes = ist.getMinutes();
    
    if (day < 1 || day > 5) return false; // Closed on weekends
    
    const timeInMinutes = hours * 60 + minutes;
    return timeInMinutes >= 555 && timeInMinutes <= 930;
  }
};

// Initialize latest spot prices from database history on startup
const initializeSpotPrices = async () => {
  const symbols = Object.keys(latestSpotPrices);
  for (const sym of symbols) {
    db.get(
      `SELECT spot_price FROM option_chain_history WHERE symbol = ? ORDER BY timestamp DESC LIMIT 1`,
      [sym],
      (err, row) => {
        if (!err && row && row.spot_price) {
          latestSpotPrices[sym] = row.spot_price;
          console.log(`Initialized spot price for ${sym}: ${row.spot_price}`);
        }
      }
    );
  }
};
initializeSpotPrices();

// Helper to get the last saved option chain for a symbol (and expiry if provided) from database
const getLastSavedOptionChain = (symbol, expiryToUse) => {
  return new Promise((resolve) => {
    let query = `SELECT * FROM option_chain_history WHERE symbol = ?`;
    const params = [symbol];
    if (expiryToUse) {
      query += ` AND expiry = ?`;
      params.push(expiryToUse);
    }
    query += ` ORDER BY timestamp DESC LIMIT 1`;
    
    db.get(query, params, (err, row) => {
      if (err || !row) {
        resolve(null);
      } else {
        resolve(row);
      }
    });
  });
};

// Helper to get unique expiries saved in database
const getSavedExpiries = (symbol) => {
  return new Promise((resolve) => {
    db.all(
      `SELECT DISTINCT expiry FROM option_chain_history WHERE symbol = ? ORDER BY expiry ASC`,
      [symbol],
      (err, rows) => {
        if (err || !rows) {
          resolve([]);
        } else {
          resolve(rows.map(r => r.expiry));
        }
      }
    );
  });
};

// Helper to check for duplicate and save option chain (at most one per symbol per minute)
const checkAndSaveOptionChain = (symbol, spotPrice, expiry, strikesArray) => {
  return new Promise((resolve) => {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const ist = new Date(utc + (3600000 * 5.5));
    const currentMinuteStr = ist.toISOString().slice(0, 16).replace('T', ' '); // YYYY-MM-DD HH:MM
    
    db.get(
      `SELECT id FROM option_chain_history 
       WHERE symbol = ? 
         AND strftime('%Y-%m-%d %H:%M', datetime(timestamp, '+5.5 hours')) = ?`,
      [symbol, currentMinuteStr],
      (err, row) => {
        if (err) {
          console.error(`Error querying duplicates for ${symbol}:`, err.message);
          resolve();
          return;
        }
        
        if (!row) {
          db.run(
            `INSERT INTO option_chain_history (symbol, spot_price, expiry, data) VALUES (?, ?, ?, ?)`,
            [symbol, spotPrice, expiry, JSON.stringify(strikesArray)],
            function(insertErr) {
              if (insertErr) {
                console.error(`Error background-saving option chain for ${symbol}:`, insertErr.message);
              }
              resolve();
            }
          );
        } else {
          // Already exists for this minute, skip to prevent duplicates
          resolve();
        }
      }
    );
  });
};

// Endpoint to get Option Chain
app.get('/api/option-chain', async (req, res) => {
  const symbol = req.query.symbol || 'NIFTY';
  const expiryToUse = req.query.expiry;
  const cacheKey = `${symbol}_${expiryToUse || 'first'}`;

  // If market is closed, check cache first with a longer duration (1 hour)
  const duration = isIndianMarketOpen() ? 300000 : 3600000; // 5 mins during live, 1 hour closed
  const cached = getCachedData('optionChain', cacheKey, duration);
  if (cached) {
    return res.json(cached);
  }

  // If market is closed, try to serve from database snapshot first
  if (!isIndianMarketOpen()) {
    try {
      const row = await getLastSavedOptionChain(symbol, expiryToUse);
      if (row) {
        const dbExpiries = await getSavedExpiries(symbol);
        const strikesArray = JSON.parse(row.data);
        const result = {
          success: true,
          spotPrice: row.spot_price,
          expiry: row.expiry,
          expiryList: dbExpiries.length > 0 ? dbExpiries : [row.expiry],
          data: strikesArray,
          atr: latestAtrValues[symbol] || (symbol === 'NIFTY' ? 15 : symbol === 'BANKNIFTY' ? 40 : symbol === 'FINNIFTY' ? 18 : 10)
        };
        setCachedData('optionChain', cacheKey, result);
        console.log(`Served ${symbol} option chain from database snapshot (market closed).`);
        return res.json(result);
      }
    } catch (dbErr) {
      console.error('Error fetching option chain from DB:', dbErr.message);
    }
  }

  try {
    const token = dhanAccessToken;
    const clientId = process.env.DHAN_CLIENT_ID;

    if (!token || !clientId) {
      return res.status(400).json({ success: false, message: 'Dhan credentials missing. Please set them or wait for auto-refresh.' });
    }

    const scripId = scripMap[symbol];
    if (!scripId) {
      return res.status(400).json({ success: false, message: 'Invalid symbol requested' });
    }

    // 1. Get Expiry List for requested symbol
    const expiryResponse = await queuedDhanRequest({
      method: 'post',
      url: 'https://api.dhan.co/v2/optionchain/expirylist',
      data: {
        UnderlyingScrip: scripId,
        UnderlyingSeg: 'IDX_I'
      },
      headers: getDhanHeaders()
    });

    if (expiryResponse.data.status !== 'success' || !expiryResponse.data.data.length) {
      return res.status(400).json({ success: false, message: `Failed to fetch expiry list for ${symbol}` });
    }

    const expiryList = expiryResponse.data.data;
    const finalExpiry = expiryToUse || expiryList[0];

    // 2. Get Option Chain for that expiry
    const ocResponse = await queuedDhanRequest({
      method: 'post',
      url: 'https://api.dhan.co/v2/optionchain',
      data: {
        UnderlyingScrip: scripId,
        UnderlyingSeg: 'IDX_I',
        Expiry: finalExpiry
      },
      headers: getDhanHeaders()
    });

    if (ocResponse.data.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Failed to fetch option chain' });
    }

    const rawData = ocResponse.data.data;
    const ocData = rawData.oc;
    const spotPrice = rawData.last_price;

    if (latestSpotPrices.hasOwnProperty(symbol)) {
      latestSpotPrices[symbol] = spotPrice;
    }

    const strikesArray = Object.keys(ocData).map(strikeStr => {
      const strike = parseFloat(strikeStr);
      const data = ocData[strikeStr];
      return {
        strike,
        callOi: data.ce?.oi || 0,
        callChgOi: data.ce?.oi - data.ce?.previous_oi || 0, 
        callLtp: data.ce?.last_price || 0,
        callVolume: data.ce?.volume || 0,
        callIv: data.ce?.implied_volatility || data.ce?.iv || 0,
        putVolume: data.pe?.volume || 0,
        putLtp: data.pe?.last_price || 0,
        putChgOi: data.pe?.oi - data.pe?.previous_oi || 0,
        putOi: data.pe?.oi || 0,
        putIv: data.pe?.implied_volatility || data.pe?.iv || 0,
        updateStatus: null
      };
    }).sort((a, b) => a.strike - b.strike);

    // Save to Database for history and generate signals only during market hours (using duplicate check)
    if (isIndianMarketOpen()) {
      await checkAndSaveOptionChain(symbol, spotPrice, finalExpiry, strikesArray);

      // Auto-calculate and save signals to ai_signals
      let totalCallOi = 0;
      let totalPutOi = 0;
      let maxCallOi = 0;
      let maxPutOi = 0;
      let supportStrike = 0;
      let resistanceStrike = 0;

      strikesArray.forEach(strike => {
        totalCallOi += strike.callOi;
        totalPutOi += strike.putOi;

        if (strike.callOi > maxCallOi) {
          maxCallOi = strike.callOi;
          resistanceStrike = strike.strike;
        }

        if (strike.putOi > maxPutOi) {
          maxPutOi = strike.putOi;
          supportStrike = strike.strike;
        }
      });

      const pcr = totalCallOi > 0 ? (totalPutOi / totalCallOi).toFixed(2) : 0;
      
      let type = null;

      if (pcr > 1.2 && spotPrice > supportStrike) {
        type = 'CALL';
      } else if (pcr < 0.8 && spotPrice < resistanceStrike) {
        type = 'PUT';
      }

      if (type) {
        const lastAtr = latestAtrValues[symbol] || (symbol === 'NIFTY' ? 15 : symbol === 'BANKNIFTY' ? 40 : symbol === 'FINNIFTY' ? 18 : 10);
        const dynamicSlAmt = 1.0 * lastAtr;
        const dynamicTgtAmt = 2.0 * lastAtr;
        const target_price = type === 'CALL' ? spotPrice + dynamicTgtAmt : spotPrice - dynamicTgtAmt;
        const stoploss_price = type === 'CALL' ? spotPrice - dynamicSlAmt : spotPrice + dynamicSlAmt;

        db.get(`SELECT id FROM ai_signals WHERE symbol = ? AND source = 'OPTION_CHAIN' AND status = 'PENDING'`, [symbol], (err, row) => {
          if (!err && !row) {
            db.run(
              `INSERT INTO ai_signals (symbol, type, entry_price, target_price, stoploss_price, source) VALUES (?, ?, ?, ?, ?, 'OPTION_CHAIN')`,
              [symbol, type, spotPrice, parseFloat(target_price.toFixed(2)), parseFloat(stoploss_price.toFixed(2))],
              function(err) {
                if (err) console.error('Error auto-saving Option Chain signal:', err.message);
              }
            );
          }
        });
      }
    }

    const result = { 
      success: true, 
      spotPrice,
      expiry: finalExpiry,
      expiryList,
      data: strikesArray,
      atr: latestAtrValues[symbol] || (symbol === 'NIFTY' ? 15 : symbol === 'BANKNIFTY' ? 40 : symbol === 'FINNIFTY' ? 18 : 10)
    };

    setCachedData('optionChain', cacheKey, result);
    res.json(result);

  } catch (error) {
    console.error('Dhan API Error:', error.message);
    res.status(error.response?.status || 500).json({ 
      success: false, 
      message: error.message,
      details: error.response?.data
    });
  }
});

// Endpoint to get historical data
app.get('/api/option-chain/history', (req, res) => {
  const symbol = req.query.symbol || 'NIFTY';
  const date = req.query.date; // Format: YYYY-MM-DD

  if (!date) {
    return res.status(400).json({ success: false, message: 'Date is required (YYYY-MM-DD)' });
  }

  db.all(
    `SELECT * FROM option_chain_history 
     WHERE symbol = ? 
       AND strftime('%Y-%m-%d', datetime(timestamp, '+5.5 hours')) = ? 
     ORDER BY timestamp DESC`,
    [symbol, date],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
      
      // Parse the JSON data in each row
      const parsedRows = rows.map(row => ({
        ...row,
        // Convert timestamp to local IST date string for the frontend
        timestamp: new Date(new Date(row.timestamp + 'Z').getTime()).toISOString(),
        data: JSON.parse(row.data)
      }));

      res.json({ success: true, data: parsedRows });
    }
  );
});

// Endpoint to get Intraday Chart Data
app.get('/api/charts/intraday', async (req, res) => {
  const symbol = req.query.symbol || 'NIFTY';
  const interval = req.query.interval || '5'; // default 5 mins
  const cacheKey = `${symbol}_${interval}`;

  // If market is closed, cache for 1 hour
  const duration = isIndianMarketOpen() ? 300000 : 3600000; // 5 mins during live, 1 hour closed
  const cached = getCachedData('chartsIntraday', cacheKey, duration);
  if (cached) {
    return res.json(cached);
  }

  try {
    const token = dhanAccessToken;
    const clientId = process.env.DHAN_CLIENT_ID;
    
    // Dhan API limits intraday to recent days
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 1); // add 1 day to include today safely
    
    const fromDate = new Date();
    if (interval === '1') {
      // For 1-minute data, request only 1 day to reduce data volume and avoid 400 errors
      fromDate.setDate(fromDate.getDate() - 1);
    } else {
      fromDate.setDate(fromDate.getDate() - 5); 
    }

    const formatDate = (d) => d.toISOString().split('T')[0];

    if (!token || !clientId) {
      return res.status(400).json({ success: false, message: 'Dhan credentials missing.' });
    }

    const scripId = scripMap[symbol];
    if (!scripId) {
      return res.status(400).json({ success: false, message: 'Invalid symbol requested' });
    }

    const payload = {
      securityId: scripId.toString(),
      exchangeSegment: 'IDX_I',
      instrument: 'INDEX',
      interval: interval.toString(),
      fromDate: formatDate(fromDate),
      toDate: formatDate(toDate)
    };

    const response = await queuedDhanRequest({
      method: 'post',
      url: 'https://api.dhan.co/v2/charts/intraday',
      data: payload,
      headers: getDhanHeaders()
    });

    if (response.data.status === 'success' || response.data.open) {
       const data = response.data.data || response.data;
       const chartData = [];
       if (data.timestamp && data.timestamp.length > 0) {
         for (let i = 0; i < data.timestamp.length; i++) {
            const ts = data.timestamp[i];
            
            const timeUnix = parseDhanTimestamp(ts);
            chartData.push({
               time: timeUnix,
               open: data.open[i],
               high: data.high[i],
               low: data.low[i],
               close: data.close[i]
            });
         }
       }
       const result = { success: true, data: chartData };
       setCachedData('chartsIntraday', cacheKey, result);
       return res.json(result);
    } else {
      return res.status(400).json({ success: false, message: 'Failed to fetch chart data' });
    }
  } catch (error) {
    console.error('Chart API Error:', error.message);
    res.status(error.response?.status || 500).json({ 
      success: false, 
      message: error.message,
      details: error.response?.data
    });
  }
});

// Endpoint to get Historical Daily Chart Data
app.get('/api/charts/historical', async (req, res) => {
  const symbol = req.query.symbol || 'NIFTY';
  const cacheKey = symbol;

  const cached = getCachedData('chartsHistorical', cacheKey, HISTORICAL_CACHE_DURATION_MS);
  if (cached) {
    return res.json(cached);
  }

  try {
    const token = dhanAccessToken;
    const clientId = process.env.DHAN_CLIENT_ID;
    
    // Fetch for the last 2 years for good daily/monthly view
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 1);
    const fromDate = new Date();
    fromDate.setFullYear(fromDate.getFullYear() - 2); 

    const formatDate = (d) => d.toISOString().split('T')[0];

    if (!token || !clientId) {
      return res.status(400).json({ success: false, message: 'Dhan credentials missing.' });
    }

    const scripId = scripMap[symbol];
    if (!scripId) {
      return res.status(400).json({ success: false, message: 'Invalid symbol requested' });
    }

    const payload = {
      securityId: scripId.toString(),
      exchangeSegment: 'IDX_I',
      instrument: 'INDEX',
      fromDate: formatDate(fromDate),
      toDate: formatDate(toDate)
    };

    // Dhan uses /v2/charts/historical for daily data
    const response = await queuedDhanRequest({
      method: 'post',
      url: 'https://api.dhan.co/v2/charts/historical',
      data: payload,
      headers: getDhanHeaders()
    });

    if (response.data.status === 'success' || response.data.open) {
       const data = response.data.data || response.data;
       const chartData = [];
       if (data.timestamp && data.timestamp.length > 0) {
         for (let i = 0; i < data.timestamp.length; i++) {
            const ts = data.timestamp[i];
            const timeUnix = parseDhanTimestamp(ts);
            
            chartData.push({
               time: timeUnix,
               open: data.open[i],
               high: data.high[i],
               low: data.low[i],
               close: data.close[i]
            });
         }
       }
       const result = { success: true, data: chartData };
       setCachedData('chartsHistorical', cacheKey, result);
       return res.json(result);
     } else {
       return res.status(400).json({ success: false, message: 'Failed to fetch historical chart data' });
      }
    } catch (error) {
      console.error('Historical Chart API Error:', error.message);
      return res.status(error.response?.status || 500).json({ 
        success: false, 
        message: error.message,
        details: error.response?.data
      });
    }
  });

// Endpoint for AI Analysis
app.post('/api/ai-analysis', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ success: false, message: 'Gemini API Key missing in settings.' });
    }

    const symbol = req.body.symbol || 'NIFTY';
    const scripId = scripMap[symbol];
    
    // 1. Fetch Option Chain Data
    let spotPrice;
    let strikesArray = [];
    let finalExpiry = req.body.expiry;
    let ocData = null;

    // Check cache or DB first (especially when market is closed)
    const cacheKey = `${symbol}_${finalExpiry || 'first'}`;
    const cachedOc = getCachedData('optionChain', cacheKey, isIndianMarketOpen() ? 300000 : 3600000);
    
    if (cachedOc) {
      spotPrice = cachedOc.spotPrice;
      strikesArray = cachedOc.data;
      finalExpiry = cachedOc.expiry;
    } else if (!isIndianMarketOpen()) {
      try {
        const row = await getLastSavedOptionChain(symbol, finalExpiry);
        if (row) {
          spotPrice = row.spot_price;
          strikesArray = JSON.parse(row.data);
          finalExpiry = row.expiry;
        }
      } catch (dbErr) {
        console.error('Error fetching option chain for AI analysis:', dbErr.message);
      }
    }

    // Fallback to Dhan API if option chain not available
    if (!spotPrice || strikesArray.length === 0) {
      const expiryResponse = await queuedDhanRequest({
        method: 'post',
        url: 'https://api.dhan.co/v2/optionchain/expirylist',
        data: {
          UnderlyingScrip: scripId,
          UnderlyingSeg: 'IDX_I'
        },
        headers: getDhanHeaders()
      });

      if (expiryResponse.data.status !== 'success' || !expiryResponse.data.data.length) {
        return res.status(400).json({ success: false, message: `Failed to fetch expiry list for ${symbol}` });
      }

      const expiryList = expiryResponse.data.data;
      finalExpiry = finalExpiry || expiryList[0];

      const ocResponse = await queuedDhanRequest({
        method: 'post',
        url: 'https://api.dhan.co/v2/optionchain',
        data: {
          UnderlyingScrip: scripId,
          UnderlyingSeg: 'IDX_I',
          Expiry: finalExpiry
        },
        headers: getDhanHeaders()
      });

      if (ocResponse.data.status !== 'success') {
        return res.status(400).json({ success: false, message: 'Failed to fetch option chain' });
      }

      ocData = ocResponse.data.data;
      spotPrice = ocData.last_price;
      
      const rawOc = ocData.oc;
      strikesArray = Object.keys(rawOc).map(strikeStr => {
        const strike = parseFloat(strikeStr);
        const data = rawOc[strikeStr];
        return {
          strike,
          callOi: data.ce?.oi || 0,
          callChgOi: (data.ce?.oi || 0) - (data.ce?.previous_oi || 0), 
          callLtp: data.ce?.last_price || 0,
          callVolume: data.ce?.volume || 0,
          callIv: data.ce?.implied_volatility || data.ce?.iv || 0,
          putVolume: data.pe?.volume || 0,
          putLtp: data.pe?.last_price || 0,
          putChgOi: (data.pe?.oi || 0) - (data.pe?.previous_oi || 0),
          putOi: data.pe?.oi || 0,
          putIv: data.pe?.implied_volatility || data.pe?.iv || 0
        };
      }).sort((a, b) => a.strike - b.strike);
    }

    // 2. Fetch Chart Data (Last 30 candles of 5 min)
    let chartCandles = [];
    const cachedChart = getCachedData('chartsIntraday', `${symbol}_5`, isIndianMarketOpen() ? 300000 : 3600000);
    
    if (cachedChart && cachedChart.success && cachedChart.data) {
      chartCandles = cachedChart.data;
    } else {
      const toDate = new Date();
      toDate.setDate(toDate.getDate() + 1);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 2);

      const formatDate = (d) => d.toISOString().split('T')[0];
      
      const chartResponse = await queuedDhanRequest({
        method: 'post',
        url: 'https://api.dhan.co/v2/charts/intraday',
        data: {
          securityId: scripId.toString(),
          exchangeSegment: 'IDX_I',
          instrument: 'INDEX',
          interval: '5',
          fromDate: formatDate(fromDate),
          toDate: formatDate(toDate)
        },
        headers: getDhanHeaders()
      });

      const chartData = chartResponse.data.data || chartResponse.data;
      if (chartData.timestamp) {
        for (let i = 0; i < chartData.timestamp.length; i++) {
          chartCandles.push({
            time: chartData.timestamp[i],
            open: chartData.open[i],
            high: chartData.high[i],
            low: chartData.low[i],
            close: chartData.close[i]
          });
        }
      }
    }

    // Calculate PCR
    let totalCallOi = 0;
    let totalPutOi = 0;
    strikesArray.forEach(strike => {
      totalCallOi += strike.callOi || 0;
      totalPutOi += strike.putOi || 0;
    });
    const pcr = totalCallOi > 0 ? (totalPutOi / totalCallOi).toFixed(2) : 0;

    // Get last 30 candles
    const lastCandles = [];
    const len = chartCandles.length;
    const startIdx = Math.max(0, len - 30);
    for (let i = startIdx; i < len; i++) {
      const candle = chartCandles[i];
      let formattedTime = '';
      if (typeof candle.time === 'string') {
        formattedTime = candle.time;
      } else {
        formattedTime = new Date(parseDhanTimestamp(candle.time) * 1000).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
      }
      lastCandles.push({
        time: formattedTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close
      });
    }

    const prompt = `You are an expert stock market technical analyst. 
Analyze the following data for ${symbol} and provide a trading suggestion for a beginner trader.

Current Spot Price: ${spotPrice}
Put Call Ratio (PCR): ${pcr}

Last 30 Candles (5-minute interval):
${JSON.stringify(lastCandles, null, 2)}

Please provide:
1. Market Sentiment (Bullish/Bearish/Sideways) and why.
2. Key Support and Resistance levels based on the data.
3. Actionable advice: Should the user buy Call, Buy Put, or Wait? Give a reason.

IMPORTANT INSTRUCTIONS for the tone and format:
- Write the response in friendly Hinglish (Hindi + English mix, written in English script like 'Market abhi sideways chal raha hai').
- Do NOT use Hindi script (like नमस्ते or बाज़ार).
- Do NOT use markdown formatting like ###, **, or *. Just use simple plain text with line breaks for spacing.
- Explain it in a simple way, like an expert friend giving advice.`;

    // Call Gemini API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const parts = [{ text: prompt }];
    
    // Add image if provided
    if (req.body.image) {
      // Remove data:image/png;base64, prefix if present
      const base64Data = req.body.image.includes(',') ? req.body.image.split(',')[1] : req.body.image;
      parts.push({
        inlineData: {
          mimeType: "image/png",
          data: base64Data
        }
      });
    }

    const geminiResponse = await axios.post(geminiUrl, {
      contents: [{
        parts: parts
      }]
    });

    const aiResponse = geminiResponse.data.candidates[0].content.parts[0].text;

    res.json({ success: true, analysis: aiResponse });

  } catch (error) {
    console.error('AI Analysis Error:', error.message);
    if (error.response) {
      console.error('Gemini API Error Details:', error.response.data);
    }
    res.status(500).json({ 
      success: false, 
      message: error.message,
      details: error.response?.data
    });
  }
});

// Helper for calculating EMA
const calculateEMA = (data, period) => {
  if (data.length < period) return 0;
  const k = 2 / (period + 1);
  let ema = data[0].close;
  for (let i = 1; i < data.length; i++) {
    ema = (data[i].close * k) + (ema * (1 - k));
  }
  return parseFloat(ema.toFixed(2));
};

// Helper for calculating RSI
const calculateRSI = (data, period = 14) => {
  if (data.length <= period) return 50;
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff > 0) {
      gains += diff;
    } else {
      losses -= diff;
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff > 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  return parseFloat(rsi.toFixed(2));
};

// Helper for calculating ATR
const calculateATR = (data, period = 14) => {
  if (data.length <= period) return 0;
  let trs = [];
  for (let i = 1; i < data.length; i++) {
    const h_l = data[i].high - data[i].low;
    const h_pc = Math.abs(data[i].high - data[i - 1].close);
    const l_pc = Math.abs(data[i].low - data[i - 1].close);
    trs.push(Math.max(h_l, h_pc, l_pc));
  }
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = ((atr * (period - 1)) + trs[i]) / period;
  }
  return parseFloat(atr.toFixed(2));
};

// Scrapes Google News RSS for Indian Stock Market headlines (free, native, zero external dependencies)
async function fetchRecentFinancialNews() {
  try {
    const url = 'https://news.google.com/rss/search?q=Nifty+OR+Sensex+OR+RBI+OR+market+when:1d&hl=en-IN&gl=IN&ceid=IN:en';
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const xml = response.data || '';
    const items = xml.split('<item>');
    const headlines = [];

    // Extract top 8 headlines
    for (let i = 1; i < items.length && headlines.length < 8; i++) {
      const item = items[i];
      const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
      const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

      if (titleMatch) {
        let title = titleMatch[1].trim();
        title = title.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/g, '$1').trim();
        
        // Clean title (remove publication name at the end)
        const lastHyphenIndex = title.lastIndexOf(' - ');
        if (lastHyphenIndex !== -1) {
          title = title.substring(0, lastHyphenIndex).trim();
        }

        const link = linkMatch ? linkMatch[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/g, '$1').trim() : '';
        const pubDate = dateMatch ? dateMatch[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/g, '$1').trim() : '';

        headlines.push({ title, link, pubDate });
      }
    }
    return headlines;
  } catch (error) {
    console.error('Error fetching financial news RSS:', error.message);
    return [];
  }
}

// Helper function for OpenClaw AI Multi-Agent Analysis
// Helper function for OpenClaw AI Multi-Agent Analysis
async function executeOpenClawAnalysis(symbol, expiry = null, weights = { pcrWeight: 40, chartWeight: 40, newsWeight: 20 }, profile = 'intraday_scalper') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API Key missing in settings.');
  }

  const symbolStr = symbol || 'NIFTY';
  const scripId = scripMap[symbolStr];
  if (!scripId) {
    throw new Error('Invalid symbol requested');
  }

  // Define profile settings
  let primaryInterval = '5';
  let groupingFactor = 3; // 5m -> 15m (3 candles)
  let trendTimeframe = '15m';

  if (profile === 'micro_scalper') {
    primaryInterval = '1';
    groupingFactor = 5; // 1m -> 5m
    trendTimeframe = '5m';
  } else if (profile === 'intraday_scalper') {
    primaryInterval = '3';
    groupingFactor = 5; // 3m -> 15m
    trendTimeframe = '15m';
  } else { // short_term_trend
    primaryInterval = '5';
    groupingFactor = 3; // 5m -> 15m
    trendTimeframe = '15m';
  }

  // 1. Fetch Option Chain Data
  let spotPrice = 0;
  let strikesArray = [];
  let finalExpiry = expiry;

  const cacheKey = `${symbolStr}_${finalExpiry || 'first'}`;
  const cachedOc = getCachedData('optionChain', cacheKey, isIndianMarketOpen() ? 300000 : 3600000);
  
  if (cachedOc) {
    spotPrice = cachedOc.spotPrice;
    strikesArray = cachedOc.data;
    finalExpiry = cachedOc.expiry;
  } else if (!isIndianMarketOpen()) {
    try {
      const row = await getLastSavedOptionChain(symbolStr, finalExpiry);
      if (row) {
        spotPrice = row.spot_price;
        strikesArray = JSON.parse(row.data);
        finalExpiry = row.expiry;
      }
    } catch (dbErr) {
      console.error('Error fetching option chain for OpenClaw analysis from DB:', dbErr.message);
    }
  }

  // Fallback to Dhan API if cache/DB empty
  if (!spotPrice || strikesArray.length === 0) {
    const expiryResponse = await queuedDhanRequest({
      method: 'post',
      url: 'https://api.dhan.co/v2/optionchain/expirylist',
      data: { UnderlyingScrip: scripId, UnderlyingSeg: 'IDX_I' },
      headers: getDhanHeaders()
    });

    if (expiryResponse.data.status === 'success' && expiryResponse.data.data.length > 0) {
      const expiryList = expiryResponse.data.data;
      finalExpiry = finalExpiry || expiryList[0];

      const ocResponse = await queuedDhanRequest({
        method: 'post',
        url: 'https://api.dhan.co/v2/optionchain',
        data: { UnderlyingScrip: scripId, UnderlyingSeg: 'IDX_I', Expiry: finalExpiry },
        headers: getDhanHeaders()
      });

      if (ocResponse.data.status === 'success') {
        const rawData = ocResponse.data.data;
        spotPrice = rawData.last_price;
        const rawOc = rawData.oc;
        strikesArray = Object.keys(rawOc).map(strikeStr => {
          const strike = parseFloat(strikeStr);
          const data = rawOc[strikeStr];
          return {
            strike,
            callOi: data.ce?.oi || 0,
            callChgOi: (data.ce?.oi || 0) - (data.ce?.previous_oi || 0),
            callLtp: data.ce?.last_price || 0,
            callVolume: data.ce?.volume || 0,
            callIv: data.ce?.implied_volatility || data.ce?.iv || 0,
            putVolume: data.pe?.volume || 0,
            putLtp: data.pe?.last_price || 0,
            putChgOi: (data.pe?.oi || 0) - (data.pe?.previous_oi || 0),
            putOi: data.pe?.oi || 0,
            putIv: data.pe?.implied_volatility || data.pe?.iv || 0
          };
        }).sort((a, b) => a.strike - b.strike);
      }
    }
  }

  if (!spotPrice || strikesArray.length === 0) {
    throw new Error('Option chain data currently unavailable.');
  }

  // 2. Fetch Chart Data (Dynamic Primary Timeframe)
  let chartCandles = [];
  const cachedChart = getCachedData('chartsIntraday', `${symbolStr}_${primaryInterval}`, isIndianMarketOpen() ? 300000 : 3600000);
  
  if (cachedChart && cachedChart.success && cachedChart.data) {
    chartCandles = cachedChart.data;
  } else {
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 1);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 3); // 3 days for enough data to compute 14-period indicators
    const formatDate = (d) => d.toISOString().split('T')[0];

    try {
      const chartResponse = await queuedDhanRequest({
        method: 'post',
        url: 'https://api.dhan.co/v2/charts/intraday',
        data: {
          securityId: scripId.toString(),
          exchangeSegment: 'IDX_I',
          instrument: 'INDEX',
          interval: primaryInterval,
          fromDate: formatDate(fromDate),
          toDate: formatDate(toDate)
        },
        headers: getDhanHeaders()
      });

      const chartData = chartResponse.data.data || chartResponse.data;
      if (chartData.timestamp) {
        for (let i = 0; i < chartData.timestamp.length; i++) {
          chartCandles.push({
            time: chartData.timestamp[i],
            open: chartData.open[i],
            high: chartData.high[i],
            low: chartData.low[i],
            close: chartData.close[i]
          });
        }
      }
      setCachedData('chartsIntraday', `${symbolStr}_${primaryInterval}`, { success: true, data: chartCandles });
    } catch (err) {
      console.error(`Error fetching intraday charts (${primaryInterval}m) in OpenClaw:`, err.message);
    }
  }

  // 2b. Fetch 1-Hour Chart Data (for 1H EMA 20 Trend Confirmation)
  let hourCandles = [];
  const cachedHourChart = getCachedData('chartsIntraday', `${symbolStr}_60`, isIndianMarketOpen() ? 300000 : 3600000);
  
  if (cachedHourChart && cachedHourChart.success && cachedHourChart.data) {
    hourCandles = cachedHourChart.data;
  } else {
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 1);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 10); // 10 days to ensure enough candles for 1-Hour EMA 20
    const formatDate = (d) => d.toISOString().split('T')[0];

    try {
      const chartResponse = await queuedDhanRequest({
        method: 'post',
        url: 'https://api.dhan.co/v2/charts/intraday',
        data: {
          securityId: scripId.toString(),
          exchangeSegment: 'IDX_I',
          instrument: 'INDEX',
          interval: '60',
          fromDate: formatDate(fromDate),
          toDate: formatDate(toDate)
        },
        headers: getDhanHeaders()
      });

      const chartData = chartResponse.data.data || chartResponse.data;
      if (chartData.timestamp) {
        for (let i = 0; i < chartData.timestamp.length; i++) {
          hourCandles.push({
            time: chartData.timestamp[i],
            open: chartData.open[i],
            high: chartData.high[i],
            low: chartData.low[i],
            close: chartData.close[i]
          });
        }
      }
      hourCandles = hourCandles.sort((a, b) => a.time - b.time);
      setCachedData('chartsIntraday', `${symbolStr}_60`, { success: true, data: hourCandles });
    } catch (err) {
      console.error(`Error fetching 1-Hour charts for OpenClaw:`, err.message);
    }
  }

  // Sort chart candles by time just in case
  chartCandles = chartCandles.sort((a, b) => a.time - b.time);
  hourCandles = hourCandles.sort((a, b) => a.time - b.time);

  // 3. Calculate Indicators
  const ema9 = calculateEMA(chartCandles, 9);
  const ema21 = calculateEMA(chartCandles, 21);
  const rsi = calculateRSI(chartCandles, 14);
  const atr = calculateATR(chartCandles, 14) || latestAtrValues[symbolStr] || 15;

  const lastClose = chartCandles.length > 0 ? chartCandles[chartCandles.length - 1].close : spotPrice;
  const lastEma9 = ema9.length > 0 ? parseFloat(ema9[ema9.length - 1].toFixed(2)) : lastClose;
  const lastEma21 = ema21.length > 0 ? parseFloat(ema21[ema21.length - 1].toFixed(2)) : lastClose;
  const lastRsi = rsi.length > 0 ? parseFloat(rsi[rsi.length - 1].toFixed(2)) : 50;

  // Calculate 1-Hour EMA 20 Trend Filter
  const hourEma20List = calculateEMA(hourCandles, 20);
  const lastHourClose = hourCandles.length > 0 ? hourCandles[hourCandles.length - 1].close : spotPrice;
  const lastHourEma20 = hourEma20List.length > 0 ? parseFloat(hourEma20List[hourEma20List.length - 1].toFixed(2)) : lastHourClose;
  const hourlyTrend = hourCandles.length > 0 ? (lastHourClose > lastHourEma20 ? 'BULLISH' : 'BEARISH') : 'NEUTRAL';

  // Group into higher timeframe candles for major trend filter
  const groupedCandles = [];
  for (let i = 0; i < chartCandles.length; i += groupingFactor) {
    const chunk = chartCandles.slice(i, i + groupingFactor);
    if (chunk.length === 0) continue;
    const open = chunk[0].open;
    const close = chunk[chunk.length - 1].close;
    const high = Math.max(...chunk.map(c => c.high));
    const low = Math.min(...chunk.map(c => c.low));
    groupedCandles.push({ open, close, high, low });
  }
  const trendEma20List = calculateEMA(groupedCandles, 20);
  const trendEma20 = trendEma20List[groupedCandles.length - 1] || lastClose;
  const majorTrend = lastClose > trendEma20 ? 'BULLISH' : 'BEARISH';

  // Calculate current PCR
  let totalCallOi = 0;
  let totalPutOi = 0;
  strikesArray.forEach(s => {
    totalCallOi += s.callOi || 0;
    totalPutOi += s.putOi || 0;
  });
  const pcr = totalCallOi > 0 ? parseFloat((totalPutOi / totalCallOi).toFixed(2)) : 0;

  // Fetch PCR history from Database
  const getHistoricalPcrs = () => {
    return new Promise((resolve) => {
      db.all(
        `SELECT timestamp, data FROM option_chain_history 
         WHERE symbol = ? 
         ORDER BY timestamp DESC LIMIT 5`,
        [symbolStr],
        (err, rows) => {
          if (err) {
            console.error('Error fetching historical PCRs:', err.message);
            resolve([]);
            return;
          }
          const pcrs = [];
          rows.forEach(r => {
            try {
              const parsed = JSON.parse(r.data);
              let cSum = 0, pSum = 0;
              parsed.forEach(s => { cSum += s.callOi || 0; pSum += s.putOi || 0; });
              if (cSum > 0) pcrs.push(pSum / cSum);
            } catch (e) {}
          });
          resolve(pcrs);
        }
      );
    });
  };

  const historicalPcrs = await getHistoricalPcrs();

  // Find key Option Chain metrics (within 2% range of spotPrice)
  const rangePercent = 0.02;
  const nearbyStrikes = strikesArray.filter(s => Math.abs(s.strike - spotPrice) <= spotPrice * rangePercent);
  
  let resistanceStrike = null;
  let supportStrike = null;
  let heavyCallWriting = null;
  let heavyPutWriting = null;
  let callUnwinding = null;
  let putUnwinding = null;

  if (nearbyStrikes.length > 0) {
    resistanceStrike = [...nearbyStrikes].sort((a, b) => b.callOi - a.callOi)[0];
    supportStrike = [...nearbyStrikes].sort((a, b) => b.putOi - a.putOi)[0];
    heavyCallWriting = [...nearbyStrikes].sort((a, b) => b.callChgOi - a.callChgOi)[0];
    heavyPutWriting = [...nearbyStrikes].sort((a, b) => b.putChgOi - a.putChgOi)[0];
    callUnwinding = [...nearbyStrikes].sort((a, b) => a.callChgOi - b.callChgOi)[0];
    putUnwinding = [...nearbyStrikes].sort((a, b) => a.putChgOi - b.putChgOi)[0];
  }

  // Dynamic Option Strike Selection
  let atmStrike = 0;
  let atmCallLtp = 0;
  let atmPutLtp = 0;
  let itmStrikeCall = 0;
  let itmCallLtp = 0;
  let itmStrikePut = 0;
  let itmPutLtp = 0;
  
  let atmCallName = '';
  let itmCallName = '';
  let atmPutName = '';
  let itmPutName = '';
  let averageIv = 0;
  let atmCallIv = 0;
  let atmPutIv = 0;

  let shortCoveringDetected = false;
  let longUnwindingDetected = false;
  let nearbyStrikesOiData = [];
  let unwindingDetails = {
    callUnwindingStrikes: [],
    putUnwindingStrikes: []
  };

  if (strikesArray.length > 0) {
    const atmObj = strikesArray.reduce((prev, curr) => 
      Math.abs(curr.strike - spotPrice) < Math.abs(prev.strike - spotPrice) ? curr : prev
    );
    atmStrike = atmObj.strike;
    atmCallLtp = atmObj.callLtp;
    atmPutLtp = atmObj.putLtp;
    atmCallIv = atmObj.callIv || 0;
    atmPutIv = atmObj.putIv || 0;
    averageIv = (atmCallIv + atmPutIv) / 2;

    const atmIndex = strikesArray.findIndex(s => s.strike === atmStrike);
    
    // Call ITM strike (1 strike below ATM)
    const itmCallObj = atmIndex > 0 ? strikesArray[atmIndex - 1] : atmObj;
    itmStrikeCall = itmCallObj.strike;
    itmCallLtp = itmCallObj.callLtp;
    
    // Put ITM strike (1 strike above ATM)
    const itmPutObj = atmIndex < strikesArray.length - 1 ? strikesArray[atmIndex + 1] : atmObj;
    itmStrikePut = itmPutObj.strike;
    itmPutLtp = itmPutObj.putLtp;

    const getContractName = (strike, type) => {
      try {
        const date = new Date(finalExpiry);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const day = date.getDate();
        const month = months[date.getMonth()];
        return `${symbolStr} ${day}-${month} ${strike} ${type}`;
      } catch (e) {
        return `${symbolStr} ${finalExpiry} ${strike} ${type}`;
      }
    };

    atmCallName = getContractName(atmStrike, 'CE');
    itmCallName = getContractName(itmStrikeCall, 'CE');
    atmPutName = getContractName(atmStrike, 'PE');
    itmPutName = getContractName(itmStrikePut, 'PE');

    // Calculate Near ATM Unwinding & Multi-Strike OI details (±10 strikes around ATM)
    if (atmIndex !== -1) {
      const startIndex = Math.max(0, atmIndex - 10);
      const endIndex = Math.min(strikesArray.length - 1, atmIndex + 10);
      for (let i = startIndex; i <= endIndex; i++) {
        const strikeData = strikesArray[i];
        
        nearbyStrikesOiData.push({
          strike: strikeData.strike,
          callChgOi: strikeData.callChgOi || 0,
          putChgOi: strikeData.putChgOi || 0,
          callOi: strikeData.callOi || 0,
          putOi: strikeData.putOi || 0
        });

        // Use a closer window (±5 strikes) for the immediate Short Covering/Long Unwinding alerts
        const distFromAtm = Math.abs(i - atmIndex);
        if (distFromAtm <= 5) {
          if (strikeData.callChgOi < 0) {
            shortCoveringDetected = true;
            unwindingDetails.callUnwindingStrikes.push({
              strike: strikeData.strike,
              chgOi: strikeData.callChgOi
            });
          }
          if (strikeData.putChgOi < 0) {
            longUnwindingDetected = true;
            unwindingDetails.putUnwindingStrikes.push({
              strike: strikeData.strike,
              chgOi: strikeData.putChgOi
            });
          }
        }
      }
    }
  }

  const nearbyStrikesPromptDetails = nearbyStrikesOiData.map(s => 
    `  * Strike ${s.strike}: Call ChgOI = ${s.callChgOi}, Put ChgOI = ${s.putChgOi} (Call TotalOI = ${s.callOi}, Put TotalOI = ${s.putOi})`
  ).join('\n');

  // Fetch Live Financial News Headlines
  let headlines = [];
  try {
    headlines = await fetchRecentFinancialNews();
  } catch (err) {
    console.error('Failed to parse financial news headlines for LLM prompt:', err.message);
  }

  // 4. Construct Multi-Agent Prompt
  const prompt = `You are the 'OpenClaw AI Agent Hub Orchestrator'. You manage three sub-agents to analyze the NIFTY/BANKNIFTY market and issue high-accuracy trading alerts:
1. **Option Chain Agent**: Analyzes PCR, PCR change velocity, and Call/Put Open Interest blocks (resistance and support).
2. **Chart Pattern Agent**: Analyzes trend direction (using EMA 9/21 relationship) and momentum (using RSI).
3. **News Sentiment Agent**: Analyzes the recent financial news headlines and scores the market mood as BULLISH, BEARISH, or NEUTRAL.

You must weight their importance according to the weights assigned by the user:
- Option Chain Agent weight: ${weights.pcrWeight}%
- Chart Pattern Agent weight: ${weights.chartWeight}%
- News Sentiment Agent weight: ${weights.newsWeight}%

*CRITICAL RULES FOR NEWS SENTIMENT & SAFEGUARDS:*
- If News Sentiment Agent weight is greater than 0, and you detect a major risk/panic headline (e.g. GDP contraction, war escalation, high interest rate warnings, massive index crashes, inflation surge), you MUST trigger the safety protocol: force "action" to "WAIT" and set "confidence" lower, prioritizing safety over indicators.

*MULTI-TIMEFRAME TREND CONFIRMATION & ALIGNMENT:*
- You are provided with a 1-Hour chart trend confirmation ("hourlyTrend"): "${hourlyTrend}".
- Ideally:
  * For a CALL trade (Bullish setup), the 1-Hour trend should be BULLISH.
  * For a PUT trade (Bearish setup), the 1-Hour trend should be BEARISH.
- If the primary chart indicators suggest a trade but the 1-Hour trend conflicts (e.g., trying to buy Call when 1-Hour trend is BEARISH, or trying to buy Put when 1-Hour trend is BULLISH), you should be highly conservative: either output "WAIT" or significantly reduce the "confidence" score (e.g., below 65%). Explain this alignment decision in your thoughts.

*OPTION TRADING LEVEL SELECTION & HOLDS:*
- If you decide to issue a "CALL" alert:
  * Select either the suggested ATM or ITM CALL Option contract (ATM: "${atmCallName}", ITM: "${itmCallName}"). Set \`"suggestedOptionContract"\` to its contract name and \`"optionPremiumLtp"\` to its LTP.
  * Estimate option target premiums (\`"optionTarget1"\`, \`"optionTarget2"\`) and option stoploss (\`"optionStoploss"\`). Use delta-based scaling: option target/stoploss change should be roughly \`~0.50 * index change\` for ATM and \`~0.60 * index change\` for ITM (e.g., if target1 is index spot + 40 points, option target1 = option LTP + 0.5 * 40 = option LTP + 20).
- If you decide to issue a "PUT" alert, do the same using the Put option contracts (ATM: "${atmPutName}", ITM: "${itmPutName}").
- If you issue "WAIT", set \`"suggestedOptionContract"\`, \`"optionPremiumLtp"\`, \`"optionTarget1"\`, \`"optionTarget2"\`, and \`"optionStoploss"\` to null.
- Set \`"expectedHoldTime"\` to a clear estimated holding duration string (e.g. \`"5 - 15 minutes"\` for micro scalping profiles, \`"15 - 30 minutes"\` for standard scalping, \`"1 - 2 hours"\` for short-term trends). Base this on indicators strength, trend support, and the active profile: "${profile}".

*TRAILING STOPLOSS RULES:*
- You MUST provide explicit rules on when and how to trail the stoploss in the \`"trailingStoploss"\` field (e.g., "Trail stoploss to cost price once Target 1 is hit, then trail by 15 points for every 20 points spot movement", or "Trail by 10 points for every 15 points gain in option premium"). Make the trailing stoploss rules highly practical for active scalping/trading.

Data for ${symbolStr}:
- Current Spot Price: ${spotPrice}
- Current PCR: ${pcr}
- PCR values for last few minutes (newest to oldest): ${historicalPcrs.map(v => v.toFixed(2)).join(', ')}
- Technical indicators (${primaryInterval}m timeframe):
  * EMA 9: ${lastEma9}
  * EMA 21: ${lastEma21}
  * Price vs EMA 9: ${lastClose > lastEma9 ? 'Above EMA 9' : 'Below EMA 9'}
  * EMA Crossover Status: ${lastEma9 > lastEma21 ? 'EMA 9 is above EMA 21 (Bullish Trend)' : 'EMA 9 is below EMA 21 (Bearish Trend)'}
  * RSI (14): ${lastRsi} (${lastRsi > 70 ? 'Overbought' : lastRsi < 30 ? 'Oversold' : 'Neutral'})
  * ATR (14): ${atr.toFixed(2)}
  * Major Trend (${trendTimeframe} timeframe filter): ${majorTrend}
  * 1-Hour Chart Trend filter: ${hourlyTrend} (EMA 20 at ${lastHourEma20}, Price at ${lastHourClose})

- Nearby Strike Option Chain Activity (Spot: ${spotPrice}):
  * Strongest Resistance Strike: ${resistanceStrike ? resistanceStrike.strike : 'N/A'} (Call OI: ${resistanceStrike ? resistanceStrike.callOi : 0})
  * Strongest Support Strike: ${supportStrike ? supportStrike.strike : 'N/A'} (Put OI: ${supportStrike ? supportStrike.putOi : 0})
  * Heavy Call Writing (Bearish pressure): Strike ${heavyCallWriting && heavyCallWriting.callChgOi > 0 ? heavyCallWriting.strike : 'N/A'} (ChgOI: ${heavyCallWriting && heavyCallWriting.callChgOi > 0 ? heavyCallWriting.callChgOi : 0})
  * Heavy Put Writing (Bullish pressure): Strike ${heavyPutWriting && heavyPutWriting.putChgOi > 0 ? heavyPutWriting.strike : 'N/A'} (ChgOI: ${heavyPutWriting && heavyPutWriting.putChgOi > 0 ? heavyPutWriting.putChgOi : 0})
  * Call Unwinding (Short Covering / Bullish): Strike ${callUnwinding && callUnwinding.callChgOi < 0 ? callUnwinding.strike : 'N/A'} (ChgOI: ${callUnwinding && callUnwinding.callChgOi < 0 ? callUnwinding.callChgOi : 0})
  * Put Unwinding (Long Liquidation / Bearish): Strike ${putUnwinding && putUnwinding.putChgOi < 0 ? putUnwinding.strike : 'N/A'} (ChgOI: ${putUnwinding && putUnwinding.putChgOi < 0 ? putUnwinding.putChgOi : 0})
  * Short Covering (Call Unwinding) Active: ${shortCoveringDetected ? 'YES' : 'NO'}
  * Long Unwinding (Put Unwinding) Active: ${longUnwindingDetected ? 'YES' : 'NO'}
  * ATM Implied Volatility: Average ${averageIv ? averageIv.toFixed(1) + '%' : 'N/A'} (Call: ${atmCallIv}%, Put: ${atmPutIv}%)

- Full 20-Strike Change in OI Activity (ATM ±10 strikes):
${nearbyStrikesPromptDetails}

- Recent Financial & Stock Market News Headlines:
${headlines.length > 0 ? headlines.map((h, i) => `  * Headline ${i+1}: "${h.title}"`).join('\n') : '  * No recent headlines available'}

You must return a raw JSON response (without any markdown tags or backticks) in this exact format:
{
  "action": "CALL" | "PUT" | "WAIT",
  "confidence": <integer percentage between 0 and 100>,
  "newsSentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "buyRange": "<suggested buy range, e.g. '22040 - 22065'>",
  "target1": <number>,
  "target2": <number>,
  "stoploss": <number>,
  "suggestedOptionContract": "<Contract Name>" | null,
  "optionPremiumLtp": <number> | null,
  "optionTarget1": <number> | null,
  "optionTarget2": <number> | null,
  "optionStoploss": <number> | null,
  "trailingStoploss": "<trailing stoploss rule, e.g., 'Trail to Cost when Target 1 is hit, then trail by 10 points' or null if WAIT>" | null,
  "expectedHoldTime": "<holding time estimation, e.g., '10 - 15 minutes'>" | null,
  "agentThoughts": {
    "optionChainAgent": "<Hinglish summary of Option Chain, ATM IV, and Short Covering/Long Unwinding details>",
    "chartAgent": "<Hinglish summary of 1H Trend alignment and chart indicators>",
    "newsAgent": "<Hinglish summary of financial headlines sentiment>",
    "riskOrchestrator": "<Hinglish summary of target, stoploss, and trailing stoploss settings>"
  },
  "reasoning": [
    "<Bullet point 1 in Hinglish explaining trade reason>",
    "<Bullet point 2 in Hinglish explaining trade reason>",
    "<Bullet point 3 in Hinglish explaining trade reason>"
  ],
  "summary": "<General Hinglish summary for the user>"
}

INSTRUCTIONS FOR WRITING:
- Write the agent thoughts, reasoning, and summary in friendly Hinglish (using English alphabet, e.g. 'Market strong bullish trend me hai').
- Do NOT use Hindi script (like नमस्ते or बाज़ार).
- Ensure all numbers (target1, target2, stoploss, optionPremiumLtp, optionTarget1, optionTarget2, optionStoploss) are valid numbers.
- Do NOT wrap in backticks or code blocks. Just output the clean JSON object.`;

  // 5. Call Gemini
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const geminiResponse = await axios.post(geminiUrl, {
    contents: [{ parts: [{ text: prompt }] }]
  });

  const rawText = geminiResponse.data.candidates[0].content.parts[0].text;
  
  // Clean response of any markdown formatting
  let cleanText = rawText.trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '').trim();
  }

  let parsedResult;
  try {
    parsedResult = JSON.parse(cleanText);
  } catch (parseErr) {
    console.error('Failed to parse Gemini JSON. Raw text was:', rawText);
    throw new Error('AI response was not in a valid JSON format');
  }

  return {
    data: parsedResult,
    indicators: {
      spotPrice,
      pcr,
      ema9: lastEma9,
      ema21: lastEma21,
      rsi: lastRsi,
      atr,
      resistanceStrike: resistanceStrike ? resistanceStrike.strike : null,
      supportStrike: supportStrike ? supportStrike.strike : null,
      heavyCallWritingStrike: heavyCallWriting && heavyCallWriting.callChgOi > 0 ? heavyCallWriting.strike : null,
      heavyPutWritingStrike: heavyPutWriting && heavyPutWriting.putChgOi > 0 ? heavyPutWriting.strike : null,
      callUnwindingStrike: callUnwinding && callUnwinding.callChgOi < 0 ? callUnwinding.strike : null,
      putUnwindingStrike: putUnwinding && putUnwinding.putChgOi < 0 ? putUnwinding.strike : null,
      tradingProfile: profile,
      trendTimeframe,
      majorTrend,
      hourlyTrend,
      averageIv,
      shortCoveringDetected,
      longUnwindingDetected,
      nearbyStrikesOiData
    }
  };
}

// Endpoint for OpenClaw AI Multi-Agent Analysis
app.post('/api/openclaw/analyze', async (req, res) => {
  try {
    const symbol = req.body.symbol || 'NIFTY';
    const reqWeights = req.body.weights;
    let weightsObj;
    const settings = await getSystemSettings();
    if (reqWeights && reqWeights.pcrWeight !== undefined && reqWeights.chartWeight !== undefined && reqWeights.newsWeight !== undefined) {
      weightsObj = {
        pcrWeight: parseInt(reqWeights.pcrWeight, 10),
        chartWeight: parseInt(reqWeights.chartWeight, 10),
        newsWeight: parseInt(reqWeights.newsWeight, 10)
      };
    } else {
      const pcrWeight = parseInt(settings['pcr_weight'], 10) || 40;
      const chartWeight = parseInt(settings['chart_weight'], 10) || 40;
      const newsWeight = parseInt(settings['news_weight'], 10) || 20;
      weightsObj = { pcrWeight, chartWeight, newsWeight };
    }
    const profileVal = req.body.profile || settings['trading_profile'] || 'intraday_scalper';
    const result = await executeOpenClawAnalysis(symbol, req.body.expiry, weightsObj, profileVal);
    res.json({
      success: true,
      data: result.data,
      indicators: result.indicators
    });
  } catch (error) {
    console.error('OpenClaw Analyze Error:', error.message);
    if (error.response) {
      console.error('OpenClaw error response status:', error.response.status);
      console.error('OpenClaw error response headers:', error.response.headers);
      console.error('OpenClaw error response data:', JSON.stringify(error.response.data));
    } else {
      console.error('OpenClaw error details (no response):', error.stack);
    }
    res.status(500).json({ 
      success: false, 
      message: error.message,
      details: error.response?.data
    });
  }
});

// Endpoint to save a new AI signal
app.post('/api/signals', (req, res) => {
  const { symbol, type, entry_price, target_price, stoploss_price, source } = req.body;
  
  if (!symbol || !type || !entry_price) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const signalSource = source || 'OPTION_CHAIN';

  const query = `INSERT INTO ai_signals (symbol, type, entry_price, target_price, stoploss_price, source) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
  
  db.run(query, [symbol, type, entry_price, target_price, stoploss_price, signalSource], function(err) {
    if (err) {
      console.error('Error saving signal:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
    res.json({ success: true, id: this.lastID });
  });
});

// Endpoint to delete a single signal by ID
app.delete('/api/signals/:id', (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM ai_signals WHERE id = ?`, [id], function(err) {
    if (err) {
      console.error('Error deleting signal:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
    res.json({ success: true, message: 'Signal deleted successfully' });
  });
});

// Endpoint to clear/delete all signals
app.delete('/api/signals', (req, res) => {
  const sourceFilter = req.query.source;
  let query = `DELETE FROM ai_signals`;
  
  if (sourceFilter === 'OPENCLAW') {
    query += ` WHERE source = 'OPENCLAW'`;
  } else if (sourceFilter === 'AI_TESTING') {
    query += ` WHERE source != 'OPENCLAW'`;
  }

  db.run(query, [], function(err) {
    if (err) {
      console.error('Error clearing signals:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
    res.json({ success: true, message: 'All selected signals cleared successfully' });
  });
});

// Function to update PENDING signals in background using latestSpotPrices cache
const updatePendingSignals = () => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM ai_signals WHERE status = 'PENDING'`, [], (err, rows) => {
      if (err) return reject(err);
      
      if (rows.length === 0) return resolve(0);

      let pendingUpdates = rows.length;
      let updatedCount = 0;

      rows.forEach(row => {
        const currentSpot = latestSpotPrices[row.symbol];
        if (!currentSpot || currentSpot <= 0) {
          pendingUpdates--;
          if (pendingUpdates === 0) resolve(updatedCount);
          return;
        }

        let newStatus = 'PENDING';
        if (row.type === 'CALL') {
          if (row.target_price && currentSpot >= row.target_price) newStatus = 'SUCCESS';
          else if (row.stoploss_price && currentSpot <= row.stoploss_price) newStatus = 'FAILED';
        } else if (row.type === 'PUT') {
          if (row.target_price && currentSpot <= row.target_price) newStatus = 'SUCCESS';
          else if (row.stoploss_price && currentSpot >= row.stoploss_price) newStatus = 'FAILED';
        }

        if (newStatus !== 'PENDING') {
          db.run(`UPDATE ai_signals SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newStatus, row.id], function(err) {
            if (!err) updatedCount++;
            pendingUpdates--;
            if (pendingUpdates === 0) resolve(updatedCount);
          });
        } else {
          pendingUpdates--;
          if (pendingUpdates === 0) resolve(updatedCount);
        }
      });
    });
  });
};

// Endpoint to get all signals and update status
app.get('/api/signals', async (req, res) => {
  try {
    if (isIndianMarketOpen()) {
      await updatePendingSignals();
    }

    // Return all signals
    db.all(`SELECT * FROM ai_signals ORDER BY created_at DESC`, [], (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
      res.json({ success: true, data: rows });
    });

  } catch (error) {
    console.error('Error in /api/signals:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Settings Endpoints ───────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const ENV_PATH = path.resolve(__dirname, './.env');

// Helper: read .env file into object
function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) {
    fs.writeFileSync(ENV_PATH, '', 'utf8');
  }
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const env = {};
  raw.split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && key.trim()) env[key.trim()] = rest.join('=').trim();
  });
  return env;
}

// Helper: write object back to .env file
function writeEnvFile(obj) {
  const content = Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

// GET OpenClaw settings from SQLite database
app.get('/api/openclaw/settings', (req, res) => {
  db.all('SELECT key, value FROM system_settings', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    const settings = {
      telegramToken: '',
      telegramChatId: '',
      discordWebhook: '',
      whatsappPhone: '',
      whatsappApiKey: '',
      autoAlertsEnabled: false,
      autoAlertsInterval: 5,
      autoAlertsMinConfidence: 75,
      pcrWeight: 40,
      chartWeight: 40,
      newsWeight: 20,
      tradingProfile: 'intraday_scalper'
    };
    if (rows) {
      rows.forEach(r => {
        if (r.key === 'telegram_token') settings.telegramToken = r.value;
        if (r.key === 'telegram_chat_id') settings.telegramChatId = r.value;
        if (r.key === 'discord_webhook') settings.discordWebhook = r.value;
        if (r.key === 'whatsapp_phone') settings.whatsappPhone = r.value;
        if (r.key === 'whatsapp_apikey') settings.whatsappApiKey = r.value;
        if (r.key === 'auto_alerts_enabled') settings.autoAlertsEnabled = r.value === 'true';
        if (r.key === 'auto_alerts_interval') settings.autoAlertsInterval = parseInt(r.value, 10) || 5;
        if (r.key === 'auto_alerts_min_confidence') settings.autoAlertsMinConfidence = parseInt(r.value, 10) || 75;
        if (r.key === 'pcr_weight') settings.pcrWeight = parseInt(r.value, 10) || 40;
        if (r.key === 'chart_weight') settings.chartWeight = parseInt(r.value, 10) || 40;
        if (r.key === 'news_weight') settings.newsWeight = parseInt(r.value, 10) || 20;
        if (r.key === 'trading_profile') settings.tradingProfile = r.value;
      });
    }
    res.json({ success: true, settings });
  });
});

// POST to update OpenClaw settings in SQLite database
app.post('/api/openclaw/settings', (req, res) => {
  const { 
    telegramToken, 
    telegramChatId, 
    discordWebhook, 
    whatsappPhone, 
    whatsappApiKey,
    autoAlertsEnabled,
    autoAlertsInterval,
    autoAlertsMinConfidence,
    pcrWeight,
    chartWeight,
    newsWeight,
    tradingProfile
  } = req.body;

  const params = [
    { key: 'telegram_token', val: telegramToken || '' },
    { key: 'telegram_chat_id', val: telegramChatId || '' },
    { key: 'discord_webhook', val: discordWebhook || '' },
    { key: 'whatsapp_phone', val: whatsappPhone || '' },
    { key: 'whatsapp_apikey', val: whatsappApiKey || '' },
    { key: 'auto_alerts_enabled', val: autoAlertsEnabled ? 'true' : 'false' },
    { key: 'auto_alerts_interval', val: String(autoAlertsInterval || 5) },
    { key: 'auto_alerts_min_confidence', val: String(autoAlertsMinConfidence || 75) },
    { key: 'pcr_weight', val: String(pcrWeight !== undefined ? pcrWeight : 40) },
    { key: 'chart_weight', val: String(chartWeight !== undefined ? chartWeight : 40) },
    { key: 'news_weight', val: String(newsWeight !== undefined ? newsWeight : 20) },
    { key: 'trading_profile', val: tradingProfile || 'intraday_scalper' }
  ];

  db.serialize(() => {
    let hasError = false;
    const stmt = db.prepare(`INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)`);
    params.forEach(p => {
      stmt.run(p.key, p.val, (err) => {
        if (err) hasError = true;
      });
    });
    stmt.finalize((err) => {
      if (err || hasError) {
        return res.status(500).json({ success: false, message: 'Failed to save settings to database' });
      }
      res.json({ success: true, message: 'Settings updated successfully' });
      // Dynamically restart Telegram Bot Listener with new settings
      startTelegramBotListener();
    });
  });
});

// GET Live Financial News Headlines
app.get('/api/openclaw/news', async (req, res) => {
  try {
    const news = await fetchRecentFinancialNews();
    res.json({ success: true, news });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Background Scanner Orchestration Helper
function getSystemSettings() {
  return new Promise((resolve) => {
    db.all('SELECT key, value FROM system_settings', [], (err, rows) => {
      if (err || !rows) return resolve({});
      const settings = {};
      rows.forEach(r => {
        settings[r.key] = r.value;
      });
      resolve(settings);
    });
  });
}

let lastOpenClawAlertMinute = -1;
const lastAlertSpotPrices = {
  NIFTY: 0,
  BANKNIFTY: 0,
  FINNIFTY: 0,
  MIDCPNIFTY: 0
};

async function triggerOpenClawBackgroundAlerts() {
  try {
    // 1. Check if market is open
    if (!isIndianMarketOpen()) {
      return;
    }

    // 2. Fetch system settings
    const settings = await getSystemSettings();
    const isEnabled = settings['auto_alerts_enabled'] === 'true';
    if (!isEnabled) {
      return;
    }

    const interval = parseInt(settings['auto_alerts_interval'], 10) || 5;
    const minConfidence = parseInt(settings['auto_alerts_min_confidence'], 10) || 75;
    const pcrWeight = parseInt(settings['pcr_weight'], 10) || 40;
    const chartWeight = parseInt(settings['chart_weight'], 10) || 40;
    const newsWeight = parseInt(settings['news_weight'], 10) || 20;
    const weightsObj = { pcrWeight, chartWeight, newsWeight };

    // Get current Kolkata/IST hour and minute using Intl formatter
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
    const parts = formatter.formatToParts(new Date());
    const hourVal = parts.find(p => p.type === 'hour')?.value;
    const minuteVal = parts.find(p => p.type === 'minute')?.value;
    
    if (!hourVal || !minuteVal) return;
    const hour = parseInt(hourVal, 10);
    const minute = parseInt(minuteVal, 10);

    // Run exactly once at the interval boundary
    if (minute % interval !== 0 || minute === lastOpenClawAlertMinute) {
      return;
    }
    
    lastOpenClawAlertMinute = minute;
    console.log(`[OpenClaw Scheduler] Starting auto-scan at ${hour}:${minute} IST (Interval: ${interval}m, Min Confidence: ${minConfidence}%, Weights: PCR=${pcrWeight}%, Chart=${chartWeight}%, News=${newsWeight}%)`);

    const symbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];

    for (const symbol of symbols) {
      try {
        console.log(`[OpenClaw Scheduler] Scanning ${symbol}...`);

        // Check if price has changed to prevent duplicate API hits during holiday/halts
        let currentSpot = 0;
        const cacheKey = `${symbol}_first`;
        const cachedOc = getCachedData('optionChain', cacheKey, 300000);
        if (cachedOc) {
          currentSpot = cachedOc.spotPrice;
        } else {
          const lastSaved = await getLastSavedOptionChain(symbol);
          if (lastSaved) {
            currentSpot = lastSaved.spot_price;
          }
        }

        if (currentSpot > 0 && currentSpot === lastAlertSpotPrices[symbol]) {
          console.log(`[OpenClaw Scheduler] Skipping ${symbol} - Spot price (${currentSpot}) has not changed since last scan (potential holiday or market halt).`);
          continue;
        }

        // Run analysis with weights
        const tradingProfile = settings['trading_profile'] || 'intraday_scalper';
        const result = await executeOpenClawAnalysis(symbol, null, weightsObj, tradingProfile);
        const actionData = result.data;
        const indicators = result.indicators;

        // Update last spot price
        lastAlertSpotPrices[symbol] = indicators.spotPrice;

        console.log(`[OpenClaw Scheduler] ${symbol} Scan Completed: Action=${actionData.action}, Confidence=${actionData.confidence}%`);

        if ((actionData.action === 'CALL' || actionData.action === 'PUT') && actionData.confidence >= minConfidence) {
          console.log(`[OpenClaw Scheduler] Strong signal detected for ${symbol}: ${actionData.action} (${actionData.confidence}%)`);
          await sendOpenClawNotifications(symbol, actionData, settings, indicators);
          saveOpenClawSignalToDb(symbol, actionData, indicators.spotPrice);
        }
      } catch (err) {
        console.error(`[OpenClaw Scheduler] Error scanning ${symbol}:`, err.message);
      }

      // 10-second delay between symbols to avoid concurrent Gemini API rate limits (429)
      await new Promise(r => setTimeout(r, 10000));
    }
  } catch (error) {
    console.error('[OpenClaw Scheduler] Error in background scanner loop:', error.message);
  }
}

async function sendOpenClawNotifications(symbol, actionData, settings, indicators) {
  const spotPrice = indicators.spotPrice || 'N/A';
  const hourlyTrend = indicators.hourlyTrend || 'N/A';
  const averageIv = indicators.averageIv || 0;

  const currentTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(new Date());

  let optionDetails = '';
  if (actionData.suggestedOptionContract) {
    optionDetails = `*Option Contract*: ${actionData.suggestedOptionContract}\n` +
      `*Premium Entry*: ₹${actionData.optionPremiumLtp}\n` +
      `*Premium Target 1*: ₹${actionData.optionTarget1}\n` +
      `*Premium Target 2*: ₹${actionData.optionTarget2}\n` +
      `*Premium Stoploss*: ₹${actionData.optionStoploss}\n` +
      `*Expected Hold*: ⏳ ${actionData.expectedHoldTime}\n` +
      `*Trailing SL*: 📈 ${actionData.trailingStoploss || 'N/A'}\n\n`;
  }

  const messageContent = `🚨 *OpenClaw AI Trade Alert* 🚨\n\n` +
    `*Symbol*: ${symbol}\n` +
    `*Action*: ${actionData.action === 'CALL' ? 'BUY CALL / BULLISH' : 'BUY PUT / BEARISH'}\n` +
    `*Spot Price*: ${spotPrice}\n` +
    `*Confidence*: ${actionData.confidence}%\n` +
    `*1H Trend*: ${hourlyTrend}\n` +
    `*ATM IV*: ${averageIv ? averageIv.toFixed(1) + '%' : 'N/A'}\n` +
    `*Buy Range*: ${actionData.buyRange}\n` +
    `*Target 1*: ${actionData.target1}\n` +
    `*Target 2*: ${actionData.target2}\n` +
    `*Stoploss*: ${actionData.stoploss}\n` +
    `*Time (IST)*: ${currentTime}\n\n` +
    optionDetails +
    `*AI Summary*: ${actionData.summary}\n\n` +
    `🤖 Powered by OpenClaw AI Multi-Agent Engine.`;

  // Telegram
  const tgToken = settings['telegram_token'];
  const tgChatId = settings['telegram_chat_id'];
  if (tgToken && tgChatId) {
    try {
      const url = `https://api.telegram.org/bot${tgToken}/sendMessage`;
      await axios.post(url, {
        chat_id: tgChatId,
        text: messageContent,
        parse_mode: 'Markdown'
      });
      console.log(`[Background Alert] Telegram alert dispatched for ${symbol}`);
    } catch (e) {
      console.error(`[Background Alert] Telegram dispatch error for ${symbol}:`, e.message);
    }
  }

  // Discord
  const discordWebhook = settings['discord_webhook'];
  if (discordWebhook) {
    try {
      await axios.post(discordWebhook, {
        content: messageContent.replace(/\*/g, '**')
      });
      console.log(`[Background Alert] Discord alert dispatched for ${symbol}`);
    } catch (e) {
      console.error(`[Background Alert] Discord dispatch error for ${symbol}:`, e.message);
    }
  }

  // WhatsApp
  const waPhone = settings['whatsapp_phone'];
  const waApiKey = settings['whatsapp_apikey'];
  if (waPhone && waApiKey) {
    try {
      const cleanPhone = waPhone.replace(/[^0-9]/g, '');
      const waText = encodeURIComponent(messageContent.replace(/\*/g, ''));
      const waUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${waText}&apikey=${waApiKey}`;
      await axios.get(waUrl);
      console.log(`[Background Alert] WhatsApp alert dispatched for ${symbol}`);
    } catch (e) {
      console.error(`[Background Alert] WhatsApp dispatch error for ${symbol}:`, e.message);
    }
  }
}

function saveOpenClawSignalToDb(symbol, actionData, spotPrice) {
  const signalType = actionData.action === 'CALL' ? 'CALL' : 'PUT';
  db.run(
    `INSERT INTO ai_signals (symbol, type, entry_price, target_price, stoploss_price, source, status) 
     VALUES (?, ?, ?, ?, ?, 'OPENCLAW', 'PENDING')`,
    [symbol, signalType, spotPrice, actionData.target1, actionData.stoploss],
    (err) => {
      if (err) {
        console.error(`[Background Alert] Error logging signal for ${symbol} to DB:`, err.message);
      } else {
        console.log(`[Background Alert] Saved ${symbol} ${signalType} signal to database for AI Testing backtest tracking.`);
      }
    }
  );
}

// Scan alert interval is triggered inside syncMarketData()
// setInterval(triggerOpenClawBackgroundAlerts, 60000);

// GET current settings (masked)
app.get('/api/settings', (req, res) => {
  try {
    const env = readEnvFile();
    res.json({
      success: true,
      clientId: env.DHAN_CLIENT_ID || '',
      hasPin: !!(env.DHAN_PIN && env.DHAN_PIN !== 'xxxx'),
      hasTotpSecret: !!env.DHAN_TOTP_SECRET,
      hasAccessToken: !!env.DHAN_ACCESS_TOKEN,
      hasGeminiKey: !!env.GEMINI_API_KEY,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST to save credentials and trigger token refresh
app.post('/api/settings', async (req, res) => {
  try {
    const { pin, totpSecret, clientId, geminiApiKey } = req.body;
    const env = readEnvFile();

    if (clientId) env.DHAN_CLIENT_ID = clientId;
    if (pin) env.DHAN_PIN = pin;
    if (totpSecret) env.DHAN_TOTP_SECRET = totpSecret;
    if (geminiApiKey) env.GEMINI_API_KEY = geminiApiKey;

    writeEnvFile(env);

    // Reload into process.env
    if (clientId) process.env.DHAN_CLIENT_ID = clientId;
    if (pin) process.env.DHAN_PIN = pin;
    if (totpSecret) process.env.DHAN_TOTP_SECRET = totpSecret;
    if (geminiApiKey) process.env.GEMINI_API_KEY = geminiApiKey;

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST to manually trigger token refresh from UI
app.post('/api/settings/refresh-token', async (req, res) => {
  const secret = process.env.DHAN_TOTP_SECRET;
  const pin = process.env.DHAN_PIN;
  const clientId = process.env.DHAN_CLIENT_ID;

  if (!secret || !pin || pin === 'xxxx') {
    return res.status(400).json({ success: false, message: 'TOTP Secret and PIN not configured. Please save settings first.' });
  }

  try {
    const totp = generateSync({ secret });
    const url = `https://auth.dhan.co/app/generateAccessToken?dhanClientId=${clientId}&pin=${pin}&totp=${totp}`;
    const response = await axios.post(url);

    const token = response.data?.access_token || response.data?.data?.access_token || response.data?.accessToken || response.data?.data?.accessToken;
    if (token) {
      dhanAccessToken = token;
      // Save new token to .env
      const env = readEnvFile();
      env.DHAN_ACCESS_TOKEN = token;
      writeEnvFile(env);
      process.env.DHAN_ACCESS_TOKEN = token;
      return res.json({ success: true, message: 'Token refreshed successfully!' });
    } else {
      return res.status(400).json({ success: false, message: 'Token refresh failed. Check your PIN and TOTP Secret.', details: response.data });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
      details: error.response?.data
    });
  }
});

let isSyncing = false;
// Unified Background Synchronizer to fetch all data for active indices and update cache & DB.
const syncMarketData = async () => {
  if (isSyncing) {
    console.log(`[Sync Worker] Sync is already in progress. Skipping execution.`);
    return;
  }
  isSyncing = true;
  if (!isIndianMarketOpen()) {
    console.log(`[Sync Worker] Market is closed. Skipping live sync.`);
    isSyncing = false;
    return;
  }
  const symbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
  console.log(`[Sync Worker] Starting unified market data sync...`);
  
  for (const symbol of symbols) {
    try {
      const token = dhanAccessToken;
      const clientId = process.env.DHAN_CLIENT_ID;
      if (!token || !clientId) {
        console.log(`[Sync Worker] Skip ${symbol}: Dhan credentials missing.`);
        continue;
      }

      const scripId = scripMap[symbol];
      if (!scripId) continue;

      // 1. FETCH OPTION CHAIN
      const expiryResponse = await queuedDhanRequest({
        method: 'post',
        url: 'https://api.dhan.co/v2/optionchain/expirylist',
        data: {
          UnderlyingScrip: scripId,
          UnderlyingSeg: 'IDX_I'
        },
        headers: getDhanHeaders()
      });
      
      if (expiryResponse.data.status !== 'success' || !expiryResponse.data.data.length) continue;
      const expiry = expiryResponse.data.data[0];
      
      const ocResponse = await queuedDhanRequest({
        method: 'post',
        url: 'https://api.dhan.co/v2/optionchain',
        data: {
          UnderlyingScrip: scripId,
          UnderlyingSeg: 'IDX_I',
          Expiry: expiry
        },
        headers: getDhanHeaders()
      });
      
      if (ocResponse.data.status !== 'success') continue;
      
      const rawData = ocResponse.data.data;
      const ocData = rawData.oc;
      const spotPrice = rawData.last_price;
      
      if (latestSpotPrices.hasOwnProperty(symbol)) {
        latestSpotPrices[symbol] = spotPrice;
      }
      
      const strikesArray = Object.keys(ocData).map(strikeStr => {
        const strike = parseFloat(strikeStr);
        const data = ocData[strikeStr];
        return {
          strike,
          callOi: data.ce?.oi || 0,
          callChgOi: (data.ce?.oi || 0) - (data.ce?.previous_oi || 0), 
          callLtp: data.ce?.last_price || 0,
          callVolume: data.ce?.volume || 0,
          callIv: data.ce?.implied_volatility || data.ce?.iv || 0,
          putVolume: data.pe?.volume || 0,
          putLtp: data.pe?.last_price || 0,
          putChgOi: (data.pe?.oi || 0) - (data.pe?.previous_oi || 0),
          putOi: data.pe?.oi || 0,
          putIv: data.pe?.implied_volatility || data.pe?.iv || 0,
          updateStatus: null
        };
      }).sort((a, b) => a.strike - b.strike);

      // Save option chain to database
      await checkAndSaveOptionChain(symbol, spotPrice, expiry, strikesArray);

      // Update cache
      const cacheKey = `${symbol}_first`;
      const result = { 
        success: true, 
        spotPrice,
        expiry: expiry,
        expiryList: expiryResponse.data.data,
        data: strikesArray,
        atr: latestAtrValues[symbol] || (symbol === 'NIFTY' ? 15 : symbol === 'BANKNIFTY' ? 40 : symbol === 'FINNIFTY' ? 18 : 10)
      };
      setCachedData('optionChain', cacheKey, result);
      // Also cache for specific expiry
      setCachedData('optionChain', `${symbol}_${expiry}`, result);

      // 2. FETCH 5M CHART CANDLES
      const toDate = new Date();
      toDate.setDate(toDate.getDate() + 1);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 3); 
      const formatDate = (d) => d.toISOString().split('T')[0];

      const chartResponse = await queuedDhanRequest({
        method: 'post',
        url: 'https://api.dhan.co/v2/charts/intraday',
        data: {
          securityId: scripId.toString(),
          exchangeSegment: 'IDX_I',
          instrument: 'INDEX',
          interval: '5',
          fromDate: formatDate(fromDate),
          toDate: formatDate(toDate)
        },
        headers: getDhanHeaders()
      });

      if (chartResponse.data.status === 'success' || chartResponse.data.open) {
        const chartData = chartResponse.data.data || chartResponse.data;
        const chartCandles = [];
        if (chartData.timestamp) {
          for (let i = 0; i < chartData.timestamp.length; i++) {
            chartCandles.push({
              time: chartData.timestamp[i],
              open: chartData.open[i],
              high: chartData.high[i],
              low: chartData.low[i],
              close: chartData.close[i],
              volume: chartData.volume ? chartData.volume[i] : 1
            });
          }
        }
        setCachedData('chartsIntraday', `${symbol}_5`, { success: true, data: chartCandles });
      }

      // 3. FETCH 3M CHART CANDLES
      const chartResponse3 = await queuedDhanRequest({
        method: 'post',
        url: 'https://api.dhan.co/v2/charts/intraday',
        data: {
          securityId: scripId.toString(),
          exchangeSegment: 'IDX_I',
          instrument: 'INDEX',
          interval: '3',
          fromDate: formatDate(fromDate),
          toDate: formatDate(toDate)
        },
        headers: getDhanHeaders()
      });

      if (chartResponse3.data.status === 'success' || chartResponse3.data.open) {
        const chartData = chartResponse3.data.data || chartResponse3.data;
        const chartCandles = [];
        if (chartData.timestamp) {
          for (let i = 0; i < chartData.timestamp.length; i++) {
            chartCandles.push({
              time: chartData.timestamp[i],
              open: chartData.open[i],
              high: chartData.high[i],
              low: chartData.low[i],
              close: chartData.close[i],
              volume: chartData.volume ? chartData.volume[i] : 1
            });
          }
        }
        setCachedData('chartsIntraday', `${symbol}_3`, { success: true, data: chartCandles });
      }

      // 4. FETCH 1-Hour Chart Candles
      const fromDate10 = new Date();
      fromDate10.setDate(fromDate10.getDate() - 10);
      const chartResponse60 = await queuedDhanRequest({
        method: 'post',
        url: 'https://api.dhan.co/v2/charts/intraday',
        data: {
          securityId: scripId.toString(),
          exchangeSegment: 'IDX_I',
          instrument: 'INDEX',
          interval: '60',
          fromDate: formatDate(fromDate10),
          toDate: formatDate(toDate)
        },
        headers: getDhanHeaders()
      });

      if (chartResponse60.data.status === 'success' || chartResponse60.data.open) {
        const chartData = chartResponse60.data.data || chartResponse60.data;
        const hourCandles = [];
        if (chartData.timestamp) {
          for (let i = 0; i < chartData.timestamp.length; i++) {
            hourCandles.push({
              time: chartData.timestamp[i],
              open: chartData.open[i],
              high: chartData.high[i],
              low: chartData.low[i],
              close: chartData.close[i],
              volume: chartData.volume ? chartData.volume[i] : 1
            });
          }
        }
        setCachedData('chartsIntraday', `${symbol}_60`, { success: true, data: hourCandles });
      }

      console.log(`[Sync Worker] Successfully synchronized data for ${symbol}`);
      
      // Delay to avoid hitting Dhan API rate limits within loop (2.5 seconds spacing)
      await new Promise(r => setTimeout(r, 2500));

    } catch (err) {
      console.error(`[Sync Worker] Sync failed for ${symbol}:`, err.message);
    }
  }

  // After sync finishes, run calculations using cached data
  try {
    console.log(`[Sync Worker] Launching background decoders and alerts checker...`);
    await runAllDecoders();
    await triggerOpenClawBackgroundAlerts();
  } catch (decErr) {
    console.error(`[Sync Worker] Error running calculations:`, decErr.message);
  } finally {
    isSyncing = false;
  }
};

// Background Signal Generator: Unified High-Accuracy Decoder
async function runAllDecoders() {
  const symbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
  
  for (const symbol of symbols) {
    try {
      // Get from cache
      const cacheKey = `${symbol}_first`;
      const cached = getCachedData('optionChain', cacheKey, 300000); 
      if (!cached) {
        console.log(`[Decoder] No cached option chain for ${symbol}, skipping.`);
        continue;
      }
      
      const spotPrice = cached.spotPrice;
      const expiry = cached.expiry;
      const strikesArray = cached.data;
      
      if (latestSpotPrices.hasOwnProperty(symbol)) {
        latestSpotPrices[symbol] = spotPrice;
      }
      
      // A. Calculate PCR
      const totalCallOi = strikesArray.reduce((sum, row) => sum + row.callOi, 0);
      const totalPutOi = strikesArray.reduce((sum, row) => sum + row.putOi, 0);
      const pcr = totalCallOi > 0 ? totalPutOi / totalCallOi : 1.0;
      
      // B. Calculate PCR Velocity (Change speed)
      let pcrVelocity = 0;
      await new Promise((resolve) => {
        db.get(
          `SELECT data FROM option_chain_history WHERE symbol = ? ORDER BY timestamp DESC LIMIT 1 OFFSET 1`,
          [symbol],
          (err, row) => {
            if (!err && row) {
              try {
                const prevStrikes = JSON.parse(row.data);
                const prevCallOi = prevStrikes.reduce((sum, r) => sum + (r.callOi || 0), 0);
                const prevPutOi = prevStrikes.reduce((sum, r) => sum + (r.putOi || 0), 0);
                const prevPcr = prevCallOi > 0 ? prevPutOi / prevCallOi : 1.0;
                pcrVelocity = pcr - prevPcr;
              } catch (e) {}
            }
            resolve();
          }
        );
      });

      // C. Max Pain Strike
      let minLoss = Infinity;
      let maxPainStrike = spotPrice;
      strikesArray.forEach(targetStrike => {
        let totalLoss = 0;
        strikesArray.forEach(strikeRow => {
          if (targetStrike.strike > strikeRow.strike) {
            totalLoss += strikeRow.callOi * (targetStrike.strike - strikeRow.strike);
          }
          if (targetStrike.strike < strikeRow.strike) {
            totalLoss += strikeRow.putOi * (strikeRow.strike - targetStrike.strike);
          }
        });
        if (totalLoss < minLoss) {
          minLoss = totalLoss;
          maxPainStrike = targetStrike.strike;
        }
      });
      
      // D. Concentration Ratio
      const callStrikes = [...strikesArray].sort((a,b) => b.callOi - a.callOi).slice(0, 3);
      const putStrikes = [...strikesArray].sort((a,b) => b.putOi - a.putOi).slice(0, 3);
      const topCallOi = callStrikes.reduce((sum, s) => sum + s.callOi, 0);
      const topPutOi = putStrikes.reduce((sum, s) => sum + s.putOi, 0);
      const concentrationRatio = topCallOi > 0 ? topPutOi / topCallOi : 1.0;

      // E. Calculate Option Decoder Score
      let optionScore = 50;
      let optionSignal = 'WAIT';
      let bullishPoints = 0;
      let totalPoints = 0;

      totalPoints += 30;
      if (pcr > 1.2) bullishPoints += 30;
      else if (pcr >= 0.9) bullishPoints += 15;

      totalPoints += 20;
      if (pcrVelocity > 0.02) bullishPoints += 20;
      else if (pcrVelocity >= -0.02) bullishPoints += 10;

      totalPoints += 25;
      if (spotPrice < maxPainStrike) bullishPoints += 25;
      else if (spotPrice === maxPainStrike) bullishPoints += 12;

      totalPoints += 25;
      if (concentrationRatio > 1.2) bullishPoints += 25;
      else if (concentrationRatio >= 0.9) bullishPoints += 12;

      optionScore = Math.round((bullishPoints / totalPoints) * 100);
      if (optionScore >= 75) optionSignal = 'CALL';
      else if (optionScore <= 25) optionSignal = 'PUT';

      // Get cached chart candles
      const cachedChart = getCachedData('chartsIntraday', `${symbol}_5`, 300000);
      if (!cachedChart || !cachedChart.data || cachedChart.data.length < 30) {
        console.log(`[Decoder] No cached chart data for ${symbol}, skipping decoder calculation.`);
        continue;
      }
      
      const candles5m = cachedChart.data;

      // Group into 15m candles for Trend Filter
      const candles15m = [];
      for (let i = 0; i < candles5m.length; i += 3) {
        const chunk = candles5m.slice(i, i + 3);
        if (chunk.length === 0) continue;
        const open = chunk[0].open;
        const close = chunk[chunk.length - 1].close;
        const high = Math.max(...chunk.map(c => c.high));
        const low = Math.min(...chunk.map(c => c.low));
        candles15m.push({ open, close, high, low });
      }

      // Indicator Calculators
      const calculateEMA = (cand, period) => {
        if (!cand || cand.length === 0) return [];
        const k = 2 / (period + 1);
        let emaList = [];
        let ema = cand[0].close;
        for (let i = 0; i < cand.length; i++) {
          ema = (cand[i].close * k) + (ema * (1 - k));
          emaList.push(ema);
        }
        return emaList;
      };

      const calculateRSI = (cand, period = 14) => {
        if (!cand || cand.length < period) return Array(cand ? cand.length : 0).fill(50);
        let gains = 0;
        let losses = 0;
        for (let i = 1; i <= period; i++) {
          const diff = cand[i].close - cand[i-1].close;
          if (diff >= 0) gains += diff;
          else losses -= diff;
        }
        let avgGain = gains / period;
        let avgLoss = losses / period;
        let rsiList = Array(period).fill(50);
        const firstRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsiList.push(100 - (100 / (1 + firstRS)));
        for (let i = period + 1; i < cand.length; i++) {
          const diff = cand[i].close - cand[i-1].close;
          const gain = diff >= 0 ? diff : 0;
          const loss = diff < 0 ? -diff : 0;
          avgGain = ((avgGain * (period - 1)) + gain) / period;
          avgLoss = ((avgLoss * (period - 1)) + loss) / period;
          const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
          rsiList.push(100 - (100 / (1 + rs)));
        }
        return rsiList;
      };

      const calculateATR = (cand, period = 14) => {
        if (!cand || cand.length <= period) return Array(cand ? cand.length : 0).fill(10);
        let trs = [];
        for (let i = 1; i < cand.length; i++) {
          const h_l = cand[i].high - cand[i].low;
          const h_pc = Math.abs(cand[i].high - cand[i-1].close);
          const l_pc = Math.abs(cand[i].low - cand[i-1].close);
          trs.push(Math.max(h_l, h_pc, l_pc));
        }
        let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
        let atrList = Array(period).fill(atr);
        for (let i = period; i < trs.length; i++) {
          atr = ((atr * (period - 1)) + trs[i]) / period;
          atrList.push(atr);
        }
        return atrList;
      };

      const ema9List = calculateEMA(candles5m, 9);
      const ema20List = calculateEMA(candles5m, 20);
      const ema12List = calculateEMA(candles5m, 12);
      const ema26List = calculateEMA(candles5m, 26);
      const rsiList = calculateRSI(candles5m, 14);
      const atrList = calculateATR(candles5m, 14);
      const ema20_15m = calculateEMA(candles15m, 20);

      const len5 = candles5m.length;
      const lastCandle = candles5m[len5 - 1];
      const lastEma9 = ema9List[len5 - 1];
      const lastEma20 = ema20List[len5 - 1];
      const lastRsi = rsiList[len5 - 1] || 50;
      const lastEma12 = ema12List[len5 - 1];
      const lastEma26 = ema26List[len5 - 1];
      const macdLine = lastEma12 - lastEma26;
      const lastAtr = atrList[atrList.length - 1] || (symbol === 'NIFTY' ? 10 : 25);
      
      // Update latestAtrValues cache
      latestAtrValues[symbol] = parseFloat(lastAtr.toFixed(2));

      // Major Trend Alignment (15m Timeframe Filter)
      const len15 = candles15m.length;
      const last15mClose = candles15m[len15 - 1].close;
      const last15mEma20 = ema20_15m[len15 - 1] || last15mClose;
      const majorTrend = last15mClose > last15mEma20 ? 'BULLISH' : 'BEARISH';

      // VWAP Calculation
      let vwap = lastCandle.close;
      if (candles5m && candles5m.length > 0) {
        let vwapSum = 0;
        let volSum = 0;
        for (let i = Math.max(0, len5 - 50); i < len5; i++) {
          const c = candles5m[i];
          const typPrice = (c.high + c.low + c.close) / 3;
          const vol = c.volume || 1;
          vwapSum += typPrice * vol;
          volSum += vol;
        }
        if (volSum > 0) vwap = vwapSum / volSum;
      }

      // Calculate Chart Analysis Consensus Score
      let chartBullishScore = 0;
      let chartBearishScore = 0;

      if (lastCandle.close > lastEma9) chartBullishScore++; else chartBearishScore++;
      if (lastCandle.close > lastEma20) chartBullishScore++; else chartBearishScore++;
      if (lastEma9 > lastEma20) chartBullishScore++; else chartBearishScore++;
      if (macdLine > 0) chartBullishScore++; else chartBearishScore++;
      if (lastRsi < 40) chartBullishScore++; else if (lastRsi > 60) chartBearishScore++;
      if (lastCandle.close > vwap) chartBullishScore++; else chartBearishScore++;

      let chartSignal = 'WAIT';
      // 5m signal confirmation + 15m major trend alignment
      if (chartBullishScore >= 4 && lastCandle.close > lastEma9 && majorTrend === 'BULLISH') {
        chartSignal = 'CALL';
      } else if (chartBearishScore >= 4 && lastCandle.close < lastEma9 && majorTrend === 'BEARISH') {
        chartSignal = 'PUT';
      }

      // ATR-Based Dynamic Stoploss (1.5 * ATR) and Target (3.0 * ATR)
      const dynamicSlAmt = 1.5 * lastAtr;
      const dynamicTgtAmt = 3.0 * lastAtr;

      const callTarget = parseFloat((lastCandle.close + dynamicTgtAmt).toFixed(2));
      const callStoploss = parseFloat((lastCandle.close - dynamicSlAmt).toFixed(2));
      const putTarget = parseFloat((lastCandle.close - dynamicTgtAmt).toFixed(2));
      const putStoploss = parseFloat((lastCandle.close + dynamicSlAmt).toFixed(2));

      // Save Option Chain Signal
      if (optionSignal !== 'WAIT') {
        const target = optionSignal === 'CALL' ? spotPrice + (2.0 * lastAtr) : spotPrice - (2.0 * lastAtr);
        const sl = optionSignal === 'CALL' ? spotPrice - (1.0 * lastAtr) : spotPrice + (1.0 * lastAtr);
        
        db.get(`SELECT id FROM ai_signals WHERE symbol = ? AND source = 'OPTION_CHAIN' AND status = 'PENDING'`, [symbol], (err, row) => {
          if (!err && !row) {
            db.run(
              `INSERT INTO ai_signals (symbol, type, entry_price, target_price, stoploss_price, source) VALUES (?, ?, ?, ?, ?, 'OPTION_CHAIN')`,
              [symbol, optionSignal, spotPrice, parseFloat(target.toFixed(2)), parseFloat(sl.toFixed(2))]
            );
          }
        });
      }

      // Save Chart Signal
      if (chartSignal !== 'WAIT') {
        const target = chartSignal === 'CALL' ? callTarget : putTarget;
        const sl = chartSignal === 'CALL' ? callStoploss : putStoploss;
        
        db.get(`SELECT id FROM ai_signals WHERE symbol = ? AND source = 'CHART' AND status = 'PENDING'`, [symbol], (err, row) => {
          if (!err && !row) {
            db.run(
              `INSERT INTO ai_signals (symbol, type, entry_price, target_price, stoploss_price, source) VALUES (?, ?, ?, ?, ?, 'CHART')`,
              [symbol, chartSignal, lastCandle.close, target, sl]
            );
          }
        });
      }

      // Save Hybrid Convergence Signal (when both models agree, representing extreme accuracy)
      if (optionSignal !== 'WAIT' && optionSignal === chartSignal) {
        const target = optionSignal === 'CALL' ? callTarget : putTarget;
        const sl = optionSignal === 'CALL' ? callStoploss : putStoploss;
        
        db.get(`SELECT id FROM ai_signals WHERE symbol = ? AND source = 'HYBRID' AND status = 'PENDING'`, [symbol], (err, row) => {
          if (!err && !row) {
            db.run(
              `INSERT INTO ai_signals (symbol, type, entry_price, target_price, stoploss_price, source) VALUES (?, ?, ?, ?, ?, 'HYBRID')`,
              [symbol, optionSignal, lastCandle.close, target, sl],
              function(err) {
                if (!err) console.log(`Background auto-saved HYBRID signal for ${symbol} with ID: ${this.lastID}`);
              }
            );
          }
        });
      }

    } catch (err) {
      console.error(`Unified decoding failed for ${symbol}:`, err.message);
    }
  }
  
  // After looping through all symbols, trigger signal checks in background
  try {
    const updated = await updatePendingSignals();
    if (updated > 0) {
      console.log(`[Background] Automated signal verification updated ${updated} pending signals.`);
    }
  } catch (err) {
    console.error('Failed to run automated background signal verification:', err.message);
  }
}

// Telegram Bot Command Listener (Long Polling)
let telegramBotInterval = null;
let lastTelegramUpdateId = 0;
let currentTelegramToken = '';
let currentTelegramChatId = '';

async function startTelegramBotListener() {
  try {
    const settings = await getSystemSettings();
    const token = settings['telegram_token'];
    const chatId = settings['telegram_chat_id'];

    if (!token || !chatId) {
      if (telegramBotInterval) {
        clearInterval(telegramBotInterval);
        telegramBotInterval = null;
        console.log('[Telegram Bot] Stopped listener: credentials missing.');
      }
      return;
    }

    // If token/chatId didn't change and bot is already running, do nothing
    if (telegramBotInterval && token === currentTelegramToken && chatId === currentTelegramChatId) {
      return;
    }

    // If credentials changed, stop the previous interval
    if (telegramBotInterval) {
      clearInterval(telegramBotInterval);
      telegramBotInterval = null;
    }

    currentTelegramToken = token;
    currentTelegramChatId = chatId;
    lastTelegramUpdateId = 0; // reset offset to get fresh messages

    console.log(`[Telegram Bot] Starting long-polling listener using token: ${token.substring(0, 6)}...`);

    let isPolling = false;

    telegramBotInterval = setInterval(async () => {
      if (isPolling) return;
      isPolling = true;

      try {
        const url = `https://api.telegram.org/bot${currentTelegramToken}/getUpdates?offset=${lastTelegramUpdateId + 1}&timeout=2`;
        const response = await axios.get(url, { timeout: 5000 });
        if (response.data && response.data.ok && response.data.result) {
          const updates = response.data.result;
          for (const update of updates) {
            lastTelegramUpdateId = update.update_id;
            
            const message = update.message;
            if (message && message.text && String(message.chat.id) === String(currentTelegramChatId)) {
              const text = message.text.trim();
              console.log(`[Telegram Bot] Received command: "${text}" from Chat ID: ${message.chat.id}`);
              
              if (text.startsWith('/analyze')) {
                const parts = text.split(' ');
                const symbol = (parts[1] || 'NIFTY').toUpperCase();
                
                // Reply with typing or status indicator
                await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                  chat_id: currentTelegramChatId,
                  text: `⏳ Analyzing *${symbol}* option chain and indicators... Please wait.`,
                  parse_mode: 'Markdown'
                });

                try {
                  const settings = await getSystemSettings();
                  const pcrWeight = parseInt(settings['pcr_weight'], 10) || 40;
                  const chartWeight = parseInt(settings['chart_weight'], 10) || 40;
                  const newsWeight = parseInt(settings['news_weight'], 10) || 20;
                  const weights = { pcrWeight, chartWeight, newsWeight };
                  const profile = settings['trading_profile'] || 'intraday_scalper';

                  const result = await executeOpenClawAnalysis(symbol, null, weights, profile);
                  const actionData = result.data;
                  const indicators = result.indicators;

                  let optionDetails = '';
                  if (actionData.suggestedOptionContract) {
                    optionDetails = `*Option Contract*: ${actionData.suggestedOptionContract}\n` +
                      `*Premium Entry*: ₹${actionData.optionPremiumLtp}\n` +
                      `*Premium Target 1*: ₹${actionData.optionTarget1}\n` +
                      `*Premium Target 2*: ₹${actionData.optionTarget2}\n` +
                      `*Premium Stoploss*: ₹${actionData.optionStoploss}\n` +
                      `*Expected Hold*: ⏳ ${actionData.expectedHoldTime}\n` +
                      `*Trailing SL*: 📈 ${actionData.trailingStoploss || 'N/A'}\n\n`;
                  }

                  const responseMsg = `🚨 *OpenClaw AI Trade Alert* 🚨\n\n` +
                    `*Symbol*: ${symbol}\n` +
                    `*Action*: ${actionData.action === 'CALL' ? 'BUY CALL / BULLISH' : actionData.action === 'PUT' ? 'BUY PUT / BEARISH' : 'WAIT / NEUTRAL'}\n` +
                    `*Spot Price*: ${indicators.spotPrice || 'N/A'}\n` +
                    `*Confidence*: ${actionData.confidence}%\n` +
                    `*1H Trend*: ${indicators.hourlyTrend || 'N/A'}\n` +
                    `*ATM IV*: ${indicators.averageIv ? indicators.averageIv.toFixed(1) + '%' : 'N/A'}\n` +
                    `*Buy Range*: ${actionData.buyRange}\n` +
                    `*Target 1*: ${actionData.target1}\n` +
                    `*Target 2*: ${actionData.target2}\n` +
                    `*Stoploss*: ${actionData.stoploss}\n` +
                    `*Time (IST)*: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })}\n\n` +
                    optionDetails +
                    `*AI Summary*: ${actionData.summary}\n\n` +
                    `🤖 Powered by OpenClaw AI Multi-Agent Engine.`;

                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: responseMsg,
                    parse_mode: 'Markdown'
                  });

                  // Log to DB for Live Tracker
                  if (actionData.action === 'CALL' || actionData.action === 'PUT') {
                    saveOpenClawSignalToDb(symbol, actionData, indicators.spotPrice);
                  }
                } catch (analysisErr) {
                  console.error('[Telegram Bot] Analysis error:', analysisErr.message);
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `❌ Analysis failed: ${analysisErr.message}`
                  });
                }
              } else if (text.startsWith('/status')) {
                // Fetch active PENDING OpenClaw trades
                db.all(`SELECT * FROM ai_signals WHERE source = 'OPENCLAW' AND status = 'PENDING' ORDER BY created_at DESC`, [], async (err, rows) => {
                  if (err) {
                    await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                      chat_id: currentTelegramChatId,
                      text: `❌ Error checking signals: ${err.message}`
                    });
                    return;
                  }

                  if (!rows || rows.length === 0) {
                    await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                      chat_id: currentTelegramChatId,
                      text: `ℹ️ No active OpenClaw trades currently under watch.`
                    });
                    return;
                  }

                  let statusMsg = `📋 *Active OpenClaw Trades Under Watch:* \n\n`;
                  rows.forEach((row, index) => {
                    const spot = latestSpotPrices[row.symbol] || row.entry_price;
                    statusMsg += `${index + 1}. *${row.symbol} ${row.type}*\n` +
                      `  • Entry: ${row.entry_price.toFixed(2)}\n` +
                      `  • Target: ${row.target_price.toFixed(2)}\n` +
                      `  • Stoploss: ${row.stoploss_price.toFixed(2)}\n` +
                      `  • Current Spot: ${spot.toFixed(2)}\n` +
                      `  • Status: ⏳ MONITORING\n\n`;
                  });

                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: statusMsg,
                    parse_mode: 'Markdown'
                  });
                });
              } else if (text.startsWith('/help') || text.startsWith('/start')) {
                const helpMsg = `🤖 *OpenClaw AI Bot Commands:* \n\n` +
                  `• \`/analyze NIFTY\` - Runs options and technical agent analysis for NIFTY.\n` +
                  `• \`/analyze BANKNIFTY\` - Runs analysis for BANKNIFTY.\n` +
                  `• \`/analyze FINNIFTY\` - Runs analysis for FINNIFTY.\n` +
                  `• \`/analyze MIDCPNIFTY\` - Runs analysis for MIDCPNIFTY.\n` +
                  `• \`/status\` - Shows active pending trades and their target/SL status.\n` +
                  `• \`/help\` - Show this help menu.`;
                await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                  chat_id: currentTelegramChatId,
                  text: helpMsg,
                  parse_mode: 'Markdown'
                });
              }
            }
          }
        }
      } catch (err) {
        console.error('[Telegram Bot] Long-polling error:', err.message);
      } finally {
        isPolling = false;
      }
    }, 5000);

  } catch (err) {
    console.error('[Telegram Bot] Failed to initialize listener:', err.message);
  }
}

// Run unified sync every 1 minute
setInterval(syncMarketData, 60000);

// Run immediately on startup (wait 6s to allow process environment to load)
setTimeout(() => {
  syncMarketData();
  startTelegramBotListener();
}, 6000);

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
