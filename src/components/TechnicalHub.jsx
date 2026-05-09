import React from 'react';
import { Activity, Zap, BarChart3, Fingerprint } from 'lucide-react';

const TechnicalHub = ({ activeSymbol, data }) => {
  const indicators = [
    { name: 'RSI (14)', value: data.rsi || '50.0', status: data.rsi > 70 ? 'Overbought' : data.rsi < 30 ? 'Oversold' : 'Neutral', color: data.rsi > 70 ? 'var(--danger)' : data.rsi < 30 ? 'var(--success)' : 'var(--warning)' },
    { name: 'EMA 20/50', value: 'Golden Cross', status: 'Bullish', color: 'var(--success)' },
    { name: 'VWAP', value: activeSymbol === 'BANKNIFTY' ? 'Above' : 'Below', status: 'Trend Support', color: activeSymbol === 'BANKNIFTY' ? 'var(--success)' : 'var(--danger)' },
  ];

  return (
    <div className="glass-panel" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <Zap color="var(--primary)" size={20} />
        <h3 style={{ fontSize: '15px' }}>TECHNICAL INDICATORS</h3>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        {indicators.map((ind, idx) => (
          <div key={idx} className="glass-card" style={{ padding: '12px', borderBottom: `2px solid ${ind.color}` }}>
            <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{ind.name}</p>
            <p style={{ fontSize: '14px', fontWeight: 600, margin: '4px 0' }}>{ind.value}</p>
            <span style={{ fontSize: '10px', color: ind.color, fontWeight: 700 }}>{ind.status}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>TREND STRENGTH</span>
          <span style={{ fontSize: '12px', color: 'var(--primary)' }}>85% BULLISH</span>
        </div>
        <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', overflow: 'hidden' }}>
          <div style={{ width: '85%', height: '100%', background: 'linear-gradient(90deg, var(--success), var(--primary))', boxShadow: '0 0 10px var(--primary-glow)' }}></div>
        </div>
      </div>

      <div style={{ marginTop: '20px', display: 'flex', gap: '16px' }}>
        <div className="glass-card" style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Activity size={16} color="var(--success)" />
          <div>
            <p style={{ fontSize: '9px', color: 'var(--text-muted)' }}>VOLATILITY</p>
            <p style={{ fontSize: '12px', fontWeight: 600 }}>MEDIUM</p>
          </div>
        </div>
        <div className="glass-card" style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <BarChart3 size={16} color="var(--primary)" />
          <div>
            <p style={{ fontSize: '9px', color: 'var(--text-muted)' }}>VOLUME</p>
            <p style={{ fontSize: '12px', fontWeight: 600 }}>HIGH SURGE</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TechnicalHub;
