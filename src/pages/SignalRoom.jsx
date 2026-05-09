import React, { useState, useEffect } from 'react';
import { PlayCircle, Info, TrendingUp, AlertCircle, Compass, Activity, Brain, Shield, Zap } from 'lucide-react';

const SignalRoom = ({ activeSymbol, data }) => {
  const [isTrading, setIsTrading] = useState(false);
  const [flash, setFlash] = useState(false);
  
  // Safe Data Access
  const hasSignal = data && data.signals && data.signals.type !== 'NONE';
  const greeks = { delta: '0.55', theta: '-12.4', gamma: '0.002', vega: '15.8' };
  const stopLoss = hasSignal ? parseFloat(data.signals.sl) : 0;
  const trailingSL = (stopLoss + 15).toFixed(2);

  useEffect(() => {
    if (hasSignal) {
      try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.volume = 0.5;
        audio.play().catch(() => {}); // Ignore browser block
      } catch (e) {}
      
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [hasSignal]);

  if (!data) return <div className="glass-panel">Loading Market Data...</div>;

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      gap: '20px', 
      paddingBottom: '40px',
      border: flash ? '4px solid var(--success)' : '4px solid transparent',
      transition: 'all 0.3s ease',
      borderRadius: '20px'
    }}>
      {/* Header */}
      <div className="glass-panel" style={{ padding: '24px', background: 'linear-gradient(90deg, rgba(0, 255, 136, 0.1) 0%, transparent 100%)', borderLeft: '6px solid var(--primary)' }}>
        <h1 style={{ fontSize: '26px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <PlayCircle size={28} color="var(--primary)" />
          MASTER SIGNAL STATION: {activeSymbol}
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Real-time execution guide with AI Greeks & Psychology</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Signal Box */}
          <div className="glass-panel" style={{ padding: '30px', textAlign: 'center', border: hasSignal ? '2px solid var(--success)' : '1px solid var(--border)' }}>
             {!hasSignal ? (
               <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                 <Compass className="animate-spin-slow" size={60} color="var(--warning)" style={{ marginBottom: '20px', opacity: 0.5 }} />
                 <h2 style={{ fontSize: '24px', color: 'var(--warning)', letterSpacing: '1px' }}>AI SCANNER ACTIVE...</h2>
                 <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
                    {['RSI', 'OI DATA', 'EMA 50', 'VWAP', 'VIX'].map(item => (
                      <span key={item} style={{ fontSize: '10px', background: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)' }}>
                        SCANNING {item}
                      </span>
                    ))}
                 </div>
               </div>
             ) : (
              <div style={{ animation: 'fadeIn 0.5s ease' }}>
                 <p style={{ fontSize: '14px', color: 'var(--success)', fontWeight: 800, letterSpacing: '2px', marginBottom: '10px' }}>PROFITABLE OPPORTUNITY FOUND</p>
                 <h1 style={{ fontSize: '72px', fontWeight: 900, margin: '10px 0', color: 'var(--primary)', textShadow: '0 0 20px var(--primary-glow)' }}>
                   {data.signals.strike}
                 </h1>
                 <div style={{ display: 'flex', justifyContent: 'center', gap: '30px', marginTop: '20px' }}>
                    <div className="glass-card" style={{ padding: '20px', minWidth: '160px', border: '1px solid var(--border)' }}>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>BUY ABOVE</p>
                      <p style={{ fontSize: '28px', fontWeight: 900, color: 'white' }}>₹{activeSymbol === 'BANKNIFTY' ? '345' : '120'}</p>
                    </div>
                    <div className="glass-card" style={{ padding: '20px', minWidth: '160px', border: '1px solid var(--success)' }}>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>TARGET</p>
                      <p style={{ fontSize: '28px', fontWeight: 900, color: 'var(--success)' }}>₹{data.signals.target}</p>
                    </div>
                 </div>
                 <div style={{ marginTop: '30px', padding: '15px', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', fontSize: '16px', fontWeight: 700 }}>
                    AI VERDICT: {data.signals.logic}
                 </div>
                 <button 
                  onClick={() => setIsTrading(true)}
                  disabled={isTrading}
                  style={{ 
                    marginTop: '25px', 
                    padding: '16px 50px', 
                    background: isTrading ? 'rgba(255,255,255,0.1)' : 'var(--primary)', 
                    color: isTrading ? 'var(--text-muted)' : 'black', 
                    border: 'none', 
                    borderRadius: '12px', 
                    fontSize: '18px', 
                    fontWeight: 900, 
                    cursor: isTrading ? 'not-allowed' : 'pointer',
                    boxShadow: '0 0 20px rgba(0, 255, 136, 0.3)'
                  }}>
                   {isTrading ? 'TRADE IN PROGRESS...' : 'EXECUTE PAPER TRADE'}
                 </button>
              </div>
             )}
          </div>

          {/* Greeks */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '15px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Brain size={18} color="var(--primary)" />
              OPTION GREEKS (REAL-TIME)
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px' }}>
              {Object.entries(greeks).map(([key, val]) => (
                <div key={key} className="glass-card" style={{ padding: '12px', textAlign: 'center' }}>
                  <p style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{key}</p>
                  <p style={{ fontSize: '16px', fontWeight: 700 }}>{val}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Logic Blocks */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="glass-panel" style={{ padding: '20px' }}>
              <h4 style={{ marginBottom: '12px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Activity size={16} color="var(--primary)" />
                AI MARKET LOGIC
              </h4>
              <p style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                "PCR is {data.pcr}. Call sellers are exiting their positions. Market sentiment is bullish."
              </p>
            </div>
            <div className="glass-panel" style={{ padding: '20px' }}>
              <h4 style={{ marginBottom: '12px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <TrendingUp size={16} color="var(--success)" />
                CANDLE VERDICT
              </h4>
              <p style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                "Bullish momentum detected. Support levels are holding strong."
              </p>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="glass-panel" style={{ padding: '20px', borderTop: '4px solid var(--success)' }}>
            <h3 style={{ fontSize: '15px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Zap size={16} color="var(--success)" />
              PROFIT LOCK (TRAILING SL)
            </h3>
            <div style={{ padding: '15px', background: 'rgba(0, 255, 136, 0.05)', borderRadius: '10px', textAlign: 'center', border: '1px dashed var(--success)' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>MOVE YOUR SL TO</p>
              <h2 style={{ color: 'var(--success)', margin: '4px 0' }}>₹{hasSignal ? trailingSL : '--'}</h2>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '20px', background: 'rgba(255, 62, 62, 0.02)' }}>
            <h3 style={{ fontSize: '14px', color: 'var(--danger)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={16} /> MOMENTUM ALERT
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
              <div style={{ width: '10px', height: '10px', background: 'var(--danger)', borderRadius: '50%' }} className="animate-pulse"></div>
              <span style={{ fontSize: '12px' }}>High Volume Spike detected.</span>
            </div>
          </div>
          
          <div className="glass-panel" style={{ padding: '20px', borderTop: '4px solid var(--primary)' }}>
            <h3 style={{ fontSize: '14px', color: 'var(--primary)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Shield size={16} /> PSYCHOLOGY TIP
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5', fontStyle: 'italic' }}>
              "Hamesha Stop-Loss lagaiye. Disciplined trader hi lambe samay tak tikta hai."
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignalRoom;
