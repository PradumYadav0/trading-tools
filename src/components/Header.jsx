import React from 'react';
import { Activity, ShieldCheck, Zap } from 'lucide-react';

const Header = ({ activeSymbol, setActiveSymbol }) => {
  const [time, setTime] = React.useState(new Date());

  React.useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [isMuted, setIsMuted] = React.useState(false);

  return (
    <header className="glass-panel" style={{ padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ background: 'var(--primary)', padding: '8px', borderRadius: '8px', display: 'flex' }}>
          <Activity color="black" size={24} />
        </div>
        <div>
          <h1 style={{ fontSize: '20px', margin: 0 }}>TRADING <span className="text-gradient">PRO AI</span></h1>
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            {['BANKNIFTY', 'NIFTY'].map(s => (
              <button 
                key={s}
                onClick={() => setActiveSymbol(s)}
                style={{ 
                  padding: '4px 12px', 
                  fontSize: '11px', 
                  borderRadius: '6px',
                  border: activeSymbol === s ? '1px solid var(--primary)' : '1px solid var(--border)', 
                  background: activeSymbol === s ? 'rgba(0, 255, 136, 0.1)' : 'transparent', 
                  color: activeSymbol === s ? 'white' : 'var(--text-muted)', 
                  fontWeight: activeSymbol === s ? 800 : 400,
                  cursor: 'pointer',
                  boxShadow: activeSymbol === s ? '0 0 10px rgba(0, 255, 136, 0.2)' : 'none',
                  transition: 'all 0.2s ease'
                }}
              >{s}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Center Highlight Badge */}
      <div style={{ 
        padding: '8px 40px', 
        background: 'rgba(0, 255, 136, 0.05)', 
        border: '1px solid var(--primary)', 
        borderRadius: '30px',
        boxShadow: '0 0 20px rgba(0, 255, 136, 0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--primary)', boxShadow: '0 0 10px var(--primary)' }}></div>
        <span style={{ fontSize: '18px', fontWeight: 900, color: 'white', letterSpacing: '2px' }}>{activeSymbol}</span>
      </div>
      
      <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
        {/* Real-time System Clock */}
        <div style={{ textAlign: 'right', borderRight: '1px solid var(--border)', paddingRight: '15px' }}>
          <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>SYSTEM TIME</p>
          <span style={{ fontSize: '14px', fontWeight: 800, fontFamily: 'monospace' }}>
            {time.toLocaleTimeString()}
          </span>
        </div>

        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>LAST SYNC</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 8px var(--success)' }}></div>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>{new Date().toLocaleTimeString()}</span>
          </div>
        </div>
        
        <div className="glass-card" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <ShieldCheck size={16} color="var(--primary)" />
          <span style={{ fontSize: '13px' }}>Paper Trading Mode</span>
        </div>

        <button className="glass-card" style={{ padding: '8px 16px', background: 'var(--primary)', color: 'black', fontWeight: 600, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Zap size={16} />
          GO PRO
        </button>
      </div>
    </header>
  );
};

export default Header;
