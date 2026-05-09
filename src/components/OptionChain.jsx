import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Maximize2, Minimize2 } from 'lucide-react';

const OptionChain = ({ activeSymbol, data }) => {
  const [isDeepView, setIsDeepView] = useState(false);
  const isBN = activeSymbol === 'BANKNIFTY';
  const pcr = data.pcr;
  
  const strikes = data.strikes.map(s => ({
    strike: s,
    callOI: (Math.random() * 5).toFixed(1) + 'M',
    putOI: (Math.random() * 5).toFixed(1) + 'M',
    oiChange: (Math.random() * 200 - 100).toFixed(1) + '%',
    volume: (Math.random() * 10).toFixed(1) + 'K',
    trend: Math.random() > 0.5 ? 'bullish' : 'bearish'
  }));

  return (
    <div className="glass-panel" style={{ 
      padding: '16px', 
      display: 'flex', 
      flexDirection: 'column', 
      gap: '16px',
      position: isDeepView ? 'fixed' : 'relative',
      top: isDeepView ? '50px' : 'auto',
      left: isDeepView ? '50px' : 'auto',
      right: isDeepView ? '50px' : 'auto',
      bottom: isDeepView ? '50px' : 'auto',
      zIndex: isDeepView ? 1000 : 1,
      background: isDeepView ? '#0a0b0f' : 'rgba(255, 255, 255, 0.03)',
      boxShadow: isDeepView ? '0 0 50px rgba(0,0,0,0.9)' : 'none',
      overflow: 'auto',
      transition: 'all 0.3s ease'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '15px' }}>OPTION CHAIN {isDeepView && '(DEEP ANALYSIS)'}</h3>
        <button 
          onClick={() => setIsDeepView(!isDeepView)}
          style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          {isDeepView ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          <span style={{ fontSize: '11px' }}>{isDeepView ? 'CLOSE' : 'DEEP VIEW'}</span>
        </button>
      </div>

      <div className="glass-card" style={{ padding: '12px', textAlign: 'center', border: '1px solid var(--primary-glow)' }}>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>PUT CALL RATIO (PCR)</p>
        <h2 style={{ fontSize: '28px', color: 'var(--primary)' }}>{pcr}</h2>
        <span style={{ fontSize: '12px', color: pcr >= 1 ? 'var(--success)' : 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
          {pcr >= 1 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {pcr >= 1 ? 'BULLISH TREND' : 'BEARISH TREND'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: isDeepView ? '1fr 1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', fontSize: '10px', color: 'var(--text-muted)', padding: '0 8px' }}>
          <span>CALL OI</span>
          {isDeepView && <span>OI CHG%</span>}
          <span style={{ textAlign: 'center' }}>STRIKE</span>
          {isDeepView && <span>VOLUME</span>}
          <span style={{ textAlign: 'right' }}>PUT OI</span>
        </div>

        {strikes.map((s, idx) => (
          <div key={idx} className="glass-card" style={{ 
            display: 'grid', 
            gridTemplateColumns: isDeepView ? '1fr 1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', 
            padding: '10px 12px', 
            alignItems: 'center',
            background: s.trend === 'bullish' ? 'rgba(0, 255, 136, 0.03)' : 'rgba(255, 62, 62, 0.03)',
            borderLeft: `3px solid ${s.trend === 'bullish' ? 'var(--success)' : 'var(--danger)'}`
          }}>
            <span style={{ fontSize: '12px', fontWeight: 600 }}>{s.callOI}</span>
            {isDeepView && <span style={{ fontSize: '11px', color: s.oiChange.startsWith('-') ? 'var(--danger)' : 'var(--success)' }}>{s.oiChange}</span>}
            <span style={{ textAlign: 'center', fontSize: '13px', fontWeight: 800, color: 'var(--primary)' }}>{s.strike}</span>
            {isDeepView && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{s.volume}</span>}
            <span style={{ textAlign: 'right', fontSize: '12px', fontWeight: 600 }}>{s.putOI}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 'auto' }}>
        <button className="glass-card" style={{ width: '100%', padding: '10px', border: 'none', background: 'rgba(255,255,255,0.05)', color: 'white', fontSize: '12px', cursor: 'pointer' }}>
          VIEW FULL OPTION CHAIN
        </button>
      </div>
    </div>
  );
};

export default OptionChain;
