const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Dynamic Market Data Generator
const getMockData = (symbol) => {
  const isBN = symbol === 'BANKNIFTY';
  const basePrice = isBN ? 48200 : 22400;
  const randomMove = (Math.random() * 100 - 50);
  const currentPrice = basePrice + randomMove;
  const pcr = (0.8 + Math.random() * 0.6).toFixed(2);
  
  return {
    symbol,
    price: currentPrice.toFixed(2),
    change: (randomMove / basePrice * 100).toFixed(2),
    pcr: pcr,
    rsi: (40 + Math.random() * 30).toFixed(1),
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

// AI Insights Endpoint (Future Gemini Integration)
app.post('/api/ai-insights', async (req, res) => {
  const { symbol, data } = req.body;
  
  // Logic-based AI response for now
  let insight = "";
  if (symbol === 'BANKNIFTY') {
    insight = "Bank Nifty is showing a 'Morning Star' pattern on 5m chart. OI suggests strong support at 48000. Trend is likely to continue towards 48500.";
  } else {
    insight = "Nifty is consolidating near 22450. Wait for a clear break above 22500 for a fresh long position.";
  }

  res.json({ insight });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
