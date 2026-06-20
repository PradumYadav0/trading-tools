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

// Helper to call Gemini API with retry, exponential backoff, and descriptive error parsing
async function callGeminiWithRetry(url, payload, maxRetries = 5, initialDelay = 1500) {
  let delay = initialDelay;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await axios.post(url, payload);
    } catch (error) {
      const isRateLimit = error.response && error.response.status === 429;
      const isServerErr = error.response && error.response.status >= 500;
      
      // Extract Google API descriptive message if present
      const details = error.response?.data?.error?.message || error.response?.data?.message || error.message;
      
      if ((isRateLimit || isServerErr) && attempt < maxRetries) {
        let waitTime = delay;
        let isExtracted = false;

        if (isRateLimit && typeof details === 'string') {
          const match = details.match(/Please retry in ([\d\.]+)s/i);
          if (match) {
            const retrySeconds = parseFloat(match[1]);
            waitTime = Math.ceil(retrySeconds * 1000) + 1500; // add 1.5s buffer
            isExtracted = true;
            console.warn(`[Gemini Retry] Rate limit hit. Extracted retry time from error: ${retrySeconds}s. Waiting ${waitTime}ms before retry attempt ${attempt + 1}...`);
          }
        }

        if (!isExtracted) {
          console.warn(`[Gemini Retry] Attempt ${attempt} failed: ${details}. Retrying in ${waitTime}ms...`);
          delay *= 2.5; // Exponential backoff
        }

        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        // Enforce a more descriptive error message to be captured by the UI log
        let errorMessage = details;
        if (isRateLimit) {
          errorMessage = `Gemini API Rate Limit Exceeded (429): ${details}. ` +
            `Ensure your API Key is associated with a Google AI Studio project with active billing enabled. ` +
            `Free tier keys are subject to strict RPM and daily quotas.`;
        } else if (error.response && error.response.status === 400 && details.includes('API key expired')) {
          errorMessage = `Gemini API Error (400): API key expired. Please renew the API key in your Google AI Studio account.`;
        }
        
        const enhancedError = new Error(errorMessage);
        enhancedError.status = error.response?.status || 500;
        enhancedError.response = error.response;
        throw enhancedError;
      }
    }
  }
}

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
      max_spot_seen REAL,
      exit_time DATETIME,
      exit_price REAL,
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
      db.run(`ALTER TABLE ai_signals ADD COLUMN max_spot_seen REAL`, (alterErr) => {
        if (!alterErr) {
          console.log("Successfully migrated database: added 'max_spot_seen' column to ai_signals.");
        }
      });
      db.run(`ALTER TABLE ai_signals ADD COLUMN exit_time DATETIME`, (alterErr) => {
        if (!alterErr) {
          console.log("Successfully migrated database: added 'exit_time' column to ai_signals.");
        }
      });
      db.run(`ALTER TABLE ai_signals ADD COLUMN exit_price REAL`, (alterErr) => {
        if (!alterErr) {
          console.log("Successfully migrated database: added 'exit_price' column to ai_signals.");
        }
      });
    });

    db.run(`CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT,
      type TEXT,
      contract_name TEXT,
      qty INTEGER,
      entry_premium REAL,
      exit_premium REAL,
      entry_spot REAL,
      exit_spot REAL,
      target_premium REAL,
      stoploss_premium REAL,
      status TEXT DEFAULT 'ACTIVE',
      pnl REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password_hash TEXT,
      salt TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, () => {
      seedDefaultUser();
    });

    db.run(`CREATE TABLE IF NOT EXISTS password_resets (
      username TEXT,
      otp TEXT,
      expires_at INTEGER
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

  // Auto-expire any pending signals from previous calendar days (IST)
  db.run(`
    UPDATE ai_signals 
    SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP 
    WHERE status = 'PENDING' 
      AND date(created_at, '+5.5 hours') < date('now', '+5.5 hours')
  `, function(expireErr) {
    if (expireErr) {
      console.error('Error auto-expiring old signals:', expireErr.message);
    } else if (this.changes > 0) {
      console.log(`Auto-expired ${this.changes} pending signals from previous days.`);
    }
  });
};

// Periodic database cleanup every 12 hours
setInterval(cleanupDatabaseHistory, 12 * 60 * 60 * 1000);

// ─── Authentication System & Password Reset ──────────────────────────────────
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Generate salt and hash
const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { salt, hash };
};

// Verify hash
const verifyPassword = (password, salt, hash) => {
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return verifyHash === hash;
};

// Seed default user 'devil' / 'devil' on startup if not exists
const seedDefaultUser = () => {
  db.get(`SELECT COUNT(*) as count FROM users`, [], (err, row) => {
    if (err) {
      console.error('Error checking users count during seeding:', err.message);
      return;
    }
    if (row.count === 0) {
      const pwdInfo = hashPassword('devil');
      db.run(
        `INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)`,
        ['devil', pwdInfo.hash, pwdInfo.salt],
        (insErr) => {
          if (insErr) {
            console.error('Error seeding default user:', insErr.message);
          } else {
            console.log('Default user "devil" seeded successfully.');
          }
        }
      );
    }
  });
};

// Send OTP via SMTP (nodemailer) with console fallback
const sendOtpEmail = async (username, otp) => {
  const toEmail = process.env.RESET_TO_EMAIL;
  if (!toEmail) {
    console.log(`[OTP FALLBACK] No RESET_TO_EMAIL configured in .env. Here is the OTP for user "${username}": ${otp}`);
    return true;
  }

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass) {
    console.log(`[OTP FALLBACK] SMTP settings are not fully configured in .env. Here is the OTP for user "${username}": ${otp}`);
    return true;
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port, 10),
      secure: parseInt(port, 10) === 465,
      auth: {
        user,
        pass
      }
    });

    const mailOptions = {
      from: `"Trading Tools Support" <${user}>`,
      to: toEmail,
      subject: 'Trading Tools - Password Reset OTP',
      text: `Hello,\n\nYour 6-digit OTP for resetting the password of username "${username}" is: ${otp}.\n\nThis OTP is valid for 10 minutes.\n\nBest regards,\nTrading Tools Team`,
      html: `<p>Hello,</p><p>Your 6-digit OTP for resetting the password of username <strong>${username}</strong> is: <strong style="font-size: 1.2em; letter-spacing: 2px;">${otp}</strong>.</p><p>This OTP is valid for 10 minutes.</p><p>Best regards,<br>Trading Tools Team</p>`
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`OTP Email sent successfully to ${toEmail}: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('Failed to send OTP Email via SMTP:', error.message);
    console.log(`[OTP FALLBACK] SMTP send failed. Here is the OTP for user "${username}": ${otp}`);
    return true;
  }
};

// Session store
const activeSessions = new Map(); // token -> { username, expiresAt }
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

const createSession = (username) => {
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_EXPIRY_MS;
  activeSessions.set(token, { username, expiresAt });
  return token;
};

const verifySession = (token) => {
  const session = activeSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return null;
  }
  return session.username;
};

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'Authorization token missing.' });
  }
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
  const username = verifySession(token);
  if (!username) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session.' });
  }
  req.username = username;
  next();
};

const sanitizeUpstreamStatus = (status) => {
  const code = parseInt(status, 10);
  if (code === 401 || code === 403) {
    return 502; // Map upstream auth errors to Bad Gateway to prevent client-side logout
  }
  return code || 500;
};

// Auth: Check setup
app.get('/api/auth/check-setup', (req, res) => {
  res.json({ success: true, isSetup: true });
});

// Auth: Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  db.get(`SELECT * FROM users WHERE username = ?`, [username.trim()], (err, user) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    const isValid = verifyPassword(password, user.salt, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    const token = createSession(user.username);
    res.json({ success: true, token, username: user.username });
  });
});

// Auth: Logout
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
    activeSessions.delete(token);
  }
  res.json({ success: true });
});

// Auth: Forgot password (generate & send OTP)
app.post('/api/auth/forgot-password-email', (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ success: false, message: 'Username is required.' });
  }

  if (username.trim() !== 'devil') {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }

  db.get(`SELECT * FROM users WHERE username = ?`, [username.trim()], async (err, user) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Generate 6 digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes from now

    // Save to password_resets table (clear old resets for this user first)
    db.serialize(() => {
      db.run(`DELETE FROM password_resets WHERE username = ?`, [user.username]);
      db.run(
        `INSERT INTO password_resets (username, otp, expires_at) VALUES (?, ?, ?)`,
        [user.username, otp, expiresAt],
        async function(insErr) {
          if (insErr) {
            return res.status(500).json({ success: false, message: 'Failed to generate OTP.' });
          }

          // Send OTP
          await sendOtpEmail(user.username, otp);
          res.json({ success: true, message: 'OTP sent to your registered email address.' });
        }
      );
    });
  });
});

// Auth: Verify OTP and reset password
app.post('/api/auth/verify-otp-reset', (req, res) => {
  const { username, otp, newPassword } = req.body;
  if (!username || !otp || !newPassword) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  if (username.trim() !== 'devil') {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }

  db.get(`SELECT * FROM password_resets WHERE username = ? ORDER BY expires_at DESC LIMIT 1`, [username.trim()], (err, resetRecord) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    if (!resetRecord) {
      return res.status(400).json({ success: false, message: 'No active OTP verification found for this user.' });
    }

    if (resetRecord.otp !== otp.trim()) {
      return res.status(400).json({ success: false, message: 'Invalid OTP code.' });
    }

    if (Date.now() > resetRecord.expires_at) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    // OTP is valid!
    db.get(`SELECT * FROM users WHERE username = ?`, [username.trim()], (errUser, user) => {
      if (errUser) return res.status(500).json({ success: false, message: errUser.message });
      if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

      const pwdInfo = hashPassword(newPassword);

      db.serialize(() => {
        // Update user password
        db.run(
          `UPDATE users SET password_hash = ?, salt = ? WHERE username = ?`,
          [pwdInfo.hash, pwdInfo.salt, username.trim()]
        );
        // Clear all reset records for this user
        db.run(`DELETE FROM password_resets WHERE username = ?`, [username.trim()]);
        
        // Auto-login upon reset
        const token = createSession(username.trim());
        res.json({ success: true, token, username: username.trim() });
      });
    });
  });
});

// Global API Route Protection Middleware
app.use('/api', (req, res, next) => {
  const publicPaths = [
    '/auth/check-setup',
    '/auth/login',
    '/auth/forgot-password-email',
    '/auth/verify-otp-reset'
  ];

  // Strip query parameters for matching
  const path = req.path.split('?')[0];

  if (publicPaths.includes(path)) {
    return next();
  }

  return authMiddleware(req, res, next);
});

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

const indianHolidays = [
  // 2025 Holidays
  '2025-01-26', '2025-03-14', '2025-03-31', '2025-04-10', '2025-04-14',
  '2025-04-18', '2025-05-01', '2025-06-06', '2025-07-05', '2025-08-15',
  '2025-09-05', '2025-10-02', '2025-10-23', '2025-11-01', '2025-11-05',
  '2025-12-25',
  
  // 2026 Holidays
  '2026-01-26', '2026-03-03', '2026-03-26', '2026-03-31', '2026-04-03',
  '2026-04-14', '2026-05-01', '2026-05-28', '2026-06-26', '2026-09-14',
  '2026-10-02', '2026-10-20', '2026-11-10', '2026-11-24', '2026-12-25'
];

// Helper to check if Indian Stock Market is open strictly for live trading hours (Monday to Friday, 9:15 AM to 3:30 PM IST, excluding NSE holidays)
const isIndianMarketOpen = () => {
  try {
    const todayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());

    if (indianHolidays.includes(todayStr)) return false;

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
    const todayStr = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(ist);

    if (indianHolidays.includes(todayStr)) return false;

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
    res.status(sanitizeUpstreamStatus(error.response?.status)).json({ 
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
    res.status(sanitizeUpstreamStatus(error.response?.status)).json({ 
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
      return res.status(sanitizeUpstreamStatus(error.response?.status)).json({ 
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
- Explain it in a simple way, like an expert friend giving advice.
- STRICT LENGTH LIMIT: Make the entire advice extremely short and direct. The total response MUST NOT exceed 60-80 words. Avoid greetings, introductory text, filler words, or long paragraphs. Just give direct, short bulleted points.`;

    // Call Gemini API (using the user-configured model, defaulting to gemini-2.5-flash)
    const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
    
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

    const geminiResponse = await callGeminiWithRetry(geminiUrl, {
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
    // Return 200 to bypass proxy error page overrides and let the client read the real message
    res.status(200).json({ 
      success: false, 
      message: error.message,
      details: error.response?.data
    });
  }
});

// Helper for calculating EMA
const calculateEMA = (data, period) => {
  if (!data || data.length < period) return [];
  const k = 2 / (period + 1);
  let emaList = [];
  let ema = data[0].close;
  for (let i = 0; i < data.length; i++) {
    ema = (data[i].close * k) + (ema * (1 - k));
    emaList.push(ema);
  }
  return emaList;
};

// Helper for calculating RSI
const calculateRSI = (data, period = 14) => {
  if (!data || data.length <= period) return Array(data ? data.length : 0).fill(50);
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
  let rsiList = Array(period).fill(50);
  const firstRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsiList.push(100 - (100 / (1 + firstRS)));

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiList.push(100 - (100 / (1 + rs)));
  }

  return rsiList;
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

// Helper for calculating ADX (Average Directional Index - Wilder's Smoothing)
const calculateADX = (data, period = 14) => {
  if (!data || data.length < period * 2) {
    return 20; // Default flat ADX if not enough data
  }

  const trs = [];
  const plusDMs = [];
  const minusDMs = [];

  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevHigh = data[i - 1].high;
    const prevLow = data[i - 1].low;
    const prevClose = data[i - 1].close;

    // True Range (TR)
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);

    // Directional Movement (+DM and -DM)
    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    let plusDM = 0;
    let minusDM = 0;

    if (upMove > downMove && upMove > 0) {
      plusDM = upMove;
    }
    if (downMove > upMove && downMove > 0) {
      minusDM = downMove;
    }

    plusDMs.push(plusDM);
    minusDMs.push(minusDM);
  }

  // Smooth using Wilder's Technique
  let smoothedTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues = [];

  // First values after first period
  let plusDI = smoothedTR > 0 ? (smoothedPlusDM / smoothedTR) * 100 : 0;
  let minusDI = smoothedTR > 0 ? (smoothedMinusDM / smoothedTR) * 100 : 0;
  let dx = (plusDI + minusDI) > 0 ? (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100 : 0;
  dxValues.push(dx);

  for (let i = period; i < trs.length; i++) {
    smoothedTR = smoothedTR - (smoothedTR / period) + trs[i];
    smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + plusDMs[i];
    smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + minusDMs[i];

    plusDI = smoothedTR > 0 ? (smoothedPlusDM / smoothedTR) * 100 : 0;
    minusDI = smoothedTR > 0 ? (smoothedMinusDM / smoothedTR) * 100 : 0;
    dx = (plusDI + minusDI) > 0 ? (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100 : 0;
    dxValues.push(dx);
  }

  // ADX = Smoothed DX
  if (dxValues.length < period) return 20;

  let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxValues.length; i++) {
    adx = ((adx * (period - 1)) + dxValues[i]) / period;
  }

  return parseFloat(adx.toFixed(2));
};

// Helper for calculating Bollinger Bands (20 SMA, 2 StdDev)
const calculateBollingerBands = (data, period = 20, stdDevMultiplier = 2) => {
  if (!data || data.length < period) {
    return { upper: null, middle: null, lower: null };
  }
  
  // Get the last `period` candles
  const slice = data.slice(-period);
  const closes = slice.map(c => c.close);
  
  // Calculate SMA (Middle Band)
  const sum = closes.reduce((acc, val) => acc + val, 0);
  const middle = sum / period;
  
  // Calculate Standard Deviation
  const variance = closes.reduce((acc, val) => acc + Math.pow(val - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  
  const upper = middle + (stdDevMultiplier * stdDev);
  const lower = middle - (stdDevMultiplier * stdDev);
  
  return {
    upper: parseFloat(upper.toFixed(2)),
    middle: parseFloat(middle.toFixed(2)),
    lower: parseFloat(lower.toFixed(2))
  };
};

// Helper for calculating MACD (12, 26, 9)
const calculateMACD = (data) => {
  if (!data || data.length < 26) {
    return { macdLine: 0, signalLine: 0, histogram: 0, crossover: 'NEUTRAL', histogramTrend: 'FLAT', aboveZero: false };
  }

  // Step 1: EMA(12) and EMA(26) on close prices
  const ema12List = calculateEMA(data, 12);
  const ema26List = calculateEMA(data, 26);

  // Step 2: MACD Line = EMA12 - EMA26
  const macdValues = [];
  for (let i = 0; i < data.length; i++) {
    macdValues.push(ema12List[i] - ema26List[i]);
  }

  // Step 3: Signal Line = EMA(9) of MACD values
  const signalValues = [];
  if (macdValues.length >= 9) {
    const k = 2 / (9 + 1);
    let ema = macdValues[0];
    for (let i = 0; i < macdValues.length; i++) {
      ema = (macdValues[i] * k) + (ema * (1 - k));
      signalValues.push(ema);
    }
  }

  const lastMacd    = macdValues[macdValues.length - 1] || 0;
  const prevMacd    = macdValues[macdValues.length - 2] || 0;
  const lastSignal  = signalValues.length > 0 ? signalValues[signalValues.length - 1] : 0;
  const prevSignal  = signalValues.length > 1 ? signalValues[signalValues.length - 2] : 0;
  const histogram   = parseFloat((lastMacd - lastSignal).toFixed(2));
  const prevHisto   = parseFloat((prevMacd - prevSignal).toFixed(2));

  // Step 4: Detect crossover status
  let crossover = 'NEUTRAL';
  if (prevMacd <= prevSignal && lastMacd > lastSignal) {
    crossover = 'BULLISH_CROSSOVER';   // Fresh BUY signal
  } else if (prevMacd >= prevSignal && lastMacd < lastSignal) {
    crossover = 'BEARISH_CROSSOVER';   // Fresh SELL signal
  } else if (lastMacd > lastSignal) {
    crossover = 'BULLISH';             // MACD above signal — bullish momentum
  } else if (lastMacd < lastSignal) {
    crossover = 'BEARISH';             // MACD below signal — bearish momentum
  }

  // Step 5: Histogram expansion/contraction trend
  let histogramTrend = 'FLAT';
  if      (histogram > 0 && histogram > prevHisto) histogramTrend = 'EXPANDING_BULLISH';   // Buying pressure increasing
  else if (histogram > 0 && histogram < prevHisto) histogramTrend = 'SHRINKING_BULLISH';   // Buying pressure weakening
  else if (histogram < 0 && histogram < prevHisto) histogramTrend = 'EXPANDING_BEARISH';   // Selling pressure increasing
  else if (histogram < 0 && histogram > prevHisto) histogramTrend = 'SHRINKING_BEARISH';   // Selling pressure weakening

  return {
    macdLine:      parseFloat(lastMacd.toFixed(2)),
    signalLine:    parseFloat(lastSignal.toFixed(2)),
    histogram,
    crossover,
    histogramTrend,
    aboveZero:     lastMacd > 0
  };
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

function clearOptionDetails(parsed) {
  parsed.suggestedOptionContract = null;
  parsed.optionPremiumLtp = null;
  parsed.optionTarget1 = null;
  parsed.optionTarget2 = null;
  parsed.optionStoploss = null;
  parsed.trailingStoploss = null;
}

function calculateAtm3Vpcr(strikes, spot) {
  if (!strikes || strikes.length === 0 || !spot || spot <= 0) return 0;
  const atmObj = strikes.reduce((prev, curr) => 
    Math.abs(curr.strike - spot) < Math.abs(prev.strike - spot) ? curr : prev
  );
  const atmIndex = strikes.findIndex(s => s.strike === atmObj.strike);
  if (atmIndex === -1) return 0;

  let callVol3 = 0;
  let putVol3 = 0;

  const startIdx = Math.max(0, atmIndex - 3);
  const endIdx = Math.min(strikes.length - 1, atmIndex + 3);

  for (let i = startIdx; i <= endIdx; i++) {
    callVol3 += strikes[i].callVolume || 0;
    putVol3 += strikes[i].putVolume || 0;
  }

  return callVol3 > 0 ? parseFloat((putVol3 / callVol3).toFixed(2)) : 0;
}

function sanitizeOpenClawResult(parsed, spotPrice, atr, symbol, atrMultiplier, indicators) {
  if (parsed.action !== 'CALL' && parsed.action !== 'PUT') {
    return parsed;
  }

  const {
    hourlyTrend,
    majorTrend,
    lastRsi,
    isVolumeSpiked,
    resistanceStrike,
    supportStrike,
    shortCoveringDetected,
    longUnwindingDetected,
    itmStrikeCall,
    itmStrikePut,
    pcr,
    pcrVelocity,
    isVPcrSpiked,
    vPcrDirection
  } = indicators;

  // --- LAYER 1: Multi-Timeframe Trend Alignment (Anchor Filter) ---
  if (parsed.strategyUsed === 'TREND_FOLLOWING') {
    if (parsed.action === 'CALL' && (hourlyTrend === 'BEARISH' || majorTrend === 'BEARISH')) {
      console.log(`[OpenClaw Filter] Blocked CALL signal on ${symbol} due to trend misalignment (1H: ${hourlyTrend}, 15m: ${majorTrend})`);
      parsed.action = 'WAIT';
      parsed.strategyUsed = 'SIT_OUT';
      parsed.summary = `[TREND FILTER BLOCK] CALL signal blocked because higher timeframe trends are BEARISH. Trend alignment required.`;
      clearOptionDetails(parsed);
      return parsed;
    }
    if (parsed.action === 'PUT' && (hourlyTrend === 'BULLISH' || majorTrend === 'BULLISH')) {
      console.log(`[OpenClaw Filter] Blocked PUT signal on ${symbol} due to trend misalignment (1H: ${hourlyTrend}, 15m: ${majorTrend})`);
      parsed.action = 'WAIT';
      parsed.strategyUsed = 'SIT_OUT';
      parsed.summary = `[TREND FILTER BLOCK] PUT signal blocked because higher timeframe trends are BULLISH. Trend alignment required.`;
      clearOptionDetails(parsed);
      return parsed;
    }
  }

  // --- LAYER 2: Support & Resistance Proximity Block ---
  const spotPriceNum = parseFloat(spotPrice);
  if (parsed.action === 'CALL' && resistanceStrike) {
    const resStrikeNum = parseFloat(resistanceStrike);
    const distPercent = (resStrikeNum - spotPriceNum) / spotPriceNum;
    if (spotPriceNum <= resStrikeNum && distPercent <= 0.0015 && !shortCoveringDetected) {
      console.log(`[OpenClaw Filter] Blocked CALL on ${symbol} due to Resistance Proximity (${resStrikeNum}, Spot: ${spotPriceNum})`);
      parsed.action = 'WAIT';
      parsed.strategyUsed = 'SIT_OUT';
      parsed.summary = `[RESISTANCE BLOCK] CALL blocked. Price is too close to major resistance strike (${resStrikeNum}). Waiting for a confirmed breakout.`;
      clearOptionDetails(parsed);
      return parsed;
    }
  }
  if (parsed.action === 'PUT' && supportStrike) {
    const supStrikeNum = parseFloat(supportStrike);
    const distPercent = (spotPriceNum - supStrikeNum) / spotPriceNum;
    if (spotPriceNum >= supStrikeNum && distPercent <= 0.0015 && !longUnwindingDetected) {
      console.log(`[OpenClaw Filter] Blocked PUT on ${symbol} due to Support Proximity (${supStrikeNum}, Spot: ${spotPriceNum})`);
      parsed.action = 'WAIT';
      parsed.strategyUsed = 'SIT_OUT';
      parsed.summary = `[SUPPORT BLOCK] PUT blocked. Price is too close to major support strike (${supStrikeNum}). Waiting for a confirmed breakdown.`;
      clearOptionDetails(parsed);
      return parsed;
    }
  }

  // --- LAYER 3: RSI Overbought/Oversold Filter ---
  const rsiVal = parseFloat(lastRsi);
  if (parsed.action === 'CALL' && rsiVal > 70) {
    console.log(`[OpenClaw Filter] Blocked CALL on ${symbol} due to Overbought RSI (${rsiVal})`);
    parsed.action = 'WAIT';
    parsed.strategyUsed = 'SIT_OUT';
    parsed.summary = `[RSI OVERBOUGHT BLOCK] CALL blocked. RSI is extremely overbought (${rsiVal.toFixed(1)}). Buying here is very high risk.`;
    clearOptionDetails(parsed);
    return parsed;
  }
  if (parsed.action === 'PUT' && rsiVal < 30) {
    console.log(`[OpenClaw Filter] Blocked PUT on ${symbol} due to Oversold RSI (${rsiVal})`);
    parsed.action = 'WAIT';
    parsed.strategyUsed = 'SIT_OUT';
    parsed.summary = `[RSI OVERSOLD BLOCK] PUT blocked. RSI is extremely oversold (${rsiVal.toFixed(1)}). Selling here is very high risk.`;
    clearOptionDetails(parsed);
    return parsed;
  }

  // --- LAYER 4: Volume Surge Validation (Breakout Confirm) ---
  if (parsed.strategyUsed === 'TREND_FOLLOWING' && !isVolumeSpiked) {
    console.log(`[OpenClaw Filter] Blocked Trend breakout on ${symbol} due to Normal Volume (No Spike)`);
    parsed.action = 'WAIT';
    parsed.strategyUsed = 'SIT_OUT';
    parsed.summary = `[VOLUME FILTER BLOCK] Trend entry blocked because volume is dry. Waiting for institutional volume surge to confirm direction.`;
    clearOptionDetails(parsed);
    return parsed;
  }

  // --- LAYER 5: Multi-Agent Consensus Voting ---
  let optionAgentVote = 'NEUTRAL';
  if (pcr > 1.15 || (pcrVelocity && pcrVelocity.includes('RISING'))) {
    optionAgentVote = 'BULLISH';
  } else if (pcr < 0.85 || (pcrVelocity && pcrVelocity.includes('FALLING'))) {
    optionAgentVote = 'BEARISH';
  }

  // Volume PCR Velocity confirm
  if (isVPcrSpiked) {
    if (vPcrDirection === 'UP') optionAgentVote = 'BULLISH';
    else if (vPcrDirection === 'DOWN') optionAgentVote = 'BEARISH';
  }

  let chartAgentVote = 'NEUTRAL';
  if (hourlyTrend === 'BULLISH' && rsiVal > 48) {
    chartAgentVote = 'BULLISH';
  } else if (hourlyTrend === 'BEARISH' && rsiVal < 52) {
    chartAgentVote = 'BEARISH';
  }

  let trendAgentVote = 'NEUTRAL';
  if (majorTrend === 'BULLISH') {
    trendAgentVote = 'BULLISH';
  } else if (majorTrend === 'BEARISH') {
    trendAgentVote = 'BEARISH';
  }

  if (parsed.action === 'CALL') {
    let bullishVotes = 0;
    if (optionAgentVote === 'BULLISH') bullishVotes++;
    if (chartAgentVote === 'BULLISH') bullishVotes++;
    if (trendAgentVote === 'BULLISH') bullishVotes++;

    let bearishVotes = 0;
    if (optionAgentVote === 'BEARISH') bearishVotes++;
    if (chartAgentVote === 'BEARISH') bearishVotes++;
    if (trendAgentVote === 'BEARISH') bearishVotes++;

    if (bullishVotes < 2 || bearishVotes > 0) {
      console.log(`[OpenClaw Filter] Blocked CALL on ${symbol} due to voting disagreement (Option: ${optionAgentVote}, Chart: ${chartAgentVote}, Trend: ${trendAgentVote})`);
      parsed.action = 'WAIT';
      parsed.strategyUsed = 'SIT_OUT';
      parsed.summary = `[CONSENSUS BLOCKED] CALL blocked. Disagreement between agents (Option: ${optionAgentVote}, Chart: ${chartAgentVote}, Trend: ${trendAgentVote}).`;
      clearOptionDetails(parsed);
      return parsed;
    }
  } else if (parsed.action === 'PUT') {
    let bearishVotes = 0;
    if (optionAgentVote === 'BEARISH') bearishVotes++;
    if (chartAgentVote === 'BEARISH') bearishVotes++;
    if (trendAgentVote === 'BEARISH') bearishVotes++;

    let bullishVotes = 0;
    if (optionAgentVote === 'BULLISH') bullishVotes++;
    if (chartAgentVote === 'BULLISH') bullishVotes++;
    if (trendAgentVote === 'BULLISH') bullishVotes++;

    if (bearishVotes < 2 || bullishVotes > 0) {
      console.log(`[OpenClaw Filter] Blocked PUT on ${symbol} due to voting disagreement (Option: ${optionAgentVote}, Chart: ${chartAgentVote}, Trend: ${trendAgentVote})`);
      parsed.action = 'WAIT';
      parsed.strategyUsed = 'SIT_OUT';
      parsed.summary = `[CONSENSUS BLOCKED] PUT blocked. Disagreement between agents (Option: ${optionAgentVote}, Chart: ${chartAgentVote}, Trend: ${trendAgentVote}).`;
      clearOptionDetails(parsed);
      return parsed;
    }
  }

  // --- Math Level Validation and Adjustments (Ensuring targets & stoplosses are in correct direction) ---
  const actualAtr = atr || 15;
  const mult = atrMultiplier || 1.5;
  
  let minSl = 25;
  let minTgt1 = 30;
  let minTgt2 = 60;

  if (symbol === 'BANKNIFTY') {
    minSl = 75;
    minTgt1 = 100;
    minTgt2 = 200;
  }

  const calculatedSlOffset = Math.max(minSl, mult * actualAtr);
  const calculatedTgt1Offset = Math.max(minTgt1, mult * actualAtr);
  const calculatedTgt2Offset = Math.max(minTgt2, 2 * calculatedTgt1Offset);

  if (parsed.action === 'CALL') {
    const maxAllowedSl = spotPriceNum - calculatedSlOffset;
    if (typeof parsed.stoploss !== 'number' || parsed.stoploss >= spotPriceNum || parsed.stoploss > maxAllowedSl) {
      parsed.stoploss = parseFloat(maxAllowedSl.toFixed(2));
    }

    const minAllowedTgt1 = spotPriceNum + calculatedTgt1Offset;
    if (typeof parsed.target1 !== 'number' || parsed.target1 <= spotPriceNum || parsed.target1 < minAllowedTgt1) {
      parsed.target1 = parseFloat(minAllowedTgt1.toFixed(2));
    }

    const minAllowedTgt2 = Math.max(parsed.target1 + 10, spotPriceNum + calculatedTgt2Offset);
    if (typeof parsed.target2 !== 'number' || parsed.target2 <= parsed.target1 || parsed.target2 < minAllowedTgt2) {
      parsed.target2 = parseFloat(minAllowedTgt2.toFixed(2));
    }
  } else if (parsed.action === 'PUT') {
    const minAllowedSl = spotPriceNum + calculatedSlOffset;
    if (typeof parsed.stoploss !== 'number' || parsed.stoploss <= spotPriceNum || parsed.stoploss < minAllowedSl) {
      parsed.stoploss = parseFloat(minAllowedSl.toFixed(2));
    }

    const maxAllowedTgt1 = spotPriceNum - calculatedTgt1Offset;
    if (typeof parsed.target1 !== 'number' || parsed.target1 >= spotPriceNum || parsed.target1 > maxAllowedTgt1) {
      parsed.target1 = parseFloat(maxAllowedTgt1.toFixed(2));
    }

    const maxAllowedTgt2 = Math.min(parsed.target1 - 10, spotPriceNum - calculatedTgt2Offset);
    if (typeof parsed.target2 !== 'number' || parsed.target2 >= parsed.target1 || parsed.target2 > maxAllowedTgt2) {
      parsed.target2 = parseFloat(maxAllowedTgt2.toFixed(2));
    }
  }

  // --- Option Level Sanitization ---
  if (parsed.suggestedOptionContract && typeof parsed.optionPremiumLtp === 'number' && parsed.optionPremiumLtp > 0) {
    const optionLtp = parseFloat(parsed.optionPremiumLtp);
    const contractLower = parsed.suggestedOptionContract.toLowerCase();
    const isItm = contractLower.includes('itm') || 
                  (parsed.action === 'CALL' && itmStrikeCall && parsed.suggestedOptionContract.includes(String(itmStrikeCall))) ||
                  (parsed.action === 'PUT' && itmStrikePut && parsed.suggestedOptionContract.includes(String(itmStrikePut)));
    const delta = isItm ? 0.6 : 0.5;

    const idxTgtDelta = Math.abs(parsed.target1 - spotPriceNum);
    const idxSlDelta = Math.abs(spotPriceNum - parsed.stoploss);

    const minOptTgt1 = optionLtp + delta * idxTgtDelta;
    if (typeof parsed.optionTarget1 !== 'number' || parsed.optionTarget1 <= optionLtp) {
      parsed.optionTarget1 = parseFloat(minOptTgt1.toFixed(2));
    }

    const minOptTgt2 = optionLtp + delta * Math.abs(parsed.target2 - spotPriceNum);
    if (typeof parsed.optionTarget2 !== 'number' || parsed.optionTarget2 <= parsed.optionTarget1) {
      parsed.optionTarget2 = parseFloat(Math.max(parsed.optionTarget1 + 5, minOptTgt2).toFixed(2));
    }

    const maxOptSl = Math.max(1.0, optionLtp - delta * idxSlDelta);
    if (typeof parsed.optionStoploss !== 'number' || parsed.optionStoploss >= optionLtp || parsed.optionStoploss <= 0) {
      parsed.optionStoploss = parseFloat(maxOptSl.toFixed(2));
    }
  }

  return parsed;
}

// Helper function for OpenClaw AI Multi-Agent Analysis
// Helper function for OpenClaw AI Multi-Agent Analysis
async function executeOpenClawAnalysis(symbol, expiry = null, weights = { pcrWeight: 40, chartWeight: 40, newsWeight: 20 }, profile = 'intraday_scalper', isBackground = false) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API Key missing in settings.');
  }

  const symbolStr = symbol || 'NIFTY';
  const settings = await getSystemSettings();
  const atrMultiplier = parseFloat(settings['stoploss_atr_multiplier']) || 1.5;

  // Fetch active pending signal for this symbol from SQLite DB (Memory Technique) - Only select from today (IST)
  const getActiveSignal = () => {
    return new Promise((resolve) => {
      db.get(
        `SELECT id, type, entry_price, target_price, stoploss_price, created_at 
         FROM ai_signals 
         WHERE symbol = ? AND status = 'PENDING' AND source = 'OPENCLAW'
           AND date(created_at, '+5.5 hours') = date('now', '+5.5 hours')
         ORDER BY id DESC LIMIT 1`,
        [symbolStr],
        (err, row) => {
          if (err) resolve(null);
          else resolve(row);
        }
      );
    });
  };

  const activeSignal = await getActiveSignal();
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
  const macd = calculateMACD(chartCandles); // MACD (12, 26, 9)
  const adxVal = calculateADX(chartCandles, 14);
  const bbVal = calculateBollingerBands(chartCandles, 20, 2);

  const lastAdx = adxVal;
  const lastBbUpper = bbVal.upper;
  const lastBbMiddle = bbVal.middle;
  const lastBbLower = bbVal.lower;

  const lastClose = chartCandles.length > 0 ? chartCandles[chartCandles.length - 1].close : spotPrice;
  const lastEma9 = ema9.length > 0 ? parseFloat(ema9[ema9.length - 1].toFixed(2)) : lastClose;
  const lastEma21 = ema21.length > 0 ? parseFloat(ema21[ema21.length - 1].toFixed(2)) : lastClose;
  const lastRsi = rsi.length > 0 ? parseFloat(rsi[rsi.length - 1].toFixed(2)) : 50;

  // Calculate Volume Surge (Latest volume vs 10-candle average volume)
  let isVolumeSpiked = false;
  let latestVolume = 0;
  let averageVolume = 0;
  if (chartCandles.length >= 10) {
    const last10 = chartCandles.slice(-10);
    const sumVol = last10.reduce((acc, c) => acc + (c.volume || 0), 0);
    averageVolume = Math.round(sumVol / 10);
    latestVolume = chartCandles[chartCandles.length - 1].volume || 0;
    if (averageVolume > 0 && latestVolume > 1.5 * averageVolume) {
      isVolumeSpiked = true;
    }
  }

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

  const isShortTermBullish = lastEma9 > lastEma21 && lastClose > lastEma21;
  const isShortTermBearish = lastEma9 < lastEma21 && lastClose < lastEma21;

  // Get last 15 candles for Price Action analysis by Gemini
  const last15Candles = [];
  const startCandleIdx = Math.max(0, chartCandles.length - 15);
  for (let i = startCandleIdx; i < chartCandles.length; i++) {
    const c = chartCandles[i];
    let timeStr = '';
    if (typeof c.time === 'number') {
      timeStr = new Date(parseDhanTimestamp(c.time) * 1000).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
    } else {
      timeStr = c.time;
    }
    last15Candles.push({
      time: timeStr,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume
    });
  }
  const last15CandlesStr = JSON.stringify(last15Candles, null, 2);

  // Multi-Timeframe Trend Concurrence Check
  let trendConcurrence = "MISALIGNED";
  if (isShortTermBullish && majorTrend === "BULLISH" && hourlyTrend === "BULLISH") {
    trendConcurrence = "STRONG_BULLISH";
  } else if (isShortTermBearish && majorTrend === "BEARISH" && hourlyTrend === "BEARISH") {
    trendConcurrence = "STRONG_BEARISH";
  } else if ((isShortTermBullish && majorTrend === "BULLISH") || (isShortTermBullish && hourlyTrend === "BULLISH")) {
    trendConcurrence = "MODERATE_BULLISH";
  } else if ((isShortTermBearish && majorTrend === "BEARISH") || (isShortTermBearish && hourlyTrend === "BEARISH")) {
    trendConcurrence = "MODERATE_BEARISH";
  }

  // Calculate current PCR
  let totalCallOi = 0;
  let totalPutOi = 0;
  strikesArray.forEach(s => {
    totalCallOi += s.callOi || 0;
    totalPutOi += s.putOi || 0;
  });
  const pcr = totalCallOi > 0 ? parseFloat((totalPutOi / totalCallOi).toFixed(2)) : 0;

  // Calculate current PCVR (Put-Call Volume Ratio)
  let totalCallVolume = 0;
  let totalPutVolume = 0;
  strikesArray.forEach(s => {
    totalCallVolume += s.callVolume || 0;
    totalPutVolume += s.putVolume || 0;
  });
  const pcvr = totalCallVolume > 0 ? parseFloat((totalPutVolume / totalCallVolume).toFixed(2)) : 0;

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

  const getHistoricalOptionChain15m = () => {
    return new Promise((resolve) => {
      db.get(
        `SELECT data FROM option_chain_history 
         WHERE symbol = ? AND timestamp <= datetime('now', '-15 minutes') 
         ORDER BY timestamp DESC LIMIT 1`,
        [symbolStr],
        (err, row) => {
          if (err || !row) {
            resolve(null);
          } else {
            try {
              resolve(JSON.parse(row.data));
            } catch (e) {
              resolve(null);
            }
          }
        }
      );
    });
  };

  const getHistoricalOptionChain1m = () => {
    return new Promise((resolve) => {
      db.get(
        `SELECT data FROM option_chain_history 
         WHERE symbol = ? AND timestamp <= datetime('now', '-1 minute') 
         ORDER BY timestamp DESC LIMIT 1`,
        [symbolStr],
        (err, row) => {
          if (err || !row) {
            resolve(null);
          } else {
            try {
              resolve(JSON.parse(row.data));
            } catch (e) {
              resolve(null);
            }
          }
        }
      );
    });
  };

  const historicalPcrs = await getHistoricalPcrs();
  const oldStrikesArray = await getHistoricalOptionChain15m();
  const oldStrikesArray1m = await getHistoricalOptionChain1m();

  let smartMoneyDetails = "Not enough historical data to calculate 15-minute institutional build-up.";
  let smartMoneySentiment = "NEUTRAL";
  let freshResistanceWall15m = "N/A";
  let freshSupportWall15m = "N/A";
  let total15mCallOiChange = 0;
  let total15mPutOiChange = 0;
  let smartMoneyUnwindingWarning = "No panic detected.";

  if (oldStrikesArray && oldStrikesArray.length > 0 && strikesArray && strikesArray.length > 0) {
    const changes15m = [];
    let maxCallWritingChg = -Infinity;
    let maxPutWritingChg = -Infinity;
    let maxCallUnwindingChg = Infinity;
    let maxPutUnwindingChg = Infinity;

    let resStrike15m = null;
    let supStrike15m = null;
    let callPanicStrike15m = null;
    let putPanicStrike15m = null;

    const atmObjTmp = strikesArray.reduce((prev, curr) => 
      Math.abs(curr.strike - spotPrice) < Math.abs(prev.strike - spotPrice) ? curr : prev
    );
    const atmStrikeVal = atmObjTmp.strike;
    const atmIndexTmp = strikesArray.findIndex(s => s.strike === atmStrikeVal);

    if (atmIndexTmp !== -1) {
      const startIndex = Math.max(0, atmIndexTmp - 5);
      const endIndex = Math.min(strikesArray.length - 1, atmIndexTmp + 5);

      for (let i = startIndex; i <= endIndex; i++) {
        const currStrike = strikesArray[i];
        const oldStrike = oldStrikesArray.find(s => s.strike === currStrike.strike);
        
        if (oldStrike) {
          const callOiChg = currStrike.callOi - oldStrike.callOi;
          const putOiChg = currStrike.putOi - oldStrike.putOi;
          
          total15mCallOiChange += callOiChg;
          total15mPutOiChange += putOiChg;

          changes15m.push({
            strike: currStrike.strike,
            callOiChg,
            putOiChg,
            currCallOi: currStrike.callOi,
            currPutOi: currStrike.putOi
          });

          if (callOiChg > maxCallWritingChg) {
            maxCallWritingChg = callOiChg;
            resStrike15m = currStrike.strike;
          }
          if (putOiChg > maxPutWritingChg) {
            maxPutWritingChg = putOiChg;
            supStrike15m = currStrike.strike;
          }

          if (callOiChg < 0 && callOiChg < maxCallUnwindingChg) {
            maxCallUnwindingChg = callOiChg;
            callPanicStrike15m = currStrike.strike;
          }
          if (putOiChg < 0 && putOiChg < maxPutUnwindingChg) {
            maxPutUnwindingChg = putOiChg;
            putPanicStrike15m = currStrike.strike;
          }
        }
      }
    }

    if (changes15m.length > 0) {
      const thresholdUnwinding = -10000;
      let isCallPanic = maxCallUnwindingChg < thresholdUnwinding;
      let isPutPanic = maxPutUnwindingChg < thresholdUnwinding;

      if (isCallPanic && isPutPanic) {
        smartMoneySentiment = "SIDEWAYS_UNWINDING";
        smartMoneyUnwindingWarning = "⚠️ BOTH Call & Put writers are covering. High volatility chop.";
      } else if (isCallPanic) {
        smartMoneySentiment = "SHORT_COVERING_PANIC";
        smartMoneyUnwindingWarning = `⚠️ Call writers covering in panic at strike ${callPanicStrike15m} (Change: ${maxCallUnwindingChg}). Upward squeeze breakout expected!`;
      } else if (isPutPanic) {
        smartMoneySentiment = "LONG_UNWINDING_PANIC";
        smartMoneyUnwindingWarning = `⚠️ Put writers covering in panic at strike ${putPanicStrike15m} (Change: ${maxPutUnwindingChg}). Downward breakdown expected!`;
      } else {
        if (total15mPutOiChange > total15mCallOiChange && total15mPutOiChange > 0) {
          smartMoneySentiment = "BULLISH_BUILDUP";
        } else if (total15mCallOiChange > total15mPutOiChange && total15mCallOiChange > 0) {
          smartMoneySentiment = "BEARISH_BUILDUP";
        } else {
          smartMoneySentiment = "NEUTRAL";
        }
      }

      freshResistanceWall15m = resStrike15m && maxCallWritingChg > 0 ? `${resStrike15m} (Added: +${maxCallWritingChg})` : "None";
      freshSupportWall15m = supStrike15m && maxPutWritingChg > 0 ? `${supStrike15m} (Added: +${maxPutWritingChg})` : "None";

      smartMoneyDetails = changes15m.map(c => 
        `  * Strike ${c.strike}: Call OI 15m Change = ${c.callOiChg >= 0 ? '+' : ''}${c.callOiChg}, Put OI 15m Change = ${c.putOiChg >= 0 ? '+' : ''}${c.putOiChg} (Current Call OI: ${c.currCallOi}, Current Put OI: ${c.currPutOi})`
      ).join('\n');
    }
  }

  // Calculate Cumulative OI Delta Divergence (Trap Filter)
  const intervalMin = parseInt(primaryInterval, 10) || 5;
  const lookbackCount = Math.round(15 / intervalMin) || 3;
  let price15mAgo = spotPrice;
  if (chartCandles.length > lookbackCount) {
    price15mAgo = chartCandles[chartCandles.length - 1 - lookbackCount].close;
  } else if (chartCandles.length > 0) {
    price15mAgo = chartCandles[0].close;
  }

  const priceChange15m = spotPrice - price15mAgo;
  const cumulativeOiDelta15m = total15mPutOiChange - total15mCallOiChange;
  
  const divThreshold = symbolStr.includes('BANKNIFTY') ? 30000 : 50000;
  let oiDivergenceStatus = "NO_DIVERGENCE";

  if (priceChange15m > 0.001 * spotPrice && cumulativeOiDelta15m < -divThreshold) {
    oiDivergenceStatus = "BULL_TRAP_WARNING";
  } else if (priceChange15m < -0.001 * spotPrice && cumulativeOiDelta15m > divThreshold) {
    oiDivergenceStatus = "BEAR_TRAP_WARNING";
  }

  // ── Market Regime Detection (TRENDING vs CHOPPY) ──────────────────────────────
  // Uses ATR-based analysis: if candles are small relative to ATR, market is choppy
  let marketRegime = "UNKNOWN";
  let choppinessScore = 0;
  if (chartCandles.length >= 10) {
    const last10 = chartCandles.slice(-10);
    // Directional Efficiency Ratio: net move / sum of individual candle moves
    const netMove = Math.abs(last10[last10.length - 1].close - last10[0].open);
    const totalMove = last10.reduce((sum, c) => sum + Math.abs(c.close - c.open), 0);
    const efficiencyRatio = totalMove > 0 ? netMove / totalMove : 0;
    // High Efficiency = Trending, Low Efficiency = Choppy/Sideways
    choppinessScore = Math.round((1 - efficiencyRatio) * 100);
    
    // Combine ADX and Efficiency Ratio for more accurate sideways market classification
    if (adxVal < 20) {
      marketRegime = "CHOPPY";
      choppinessScore = Math.max(choppinessScore, 75); // Ensure high choppiness when ADX is very low
    } else if (adxVal >= 25 && efficiencyRatio >= 0.4) {
      marketRegime = "TRENDING";
    } else if (efficiencyRatio >= 0.5) {
      marketRegime = "TRENDING";
    } else if (efficiencyRatio >= 0.25 || adxVal >= 20) {
      marketRegime = "MIXED";
    } else {
      marketRegime = "CHOPPY";
    }
  }

  // Calculate PCR Velocity
  let pcrVelocity = "STABLE";
  if (historicalPcrs.length >= 2) {
    const oldest = historicalPcrs[historicalPcrs.length - 1];
    const newest = pcr;
    const diff = newest - oldest;
    if (diff > 0.05) {
      pcrVelocity = "RISING_FAST";
    } else if (diff < -0.05) {
      pcrVelocity = "FALLING_FAST";
    } else if (diff > 0.01) {
      pcrVelocity = "RISING_MODERATE";
    } else if (diff < -0.01) {
      pcrVelocity = "FALLING_MODERATE";
    }
  }

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
  let atm3Pcr = 0;
  let atm3Vpcr = 0;
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
  let isVPcrSpiked = false;
  let vPcrDirection = 'NEUTRAL';
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
    
    // Calculate ATM ±3 Strikes PCR & VPCR
    if (atmIndex !== -1) {
      let callOi3 = 0;
      let putOi3 = 0;
      let callVol3 = 0;
      let putVol3 = 0;

      const startIdx = Math.max(0, atmIndex - 3);
      const endIdx = Math.min(strikesArray.length - 1, atmIndex + 3);

      for (let i = startIdx; i <= endIdx; i++) {
        callOi3 += strikesArray[i].callOi || 0;
        putOi3 += strikesArray[i].putOi || 0;
        callVol3 += strikesArray[i].callVolume || 0;
        putVol3 += strikesArray[i].putVolume || 0;
      }

      atm3Pcr = callOi3 > 0 ? parseFloat((putOi3 / callOi3).toFixed(2)) : 0;
      atm3Vpcr = callVol3 > 0 ? parseFloat((putVol3 / callVol3).toFixed(2)) : 0;
    }

    // Volume PCR Velocity Trigger (ATM ±3 Strikes, 1-minute lookback)
    if (oldStrikesArray1m && oldStrikesArray1m.length > 0) {
      const oldAtm3Vpcr1m = calculateAtm3Vpcr(oldStrikesArray1m, spotPrice);
      if (oldAtm3Vpcr1m > 0) {
        const vPcrSpeed = (atm3Vpcr - oldAtm3Vpcr1m) / oldAtm3Vpcr1m;
        if (Math.abs(vPcrSpeed) >= 0.20) {
          isVPcrSpiked = true;
          vPcrDirection = vPcrSpeed > 0 ? 'UP' : 'DOWN';
        }
      }
    }
    
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
          putOi: strikeData.putOi || 0,
          callVolume: strikeData.callVolume || 0,
          putVolume: strikeData.putVolume || 0,
          callLtp: strikeData.callLtp || 0,
          putLtp: strikeData.putLtp || 0
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
    `  * Strike ${s.strike}: Call ChgOI = ${s.callChgOi}, Put ChgOI = ${s.putChgOi} (Call TotalOI = ${s.callOi}, Put TotalOI = ${s.putOi}), Call Vol = ${s.callVolume}, Put Vol = ${s.putVolume}, Call LTP = ${s.callLtp}, Put LTP = ${s.putLtp}`
  ).join('\n');

  // Fetch Live Financial News Headlines
  let headlines = [];
  try {
    headlines = await fetchRecentFinancialNews();
  } catch (err) {
    console.error('Failed to parse financial news headlines for LLM prompt:', err.message);
  }

  // 4. Construct Multi-Agent Prompt (Including Active Trade Memory check)
  let memorySection = "";
  if (activeSignal) {
    memorySection = `
*ACTIVE TRADE MEMORY (ACTIVE STATE):*
- There is currently a PENDING trade running for ${symbolStr} from a previous alert:
  * Type: ${activeSignal.type} (Buy ${activeSignal.type})
  * Entry Spot Price: ${activeSignal.entry_price}
  * Target Spot Price: ${activeSignal.target_price}
  * Stoploss Spot Price: ${activeSignal.stoploss_price}
  * Opened at: ${activeSignal.created_at}

*INSTRUCTIONS FOR MANAGING ACTIVE TRADE:*
- Since a trade is already active, evaluate if we should:
  1. "WAIT" (Keep holding the trade, no change needed).
  2. "CALL" or "PUT" (Only if the trend has completely reversed and you want to close this trade and enter a fresh opposite trade).
  3. "WAIT" but suggest a Trailing Stoploss in the "trailingStoploss" field (e.g. "Trail stoploss to cost price" or "Trail stoploss to X").
- If the current spot price (\${spotPrice}) has crossed the active target or stoploss, or if you decide it's time to exit early due to trend change, explain this in your reasoning and thoughts.
`;
  }

  const prompt = `You are the 'OpenClaw AI Agent Hub Orchestrator'. You manage three sub-agents to analyze the NIFTY/BANKNIFTY market and issue high-accuracy trading alerts:
1. **Option Chain Agent**: Analyzes PCR, PCR change velocity, and Call/Put Open Interest blocks (resistance and support). You MUST thoroughly inspect the "Full 20-Strike Change in OI Activity (ATM ±10 strikes)" data to detect where the heavy call writing (bearish ceiling) or heavy put writing (bullish floor) is concentrating, and check if call unwinding (short covering) or put unwinding (long liquidation) is occurring near the ATM strike. Furthermore, inspect the "15-Minute Institutional Smart Money OI Activity" to see what the big players (FII/DII option writers) have been doing in the last 15 minutes. Focus heavily on "Smart Money Unwinding Panic Alerts" — if Call writers are in panic at a strike, it is a strong bullish breakout sign; if Put writers are in panic, it is a strong bearish breakdown sign. Ensure your signal aligns with the direction of the big players' panic or fresh build-ups.
2. **Chart Pattern Agent**: Analyzes trend direction (using EMA 9/21 crossover), momentum (using RSI), and price action patterns (support/resistance breakout, double tops/bottoms, candlestick structures like engulfing/pin-bars) from the "Last 15 Candles" list provided in the data.
3. **News Sentiment Agent**: Analyzes the recent financial news headlines and scores the market mood as BULLISH, BEARISH, or NEUTRAL.

You must weight their importance according to the weights assigned by the user:
- Option Chain Agent weight: ${weights.pcrWeight}%
- Chart Pattern Agent weight: ${weights.chartWeight}%
- News Sentiment Agent weight: ${weights.newsWeight}%

*CRITICAL RULES FOR NEWS SENTIMENT & SAFEGUARDS:*
- If News Sentiment Agent weight is greater than 0, and you detect a major risk/panic headline (e.g. GDP contraction, war escalation, high interest rate warnings, massive index crashes, inflation surge), you MUST trigger the safety protocol: force "action" to "WAIT" and set "confidence" lower, prioritizing safety over indicators.

*HIGH QUALITY TRADE SAFEGUARDS (Strict Accuracy Filters):*
- Never recommend "CALL" if Cumulative OI Delta Divergence Status is "BULL_TRAP_WARNING" (Price rising but institutional sellers are writing Calls heavily, signalling a trap).
- Never recommend "PUT" if Cumulative OI Delta Divergence Status is "BEAR_TRAP_WARNING" (Price falling but institutional sellers are writing Puts heavily, signalling a trap).
- Never recommend "CALL" if the spot price is within 0.15% below the Strongest Resistance Strike (e.g. if Resistance is 23200, Nifty Spot must NOT be between 23165 and 23200) unless active Call Unwinding (Short Covering) is detected.
- Never recommend "PUT" if the spot price is within 0.15% above the Strongest Support Strike (e.g. if Support is 23100, Nifty Spot must NOT be between 23100 and 23135) unless active Put Unwinding (Long Unwinding) is detected.
- If ATM Implied Volatility (IV) is exceptionally high (NIFTY > 18%, BANKNIFTY/FINNIFTY/MIDCPNIFTY > 22%), option premiums are overpriced. Significantly reduce confidence score or recommend "WAIT" to protect the user from Volatility Crush (Vega decay).
- Prioritize breakout setups that are accompanied by a Volume Surge ("YES"). If volume is low or trend indicators conflict, prefer "WAIT".
- Keep trade quality extremely high. It is better to recommend "WAIT" and skip a trade than to suggest a low-probability entry.

- **MARKET REGIME & STRATEGY SELECTION RULES (Critical)**: You are provided with Market Regime data and indicators like ADX and Bollinger Bands. You MUST choose the correct strategy:
  * **TREND_FOLLOWING Strategy**: Use this when Market Regime is "TRENDING" (ADX >= 22 & Choppiness Score <= 55) or when ADX is rising above 25. Standard trend momentum rules apply. Set \`"strategyUsed"\` to \`"TREND_FOLLOWING"\`.
  * **RANGE_BOUND_MEAN_REVERSION Strategy**: Use this when Market Regime is "CHOPPY" (ADX < 20 or Choppiness Score > 55). Under this strategy:
    - Do NOT chase breakouts or crossovers. Instead, buy calls near support and buy puts near resistance.
    - Suggest "CALL" ONLY when:
      1. Spot Price is at or very close to Lower Bollinger Band (within 0.1%).
      2. AND RSI is oversold/low (< 40).
      3. AND price is near the Strongest Support Strike.
      - Target 1: Middle Bollinger Band or ATM Strike.
      - Stoploss: Tight (10-15 Nifty points, 30-40 BankNifty points) just below Lower Bollinger Band or Support.
    - Suggest "PUT" ONLY when:
      1. Spot Price is at or very close to Upper Bollinger Band (within 0.1%).
      2. AND RSI is overbought/high (> 60).
      3. AND price is near the Strongest Resistance Strike.
      - Target 1: Middle Bollinger Band or ATM Strike.
      - Stoploss: Tight (10-15 Nifty points, 30-40 BankNifty points) just above Upper Bollinger Band or Resistance.
    - Set \`"strategyUsed"\` to \`"RANGE_BOUND_MEAN_REVERSION"\` for these trades.
    - If none of these conditions are met, output "WAIT" with \`"strategyUsed"\` to \`"SIT_OUT"\`.
  * **MIXED Regime**: If ADX is between 20-22 or Choppiness is between 40-55, you can use either strategy but you must have high confirmation (confidence > 80%). If wait, set \`"strategyUsed"\` to \`"SIT_OUT"\`.

*MULTI-TIMEFRAME TREND CONFIRMATION & ALIGNMENT:*
- You are provided with a 1-Hour chart trend confirmation ("hourlyTrend"): "${hourlyTrend}".
- Ideally:
  * For a CALL trade (Bullish setup), the 1-Hour trend should be BULLISH.
  * For a PUT trade (Bearish setup), the 1-Hour trend should be BEARISH.
- If the primary chart indicators suggest a trade but the 1-Hour trend conflicts (e.g., trying to buy Call when 1-Hour trend is BEARISH, or trying to buy Put when 1-Hour trend is BULLISH), you should be highly conservative: either output "WAIT" or significantly reduce the "confidence" score (e.g., below 65%). Explain this alignment decision in your thoughts.

*INDEX TARGET & STOPLOSS GUIDELINES:*
- You must calculate realistic and noise-tolerant targets and stoplosses for the index (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY).
- STRUCTURE-BASED STOPLOSS (SL Hunting Protection): Place stoplosses relative to structural support/resistance levels rather than arbitrary math points:
  * For CALL trades (Bullish setup): Set stoploss 3-5 Nifty points (15-20 Banknifty points) BELOW the Lower Bollinger Band or Strongest Support Strike or recent swing low (whichever is closer below entry), adding this safety cushion to prevent SL hunting wicks.
  * For PUT trades (Bearish setup): Set stoploss 3-5 Nifty points (15-20 Banknifty points) ABOVE the Upper Bollinger Band or Strongest Resistance Strike or recent swing high, adding this safety cushion.
- Enforce the absolute minimum boundaries:
  * NIFTY: Stoploss must be at least ${atrMultiplier} * ATR (minimum 25 points). Target 1 must be at least ${atrMultiplier} * ATR to 2 * ATR (minimum 30 points) from entry. Target 2 must be at least 60 points.
  * BANKNIFTY: Stoploss must be at least ${atrMultiplier} * ATR (minimum 75 points). Target 1 must be at least ${atrMultiplier} * ATR to 2 * ATR (minimum 100 points). Target 2 must be at least 200 points.
  * FINNIFTY: Stoploss must be at least ${atrMultiplier} * ATR (minimum 30 points). Target 1 must be at least 40 points. Target 2 must be at least 80 points.
  * MIDCPNIFTY: Stoploss must be at least ${atrMultiplier} * ATR (minimum 20 points). Target 1 must be at least 25 points. Target 2 must be at least 50 points.
- Ensure that the Risk-to-Reward Ratio is healthy (minimum 1:1.2, ideally 1:1.5 or higher). Never set a target or stoploss closer than the minimum boundaries defined above.

*SCALPER FOCUS & HOLDS:*
- The user is an active scalper who holds positions for 10 to 60 minutes max.
- The 1-Hour chart represents the major trend anchor, the 15-minute chart represents the mid-term trend bias, and the 5-minute/3-minute chart represents the execution trigger.
- When generating targets and stoplosses, keep them optimized for a 10 - 60 minute holding duration. Avoid setting massive targets (like 150+ points for Nifty) that require days to hit. Instead, focus on capture-and-exit: Target 1 should be a quick intraday swing target reachable within the next few candles, and Stoploss should protect the scalp.

*OPTION TRADING LEVEL SELECTION & HOLDS:*
- If you decide to issue a "CALL" alert:
  * Select either the suggested ATM or ITM CALL Option contract (ATM: "${atmCallName}", ITM: "${itmCallName}"). Set \`"suggestedOptionContract"\` to its contract name and \`"optionPremiumLtp"\` to its LTP.
  * Estimate option target premiums (\`"optionTarget1"\`, \`"optionTarget2"\`) and option stoploss (\`"optionStoploss"\`). Use delta-based scaling: option target/stoploss change should be roughly \`~0.50 * index change\` for ATM and \`~0.60 * index change\` for ITM (e.g., if target1 is index spot + 40 points, option target1 = option LTP + 0.5 * 40 = option LTP + 20).
- If you decide to issue a "PUT" alert, do the same using the Put option contracts (ATM: "${atmPutName}", ITM: "${itmPutName}").
- If you issue "WAIT", set \`"suggestedOptionContract"\`, \`"optionPremiumLtp"\`, \`"optionTarget1"\`, \`"optionTarget2"\`, and \`"optionStoploss"\` to null.
- Set \`"expectedHoldTime"\` to a clear estimated holding duration string (e.g. \`"5 - 15 minutes"\` for micro scalping profiles, \`"15 - 30 minutes"\` for standard scalping, \`"1 - 2 hours"\` for short-term trends). Base this on indicators strength, trend support, and the active profile: "${profile}".

*TRAILING STOPLOSS RULES:*
- You MUST provide explicit rules on when and how to trail the stoploss in the \`"trailingStoploss"\` field (e.g., "Trail stoploss to cost price once Target 1 is hit, then trail by 15 points for every 20 points spot movement", or "Trail by 10 points for every 15 points gain in option premium"). Make the trailing stoploss rules highly practical for active scalping/trading.

${memorySection}

Data for ${symbolStr}:
- Current Spot Price: ${spotPrice}
- Current PCR (Full Option Chain): ${pcr}
- Current PCVR (Put-Call Volume Ratio - Full Chain): ${pcvr}
- ATM ±3 Strikes PCR: ${atm3Pcr} (Highly sensitive Put/Call Open Interest ratio for FII/DII activity)
- ATM ±3 Strikes Volume PCR: ${atm3Vpcr} (Put-Call Volume Ratio for immediate momentum confirmation)
- PCR values for last few minutes (newest to oldest): ${historicalPcrs.map(v => v.toFixed(2)).join(', ')}
- Last 15 Candles (${primaryInterval}-minute interval):
${last15CandlesStr}

- Technical indicators (${primaryInterval}m timeframe):
  * EMA 9: ${lastEma9}
  * EMA 21: ${lastEma21}
  * Price vs EMA 9: ${lastClose > lastEma9 ? 'Above EMA 9' : 'Below EMA 9'}
  * EMA Crossover Status: ${lastEma9 > lastEma21 ? 'EMA 9 is above EMA 21 (Bullish Trend)' : 'EMA 9 is below EMA 21 (Bearish Trend)'}
  * RSI (14): ${lastRsi} (${lastRsi > 70 ? 'Overbought' : lastRsi < 30 ? 'Oversold' : 'Neutral'})
  * ATR (14): ${atr.toFixed(2)}
  * ADX (14): ${lastAdx} (${lastAdx < 20 ? 'Weak/Sideways Trend' : lastAdx > 25 ? 'Strong Trend' : 'Normal Trend'})
  * Bollinger Bands (20, 2): Upper = ${lastBbUpper}, Middle = ${lastBbMiddle}, Lower = ${lastBbLower} (Current Spot is ${spotPrice})
  * MACD Line (12,26): ${macd.macdLine} | Signal Line (9): ${macd.signalLine} | Histogram: ${macd.histogram}
  * MACD Crossover Status: ${macd.crossover} (${macd.crossover === 'BULLISH_CROSSOVER' ? 'FRESH BUY SIGNAL — strong bullish momentum just triggered' : macd.crossover === 'BEARISH_CROSSOVER' ? 'FRESH SELL SIGNAL — strong bearish momentum just triggered' : macd.crossover === 'BULLISH' ? 'MACD above Signal — bullish momentum ongoing' : macd.crossover === 'BEARISH' ? 'MACD below Signal — bearish momentum ongoing' : 'Neutral'})
  * MACD Histogram Trend: ${macd.histogramTrend} (${macd.histogramTrend === 'EXPANDING_BULLISH' ? 'Buying pressure INCREASING — strong upward momentum' : macd.histogramTrend === 'SHRINKING_BULLISH' ? 'Buying pressure WEAKENING — potential reversal or slowdown ahead' : macd.histogramTrend === 'EXPANDING_BEARISH' ? 'Selling pressure INCREASING — strong downward momentum' : macd.histogramTrend === 'SHRINKING_BEARISH' ? 'Selling pressure WEAKENING — potential bullish reversal ahead' : 'No clear momentum direction'})
  * MACD Zero Line: ${macd.aboveZero ? 'ABOVE ZERO — in bullish territory overall' : 'BELOW ZERO — in bearish territory overall'}
  * Major Trend (${trendTimeframe} timeframe filter): ${majorTrend}
  * 1-Hour Chart Trend filter: ${hourlyTrend} (EMA 20 at ${lastHourEma20}, Price at ${lastHourClose})
  * Multi-Timeframe Trend Concurrence: ${trendConcurrence} (Short-term, Mid-term, and Higher-term alignment check)
  * Volume Surge (Latest candle vol vs 10-period Avg Vol): ${isVolumeSpiked ? 'YES (Volume spike detected)' : 'NO (Normal volume)'} (Latest Vol: ${latestVolume}, Avg Vol: ${averageVolume})
  * PCR Velocity (OI Change direction): ${pcrVelocity}
  * Market Regime (last 10 candles): ${marketRegime} (Choppiness Score: ${choppinessScore}/100 — Higher = More Choppy/Sideways)

- 15-Minute Institutional Smart Money OI Activity:
  * Smart Money Sentiment (15m): ${smartMoneySentiment}
  * Smart Money Unwinding Panic Alert: ${smartMoneyUnwindingWarning}
  * Fresh Resistance Wall Build-up (15m): ${freshResistanceWall15m}
  * Fresh Support Wall Build-up (15m): ${freshSupportWall15m}
  * Cumulative OI Delta (15m): ${cumulativeOiDelta15m} (Put OI Change - Call OI Change)
  * Spot Price Change (15m): ${priceChange15m.toFixed(2)} (Current Spot: ${spotPrice}, 15m ago: ${price15mAgo.toFixed(2)})
  * Cumulative OI Delta Divergence Status: ${oiDivergenceStatus}
  * Strike-by-Strike 15m OI changes details:
${smartMoneyDetails}

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
  "strategyUsed": "TREND_FOLLOWING" | "RANGE_BOUND_MEAN_REVERSION" | "SIT_OUT",
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
  "activeTradeAction": "HOLD" | "EXIT_EARLY" | "TRAIL_SL",
  "newStoploss": <number> | null,
  "agentThoughts": {
    "optionChainAgent": "<Ultra-short Hinglish status, max 7 words. Example: 'PCR neutral, call writing heavy.'>",
    "chartAgent": "<Ultra-short Hinglish status, max 7 words. Example: 'RSI oversold, support active.'>",
    "newsAgent": "<Ultra-short Hinglish status, max 7 words. Example: 'Global news neutral.'>",
    "riskOrchestrator": "<Ultra-short Hinglish status, max 7 words. Example: 'Strict SL set near support.'>"
  },
  "reasoning": [
    "<Single short sentence in Hinglish explaining key trade reason, max 10 words. Must provide EXACTLY 1 bullet point here. Example: 'EMA crossover and high option support.'>"
  ],
  "summary": "<Single short sentence Hinglish summary, max 12 words. Example: 'CALL setup above EMA9, keep strict SL.'>"
}

INSTRUCTIONS FOR WRITING:
- Write the agent thoughts, reasoning, and summary as ultra-short, concise sentences or phrases in friendly Hinglish (using English alphabet, e.g. 'Market strong bullish trend me hai').
- STRICT LIMITS: agentThoughts fields must be max 7 words each. The reasoning array must contain EXACTLY 1 bullet point of max 10 words. The summary field must be max 12 words.
- ACTIVE TRADE EVALUATION (if there is an active trade running in Active Trade Memory):
  * If the trend has reversed (e.g. opposite EMA crossovers, Smart Money unwinding, or trap warning indicators conflicting), set \`activeTradeAction\` to \`EXIT_EARLY\` to exit immediately.
  * If the price has moved significantly in our direction (e.g. Nifty +20 pts, Banknifty +50 pts from entry), set \`activeTradeAction\` to \`TRAIL_SL\` and calculate a smart trailing stoploss (e.g. trailing to entry price to make it a risk-free trade, or trailing to the Middle Bollinger Band/swing low) and write that trailing spot price in \`newStoploss\`.
  * If the trade is normal and no exit or trail is needed, set \`activeTradeAction\` to \`HOLD\` and \`newStoploss\` to null.
  * If there is no active trade in Active Trade Memory, default \`activeTradeAction\` to \`HOLD\` and \`newStoploss\` to null.
- Do NOT write long paragraphs, greetings, or descriptions. Be extremely brief to conserve tokens.
- Do NOT use Hindi script (like नमस्ते or बाज़ार).
- Ensure all numbers (target1, target2, stoploss, optionPremiumLtp, optionTarget1, optionTarget2, optionStoploss, newStoploss) are valid numbers.
- Do NOT wrap in backticks or code blocks. Just output the clean JSON object.`;

  // Pre-filtering check bypassed by user request to ensure Gemini is called on every interval
  if (isBackground) {
    console.log(`[OpenClaw Background] Pre-filtering safeguard is bypassed. Executing Gemini API analysis for ${symbolStr}...`);
  }

  // 5. Call Gemini (using the user-configured model, defaulting to gemini-2.5-flash)
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
  const geminiResponse = await callGeminiWithRetry(geminiUrl, {
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

  // Apply a default for strategyUsed if not parsed correctly
  if (!parsedResult.strategyUsed) {
    if (parsedResult.action === 'WAIT') {
      parsedResult.strategyUsed = 'SIT_OUT';
    } else {
      parsedResult.strategyUsed = 'TREND_FOLLOWING';
    }
  }

  // 5-Layer Algorithmic Filtration and level correction
  parsedResult = sanitizeOpenClawResult(parsedResult, spotPrice, atr, symbolStr, atrMultiplier, {
    hourlyTrend,
    majorTrend,
    lastRsi,
    isVolumeSpiked,
    resistanceStrike: resistanceStrike ? resistanceStrike.strike : null,
    supportStrike: supportStrike ? supportStrike.strike : null,
    shortCoveringDetected,
    longUnwindingDetected,
    itmStrikeCall,
    itmStrikePut
  });

  // Apply Strict Trend Filter and Unwinding safeguards on the parsed result
  const isStrictTrendFilterEnabled = settings['strict_trend_filter'] !== 'false';
  
  if (isStrictTrendFilterEnabled && !activeSignal) {
    // ── CHOPPY MARKET SAFEGUARD (Most Important Filter) ──────────────────
    // If market is CHOPPY (sideways), block all trade signals — except if Range Scalping (mean reversion) strategy is specifically used!
    if ((parsedResult.action === 'CALL' || parsedResult.action === 'PUT') && 
        marketRegime === 'CHOPPY' && 
        choppinessScore > 75 && 
        parsedResult.strategyUsed !== 'RANGE_BOUND_MEAN_REVERSION') {
      console.log(`[OpenClaw Safeguard] Blocking ${parsedResult.action} signal for ${symbolStr} — Market is CHOPPY (Score: ${choppinessScore}/100). No clear trend direction.`);
      parsedResult.action = 'WAIT';
      parsedResult.strategyUsed = 'SIT_OUT';
      parsedResult.suggestedOptionContract = null;
      parsedResult.optionPremiumLtp = null;
      parsedResult.optionTarget1 = null;
      parsedResult.optionTarget2 = null;
      parsedResult.optionStoploss = null;
      parsedResult.trailingStoploss = null;
      parsedResult.summary = `[CHOPPY MARKET BLOCK] Market is sideways/choppy (Choppiness Score: ${choppinessScore}/100). Trading in choppy conditions has very low win rate. Waiting for a clear trending move before taking any trade.`;
    }

    // Trend alignment check only applies to TREND_FOLLOWING strategy! Range Mean Reversion deliberately trades against/inside trends.
    if (parsedResult.strategyUsed === 'TREND_FOLLOWING') {
      if (parsedResult.action === 'CALL' && hourlyTrend === 'BEARISH') {
        console.log(`[OpenClaw Safeguard] Overriding CALL signal for ${symbolStr} because 1-Hour Trend is BEARISH.`);
        parsedResult.action = 'WAIT';
        parsedResult.strategyUsed = 'SIT_OUT';
        parsedResult.suggestedOptionContract = null;
        parsedResult.optionPremiumLtp = null;
        parsedResult.optionTarget1 = null;
        parsedResult.optionTarget2 = null;
        parsedResult.optionStoploss = null;
        parsedResult.trailingStoploss = null;
        parsedResult.summary = `[SAFEGUARD OVERRIDE] AI suggested CALL, but trend-filter blocked it because 1-Hour trend is BEARISH. Waiting for trend alignment.`;
      } else if (parsedResult.action === 'PUT' && hourlyTrend === 'BULLISH') {
        console.log(`[OpenClaw Safeguard] Overriding PUT signal for ${symbolStr} because 1-Hour Trend is BULLISH.`);
        parsedResult.action = 'WAIT';
        parsedResult.strategyUsed = 'SIT_OUT';
        parsedResult.suggestedOptionContract = null;
        parsedResult.optionPremiumLtp = null;
        parsedResult.optionTarget1 = null;
        parsedResult.optionTarget2 = null;
        parsedResult.optionStoploss = null;
        parsedResult.trailingStoploss = null;
        parsedResult.summary = `[SAFEGUARD OVERRIDE] AI suggested PUT, but trend-filter blocked it because 1-Hour trend is BULLISH. Waiting for trend alignment.`;
      }
    }

    // Short Covering / Long Unwinding Safeguards:
    if (parsedResult.action === 'CALL' && longUnwindingDetected) {
      console.log(`[OpenClaw Safeguard] Overriding CALL signal for ${symbolStr} due to active Put Unwinding (bearish pressure).`);
      parsedResult.action = 'WAIT';
      parsedResult.suggestedOptionContract = null;
      parsedResult.optionPremiumLtp = null;
      parsedResult.optionTarget1 = null;
      parsedResult.optionTarget2 = null;
      parsedResult.optionStoploss = null;
      parsedResult.trailingStoploss = null;
      parsedResult.summary = `[SAFEGUARD OVERRIDE] CALL signal blocked because active Put Unwinding (long liquidation) was detected near ATM strikes.`;
    }
    if (parsedResult.action === 'PUT' && shortCoveringDetected) {
      console.log(`[OpenClaw Safeguard] Overriding PUT signal for ${symbolStr} due to active Call Unwinding (short covering / squeeze).`);
      parsedResult.action = 'WAIT';
      parsedResult.suggestedOptionContract = null;
      parsedResult.optionPremiumLtp = null;
      parsedResult.optionTarget1 = null;
      parsedResult.optionTarget2 = null;
      parsedResult.optionStoploss = null;
      parsedResult.trailingStoploss = null;
      parsedResult.summary = `[SAFEGUARD OVERRIDE] PUT signal blocked because active Call Unwinding (short covering/short squeeze) was detected near ATM strikes.`;
    }

    // Smart Money Safeguards:
    if (parsedResult.action === 'CALL' && (smartMoneySentiment === 'LONG_UNWINDING_PANIC' || smartMoneySentiment === 'BEARISH_BUILDUP')) {
      console.log(`[OpenClaw Safeguard] Overriding CALL signal for ${symbolStr} due to Bearish Smart Money 15m Sentiment: ${smartMoneySentiment}`);
      parsedResult.action = 'WAIT';
      parsedResult.suggestedOptionContract = null;
      parsedResult.optionPremiumLtp = null;
      parsedResult.optionTarget1 = null;
      parsedResult.optionTarget2 = null;
      parsedResult.optionStoploss = null;
      parsedResult.trailingStoploss = null;
      parsedResult.summary = `[SAFEGUARD OVERRIDE] CALL signal blocked because 15-minute Smart Money (FII/DII) is building Bearish pressure (${smartMoneySentiment}).`;
    } else if (parsedResult.action === 'PUT' && (smartMoneySentiment === 'SHORT_COVERING_PANIC' || smartMoneySentiment === 'BULLISH_BUILDUP')) {
      console.log(`[OpenClaw Safeguard] Overriding PUT signal for ${symbolStr} due to Bullish Smart Money 15m Sentiment: ${smartMoneySentiment}`);
      parsedResult.action = 'WAIT';
      parsedResult.suggestedOptionContract = null;
      parsedResult.optionPremiumLtp = null;
      parsedResult.optionTarget1 = null;
      parsedResult.optionTarget2 = null;
      parsedResult.optionStoploss = null;
      parsedResult.trailingStoploss = null;
      parsedResult.summary = `[SAFEGUARD OVERRIDE] PUT signal blocked because 15-minute Smart Money (FII/DII) is building Bullish pressure (${smartMoneySentiment}).`;
    }

    // Cumulative OI Delta Divergence Safeguard overrides (Trap Filter):
    if (parsedResult.action === 'CALL' && oiDivergenceStatus === 'BULL_TRAP_WARNING') {
      console.log(`[OpenClaw Safeguard] Overriding CALL signal for ${symbolStr} due to Bull Trap (OI Divergence Status: BULL_TRAP_WARNING).`);
      parsedResult.action = 'WAIT';
      parsedResult.suggestedOptionContract = null;
      parsedResult.optionPremiumLtp = null;
      parsedResult.optionTarget1 = null;
      parsedResult.optionTarget2 = null;
      parsedResult.optionStoploss = null;
      parsedResult.trailingStoploss = null;
      parsedResult.summary = `[SAFEGUARD OVERRIDE] CALL signal blocked because a BULL TRAP was detected (Price rising but smart money writing Calls aggressively: Divergence negative).`;
    } else if (parsedResult.action === 'PUT' && oiDivergenceStatus === 'BEAR_TRAP_WARNING') {
      console.log(`[OpenClaw Safeguard] Overriding PUT signal for ${symbolStr} due to Bear Trap (OI Divergence Status: BEAR_TRAP_WARNING).`);
      parsedResult.action = 'WAIT';
      parsedResult.suggestedOptionContract = null;
      parsedResult.optionPremiumLtp = null;
      parsedResult.optionTarget1 = null;
      parsedResult.optionTarget2 = null;
      parsedResult.optionStoploss = null;
      parsedResult.trailingStoploss = null;
      parsedResult.summary = `[SAFEGUARD OVERRIDE] PUT signal blocked because a BEAR TRAP was detected (Price falling but smart money writing Puts aggressively: Divergence positive).`;
    }
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
      pcvr,
      pcrVelocity,
      trendConcurrence,
      isVolumeSpiked,
      latestVolume,
      averageVolume,
      averageIv,
      shortCoveringDetected,
      longUnwindingDetected,
      nearbyStrikesOiData,
      smartMoneySentiment,
      smartMoneyUnwindingWarning,
      freshResistanceWall15m,
      freshSupportWall15m,
      priceChange15m,
      cumulativeOiDelta15m,
      oiDivergenceStatus,
      adx: lastAdx,
      bbUpper: lastBbUpper,
      bbMiddle: lastBbMiddle,
      bbLower: lastBbLower,
      marketRegime,
      choppinessScore,
      atm3Pcr,
      atm3Vpcr,
      isVPcrSpiked,
      vPcrDirection,
      activeSignal
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
    // Return 200 to bypass proxy error page overrides and let the client read the real message
    res.status(200).json({ 
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

  // Check if a pending signal for the same symbol and source already exists
  db.get(
    `SELECT id FROM ai_signals WHERE symbol = ? AND source = ? AND status = 'PENDING'`,
    [symbol, signalSource],
    (err, row) => {
      if (err) {
        console.error('Error checking duplicate signal:', err.message);
        return res.status(500).json({ success: false, message: err.message });
      }
      if (row) {
        return res.json({ success: true, id: row.id, message: 'Pending signal already exists for this symbol and source' });
      }

      const query = `INSERT INTO ai_signals (symbol, type, entry_price, target_price, stoploss_price, source) 
                     VALUES (?, ?, ?, ?, ?, ?)`;
      
      db.run(query, [symbol, type, entry_price, target_price, stoploss_price, signalSource], function(err) {
        if (err) {
          console.error('Error saving signal:', err.message);
          return res.status(500).json({ success: false, message: err.message });
        }
        res.json({ success: true, id: this.lastID });
      });
    }
  );
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

async function sendTradeClosureNotification(row, newStatus, exitSpot) {
  const settings = await getSystemSettings();
  const tgToken = settings['telegram_token'];
  const tgChatId = settings['telegram_chat_id'];
  
  if (!tgToken || !tgChatId) return;

  const tradeIdStr = `CLAW-${row.symbol}-${row.id}`;
  const pnl = row.type === 'CALL' 
    ? (exitSpot - row.entry_price) 
    : (row.entry_price - exitSpot);
  const pnlSign = pnl >= 0 ? '+' : '';
  
  const isTargetHit = row.target_price && (row.type === 'CALL' ? exitSpot >= row.target_price : exitSpot <= row.target_price);
  const statusLabel = newStatus === 'SUCCESS' 
    ? (isTargetHit ? '✅ SUCCESS (Target Hit)' : '✅ SUCCESS (Trailed SL Hit)') 
    : '❌ FAILED (Stoploss Hit)';

  const message = `🔔 *OpenClaw Trade Closure Alert* 🔔\n\n` +
    `*Trade ID*: \`${tradeIdStr}\`\n` +
    `*Symbol*: ${row.symbol}\n` +
    `*Action*: ${row.type === 'CALL' ? 'BUY CALL / BULLISH' : 'BUY PUT / BEARISH'}\n` +
    `*Status*: ${statusLabel}\n\n` +
    `📊 *Trade Details*:\n` +
    `  • Entry Price: ${row.entry_price.toFixed(2)}\n` +
    `  • Target Price: ${row.target_price ? row.target_price.toFixed(2) : 'N/A'}\n` +
    `  • Stoploss Price: ${row.stoploss_price ? row.stoploss_price.toFixed(2) : 'N/A'}\n` +
    `  • Exit Spot Price: ${exitSpot.toFixed(2)}\n` +
    `  • PnL: *${pnlSign}${pnl.toFixed(2)} Points*\n\n` +
    `🤖 Powered by OpenClaw AI Engine.`;

  try {
    const url = `https://api.telegram.org/bot${tgToken}/sendMessage`;
    await axios.post(url, {
      chat_id: tgChatId,
      text: message,
      parse_mode: 'Markdown'
    });
    console.log(`[Background Closure Alert] Telegram alert dispatched for ${row.symbol} (${newStatus})`);
  } catch (e) {
    console.error(`[Background Closure Alert] Telegram dispatch error for ${row.symbol}:`, e.message);
  }

  // Discord
  const discordWebhook = settings['discord_webhook'];
  if (discordWebhook) {
    try {
      await axios.post(discordWebhook, {
        content: message.replace(/\*/g, '**')
      });
      console.log(`[Background Closure Alert] Discord alert dispatched for ${row.symbol}`);
    } catch (e) {
      console.error(`[Background Closure Alert] Discord dispatch error for ${row.symbol}:`, e.message);
    }
  }

  // WhatsApp
  const waPhone = settings['whatsapp_phone'];
  const waApiKey = settings['whatsapp_apikey'];
  if (waPhone && waApiKey) {
    try {
      const cleanPhone = waPhone.replace(/[^0-9]/g, '');
      const waText = encodeURIComponent(message.replace(/\*/g, ''));
      const waUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${waText}&apikey=${waApiKey}`;
      await axios.get(waUrl);
      console.log(`[Background Closure Alert] WhatsApp alert dispatched for ${row.symbol}`);
    } catch (e) {
      console.error(`[Background Closure Alert] WhatsApp dispatch error for ${row.symbol}:`, e.message);
    }
  }
}

async function sendActiveTradesStatusUpdate() {
  const settings = await getSystemSettings();
  const tgToken = settings['telegram_token'];
  const tgChatId = settings['telegram_chat_id'];
  if (!tgToken || !tgChatId) return;

  db.all(`SELECT * FROM ai_signals WHERE source = 'OPENCLAW' AND status = 'PENDING' ORDER BY created_at DESC`, [], async (err, rows) => {
    if (err || !rows || rows.length === 0) return;

    let statusMsg = `📋 *OpenClaw Active Trades Update:* \n\n`;
    rows.forEach((row, index) => {
      const spot = latestSpotPrices[row.symbol] || row.entry_price;
      const change = row.type === 'CALL' ? (spot - row.entry_price) : (row.entry_price - spot);
      const changeSign = change >= 0 ? '+' : '';
      const tradeId = `CLAW-${row.symbol}-${row.id}`;
      statusMsg += `${index + 1}. *${row.symbol} ${row.type}* \`${tradeId}\`\n` +
        `  • Entry: ${row.entry_price.toFixed(2)}\n` +
        `  • Target: ${row.target_price.toFixed(2)}\n` +
        `  • Stoploss: ${row.stoploss_price.toFixed(2)}\n` +
        `  • Current Spot: ${spot.toFixed(2)} (${changeSign}${change.toFixed(2)} pts)\n` +
        `  • Status: ⏳ MONITORING\n\n`;
    });
    statusMsg += `🤖 Powered by OpenClaw AI Engine.`;

    try {
      const url = `https://api.telegram.org/bot${tgToken}/sendMessage`;
      await axios.post(url, {
        chat_id: tgChatId,
        text: statusMsg,
        parse_mode: 'Markdown'
      });
      console.log(`[Background Status Update] Sent active trades report to Telegram.`);
    } catch (e) {
      console.error(`[Background Status Update] Telegram dispatch error:`, e.message);
    }
  });
}

// Mutex flag — prevents concurrent execution of updatePendingSignals
let isUpdatingPendingSignals = false;

// Function to update PENDING signals in background using latestSpotPrices cache
const updatePendingSignals = () => {
  if (isUpdatingPendingSignals) {
    console.log('[Background] updatePendingSignals skipped — already running.');
    return Promise.resolve(0);
  }
  isUpdatingPendingSignals = true;
  return new Promise((resolve, reject) => {
    // Auto-expire any pending signals from previous calendar days (IST) before checking status
    db.run(
      `UPDATE ai_signals 
       SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP 
       WHERE status = 'PENDING' 
         AND date(created_at, '+5.5 hours') < date('now', '+5.5 hours')`,
      [],
      (expireErr) => {
        if (expireErr) {
          console.error('[Background] Error auto-expiring old signals:', expireErr.message);
        }

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
            let maxSpotSeen = row.max_spot_seen || row.entry_price;
            let maxSpotChanged = false;

            if (row.type === 'CALL') {
              if (currentSpot > maxSpotSeen) {
                maxSpotSeen = currentSpot;
                maxSpotChanged = true;
              }

              if (row.target_price && currentSpot >= row.target_price) {
                newStatus = 'SUCCESS';
              } else if (row.stoploss_price && currentSpot <= row.stoploss_price) {
                // If stoploss was trailed in profit, mark it as SUCCESS
                const pnl = currentSpot - row.entry_price;
                newStatus = pnl >= 0 ? 'SUCCESS' : 'FAILED';
              }
            } else if (row.type === 'PUT') {
              if (currentSpot < maxSpotSeen) {
                maxSpotSeen = currentSpot;
                maxSpotChanged = true;
              }

              if (row.target_price && currentSpot <= row.target_price) {
                newStatus = 'SUCCESS';
              } else if (row.stoploss_price && currentSpot >= row.stoploss_price) {
                // If stoploss was trailed in profit, mark it as SUCCESS
                const pnl = row.entry_price - currentSpot;
                newStatus = pnl >= 0 ? 'SUCCESS' : 'FAILED';
              }
            }

            if (newStatus !== 'PENDING' || maxSpotChanged) {
              // Always filter by AND status = 'PENDING' to prevent double-firing
              const query = newStatus !== 'PENDING'
                ? `UPDATE ai_signals 
                   SET status = ?, max_spot_seen = ?, exit_time = CURRENT_TIMESTAMP, exit_price = ?, updated_at = CURRENT_TIMESTAMP 
                   WHERE id = ? AND status = 'PENDING'`
                : `UPDATE ai_signals 
                   SET status = ?, max_spot_seen = ?, updated_at = CURRENT_TIMESTAMP 
                   WHERE id = ? AND status = 'PENDING'`;
              const params = newStatus !== 'PENDING'
                ? [newStatus, maxSpotSeen, currentSpot, row.id]
                : [newStatus, maxSpotSeen, row.id];

              db.run(
                query, 
                params, 
                async function(err) {
                  if (!err && this.changes > 0) {
                    // Only fire closure alert if we actually updated the row (this.changes > 0 prevents double-fire)
                    if (newStatus !== 'PENDING') {
                      updatedCount++;
                      if (row.source === 'OPENCLAW') {
                        await sendTradeClosureNotification(row, newStatus, currentSpot);
                      }
                    }
                  }
                  pendingUpdates--;
                  if (pendingUpdates === 0) resolve(updatedCount);
                }
              );
            } else {
              pendingUpdates--;
              if (pendingUpdates === 0) resolve(updatedCount);
            }
          });
        });
      }
    );
  }).finally(() => {
    isUpdatingPendingSignals = false;
  });
};

// Function to update ACTIVE paper trades and balance based on option chain cache
const updateActivePaperTrades = () => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM paper_trades WHERE status = 'ACTIVE'`, [], async (err, rows) => {
      if (err) return reject(err);
      if (!rows || rows.length === 0) return resolve(0);

      const settings = await getSystemSettings();
      let balance = parseFloat(settings['paper_wallet_balance'] || '1000000');
      let balanceChanged = false;
      let closedCount = 0;
      let pendingUpdates = rows.length;

      for (const row of rows) {
        const symbol = row.symbol;
        const cacheKey = `${symbol}_first`;
        const cached = getCachedData('optionChain', cacheKey, 300000);
        
        if (!cached || !cached.data) {
          pendingUpdates--;
          if (pendingUpdates === 0) {
            if (balanceChanged) {
              db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('paper_wallet_balance', ?)`, [String(balance)], () => resolve(closedCount));
            } else {
              resolve(closedCount);
            }
          }
          continue;
        }

        // Parse strike and type from contract_name (e.g. "NIFTY 18-Jun 22000 CE")
        const parts = row.contract_name.split(' ');
        const strike = parseFloat(parts[parts.length - 2]);
        const type = parts[parts.length - 1]; // "CE" or "PE"

        const strikeData = cached.data.find(s => s.strike === strike);
        if (!strikeData) {
          pendingUpdates--;
          if (pendingUpdates === 0) {
            if (balanceChanged) {
              db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('paper_wallet_balance', ?)`, [String(balance)], () => resolve(closedCount));
            } else {
              resolve(closedCount);
            }
          }
          continue;
        }

        const currentLtp = type === 'CE' ? strikeData.callLtp : strikeData.putLtp;
        if (!currentLtp || currentLtp <= 0) {
          pendingUpdates--;
          if (pendingUpdates === 0) {
            if (balanceChanged) {
              db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('paper_wallet_balance', ?)`, [String(balance)], () => resolve(closedCount));
            } else {
              resolve(closedCount);
            }
          }
          continue;
        }

        let lotSize = 50;
        if (symbol === 'NIFTY') lotSize = 50;
        else if (symbol === 'BANKNIFTY') lotSize = 15;
        else if (symbol === 'FINNIFTY') lotSize = 40;
        else if (symbol === 'MIDCPNIFTY') lotSize = 75;

        const totalQty = row.qty * lotSize;
        const pnl = (currentLtp - row.entry_premium) * totalQty;

        let shouldClose = false;
        let exitLtp = currentLtp;

        if (row.target_premium && currentLtp >= row.target_premium) {
          shouldClose = true;
          exitLtp = row.target_premium;
        } else if (row.stoploss_premium && currentLtp <= row.stoploss_premium) {
          shouldClose = true;
          exitLtp = row.stoploss_premium;
        }

        if (shouldClose) {
          const finalPnl = (exitLtp - row.entry_premium) * totalQty;
          balance += (row.qty * lotSize * row.entry_premium) + finalPnl; // Refund margin + PnL
          balanceChanged = true;
          closedCount++;

          db.run(
            `UPDATE paper_trades 
             SET exit_premium = ?, exit_spot = ?, status = 'CLOSED', pnl = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [exitLtp, cached.spotPrice, finalPnl, row.id],
            () => {
              pendingUpdates--;
              if (pendingUpdates === 0) {
                db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('paper_wallet_balance', ?)`, [String(balance)], () => resolve(closedCount));
              }
            }
          );
        } else {
          db.run(
            `UPDATE paper_trades SET pnl = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [pnl, row.id],
            () => {
              pendingUpdates--;
              if (pendingUpdates === 0) {
                if (balanceChanged) {
                  db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('paper_wallet_balance', ?)`, [String(balance)], () => resolve(closedCount));
                } else {
                  resolve(closedCount);
                }
              }
            }
          );
        }
      }
    });
  });
};

// Paper Trading API Endpoints
app.get('/api/paper/balance', async (req, res) => {
  try {
    const settings = await getSystemSettings();
    const balance = parseFloat(settings['paper_wallet_balance'] || '1000000');
    res.json({ success: true, balance });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/paper/reset', async (req, res) => {
  db.serialize(() => {
    db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('paper_wallet_balance', '1000000')`);
    db.run(`DELETE FROM paper_trades`, [], (err) => {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
      res.json({ success: true, message: 'Paper wallet reset successfully and all paper trades deleted.' });
    });
  });
});

app.get('/api/paper/trades', async (req, res) => {
  try {
    if (isIndianMarketOpen()) {
      await updateActivePaperTrades();
    }
    db.all(`SELECT * FROM paper_trades ORDER BY created_at DESC`, [], (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
      res.json({ success: true, data: rows });
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/paper/trade', async (req, res) => {
  try {
    const { symbol, type, contract_name, qty, entry_premium, entry_spot, target_premium, stoploss_premium } = req.body;
    
    if (!symbol || !type || !contract_name || !qty || !entry_premium) {
      return res.status(400).json({ success: false, message: 'Missing required trade details.' });
    }

    const settings = await getSystemSettings();
    let balance = parseFloat(settings['paper_wallet_balance'] || '1000000');

    let lotSize = 50;
    if (symbol === 'NIFTY') lotSize = 50;
    else if (symbol === 'BANKNIFTY') lotSize = 15;
    else if (symbol === 'FINNIFTY') lotSize = 40;
    else if (symbol === 'MIDCPNIFTY') lotSize = 75;

    const requiredMargin = qty * lotSize * entry_premium;
    if (requiredMargin > balance) {
      return res.status(400).json({ success: false, message: `Insufficient balance. Required Margin: ₹${requiredMargin.toFixed(2)}, Available Balance: ₹${balance.toFixed(2)}` });
    }

    // Deduct margin
    const newBalance = balance - requiredMargin;

    db.serialize(() => {
      db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('paper_wallet_balance', ?)`, [String(newBalance)]);
      db.run(
        `INSERT INTO paper_trades (symbol, type, contract_name, qty, entry_premium, entry_spot, target_premium, stoploss_premium, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [symbol, type, contract_name, qty, entry_premium, entry_spot || 0, target_premium || null, stoploss_premium || null],
        function(err) {
          if (err) {
            return res.status(500).json({ success: false, message: err.message });
          }
          res.json({ success: true, message: 'Trade executed successfully in Paper Trading Portfolio.', tradeId: this.lastID });
        }
      );
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/paper/exit', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Trade ID required.' });
    }

    db.get(`SELECT * FROM paper_trades WHERE id = ? AND status = 'ACTIVE'`, [id], async (err, row) => {
      if (err || !row) {
        return res.status(404).json({ success: false, message: 'Active trade not found.' });
      }

      const symbol = row.symbol;
      const cacheKey = `${symbol}_first`;
      const cached = getCachedData('optionChain', cacheKey, 300000);
      if (!cached || !cached.data) {
        return res.status(400).json({ success: false, message: 'Market data currently unavailable to close trade.' });
      }

      const parts = row.contract_name.split(' ');
      const strike = parseFloat(parts[parts.length - 2]);
      const type = parts[parts.length - 1];

      const strikeData = cached.data.find(s => s.strike === strike);
      if (!strikeData) {
        return res.status(400).json({ success: false, message: 'Option strike data not found in cache.' });
      }

      const exitLtp = type === 'CE' ? strikeData.callLtp : strikeData.putLtp;
      if (!exitLtp || exitLtp <= 0) {
        return res.status(400).json({ success: false, message: 'LTP value is invalid.' });
      }

      const settings = await getSystemSettings();
      let balance = parseFloat(settings['paper_wallet_balance'] || '1000000');

      let lotSize = 50;
      if (symbol === 'NIFTY') lotSize = 50;
      else if (symbol === 'BANKNIFTY') lotSize = 15;
      else if (symbol === 'FINNIFTY') lotSize = 40;
      else if (symbol === 'MIDCPNIFTY') lotSize = 75;

      const totalQty = row.qty * lotSize;
      const finalPnl = (exitLtp - row.entry_premium) * totalQty;

      // Refund margin + PnL
      const requiredMargin = row.qty * lotSize * row.entry_premium;
      const refundedMargin = requiredMargin + finalPnl;
      const newBalance = balance + refundedMargin;

      db.serialize(() => {
        db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('paper_wallet_balance', ?)`, [String(newBalance)]);
        db.run(
          `UPDATE paper_trades 
           SET exit_premium = ?, exit_spot = ?, status = 'CLOSED', pnl = ?, updated_at = CURRENT_TIMESTAMP 
           WHERE id = ?`,
          [exitLtp, cached.spotPrice, finalPnl, row.id],
          (updateErr) => {
            if (updateErr) {
              return res.status(500).json({ success: false, message: updateErr.message });
            }
            res.json({ success: true, message: 'Trade exited successfully.', pnl: finalPnl });
          }
        );
      });
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

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
      tradingProfile: 'intraday_scalper',
      stoplossAtrMultiplier: 1.5,
      strictTrendFilter: true
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
        if (r.key === 'stoploss_atr_multiplier') settings.stoplossAtrMultiplier = parseFloat(r.value) || 1.5;
        if (r.key === 'strict_trend_filter') settings.strictTrendFilter = r.value !== 'false';
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
    tradingProfile,
    stoplossAtrMultiplier,
    strictTrendFilter
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
    { key: 'trading_profile', val: tradingProfile || 'intraday_scalper' },
    { key: 'stoploss_atr_multiplier', val: String(stoplossAtrMultiplier || 1.5) },
    { key: 'strict_trend_filter', val: strictTrendFilter === false ? 'false' : 'true' }
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

const backgroundLogs = [];
function logToBackground(text, type = 'info') {
  const timestamp = new Date().toLocaleTimeString('en-US', { 
    timeZone: 'Asia/Kolkata', 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: false
  });
  backgroundLogs.push({ timestamp, text, type });
  if (backgroundLogs.length > 60) {
    backgroundLogs.shift();
  }
  console.log(`[OpenClaw Log] ${text}`);
}

app.get('/api/openclaw/logs', (req, res) => {
  res.json({ success: true, logs: backgroundLogs });
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
let lastActiveReportTime = 0;
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
    logToBackground(`Scheduler starting auto-scan. Interval: ${interval}m, Min Conf: ${minConfidence}%, Weights: PCR=${pcrWeight}%, Chart=${chartWeight}%, News=${newsWeight}%`, 'info');

    const symbols = ['NIFTY', 'BANKNIFTY'];

    for (const symbol of symbols) {
      try {
        logToBackground(`Scanning index ${symbol}...`, 'info');

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
          logToBackground(`Skipping ${symbol} - Spot price (${currentSpot}) unchanged since last scan.`, 'info');
          continue;
        }

        // Run analysis with weights
        const tradingProfile = settings['trading_profile'] || 'intraday_scalper';

        // Same-day Re-entry: Check cooldown (15 min) after last closed trade for this symbol
        const RE_ENTRY_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
        const lastClosedTime = await new Promise((resolve) => {
          db.get(
            `SELECT MAX(updated_at) as lastClose FROM ai_signals
             WHERE symbol = ? AND source = 'OPENCLAW'
               AND status IN ('SUCCESS', 'FAILED', 'CLOSED')
               AND date(updated_at, '+5.5 hours') = date('now', '+5.5 hours')`,
            [symbol],
            (err, row) => {
              if (err || !row || !row.lastClose) return resolve(null);
              resolve(new Date(row.lastClose + 'Z').getTime()); // SQLite stores UTC
            }
          );
        });

        if (lastClosedTime && (Date.now() - lastClosedTime) < RE_ENTRY_COOLDOWN_MS) {
          const minutesAgo = Math.floor((Date.now() - lastClosedTime) / 60000);
          const minutesLeft = 15 - minutesAgo;
          logToBackground(`Skipping ${symbol} — Re-entry cooldown active. Last trade closed ${minutesAgo}m ago. Next re-entry in ~${minutesLeft}m.`, 'info');
          continue;
        }

        const result = await executeOpenClawAnalysis(symbol, null, weightsObj, tradingProfile, true);
        const actionData = result.data;
        const indicators = result.indicators;
        const activeSignal = indicators.activeSignal;

        // Update last spot price
        lastAlertSpotPrices[symbol] = indicators.spotPrice;

        logToBackground(`${symbol} scan completed. Action: ${actionData.action}, Confidence: ${actionData.confidence}%`, actionData.action !== 'WAIT' ? 'success' : 'info');

        // Check if there is an active signal running and handle early exits / trailing stoplosses
        if (activeSignal && actionData.activeTradeAction) {
          if (actionData.activeTradeAction === 'EXIT_EARLY') {
            logToBackground(`[Active Trade] OpenClaw AI recommended EXIT_EARLY for ${symbol} (Signal ID: ${activeSignal.id}).`, 'warning');
            await closeActiveSignalEarly(activeSignal.id, indicators.spotPrice, 'FAILED');
            await sendEarlyExitNotifications(symbol, activeSignal, indicators.spotPrice, settings, actionData.reasoning?.[0] || 'Trend reversal detected by AI.');
          } else if (actionData.activeTradeAction === 'TRAIL_SL' && actionData.newStoploss) {
            const newSL = parseFloat(actionData.newStoploss);
            if (newSL && newSL !== activeSignal.stoploss_price) {
              logToBackground(`[Active Trade] OpenClaw AI trailed stoploss for ${symbol} from ${activeSignal.stoploss_price} to ${newSL}.`, 'success');
              await updateActiveSignalStoploss(activeSignal.id, newSL);
              await sendTrailingSlNotifications(symbol, activeSignal, newSL, settings);
            }
          }
        }

        if ((actionData.action === 'CALL' || actionData.action === 'PUT') && actionData.confidence >= minConfidence) {
          logToBackground(`🚨 Strong signal detected for ${symbol}: ${actionData.action} (${actionData.confidence}%)`, 'success');
          // Save to DB FIRST to get the unique Trade ID, then send alert with that ID
          const signalId = await saveOpenClawSignalToDb(symbol, actionData, indicators.spotPrice);
          await sendOpenClawNotifications(symbol, actionData, settings, indicators, signalId);
        }
      } catch (err) {
        logToBackground(`Error scanning ${symbol}: ${err.message}`, 'error');
      }

      // 10-second delay between symbols to avoid concurrent Gemini API rate limits (429)
      await new Promise(r => setTimeout(r, 10000));
    }
  } catch (error) {
    logToBackground(`Error in background scanner loop: ${error.message}`, 'error');
  }
}


// Helper: escape underscores in a string so Telegram Markdown v1 doesn't misparse them
function escapeTgMd(str) {
  if (str === null || str === undefined) return 'N/A';
  return String(str).replace(/_/g, '\\_');
}

async function sendOpenClawNotifications(symbol, actionData, settings, indicators, signalId) {
  const spotPrice = indicators.spotPrice || 'N/A';
  // Escape underscores in trend/divergence fields that are the root cause of Telegram 400 errors
  const hourlyTrend = escapeTgMd(indicators.hourlyTrend || 'N/A');
  const oiDivergenceStatus = escapeTgMd(indicators.oiDivergenceStatus || 'NO\_DIVERGENCE');
  const averageIv = indicators.averageIv || 0;
  const tradeIdStr = signalId ? `CLAW-${symbol}-${signalId}` : 'CLAW-UNKNOWN';
  const aiSummary = escapeTgMd(actionData.summary);
  const buyRange = escapeTgMd(actionData.buyRange);
  const target1 = escapeTgMd(actionData.target1);
  const target2 = escapeTgMd(actionData.target2);
  const stoploss = escapeTgMd(actionData.stoploss);

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
    optionDetails = `*Option Contract*: ${escapeTgMd(actionData.suggestedOptionContract)}\n` +
      `*Premium Entry*: Rs ${actionData.optionPremiumLtp}\n` +
      `*Premium Target 1*: Rs ${actionData.optionTarget1}\n` +
      `*Premium Target 2*: Rs ${actionData.optionTarget2}\n` +
      `*Premium Stoploss*: Rs ${actionData.optionStoploss}\n` +
      `*Expected Hold*: ${escapeTgMd(actionData.expectedHoldTime)}\n\n`;
  }

  const actionLabel = actionData.action === 'CALL' ? 'BUY CALL / BULLISH' : 'BUY PUT / BEARISH';

  let strategyLabel = 'TREND FOLLOWING (Trending Market)';
  if (actionData.strategyUsed === 'RANGE_BOUND_MEAN_REVERSION') {
    strategyLabel = 'RANGE SCALPING (Sideways Market)';
  } else if (actionData.strategyUsed === 'SIT_OUT') {
    strategyLabel = 'SIT OUT / NO TRADE';
  }

  const messageContent = `🚨 *OpenClaw AI Trade Alert* 🚨\n\n` +
    `*Trade ID*: \`${tradeIdStr}\`\n` +
    `*Symbol*: ${symbol}\n` +
    `*Action*: ${actionLabel}\n` +
    `*Strategy*: ${strategyLabel}\n` +
    `*Spot Price*: ${spotPrice}\n` +
    `*Confidence*: ${actionData.confidence}%\n` +
    `*1H Trend*: ${hourlyTrend}\n` +
    `*ATM IV*: ${averageIv ? averageIv.toFixed(1) + '%' : 'N/A'}\n` +
    `*ATM +/- 3 PCR*: ${indicators.atm3Pcr || 'N/A'}\n` +
    `*ATM +/- 3 Vol PCR*: ${indicators.atm3Vpcr || 'N/A'}\n` +
    `*OI Divergence*: ${oiDivergenceStatus}\n` +
    `*Buy Range*: ${buyRange}\n` +
    `*Target 1*: ${target1}\n` +
    `*Target 2*: ${target2}\n` +
    `*Stoploss*: ${stoploss}\n` +
    `*Time (IST)*: ${currentTime}\n\n` +
    optionDetails +
    `*AI Summary*: ${aiSummary}\n\n` +
    `🤖 Powered by OpenClaw AI Multi\-Agent Engine.`;

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
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO ai_signals (symbol, type, entry_price, target_price, stoploss_price, source, status) 
       VALUES (?, ?, ?, ?, ?, 'OPENCLAW', 'PENDING')`,
      [symbol, signalType, spotPrice, actionData.target1, actionData.stoploss],
      function(err) {
        if (err) {
          console.error(`[Background Alert] Error logging signal for ${symbol} to DB:`, err.message);
          reject(err);
        } else {
          console.log(`[Background Alert] Saved ${symbol} ${signalType} signal to DB with Trade ID: CLAW-${symbol}-${this.lastID}`);
          resolve(this.lastID);
        }
      }
    );
  });
}

function closeActiveSignalEarly(id, exitPrice, status) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE ai_signals 
       SET status = ?, exit_price = ?, exit_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'PENDING'`,
      [status, exitPrice, id],
      function(err) {
        if (err) {
          console.error(`[Background Alert] Error closing active signal ${id} early:`, err.message);
          reject(err);
        } else {
          console.log(`[Background Alert] Closed active signal ${id} early with status ${status} and exit price ${exitPrice}.`);
          resolve(this.changes);
        }
      }
    );
  });
}

function updateActiveSignalStoploss(id, newStoploss) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE ai_signals 
       SET stoploss_price = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'PENDING'`,
      [newStoploss, id],
      function(err) {
        if (err) {
          console.error(`[Background Alert] Error updating stoploss for active signal ${id}:`, err.message);
          reject(err);
        } else {
          console.log(`[Background Alert] Updated stoploss for active signal ${id} to ${newStoploss}.`);
          resolve(this.changes);
        }
      }
    );
  });
}

async function sendEarlyExitNotifications(symbol, activeSignal, exitPrice, settings, reason) {
  const tgToken = settings['telegram_token'];
  const tgChatId = settings['telegram_chat_id'];
  if (!tgToken || !tgChatId) return;

  const tradeIdStr = `CLAW-${symbol}-${activeSignal.id}`;
  const pnl = activeSignal.type === 'CALL' 
    ? (exitPrice - activeSignal.entry_price) 
    : (activeSignal.entry_price - exitPrice);
  const pnlSign = pnl >= 0 ? '+' : '';
  const escapedReason = escapeTgMd(reason || 'Trend reversal detected by AI');

  const message = `⚠️ *[Early Exit Alert] OpenClaw AI Trade Exited Early* ⚠️\n\n` +
    `*Trade ID*: \`${tradeIdStr}\`\n` +
    `*Symbol*: ${symbol}\n` +
    `*Action*: ${activeSignal.type === 'CALL' ? 'BUY CALL / BULLISH' : 'BUY PUT / BEARISH'}\n` +
    `*Status*: ❌ CLOSED EARLY\n\n` +
    `📊 *Exit Details*:\n` +
    `  • Entry Price: ${activeSignal.entry_price.toFixed(2)}\n` +
    `  • Exit Spot Price: ${exitPrice.toFixed(2)}\n` +
    `  • PnL: *${pnlSign}${pnl.toFixed(2)} Points*\n` +
    `  • Reason: ${escapedReason}\n\n` +
    `🤖 - Powered by OpenClaw AI Engine.`;

  try {
    const url = `https://api.telegram.org/bot${tgToken}/sendMessage`;
    await axios.post(url, {
      chat_id: tgChatId,
      text: message,
      parse_mode: 'Markdown'
    });
    console.log(`[Background Early Exit] Telegram alert dispatched for ${symbol}`);
  } catch (e) {
    console.error(`[Background Early Exit] Telegram dispatch error for ${symbol}:`, e.message);
  }

  // Discord
  const discordWebhook = settings['discord_webhook'];
  if (discordWebhook) {
    try {
      await axios.post(discordWebhook, {
        content: message.replace(/\*/g, '**')
      });
      console.log(`[Background Early Exit] Discord alert dispatched for ${symbol}`);
    } catch (e) {
      console.error(`[Background Early Exit] Discord dispatch error for ${symbol}:`, e.message);
    }
  }

  // WhatsApp
  const waPhone = settings['whatsapp_phone'];
  const waApiKey = settings['whatsapp_apikey'];
  if (waPhone && waApiKey) {
    try {
      const cleanPhone = waPhone.replace(/[^0-9]/g, '');
      const waText = encodeURIComponent(message.replace(/\*/g, ''));
      const waUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${waText}&apikey=${waApiKey}`;
      await axios.get(waUrl);
      console.log(`[Background Early Exit] WhatsApp alert dispatched for ${symbol}`);
    } catch (e) {
      console.error(`[Background Early Exit] WhatsApp dispatch error for ${symbol}:`, e.message);
    }
  }
}

async function sendTrailingSlNotifications(symbol, activeSignal, newStoploss, settings) {
  const tgToken = settings['telegram_token'];
  const tgChatId = settings['telegram_chat_id'];
  if (!tgToken || !tgChatId) return;

  const tradeIdStr = `CLAW-${symbol}-${activeSignal.id}`;
  const oldStoploss = activeSignal.stoploss_price;

  const message = `📈 *[Trailing Stoploss Alert] Stoploss Trailed* 📈\n\n` +
    `*Trade ID*: \`${tradeIdStr}\`\n` +
    `*Symbol*: ${symbol}\n` +
    `*Action*: ${activeSignal.type === 'CALL' ? 'BUY CALL / BULLISH' : 'BUY PUT / BEARISH'}\n\n` +
    `📊 *Stoploss Details*:\n` +
    `  • Entry Price: ${activeSignal.entry_price.toFixed(2)}\n` +
    `  • Old Stoploss: ${oldStoploss ? oldStoploss.toFixed(2) : 'N/A'}\n` +
    `  • *New Stoploss*: *${newStoploss.toFixed(2)}*\n\n` +
    `🤖 - Powered by OpenClaw AI Engine.`;

  try {
    const url = `https://api.telegram.org/bot${tgToken}/sendMessage`;
    await axios.post(url, {
      chat_id: tgChatId,
      text: message,
      parse_mode: 'Markdown'
    });
    console.log(`[Background Trailing SL] Telegram alert dispatched for ${symbol}`);
  } catch (e) {
    console.error(`[Background Trailing SL] Telegram dispatch error for ${symbol}:`, e.message);
  }

  // Discord
  const discordWebhook = settings['discord_webhook'];
  if (discordWebhook) {
    try {
      await axios.post(discordWebhook, {
        content: message.replace(/\*/g, '**')
      });
      console.log(`[Background Trailing SL] Discord alert dispatched for ${symbol}`);
    } catch (e) {
      console.error(`[Background Trailing SL] Discord dispatch error for ${symbol}:`, e.message);
    }
  }

  // WhatsApp
  const waPhone = settings['whatsapp_phone'];
  const waApiKey = settings['whatsapp_apikey'];
  if (waPhone && waApiKey) {
    try {
      const cleanPhone = waPhone.replace(/[^0-9]/g, '');
      const waText = encodeURIComponent(message.replace(/\*/g, ''));
      const waUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${waText}&apikey=${waApiKey}`;
      await axios.get(waUrl);
      console.log(`[Background Trailing SL] WhatsApp alert dispatched for ${symbol}`);
    } catch (e) {
      console.error(`[Background Trailing SL] WhatsApp dispatch error for ${symbol}:`, e.message);
    }
  }
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
      geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST to save credentials and trigger token refresh
app.post('/api/settings', async (req, res) => {
  try {
    const { pin, totpSecret, clientId, geminiApiKey, geminiModel } = req.body;
    const env = readEnvFile();

    if (clientId) env.DHAN_CLIENT_ID = clientId;
    if (pin) env.DHAN_PIN = pin;
    if (totpSecret) env.DHAN_TOTP_SECRET = totpSecret;
    if (geminiApiKey) env.GEMINI_API_KEY = geminiApiKey;
    if (geminiModel) env.GEMINI_MODEL = geminiModel;

    writeEnvFile(env);

    // Reload into process.env
    if (clientId) process.env.DHAN_CLIENT_ID = clientId;
    if (pin) process.env.DHAN_PIN = pin;
    if (totpSecret) process.env.DHAN_TOTP_SECRET = totpSecret;
    if (geminiApiKey) process.env.GEMINI_API_KEY = geminiApiKey;
    if (geminiModel) process.env.GEMINI_MODEL = geminiModel;

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
  const symbols = ['NIFTY', 'BANKNIFTY'];
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
    console.log(`[Sync Worker] Launching background decoders, paper trades updater, and alerts checker...`);
    await runAllDecoders();
    await updateActivePaperTrades();
    await triggerOpenClawBackgroundAlerts();
  } catch (decErr) {
    console.error(`[Sync Worker] Error running calculations:`, decErr.message);
  } finally {
    isSyncing = false;
  }
};

// Background Signal Generator: Unified High-Accuracy Decoder
async function runAllDecoders() {
  const symbols = ['NIFTY', 'BANKNIFTY'];
  
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

    // Check if we should send periodic active trades status report (every 5 minutes)
    const now = Date.now();
    const REPORT_INTERVAL = 5 * 60 * 1000; // 5 minutes
    if (now - lastActiveReportTime >= REPORT_INTERVAL) {
      db.get(`SELECT COUNT(*) as count FROM ai_signals WHERE source = 'OPENCLAW' AND status = 'PENDING'`, [], (err, row) => {
        if (!err && row && row.count > 0) {
          sendActiveTradesStatusUpdate();
          lastActiveReportTime = now;
        }
      });
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
                      `*Expected Hold*: ⏳ ${actionData.expectedHoldTime}\n\n`;
                  }

                  // Save to DB FIRST (with duplicate guard) — get Trade ID before sending alert
                  let tradeIdStr = 'CLAW-MANUAL';
                  if (actionData.action === 'CALL' || actionData.action === 'PUT') {
                    // Duplicate guard: only save if no existing PENDING OPENCLAW trade for this symbol today
                    const todayIst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
                    const existing = await new Promise((res) => {
                      db.get(
                        `SELECT id FROM ai_signals WHERE symbol = ? AND source = 'OPENCLAW' AND status = 'PENDING' AND date(created_at, '+5.5 hours') = ?`,
                        [symbol, todayIst],
                        (e, row) => res(row)
                      );
                    });
                    if (!existing) {
                      try {
                        const newId = await saveOpenClawSignalToDb(symbol, actionData, indicators.spotPrice);
                        tradeIdStr = `CLAW-${symbol}-${newId}`;
                      } catch (dbErr) {
                        console.error('[Telegram Bot] DB save error:', dbErr.message);
                      }
                    } else {
                      tradeIdStr = `CLAW-${symbol}-${existing.id}`;
                      console.log(`[Telegram Bot] Duplicate guard: OPENCLAW signal for ${symbol} already exists (ID: ${existing.id}). Skipping DB insert.`);
                    }
                  }

                  let strategyLabel = 'TREND FOLLOWING (Trending Market)';
                  if (actionData.strategyUsed === 'RANGE_BOUND_MEAN_REVERSION') {
                    strategyLabel = 'RANGE SCALPING (Sideways Market)';
                  } else if (actionData.strategyUsed === 'SIT_OUT') {
                    strategyLabel = 'SIT OUT / NO TRADE';
                  }

                  const responseMsg = `🚨 *OpenClaw AI Trade Alert* 🚨\n\n` +
                    `*Trade ID*: \`${tradeIdStr}\`\n` +
                    `*Symbol*: ${symbol}\n` +
                    `*Action*: ${actionData.action === 'CALL' ? 'BUY CALL / BULLISH' : actionData.action === 'PUT' ? 'BUY PUT / BEARISH' : 'WAIT / NEUTRAL'}\n` +
                    `*Strategy*: ${strategyLabel}\n` +
                    `*Spot Price*: ${indicators.spotPrice || 'N/A'}\n` +
                    `*Confidence*: ${actionData.confidence}%\n` +
                    `*1H Trend*: ${escapeTgMd(indicators.hourlyTrend || 'N/A')}\n` +
                    `*ATM IV*: ${indicators.averageIv ? indicators.averageIv.toFixed(1) + '%' : 'N/A'}\n` +
                    `*Buy Range*: ${escapeTgMd(actionData.buyRange)}\n` +
                    `*Target 1*: ${escapeTgMd(actionData.target1)}\n` +
                    `*Target 2*: ${escapeTgMd(actionData.target2)}\n` +
                    `*Stoploss*: ${escapeTgMd(actionData.stoploss)}\n` +
                    `*Time (IST)*: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })}\n\n` +
                    optionDetails +
                    `*AI Summary*: ${escapeTgMd(actionData.summary)}\n\n` +
                    `🤖 Powered by OpenClaw AI Multi\-Agent Engine.`;

                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: responseMsg,
                    parse_mode: 'Markdown'
                  });
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
              } else if (text.startsWith('/alerts')) {
                const parts = text.split(' ');
                const status = (parts[1] || '').toLowerCase();
                if (status === 'on' || status === 'off') {
                  const dbVal = status === 'on' ? 'true' : 'false';
                  db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('auto_alerts_enabled', ?)`, [dbVal], async (err) => {
                    let replyText = err 
                      ? `❌ Failed to update alert settings: ${err.message}` 
                      : `🔔 Automatic background alerts are now turned *${status.toUpperCase()}*.`;
                    await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                      chat_id: currentTelegramChatId,
                      text: replyText,
                      parse_mode: 'Markdown'
                    });
                  });
                } else {
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `⚠️ Usage: \`/alerts on\` or \`/alerts off\``,
                    parse_mode: 'Markdown'
                  });
                }
              } else if (text.startsWith('/logs')) {
                const lastLogs = backgroundLogs.slice(-15);
                if (lastLogs.length === 0) {
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `ℹ️ No background logs recorded yet.`
                  });
                } else {
                  let logMsg = `📋 *OpenClaw Background Logs (Last 15):* \n\n\`\`\``;
                  lastLogs.forEach(l => {
                    logMsg += `[${l.timestamp}] ${l.text}\n`;
                  });
                  logMsg += `\`\`\``;
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: logMsg,
                    parse_mode: 'Markdown'
                  });
                }
              } else if (text.startsWith('/safeguards')) {
                const parts = text.split(' ');
                const status = (parts[1] || '').toLowerCase();
                if (status === 'on' || status === 'off') {
                  const dbVal = status === 'on' ? 'true' : 'false';
                  db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('strict_trend_filter', ?)`, [dbVal], async (err) => {
                    let replyText = err 
                      ? `❌ Failed to update safeguard settings: ${err.message}` 
                      : `🛡️ Strict Trend Filter safeguards are now turned *${status.toUpperCase()}*.`;
                    await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                      chat_id: currentTelegramChatId,
                      text: replyText,
                      parse_mode: 'Markdown'
                    });
                  });
                } else {
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `⚠️ Usage: \`/safeguards on\` or \`/safeguards off\``,
                    parse_mode: 'Markdown'
                  });
                }
              } else if (text.startsWith('/profile')) {
                const parts = text.split(' ');
                const profile = parts[1] || '';
                const validProfiles = ['micro_scalper', 'intraday_scalper', 'short_term_trend'];
                if (validProfiles.includes(profile)) {
                  db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('trading_profile', ?)`, [profile], async (err) => {
                    let replyText = err 
                      ? `❌ Failed to update trading profile: ${err.message}` 
                      : `⚙️ Trading profile successfully updated to *${profile.toUpperCase()}*.`;
                    await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                      chat_id: currentTelegramChatId,
                      text: replyText,
                      parse_mode: 'Markdown'
                    });
                  });
                } else {
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `⚠️ Usage: \`/profile [type]\`\nAvailable types:\n• \`micro_scalper\`\n• \`intraday_scalper\`\n• \`short_term_trend\``,
                    parse_mode: 'Markdown'
                  });
                }
              } else if (text.startsWith('/exit')) {
                const parts = text.split(' ');
                const symbol = (parts[1] || '').toUpperCase();
                if (symbol) {
                  const exitPrice = latestSpotPrices[symbol] || 0;
                  db.run(
                    `UPDATE ai_signals 
                     SET status = 'CLOSED', exit_time = CURRENT_TIMESTAMP, exit_price = ?, updated_at = CURRENT_TIMESTAMP 
                     WHERE symbol = ? AND status = 'PENDING' AND source = 'OPENCLAW'`,
                    [exitPrice, symbol],
                    async function (err) {
                      let replyText;
                      if (err) {
                        replyText = `❌ Error exiting trade: ${err.message}`;
                      } else if (this.changes > 0) {
                        replyText = `⏹️ Active *${symbol}* trade has been closed manually in database tracker.`;
                      } else {
                        replyText = `ℹ️ No active pending trade found for *${symbol}*.`;
                      }
                      await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                        chat_id: currentTelegramChatId,
                        text: replyText,
                        parse_mode: 'Markdown'
                      });
                    }
                  );
                } else {
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `⚠️ Usage: \`/exit [SYMBOL]\` (e.g. \`/exit NIFTY\`)`,
                    parse_mode: 'Markdown'
                  });
                }
              } else if (text.startsWith('/news')) {
                try {
                  const headlines = await fetchRecentFinancialNews();
                  if (headlines && headlines.length > 0) {
                    let newsMsg = `📰 *Top Financial Headlines:* \n\n`;
                    headlines.forEach((h, index) => {
                      newsMsg += `${index + 1}. *${h.title}*\n`;
                    });
                    await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                      chat_id: currentTelegramChatId,
                      text: newsMsg,
                      parse_mode: 'Markdown'
                    });
                  } else {
                    await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                      chat_id: currentTelegramChatId,
                      text: `ℹ️ No recent financial headlines found.`
                    });
                  }
                } catch (err) {
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `❌ Failed to fetch news: ${err.message}`
                  });
                }
              } else if (text.startsWith('/settings')) {
                try {
                  const settings = await getSystemSettings();
                  const pcrWeight = settings['pcr_weight'] || '40';
                  const chartWeight = settings['chart_weight'] || '40';
                  const newsWeight = settings['news_weight'] || '20';
                  const autoAlerts = settings['auto_alerts_enabled'] === 'true' ? '🟢 ENABLED' : '🔴 DISABLED';
                  const minConf = settings['auto_alerts_min_confidence'] || '75';
                  const profile = settings['trading_profile'] || 'intraday_scalper';
                  const slMultiplier = settings['stoploss_atr_multiplier'] || '1.5';
                  const trendFilter = settings['strict_trend_filter'] !== 'false' ? '🟢 ENABLED' : '🔴 DISABLED';
                  const walletBal = parseFloat(settings['paper_wallet_balance'] || '1000000').toLocaleString('en-IN', { style: 'currency', currency: 'INR' });

                  const settingsMsg = `⚙️ *Current System Settings:* \n\n` +
                    `• *Strict Trend Safeguard*: ${trendFilter}\n` +
                    `• *Stoploss ATR Multiplier*: ${slMultiplier}x\n` +
                    `• *Background Scanner Alerts*: ${autoAlerts}\n` +
                    `• *Min Auto-Alert Confidence*: ${minConf}%\n` +
                    `• *Trading Profile*: \`${profile}\`\n` +
                    `• *Paper Wallet Balance*: ${walletBal}\n` +
                    `• *Analysis Weights*: PCR: ${pcrWeight}% | Chart: ${chartWeight}% | News: ${newsWeight}%\n`;

                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: settingsMsg,
                    parse_mode: 'Markdown'
                  });
                } catch (err) {
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `❌ Failed to fetch settings: ${err.message}`
                  });
                }
              } else if (text.startsWith('/set_sl')) {
                const parts = text.split(' ');
                const val = parseFloat(parts[1]);
                if (isNaN(val) || val <= 0 || val > 10) {
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `⚠️ Usage: \`/set_sl [multiplier]\` (e.g. \`/set_sl 1.5\` or \`/set_sl 2.0\`). Value must be between 0.1 and 10.`
                  });
                } else {
                  db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('stoploss_atr_multiplier', ?)`, [String(val)], async (err) => {
                    const replyText = err 
                      ? `❌ Failed to update Stoploss ATR Multiplier: ${err.message}` 
                      : `📐 *Stoploss ATR Multiplier* is now set to *${val}x*.`;
                    await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                      chat_id: currentTelegramChatId,
                      text: replyText,
                      parse_mode: 'Markdown'
                    });
                    logToBackground(`Telegram updated stoploss_atr_multiplier to ${val}`);
                  });
                }
              } else if (text.startsWith('/set_min_conf')) {
                const parts = text.split(' ');
                const val = parseInt(parts[1], 10);
                if (isNaN(val) || val < 10 || val > 100) {
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `⚠️ Usage: \`/set_min_conf [confidence]\` (e.g. \`/set_min_conf 80\`). Value must be between 10 and 100.`
                  });
                } else {
                  db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('auto_alerts_min_confidence', ?)`, [String(val)], async (err) => {
                    const replyText = err 
                      ? `❌ Failed to update Minimum Confidence: ${err.message}` 
                      : `🎯 *Minimum Alert Confidence* is now set to *${val}%*.`;
                    await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                      chat_id: currentTelegramChatId,
                      text: replyText,
                      parse_mode: 'Markdown'
                    });
                    logToBackground(`Telegram updated auto_alerts_min_confidence to ${val}%`);
                  });
                }
              } else if (text.startsWith('/wallet')) {
                try {
                  const settings = await getSystemSettings();
                  const rawBal = parseFloat(settings['paper_wallet_balance'] || '1000000');
                  const balance = rawBal.toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
                  db.get(`SELECT COUNT(*) as count FROM paper_trades WHERE status = 'ACTIVE'`, [], async (err, row) => {
                    const activeCount = row ? row.count : 0;
                    const walletMsg = `💳 *Paper Trading Wallet Details:*\n\n` +
                      `• *Available Balance*: ${balance}\n` +
                      `• *Active Positions*: ${activeCount}\n\n` +
                      `Use \`/positions\` to see active trades, or \`/reset_wallet\` to wipe portfolio and reset balance.`;
                    await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                      chat_id: currentTelegramChatId,
                      text: walletMsg,
                      parse_mode: 'Markdown'
                    });
                  });
                } catch (err) {
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `❌ Failed to fetch wallet: ${err.message}`
                  });
                }
              } else if (text.startsWith('/positions')) {
                try {
                  if (isIndianMarketOpen()) {
                    await updateActivePaperTrades();
                  }
                  db.all(`SELECT * FROM paper_trades WHERE status = 'ACTIVE' ORDER BY created_at DESC`, [], async (err, rows) => {
                    if (err) {
                      await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                        chat_id: currentTelegramChatId,
                        text: `❌ Error fetching active paper trades: ${err.message}`
                      });
                      return;
                    }
                    if (!rows || rows.length === 0) {
                      await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                        chat_id: currentTelegramChatId,
                        text: `ℹ️ *No active paper trading positions.*`
                      });
                      return;
                    }
                    let posMsg = `📊 *Active Paper Trading Positions:* \n\n`;
                    rows.forEach(r => {
                      const pnlStr = r.pnl >= 0 ? `🟢 +₹${r.pnl.toFixed(2)}` : `🔴 -₹${Math.abs(r.pnl).toFixed(2)}`;
                      posMsg += `• *ID ${r.id}: ${r.contract_name}* (Qty: ${r.qty} lots)\n` +
                        `  Entry Premium: ₹${r.entry_premium.toFixed(2)} | Target: ₹${r.target_premium ? r.target_premium.toFixed(2) : 'N/A'} | SL: ₹${r.stoploss_premium ? r.stoploss_premium.toFixed(2) : 'N/A'}\n` +
                        `  Current P&L: *${pnlStr}*\n\n`;
                    });
                    await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                      chat_id: currentTelegramChatId,
                      text: posMsg,
                      parse_mode: 'Markdown'
                    });
                  });
                } catch (err) {
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `❌ Failed to load positions: ${err.message}`
                  });
                }
              } else if (text.startsWith('/close')) {
                const parts = text.split(' ');
                const target = parts[1];
                if (!target) {
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `⚠️ Usage: \`/close [ID]\` (e.g. \`/close 3\`) or \`/close [SYMBOL]\` (e.g. \`/close NIFTY\`) to exit active paper trades.`,
                    parse_mode: 'Markdown'
                  });
                  return;
                }

                const tradeId = parseInt(target, 10);
                let query = '';
                let queryParams = [];
                if (!isNaN(tradeId)) {
                  query = `SELECT * FROM paper_trades WHERE id = ? AND status = 'ACTIVE'`;
                  queryParams = [tradeId];
                } else {
                  query = `SELECT * FROM paper_trades WHERE symbol = ? AND status = 'ACTIVE'`;
                  queryParams = [target.toUpperCase()];
                }

                db.all(query, queryParams, async (err, rows) => {
                  if (err) {
                    await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                      chat_id: currentTelegramChatId,
                      text: `❌ Database error: ${err.message}`
                    });
                    return;
                  }
                  if (!rows || rows.length === 0) {
                    await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                      chat_id: currentTelegramChatId,
                      text: `ℹ️ No active paper positions found matching: *${target.toUpperCase()}*.`
                    });
                    return;
                  }

                  let closedList = [];
                  let errorCount = 0;
                  for (const row of rows) {
                    try {
                      const symbol = row.symbol;
                      const cacheKey = `${symbol}_first`;
                      const cached = getCachedData('optionChain', cacheKey, 300000);
                      if (!cached || !cached.data) {
                        errorCount++;
                        continue;
                      }

                      const cParts = row.contract_name.split(' ');
                      const strike = parseFloat(cParts[cParts.length - 2]);
                      const optType = cParts[cParts.length - 1];
                      const strikeData = cached.data.find(s => s.strike === strike);
                      if (!strikeData) {
                        errorCount++;
                        continue;
                      }

                      const exitLtp = optType === 'CE' ? strikeData.callLtp : strikeData.putLtp;
                      if (!exitLtp || exitLtp <= 0) {
                        errorCount++;
                        continue;
                      }

                      const settings = await getSystemSettings();
                      let balance = parseFloat(settings['paper_wallet_balance'] || '1000000');
                      let lotSize = 50;
                      if (symbol === 'NIFTY') lotSize = 50;
                      else if (symbol === 'BANKNIFTY') lotSize = 15;
                      else if (symbol === 'FINNIFTY') lotSize = 40;
                      else if (symbol === 'MIDCPNIFTY') lotSize = 75;

                      const totalQty = row.qty * lotSize;
                      const finalPnl = (exitLtp - row.entry_premium) * totalQty;
                      const requiredMargin = row.qty * lotSize * row.entry_premium;
                      const refundedMargin = requiredMargin + finalPnl;
                      const newBalance = balance + refundedMargin;

                      await new Promise((resolveUpdate) => {
                        db.serialize(() => {
                          db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('paper_wallet_balance', ?)`, [String(newBalance)]);
                          db.run(
                            `UPDATE paper_trades 
                             SET exit_premium = ?, exit_spot = ?, status = 'CLOSED', pnl = ?, updated_at = CURRENT_TIMESTAMP 
                             WHERE id = ?`,
                            [exitLtp, cached.spotPrice, finalPnl, row.id],
                            () => {
                              closedList.push(`ID ${row.id} (${row.contract_name}) P&L: ${finalPnl >= 0 ? '+' : ''}₹${finalPnl.toFixed(2)}`);
                              resolveUpdate();
                            }
                          );
                        });
                      });
                    } catch (e) {
                      errorCount++;
                    }
                  }

                  let replyText = `⏹️ *Position Close Summary:* \n\n`;
                  if (closedList.length > 0) {
                    replyText += `Closed positions:\n` + closedList.map(item => `• ${item}`).join('\n') + `\n\n`;
                  }
                  if (errorCount > 0) {
                    replyText += `❌ Failed to close ${errorCount} position(s) due to missing market/strike data in cache.\n`;
                  }
                  
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: replyText,
                    parse_mode: 'Markdown'
                  });
                });
              } else if (text.startsWith('/reset_wallet')) {
                db.serialize(() => {
                  db.run(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('paper_wallet_balance', '1000000')`);
                  db.run(`DELETE FROM paper_trades`, [], async (err) => {
                    const replyText = err 
                      ? `❌ Error resetting wallet: ${err.message}` 
                      : `🔄 *Paper wallet reset successfully!* Balance is back to *₹10,00,000.00* and all paper trades deleted.`;
                    await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                      chat_id: currentTelegramChatId,
                      text: replyText,
                      parse_mode: 'Markdown'
                    });
                    logToBackground(`Telegram reset the paper trading wallet balance and portfolio`);
                  });
                });
              } else if (text.startsWith('/chart')) {
                const parts = text.split(' ');
                const symbol = (parts[1] || 'NIFTY').toUpperCase();
                const cacheKey5m = `${symbol}_5`;
                const cachedChart = getCachedData('chartsIntraday', cacheKey5m, 3600000); 

                if (!cachedChart || !cachedChart.data || cachedChart.data.length === 0) {
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `❌ No 5M chart data found in cache for *${symbol}*. Please wait for sync run.`,
                    parse_mode: 'Markdown'
                  });
                  return;
                }

                try {
                  const candles = cachedChart.data;
                  const lastCandle = candles[candles.length - 1];
                  const spot = latestSpotPrices[symbol] || lastCandle.close;

                  // Simple technical calculations
                  const calculateEMAForBot = (cand, period) => {
                    if (!cand || cand.length === 0) return 0;
                    const k = 2 / (period + 1);
                    let ema = cand[0].close;
                    for (let i = 1; i < cand.length; i++) {
                      ema = (cand[i].close * k) + (ema * (1 - k));
                    }
                    return ema;
                  };

                  const calculateRSIForBot = (cand, period = 14) => {
                    if (!cand || cand.length < period) return 50;
                    let gains = 0;
                    let losses = 0;
                    for (let i = 1; i <= period; i++) {
                      const diff = cand[i].close - cand[i-1].close;
                      if (diff >= 0) gains += diff;
                      else losses -= diff;
                    }
                    let avgGain = gains / period;
                    let avgLoss = losses / period;
                    for (let i = period + 1; i < cand.length; i++) {
                      const diff = cand[i].close - cand[i-1].close;
                      const gain = diff >= 0 ? diff : 0;
                      const loss = diff < 0 ? -diff : 0;
                      avgGain = ((avgGain * (period - 1)) + gain) / period;
                      avgLoss = ((avgLoss * (period - 1)) + loss) / period;
                    }
                    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
                    return 100 - (100 / (1 + rs));
                  };

                  const ema9 = calculateEMAForBot(candles, 9);
                  const ema20 = calculateEMAForBot(candles, 20);
                  const rsi = calculateRSIForBot(candles, 14);

                  const trend = lastCandle.close > ema20 ? '📈 BULLISH (Above EMA 20)' : '📉 BEARISH (Below EMA 20)';
                  const crossover = ema9 > ema20 ? 'Bullish (EMA 9 > EMA 20)' : 'Bearish (EMA 9 < EMA 20)';

                  const chartMsg = `📊 *Intraday 5M Chart Technical Summary (${symbol}):* \n\n` +
                    `• *Current Spot Price*: ${spot.toFixed(2)}\n` +
                    `• *Last Candle Close*: ${lastCandle.close.toFixed(2)}\n` +
                    `• *EMA 9*: ${ema9.toFixed(2)} | *EMA 20*: ${ema20.toFixed(2)}\n` +
                    `• *EMA Trend*: ${trend}\n` +
                    `• *EMA Cross*: ${crossover}\n` +
                    `• *RSI (14)*: ${rsi.toFixed(2)} (${rsi > 70 ? '⚠️ Overbought' : rsi < 30 ? '⚠️ Oversold' : 'Neutral'})\n` +
                    `• *ATR Volatility*: ${latestAtrValues[symbol] || 'N/A'} pts\n`;

                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: chartMsg,
                    parse_mode: 'Markdown'
                  });
                } catch (calcErr) {
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `❌ Analysis calculation error: ${calcErr.message}`
                  });
                }
              } else if (text.startsWith('/optionchain')) {
                const parts = text.split(' ');
                const symbol = (parts[1] || 'NIFTY').toUpperCase();
                const cacheKey = `${symbol}_first`;
                const cached = getCachedData('optionChain', cacheKey, 3600000); 

                if (!cached || !cached.data) {
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `❌ No option chain data found in cache for *${symbol}*. Please wait for sync run.`,
                    parse_mode: 'Markdown'
                  });
                  return;
                }

                try {
                  const spot = cached.spotPrice;
                  const expiry = cached.expiry;
                  const strikesArray = cached.data;

                  const totalCallOi = strikesArray.reduce((sum, row) => sum + row.callOi, 0);
                  const totalPutOi = strikesArray.reduce((sum, row) => sum + row.putOi, 0);
                  const pcr = totalCallOi > 0 ? totalPutOi / totalCallOi : 1.0;

                  // Max Pain Strike calculation
                  let minLoss = Infinity;
                  let maxPainStrike = spot;
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

                  // Concentration Ratio
                  const callStrikes = [...strikesArray].sort((a,b) => b.callOi - a.callOi).slice(0, 3);
                  const putStrikes = [...strikesArray].sort((a,b) => b.putOi - a.putOi).slice(0, 3);
                  const topCallOi = callStrikes.reduce((sum, s) => sum + s.callOi, 0);
                  const topPutOi = putStrikes.reduce((sum, s) => sum + s.putOi, 0);
                  const concentrationRatio = topCallOi > 0 ? topPutOi / topCallOi : 1.0;

                  // Unwinding warnings
                  let unwindingWarning = 'No major unwinding detected.';
                  const callChangeTotal = strikesArray.reduce((sum, row) => sum + row.callChgOi, 0);
                  const putChangeTotal = strikesArray.reduce((sum, row) => sum + row.putChgOi, 0);
                  if (callChangeTotal < 0 && Math.abs(callChangeTotal) > totalCallOi * 0.05) {
                    unwindingWarning = '⚠️ *Call Unwinding detected!* Short-covering squeeze upside risk.';
                  } else if (putChangeTotal < 0 && Math.abs(putChangeTotal) > totalPutOi * 0.05) {
                    unwindingWarning = '⚠️ *Put Unwinding detected!* Long liquidation breakdown risk.';
                  }

                  const optionMsg = `📉 *Option Chain Snapshot (${symbol}):* \n\n` +
                    `• *Expiry*: ${expiry}\n` +
                    `• *Spot Price*: ${spot.toFixed(2)}\n` +
                    `• *Put-Call Ratio (PCR)*: ${pcr.toFixed(2)} (${pcr > 1.2 ? 'Bullish' : pcr < 0.8 ? 'Bearish' : 'Neutral Range'})\n` +
                    `• *Max Pain Strike*: ${maxPainStrike.toFixed(2)}\n` +
                    `• *Concentration Ratio*: ${concentrationRatio.toFixed(2)}\n` +
                    `• *Total Call OI*: ${totalCallOi.toLocaleString()}\n` +
                    `• *Total Put OI*: ${totalPutOi.toLocaleString()}\n` +
                    `• *Unwinding Status*: ${unwindingWarning}\n`;

                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: optionMsg,
                    parse_mode: 'Markdown'
                  });
                } catch (optErr) {
                  await axios.post(`https://api.telegram.org/bot${currentTelegramToken}/sendMessage`, {
                    chat_id: currentTelegramChatId,
                    text: `❌ Option chain analysis error: ${optErr.message}`
                  });
                }
              } else if (text.startsWith('/help') || text.startsWith('/start')) {
                const helpMsg = `🤖 *OpenClaw AI Bot - Complete Commands:* \n\n` +
                  `*Analysis & Status:*\n` +
                  `• \`/analyze [symbol]\` - Runs options & technical agent analysis.\n` +
                  `• \`/status\` - Shows active pending alerts and target/SL checks.\n` +
                  `• \`/chart [symbol]\` - Shows 5M chart technical metrics (EMA, RSI, ATR).\n` +
                  `• \`/optionchain [symbol]\` - Shows PCR, Max Pain, Concentration and warnings.\n` +
                  `• \`/news\` - Gets recent financial news headlines.\n\n` +
                  `*Settings Management:*\n` +
                  `• \`/settings\` - Displays all active system settings.\n` +
                  `• \`/safeguards on/off\` - Toggle Strict Trend Filter guards.\n` +
                  `• \`/alerts on/off\` - Toggle background automated alert generation.\n` +
                  `• \`/profile [type]\` - Set profile (\`micro_scalper\`, \`intraday_scalper\`, \`short_term_trend\`).\n` +
                  `• \`/set_sl [multiplier]\` - Set Stoploss ATR multiplier (e.g. \`/set_sl 1.5\`).\n` +
                  `• \`/set_min_conf [conf]\` - Set min confidence threshold (e.g. \`/set_min_conf 80\`).\n\n` +
                  `*Paper Trading Portfolio:*\n` +
                  `• \`/wallet\` - Displays paper wallet balance and active positions count.\n` +
                  `• \`/positions\` - Lists active paper trades with live dynamic PnL.\n` +
                  `• \`/close [ID/symbol]\` - Manually close a paper trade (e.g. \`/close 3\` or \`/close NIFTY\`).\n` +
                  `• \`/reset_wallet\` - Erase portfolio and reset balance to ₹10,00,000.\n` +
                  `• \`/exit [symbol]\` - Close background alerts for index symbol.\n\n` +
                  `• \`/help\` - Displays this detailed help menu.`;
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
