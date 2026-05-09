import React from 'react';

const FullOptionChain = ({ activeSymbol, data }) => {
  const isBN = activeSymbol === 'BANKNIFTY';
  const strikes = data.strikes.map(s => ({
    strike: s,
    callOI: (Math.random() * 10).toFixed(1) + 'L',
    callChg: (Math.random() * 200 - 100).toFixed(1) + '%',
    callVol: (Math.random() * 50).toFixed(1) + 'K',
    callLtp: (Math.random() * 500 + 100).toFixed(1),
    putLtp: (Math.random() * 500 + 100).toFixed(1),
    putVol: (Math.random() * 50).toFixed(1) + 'K',
    putChg: (Math.random() * 200 - 100).toFixed(1) + '%',
    putOI: (Math.random() * 10).toFixed(1) + 'L',
  }));

  return (
    <div className="glass-panel" style={{ padding: '0', overflow: 'hidden', border: '1px solid var(--primary-glow)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', background: 'rgba(255,255,255,0.05)', padding: '12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ color: 'var(--danger)', textAlign: 'center', fontSize: '10px', fontWeight: 800 }}>CALL OI</div>
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '10px' }}>CHG %</div>
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '10px' }}>VOL</div>
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '10px' }}>LTP</div>
        <div style={{ color: 'var(--primary)', textAlign: 'center', fontSize: '11px', fontWeight: 900 }}>STRIKE</div>
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '10px' }}>LTP</div>
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '10px' }}>VOL</div>
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '10px' }}>CHG %</div>
        <div style={{ color: 'var(--success)', textAlign: 'center', fontSize: '10px', fontWeight: 800 }}>PUT OI</div>
      </div>

      <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
        {strikes.map((s, idx) => {
          const isATM = Math.abs(s.strike - data.price) < (isBN ? 51 : 26);
          return (
            <div key={idx} style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(9, 1fr)', 
              padding: '14px 12px', 
              borderBottom: '1px solid rgba(255,255,255,0.02)',
              background: isATM ? 'rgba(0, 255, 255, 0.1)' : (idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)'),
              borderLeft: isATM ? '4px solid var(--primary)' : 'none',
              transition: 'background 0.2s ease',
              position: 'relative'
            }} className="hover-highlight">
              {isATM && <span style={{ position: 'absolute', left: '0', top: '0', fontSize: '8px', background: 'var(--primary)', color: 'black', padding: '0 4px', fontWeight: 900 }}>ATM</span>}
              <div style={{ textAlign: 'center', fontSize: '12px', fontWeight: 600 }}>{s.callOI}</div>
              <div style={{ textAlign: 'center', fontSize: '11px', color: s.callChg.startsWith('-') ? 'var(--danger)' : 'var(--success)' }}>{s.callChg}</div>
              <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>{s.callVol}</div>
              <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--danger)' }}>{s.callLtp}</div>
              <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 800, color: 'var(--primary)', background: 'rgba(0, 255, 136, 0.05)', borderRadius: '4px' }}>{s.strike}</div>
              <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--success)' }}>{s.putLtp}</div>
              <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>{s.putVol}</div>
              <div style={{ textAlign: 'center', fontSize: '11px', color: s.putChg.startsWith('-') ? 'var(--danger)' : 'var(--success)' }}>{s.putChg}</div>
              <div style={{ textAlign: 'center', fontSize: '12px', fontWeight: 600 }}>{s.putOI}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FullOptionChain;
