import React, { useEffect, useRef, useState } from 'react';

const ChartAnalysis = () => {
  const containerRef = useRef();
  const [symbol, setSymbol] = useState('NSE:NIFTY');

  useEffect(() => {
    // Load TradingView script
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => {
      createWidget(symbol);
    };
    document.head.appendChild(script);

    return () => {
      // Cleanup if needed
    };
  }, []);

  // Re-create widget when symbol changes
  useEffect(() => {
    if (typeof TradingView !== 'undefined') {
      createWidget(symbol);
    }
  }, [symbol]);

  const createWidget = (sym) => {
    new TradingView.widget({
      width: '100%',
      height: 600,
      symbol: sym,
      interval: '5',
      timezone: 'Asia/Kolkata',
      theme: 'dark',
      style: '1',
      locale: 'en',
      toolbar_bg: '#111827',
      enable_publishing: false,
      hide_side_toolbar: false,
      allow_symbol_change: true,
      container_id: 'tv_chart_container',
      studies: [
        'RSI@tv-basicstudies',
        'MASimple@tv-basicstudies'
      ],
    });
  };

  return (
    <div className="container" style={{ padding: '2rem', color: 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem' }}>Chart Analysis</h1>
        
        <div style={{ display: 'flex', gap: '1rem' }}>
          <select 
            value={symbol} 
            onChange={(e) => setSymbol(e.target.value)}
            style={{ padding: '0.5rem', background: '#1E293B', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
          >
            <option value="NSE:NIFTY">NIFTY</option>
            <option value="NSE:BANKNIFTY">BANKNIFTY</option>
            <option value="NSE:CNXFINANCE">FINNIFTY</option>
          </select>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '1rem', minHeight: '620px' }}>
        <div id="tv_chart_container" style={{ height: '600px' }} />
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '2rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Note for AI Analysis</h3>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          This chart is powered by TradingView. For **AI Analysis**, the system directly fetches data from Dhan API in the backend, so you don't need to worry about missing data for AI analysis!
        </p>
      </div>
    </div>
  );
};

export default ChartAnalysis;
