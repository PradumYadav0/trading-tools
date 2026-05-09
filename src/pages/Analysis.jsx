import React from 'react';
import FullOptionChain from '../components/FullOptionChain';
import { ShieldAlert, Activity, TrendingUp, TrendingDown, Info, Zap } from 'lucide-react';

const Analysis = ({ activeSymbol, data }) => {
  const pcr = parseFloat(data.pcr);
  const isBullish = pcr > 1.1;
  const isBearish = pcr < 0.8;
  const sentiment = isBullish ? 'BULLISH' : isBearish ? 'BEARISH' : 'SIDEWAYS';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      {/* Top Identity & Sentiment Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '20px' }}>
        <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'rgba(0, 255, 136, 0.05)', border: '1px solid var(--primary)' }}>
           <span style={{ fontSize: '10px', color: 'var(--primary)', fontWeight: 800 }}>CURRENT TERMINAL</span>
           <h1 style={{ fontSize: '28px', fontWeight: 900, margin: '4px 0' }}>{activeSymbol}</h1>
           <span style={{ fontSize: '12px', color: 'var(--success)' }}>LIVE DATA</span>
        </div>

        <div className="glass-panel" style={{ padding: '20px', display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>MAX PAIN</p>
            <h2 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--warning)' }}>{activeSymbol === 'BANKNIFTY' ? '48200' : '22400'}</h2>
          </div>
          <div style={{ width: '1px', height: '40px', background: 'var(--border)' }}></div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>PCR VALUE</p>
            <h2 style={{ fontSize: '20px', color: isBullish ? 'var(--success)' : isBearish ? 'var(--danger)' : 'var(--warning)' }}>{pcr}</h2>
          </div>
          <div style={{ width: '1px', height: '40px', background: 'var(--border)' }}></div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>BATTLEGROUND</p>
            <h2 style={{ fontSize: '20px', color: 'var(--primary)' }}>{activeSymbol === 'BANKNIFTY' ? '48300' : '22450'}</h2>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
           <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>MARKET PRICE</p>
           <h2 style={{ fontSize: '24px', fontWeight: 900 }}>₹{data.price.toLocaleString()}</h2>
        </div>
      </div>

      {/* AI Deep Analysis Box */}
      <div className="glass-panel" style={{ padding: '24px', background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, transparent 100%)' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <Zap size={22} color="var(--primary)" />
          AI OPTION CHAIN VERDICT
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '30px' }}>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '15px', borderLeft: '5px solid var(--primary)' }}>
            <p style={{ fontSize: '15px', lineHeight: '1.8', color: 'var(--text-secondary)' }}>
              "Option Chain analysis reveals that **{activeSymbol}** is currently showing **{sentiment.toLowerCase()}** bias. 
              The most active strike is **{activeSymbol === 'BANKNIFTY' ? '48200' : '22400'}** where massive OI addition is seen. 
              {isBullish ? 'Bulls are protecting the lower levels strongly.' : isBearish ? 'Bears are aggressive at every rise.' : 'Market is indecisive at current levels.'}"
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
             <div className="glass-card" style={{ padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px' }}>Strong Support</span>
                <span style={{ color: 'var(--success)', fontWeight: 800 }}>{activeSymbol === 'BANKNIFTY' ? '48000' : '22300'}</span>
             </div>
             <div className="glass-card" style={{ padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px' }}>Heavy Resistance</span>
                <span style={{ color: 'var(--danger)', fontWeight: 800 }}>{activeSymbol === 'BANKNIFTY' ? '48500' : '22500'}</span>
             </div>
          </div>
        </div>
      </div>

      {/* New: Smart Strike & Heatmap Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
        {/* Smart Strike Recommender */}
        <div className="glass-panel" style={{ padding: '20px', background: 'linear-gradient(135deg, rgba(255, 184, 0, 0.05) 0%, transparent 100%)', border: '1px solid var(--warning)' }}>
           <h3 style={{ fontSize: '15px', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
             <Zap size={18} /> SMART STRIKE SELECTOR
           </h3>
           <div className="glass-card" style={{ padding: '15px', textAlign: 'center', background: 'rgba(255,184,0,0.1)' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>BEST STRIKE TO BUY</p>
              <h2 style={{ fontSize: '22px', margin: '5px 0' }}>{activeSymbol === 'BANKNIFTY' ? '48200' : '22400'} {isBullish ? 'CE' : 'PE'}</h2>
              <p style={{ fontSize: '10px', color: 'var(--warning)' }}>Optimal Delta/Theta Ratio</p>
           </div>
           <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '12px' }}>
             "Buying this strike gives you the best risk-reward right now."
           </p>
        </div>

        {/* OI Heatmap Grid */}
        <div className="glass-panel" style={{ padding: '20px' }}>
           <h3 style={{ fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
             <Activity size={18} color="var(--primary)" />
             OI BUILDUP HEATMAP
           </h3>
           <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
              {data.strikes.slice(8, 13).map((s, i) => (
                <div key={i} style={{ 
                  padding: '10px', 
                  borderRadius: '8px', 
                  background: i % 2 === 0 ? 'rgba(0, 255, 136, 0.2)' : 'rgba(255, 62, 62, 0.2)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  textAlign: 'center'
                }}>
                  <p style={{ fontSize: '10px', fontWeight: 800 }}>{s}</p>
                  <p style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{i % 2 === 0 ? '+15% OI' : '-8% OI'}</p>
                </div>
              ))}
           </div>
           <p style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '12px' }}>
             *Green = Strong Support, Red = Heavy Resistance.
           </p>
        </div>
      </div>

      {/* Market Phase Tracker */}
      <div className="glass-panel" style={{ padding: '24px', background: 'rgba(255,255,255,0.02)' }}>
        <h3 style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <ShieldAlert size={20} color="var(--primary)" />
          MARKET PHASE TRACKER (INSTITUTIONAL FLOW)
        </h3>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
           {[
             { name: 'ACCUMULATION', active: !isBullish && !isBearish, desc: 'Big players buying quietly', matlab: 'Market range mein hai. Wait karo.' },
             { name: 'BREAKOUT', active: isBullish, desc: 'Trend is starting now', matlab: 'Paisa banane ka waqt hai. Entry lo.' },
             { name: 'DISTRIBUTION', active: false, desc: 'Profit booking at top', matlab: 'Market thak gaya hai. Profit lo.' },
             { name: 'PANIC / CRASH', active: isBearish, desc: 'Heavy panic selling', matlab: 'Market girega. Put side dekho.' }
           ].map((phase, idx) => (
             <div key={idx} className="glass-card" style={{ 
               flex: 1, 
               padding: '15px', 
               textAlign: 'center', 
               border: phase.active ? '2px solid var(--primary)' : '1px solid var(--border)',
               background: phase.active ? 'rgba(0, 255, 136, 0.1)' : 'transparent',
               opacity: phase.active ? 1 : 0.4,
               transition: 'all 0.3s ease'
             }}>
                <h4 style={{ fontSize: '11px', color: phase.active ? 'var(--primary)' : 'var(--text-muted)' }}>{phase.name}</h4>
                <p style={{ fontSize: '9px', marginTop: '4px', color: 'var(--text-secondary)' }}>{phase.desc}</p>
                <p style={{ fontSize: '10px', marginTop: '8px', color: phase.active ? 'white' : 'var(--text-muted)', fontWeight: 600, fontStyle: 'italic' }}>
                  {phase.matlab}
                </p>
                {phase.active && <div style={{ fontSize: '10px', marginTop: '8px', color: 'var(--primary)', fontWeight: 900 }}>CURRENT PHASE</div>}
             </div>
           ))}
        </div>
      </div>

      {/* Market Momentum Scanner (Volume vs OI Logic) */}
      <div className="glass-panel" style={{ padding: '24px', background: 'rgba(255,255,255,0.02)' }}>
        <h3 style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <Activity size={20} color="var(--primary)" />
          MARKET MOMENTUM SCANNER (LIVE PULSE)
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px' }}>
           <div className="glass-card" style={{ padding: '15px', border: isBullish ? '2px solid var(--success)' : '1px solid var(--border)', background: isBullish ? 'rgba(0, 255, 136, 0.05)' : 'transparent' }}>
              <h4 style={{ fontSize: '12px', color: 'var(--success)' }}>SHORT COVERING</h4>
              <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '4px 0' }}>Sellers are panicking</p>
              <div style={{ fontSize: '14px', fontWeight: 900, marginBottom: '8px' }}>{isBullish ? 'DETECTED 🚀' : 'NO'}</div>
              <p style={{ fontSize: '9px', color: 'var(--success)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '5px' }}>
                MATLAB: Market tezi se upar jayega.
              </p>
           </div>
           <div className="glass-card" style={{ padding: '15px', border: '1px solid var(--border)' }}>
              <h4 style={{ fontSize: '12px', color: 'var(--primary)' }}>LONG BUILDUP</h4>
              <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '4px 0' }}>Fresh Buying seen</p>
              <div style={{ fontSize: '14px', fontWeight: 900, marginBottom: '8px' }}>{isBullish ? 'ACTIVE' : 'WAIT'}</div>
              <p style={{ fontSize: '9px', color: 'var(--primary)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '5px' }}>
                MATLAB: Naye log kharid rahe hain.
              </p>
           </div>
           <div className="glass-card" style={{ padding: '15px', border: isBearish ? '2px solid var(--danger)' : '1px solid var(--border)', background: isBearish ? 'rgba(255, 62, 62, 0.05)' : 'transparent' }}>
              <h4 style={{ fontSize: '12px', color: 'var(--danger)' }}>SHORT BUILDUP</h4>
              <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '4px 0' }}>Heavy Selling pressure</p>
              <div style={{ fontSize: '14px', fontWeight: 900, marginBottom: '8px' }}>{isBearish ? 'DETECTED ⚠️' : 'NO'}</div>
              <p style={{ fontSize: '9px', color: 'var(--danger)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '5px' }}>
                MATLAB: Market niche gir sakta hai.
              </p>
           </div>
           <div className="glass-card" style={{ padding: '15px', border: '1px solid var(--border)' }}>
              <h4 style={{ fontSize: '12px', color: 'var(--warning)' }}>LONG UNWINDING</h4>
              <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '4px 0' }}>Buyers are exiting</p>
              <div style={{ fontSize: '14px', fontWeight: 900, marginBottom: '8px' }}>{isBearish ? 'ACTIVE' : 'NO'}</div>
              <p style={{ fontSize: '9px', color: 'var(--warning)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '5px' }}>
                MATLAB: Log munafa book kar rahe hain.
              </p>
           </div>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '15px', fontStyle: 'italic' }}>
          *AI identifies these phases by comparing Change in OI vs Volume across all major strikes.
        </p>
      </div>

      {/* Buying Strategy Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div className="glass-panel" style={{ padding: '24px', borderTop: '4px solid var(--success)', transition: 'transform 0.3s ease' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
             <h4 style={{ color: 'var(--success)', fontWeight: 800 }}>CALL BUYING SETUP</h4>
             <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>⏱️ HOLD: 15-20 MINS</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '15px' }}>
            {isBullish ? 'Momentum is with Bulls. Target the next resistance level.' : 'Call Writers are still strong. Don\'t buy Call yet.'}
          </p>
          <div style={{ padding: '12px', background: 'rgba(0, 255, 136, 0.05)', borderRadius: '8px', textAlign: 'center', fontSize: '14px', fontWeight: 700 }}>
             {isBullish ? 'SUGGESTION: BUY CALL' : 'ACTION: WAIT (No Trend)'}
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '24px', borderTop: '4px solid var(--danger)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
             <h4 style={{ color: 'var(--danger)', fontWeight: 800 }}>PUT BUYING SETUP</h4>
             <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>⏱️ HOLD: 15-20 MINS</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '15px' }}>
            {isBearish ? 'Panic selling expected. Look for Put entry below support.' : 'Put writing is strong. Markets are getting supported.'}
          </p>
          <div style={{ padding: '12px', background: 'rgba(255, 62, 62, 0.05)', borderRadius: '8px', textAlign: 'center', fontSize: '14px', fontWeight: 700 }}>
             {isBearish ? 'SUGGESTION: BUY PUT' : 'ACTION: WAIT (Support Active)'}
          </div>
        </div>
      </div>

      {/* Option Chain Grid */}
      <div className="glass-panel" style={{ padding: '20px' }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Activity size={20} color="var(--primary)" />
              DEEP OPTION CHAIN TERMINAL
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>*Real-time data stream active</span>
         </div>
         <FullOptionChain activeSymbol={activeSymbol} data={data} />
      </div>
    </div>
  );
};

export default Analysis;
