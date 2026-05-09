import React from 'react';
import { Clock } from 'lucide-react';

const MultiTrend = ({ activeSymbol }) => {
  const trends = [
    { tf: '5M', trend: 'Strong Bullish', color: 'var(--success)' },
    { tf: '15M', trend: 'Bullish', color: 'var(--success)' },
    { tf: '1H', trend: 'Neutral', color: 'var(--warning)' },
    { tf: '1D', trend: 'Bearish', color: 'var(--danger)' },
  ];

  return (
    <div className="glass-panel" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <Clock size={16} color="var(--primary)" />
        <h3 style={{ fontSize: '14px' }}>MULTI-TIMEFRAME TREND</h3>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {trends.map((t, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>{t.tf}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '40px', height: '4px', background: 'var(--border)', borderRadius: '10px' }}>
                <div style={{ width: '100%', height: '100%', background: t.color, borderRadius: '10px' }}></div>
              </div>
              <span style={{ fontSize: '11px', color: t.color, fontWeight: 700 }}>{t.trend}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MultiTrend;
