import React from 'react';
import { Target } from 'lucide-react';

const OptionGreeks = ({ activeSymbol }) => {
  const greeks = [
    { name: 'DELTA', value: activeSymbol === 'BANKNIFTY' ? '0.52' : '0.48', info: 'Price sensitivity' },
    { name: 'THETA', value: activeSymbol === 'BANKNIFTY' ? '-45.2' : '-12.5', info: 'Time decay' },
    { name: 'VEGA', value: '18.4', info: 'Volatility sensitivity' },
    { name: 'GAMMA', value: '0.002', info: 'Delta change rate' },
  ];

  return (
    <div className="glass-panel" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <Target size={18} color="var(--primary)" />
        <h3 style={{ fontSize: '14px' }}>OPTION GREEKS</h3>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        {greeks.map((g, idx) => (
          <div key={idx} className="glass-card" style={{ padding: '10px', background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{g.name}</span>
            </div>
            <p style={{ fontSize: '15px', fontWeight: 700, margin: '2px 0' }}>{g.value}</p>
            <p style={{ fontSize: '8px', color: 'var(--text-muted)' }}>{g.info}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default OptionGreeks;
