import React from 'react';
import { Globe, ArrowUpRight, ArrowDownRight } from 'lucide-react';

const GlobalMarkets = () => {
  const markets = [
    { name: 'GIFT NIFTY', value: '22,480', change: '+0.45%', status: 'up' },
    { name: 'NASDAQ', value: '16,340', change: '+1.12%', status: 'up' },
    { name: 'DOW JONES', value: '38,200', change: '-0.15%', status: 'down' },
  ];

  return (
    <div className="glass-panel" style={{ padding: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <Globe size={16} color="var(--primary)" />
        <span style={{ fontSize: '12px', fontWeight: 600 }}>GLOBAL CUES</span>
      </div>
      <div style={{ display: 'flex', gap: '16px', overflowX: 'auto' }}>
        {markets.map((m, idx) => (
          <div key={idx} className="glass-card" style={{ padding: '8px 12px', minWidth: '140px', borderLeft: `3px solid ${m.status === 'up' ? 'var(--success)' : 'var(--danger)'}` }}>
            <p style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{m.name}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700 }}>{m.value}</span>
              <span style={{ fontSize: '10px', color: m.status === 'up' ? 'var(--success)' : 'var(--danger)', display: 'flex', alignItems: 'center' }}>
                {m.status === 'up' ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                {m.change}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GlobalMarkets;
