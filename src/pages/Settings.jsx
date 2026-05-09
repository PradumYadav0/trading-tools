import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, Shield, Target, Wallet } from 'lucide-react';

const Settings = () => {
  const [capital, setCapital] = useState(localStorage.getItem('trading_capital') || '25000');
  const [risk, setRisk] = useState(localStorage.getItem('trading_risk') || '2');
  const [goal, setGoal] = useState(localStorage.getItem('trading_goal') || '2000');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem('trading_capital', capital);
    localStorage.setItem('trading_risk', risk);
    localStorage.setItem('trading_goal', goal);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div className="glass-panel" style={{ padding: '24px', borderLeft: '6px solid var(--primary)' }}>
        <h1 style={{ fontSize: '26px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <SettingsIcon size={28} color="var(--primary)" />
          TERMINAL CONFIGURATION
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Customize your risk and capital settings</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div className="glass-panel" style={{ padding: '30px' }}>
           <div style={{ marginBottom: '25px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', marginBottom: '10px', color: 'var(--primary)' }}>
                 <Wallet size={16} /> TRADING CAPITAL (₹)
              </label>
              <input 
                type="number" 
                value={capital} 
                onChange={(e) => setCapital(e.target.value)}
                style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '8px', color: 'white', fontSize: '18px', fontWeight: 800 }}
              />
           </div>

           <div style={{ marginBottom: '25px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', marginBottom: '10px', color: 'var(--danger)' }}>
                 <Shield size={16} /> RISK PER TRADE (%)
              </label>
              <input 
                type="number" 
                value={risk} 
                onChange={(e) => setRisk(e.target.value)}
                style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '8px', color: 'white', fontSize: '18px', fontWeight: 800 }}
              />
           </div>

           <div style={{ marginBottom: '25px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', marginBottom: '10px', color: 'var(--success)' }}>
                 <Target size={16} /> DAILY PROFIT GOAL (₹)
              </label>
              <input 
                type="number" 
                value={goal} 
                onChange={(e) => setGoal(e.target.value)}
                style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '8px', color: 'white', fontSize: '18px', fontWeight: 800 }}
              />
           </div>

           <button 
             onClick={handleSave}
             style={{ width: '100%', padding: '15px', background: 'var(--primary)', border: 'none', borderRadius: '10px', color: 'black', fontWeight: 900, cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }}>
             <Save size={18} />
             {saved ? 'SETTINGS SAVED!' : 'SAVE CONFIGURATION'}
           </button>
        </div>

        <div className="glass-panel" style={{ padding: '30px', background: 'rgba(255,255,255,0.02)' }}>
           <h3 style={{ marginBottom: '20px' }}>SYSTEM LOGIC</h3>
           <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div className="glass-card" style={{ padding: '15px' }}>
                 <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Position Sizing</p>
                 <p style={{ fontSize: '14px', marginTop: '4px' }}>AI will automatically calculate lots to keep your loss below {risk}% of ₹{capital}.</p>
              </div>
              <div className="glass-card" style={{ padding: '15px' }}>
                 <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Trading Mode</p>
                 <p style={{ fontSize: '14px', marginTop: '4px' }}>Pro Scalper Mode Active. Low latency signals prioritize speed.</p>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
