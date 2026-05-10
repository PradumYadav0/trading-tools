const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const kotakNeo = require('./services/kotakNeoService');
const dbService = require('./services/DatabaseService');
const newsService = require('./services/NewsService');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Live News Endpoint
app.get('/api/news', async (req, res) => {
  const news = await newsService.getLiveNews();
  res.json({ success: true, data: news });
});

// Dynamic Market Data Generator
const getMockData = (symbol) => {
  const isBN = symbol === 'BANKNIFTY';
  const basePrice = isBN ? 48200 : 22400;
  const randomMove = 25.50; // Frozen value
  const currentPrice = basePrice + randomMove;
  const pcr = 1.15;
  
  return {
    symbol,
    price: currentPrice.toFixed(2),
    change: (randomMove / basePrice * 100).toFixed(2),
    pcr: pcr,
    rsi: (40 + Math.random() * 30).toFixed(1),
    isMarketOpen: false,
    strikes: Array.from({ length: 21 }, (_, i) => {
      const step = isBN ? 100 : 50;
      const start = basePrice - (step * 10);
      return start + (i * step);
    }),
    signals: {
      type: pcr > 1.1 ? 'BUY' : pcr < 0.8 ? 'SELL' : 'NONE',
      strike: isBN ? '48100 CE' : '22400 CE',
      target: (currentPrice + (isBN ? 200 : 50)).toFixed(2),
      sl: (currentPrice - (isBN ? 100 : 30)).toFixed(2)
    }
  };
};

// Endpoint to get Market Data
app.get('/api/market-data', (req, res) => {
  const { symbol } = req.query;
  const data = getMockData(symbol || 'BANKNIFTY');
  res.json(data);
});

// Option Chain Endpoint with Greeks
app.get('/api/option-chain', async (req, res) => {
  const { symbol, expiry } = req.query;
  const isBN = symbol === 'BANKNIFTY';
  const basePrice = isBN ? 48200 : 22400; // Will be replaced by live Spot price
  const step = isBN ? 100 : 50;
  
  let options = [];
  
  try {
     // STRICTLY USE KOTAK NEO API
     // This will only work if Kotak Neo is successfully connected and Tokens are loaded
     if (kotakNeo.sessionToken && kotakNeo.masterScripLoaded) {
         const tokens = kotakNeo.getOptionTokens(symbol || 'NIFTY');
         if (tokens && tokens.length > 0) {
             const liveData = await kotakNeo.getQuotes(tokens);
             // Logic to map liveData back into the options array will go here
             // Using OptionMath.js to calculate Greeks
         }
     }
  } catch (error) {
     console.error('Failed to fetch from Kotak', error);
  }

  // If market is closed or Kotak not mapped yet, show frozen framework 
  // (We don't use Math.random() so it stays frozen, and we don't use NSE so there's no delay data)
  if (options.length === 0) {
      for (let i = -25; i <= 25; i++) {
        const strike = basePrice + (i * step);
        options.push({
          strike: strike,
          CE: { ltp: "---", oi: 0, volume: 0, iv: "0.00", delta: "0.00", theta: "0.00", gamma: "0.00", vega: "0.00" },
          PE: { ltp: "---", oi: 0, volume: 0, iv: "0.00", delta: "0.00", theta: "0.00", gamma: "0.00", vega: "0.00" }
        });
      }
  }

  // Save the current snapshot to the Database for historical backtesting
  await dbService.saveOptionChain(symbol || 'NIFTY', basePrice, options);

  res.json({
    success: true,
    symbol: symbol || 'NIFTY',
    spotPrice: basePrice,
    data: options
  });
});

// Historical Option Chain Endpoint (from Database)
app.get('/api/historical-option-chain', async (req, res) => {
  const { symbol, limit } = req.query;
  try {
    const data = await dbService.getHistoricalOptionChain(symbol || 'NIFTY', parseInt(limit) || 10);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch historical data' });
  }
});

const { GoogleGenAI } = require('@google/genai');

// AI Insights Endpoint (Using Gemini API)
app.post('/api/ai-insights', async (req, res) => {
  const { symbol, data } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    return res.json({ insight: "Gemini API key is missing. Please add GEMINI_API_KEY in the Settings or .env file." });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: apiKey });
    
    const prompt = `You are an expert quantitative stock market analyst. Analyze this live options data for ${symbol}. 
    Current Price: ${data.price}. PCR: ${data.pcr}. 
    Data: ${JSON.stringify(data.signals)}
    
    Give a sharp, 3-sentence professional verdict on the trend and where the smart money is moving. Mention Support, Resistance, and whether to Buy/Sell/Wait.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5',
      contents: prompt,
    });

    res.json({ insight: response.text });
  } catch (error) {
    console.error("Gemini API Error:", error);
    res.json({ insight: "AI Analysis failed to process current market data." });
  }
});

// Kotak Neo Login Endpoint
app.post('/api/kotak/login', async (req, res) => {
    try {
        const result = await kotakNeo.login();
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Kotak Neo TOTP Validation
app.post('/api/kotak/validate-totp', async (req, res) => {
    const { totp } = req.body;
    try {
        const token = await kotakNeo.validateTOTP(totp);
        res.json({ success: true, token });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Real Market Data (Optional if connected)
app.get('/api/kotak/quotes', async (req, res) => {
    const { symbols } = req.query;
    try {
        const quotes = await kotakNeo.getQuotes(symbols.split(','));
        res.json({ success: true, data: quotes });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
