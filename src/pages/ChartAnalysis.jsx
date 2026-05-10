import React, { useState, useEffect } from 'react';
import { Activity, Crosshair, Zap, BarChart2 } from 'lucide-react';

const ChartAnalysis = ({ activeSymbol, data }) => {
  const [aiInsight, setAiInsight] = useState("AI is scanning the chart for patterns...");

  useEffect(() => {
    // Simulate Gemini AI chart analysis fetching
    setTimeout(() => {
       const isBullish = parseFloat(data?.pcr || 1) > 1;
       if (activeSymbol === 'BANKNIFTY') {
         setAiInsight(`BankNifty is forming a strong base around the ${isBullish ? 'support' : 'resistance'} levels. The 5-minute chart shows a potential ${isBullish ? 'Double Bottom breakout' : 'Head and Shoulders breakdown'}. Smart money is ${isBullish ? 'accumulating' : 'distributing'} here.`);
       } else {
         setAiInsight(`Nifty 50 chart structure is ${isBullish ? 'bullish' : 'bearish'}. We can see a clear trendline ${isBullish ? 'support holding strong' : 'resistance rejecting prices'}. Wait for the 15-minute candle to close before taking an entry.`);
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
           <iframe 
             key={tvSymbol}
             title="Advanced Chart"
             src={`https://s.tradingview.com/widgetembed/?frameElementId=tradingview_123&symbol=${tvSymbol}&interval=5&hidesidetoolbar=1&symboledit=1&saveimage=1&toolbarbg=131722&studies=%5B%5D&theme=dark&style=1&timezone=Asia%2FKolkata&studies_overrides=%7B%7D&overrides=%7B%7D&enabled_features=%5B%5D&disabled_features=%5B%5D&locale=in&utm_source=&utm_medium=widget&utm_campaign=chart&utm_term=${tvSymbol}`}
             style={{ width: '100%', height: '100%', border: 'none' }}
           ></iframe>
        </div>

        {/* Right Side Tools */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {/* AI Scanner Box */}
          <div className="glass-panel" style={{ padding: '20px', background: 'linear-gradient(135deg, rgba(0,255,136,0.05) 0%, transparent 100%)', flex: 1 }}>
             <h3 style={{ fontSize: '14px', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
               <Zap size={16} /> LIVE AI CHART VERDICT
             </h3>
             <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.8' }}>
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

export default ChartAnalysis;
