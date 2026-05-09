import React from 'react';
import { BrainCircuit, Info, Timer } from 'lucide-react';

const SignalPanel = ({ activeSymbol, data }) => {
  const isBN = activeSymbol === 'BANKNIFTY';
  const hasSignal = data.signals.type !== 'NONE';

  return (
    <div className="glass-panel" style={{ padding: '24px', border: 'none', background: hasSignal ? 'rgba(0, 255, 136, 0.03)' : 'rgba(255, 184, 0, 0.03)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
        <div style={{ padding: '8px', background: hasSignal ? 'var(--success)' : 'var(--warning)', borderRadius: '10px' }}>
          <BrainCircuit color="black" size={24} />
        </div>
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: 800 }}>{hasSignal ? 'BUY SIGNAL' : 'NO SIGNAL'}</h3>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>AI REAL-TIME VERDICT</p>
        </div>
      </div>

      {!hasSignal ? (
        <div style={{ textAlign: 'center', padding: '30px 0' }}>
          <Timer size={40} color="var(--warning)" style={{ marginBottom: '16px', opacity: 0.5 }} />
          <h2 style={{ color: 'var(--warning)', fontSize: '20px', letterSpacing: '1px' }}>WAITING...</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '10px' }}>
            No high-probability setups found. Patience pays in trading.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: '42px', fontWeight: 900, color: 'var(--success)', textShadow: '0 0 20px rgba(0, 255, 136, 0.3)' }}>
              {data.signals.strike}
            </h1>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>RECOMMENDED ENTRY PRICE</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className="glass-card" style={{ padding: '16px', textAlign: 'center', background: 'rgba(255,255,255,0.02)' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>TARGET</p>
              <p style={{ fontSize: '22px', fontWeight: 800, color: 'var(--success)' }}>₹{data.signals.target}</p>
            </div>
            <div className="glass-card" style={{ padding: '16px', textAlign: 'center', background: 'rgba(255,255,255,0.02)' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>STOP LOSS</p>
              <p style={{ fontSize: '22px', fontWeight: 800, color: 'var(--danger)' }}>₹{data.signals.sl}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SignalPanel;
