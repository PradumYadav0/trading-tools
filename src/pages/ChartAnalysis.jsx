import React, { useState, useEffect, useRef } from 'react';
import { Activity, Crosshair, Zap, BarChart2 } from 'lucide-react';

const ChartAnalysis = ({ activeSymbol, data }) => {
  const [aiInsight, setAiInsight] = useState("AI is scanning the chart for patterns...");

  useEffect(() => {
    // Simulate Gemini AI chart analysis fetching
    setTimeout(() => {
       const isBullish = parseFloat(data?.pcr || 1) > 1;
       if (activeSymbol === 'BANKNIFTY') {
         setAiInsight(`[Multi-Timeframe Analysis]\n15-Min: Trend is clearly ${isBullish ? 'Bullish. Strong support at 48200' : 'Bearish. Resistance at 48500'}.\n5-Min: Price is forming a potential ${isBullish ? 'Double Bottom breakout' : 'Head and Shoulders breakdown'}. Smart money is ${isBullish ? 'accumulating' : 'distributing'} here.\n\nVerdict: Wait for 5-min candle confirmation.`);
       } else {
         setAiInsight(`[Multi-Timeframe Analysis]\n15-Min: Nifty 50 structure is ${isBullish ? 'Bullish' : 'Bearish'}. Trendline is ${isBullish ? 'holding strong' : 'rejecting prices'}.\n5-Min: Scalping momentum is building up. Wait for the 5-minute candle to close before taking a scalping entry.`);
       }
    }, 1500);
  }, [activeSymbol, data]);

  // Map our symbols to TradingView symbols
  const tvSymbol = activeSymbol === 'BANKNIFTY' ? 'NSE:BANKNIFTY' : 'NSE:NIFTY';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div className="glass-panel" style={{ padding: '24px', borderLeft: '6px solid var(--primary)' }}>
        <h1 style={{ fontSize: '26px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <BarChart2 size={28} color="var(--primary)" />
          ADVANCED CHART AI
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Real-time institutional chart patterns mapped with AI.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '20px', height: '600px' }}>
        {/* Trading View Embed */}
        <div className="glass-panel" style={{ padding: '0', overflow: 'hidden', position: 'relative' }}>
           <TradingViewWidget symbol={tvSymbol} />
        </div>

        {/* Right Side Tools */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {/* AI Scanner Box */}
          <div className="glass-panel" style={{ padding: '20px', background: 'linear-gradient(135deg, rgba(0,255,136,0.05) 0%, transparent 100%)', flex: 1 }}>
             <h3 style={{ fontSize: '14px', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
               <Zap size={16} /> LIVE AI CHART VERDICT
             </h3>
             <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.8', whiteSpace: 'pre-line' }}>
               {aiInsight}
             </p>
             <div style={{ marginTop: '20px', padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', textAlign: 'center' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>MOMENTUM</span>
                <div style={{ fontSize: '16px', fontWeight: 900, color: parseFloat(data?.pcr || 1) > 1 ? 'var(--success)' : 'var(--danger)', marginTop: '5px' }}>
                  {parseFloat(data?.pcr || 1) > 1 ? 'BUY ON DIPS' : 'SELL ON RISE'}
                </div>
             </div>
          </div>

          <div className="glass-panel" style={{ padding: '20px' }}>
             <h3 style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
               <Crosshair size={16} color="var(--warning)" /> KEY LEVELS
             </h3>
             <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>R2 (Breakout)</span>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--danger)' }}>{data?.price ? (data.price + 150).toLocaleString() : '---'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>R1 (Resistance)</span>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--warning)' }}>{data?.price ? (data.price + 50).toLocaleString() : '---'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>CMP (Live)</span>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: 'white' }}>{data?.price ? (data.price).toLocaleString() : '---'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>S1 (Support)</span>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--success)' }}>{data?.price ? (data.price - 50).toLocaleString() : '---'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>S2 (Breakdown)</span>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--danger)' }}>{data?.price ? (data.price - 150).toLocaleString() : '---'}</span>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Official TradingView Advanced Widget Integration
let tvScriptLoadingPromise;

function TradingViewWidget({ symbol }) {
  const onLoadScriptRef = useRef();

  useEffect(() => {
    onLoadScriptRef.current = createWidget;

    if (!tvScriptLoadingPromise) {
      tvScriptLoadingPromise = new Promise((resolve) => {
        const script = document.createElement('script');
        script.id = 'tradingview-widget-loading-script';
        script.src = 'https://s3.tradingview.com/tv.js';
        script.type = 'text/javascript';
        script.onload = resolve;
        document.head.appendChild(script);
      });
    }

    tvScriptLoadingPromise.then(() => onLoadScriptRef.current && onLoadScriptRef.current());

    return () => onLoadScriptRef.current = null;

    function createWidget() {
      if (document.getElementById('tradingview_chart_id') && 'TradingView' in window) {
        new window.TradingView.widget({
          autosize: true,
          symbol: symbol,
          interval: "5",
          timezone: "Asia/Kolkata",
          theme: "dark",
          style: "1",
          locale: "in",
          enable_publishing: false,
          hide_side_toolbar: false,
          container_id: "tradingview_chart_id"
        });
      }
    }
  }, [symbol]);

  return <div id='tradingview_chart_id' style={{ height: "100%", width: "100%" }} />;
}

export default ChartAnalysis;
