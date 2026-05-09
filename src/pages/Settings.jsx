import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, Shield, Target, Wallet } from 'lucide-react';

const Settings = () => {
  const [capital, setCapital] = useState(localStorage.getItem('trading_capital') || '25000');
  const [risk, setRisk] = useState(localStorage.getItem('trading_risk') || '2');
  const [goal, setGoal] = useState(localStorage.getItem('trading_goal') || '2000');
  const [saved, setSaved] = useState(false);
  
  // Kotak Neo States
  const [kotakCreds, setKotakCreds] = useState({
    consumerKey: '',
    consumerSecret: '',
    neoId: ''
  });
  const [totp, setTotp] = useState('');
  const [loginStep, setLoginStep] = useState(1); // 1: Login, 2: TOTP
  const [loading, setLoading] = useState(false);

  const handleSave = () => {
    localStorage.setItem('trading_capital', capital);
    localStorage.setItem('trading_risk', risk);
    localStorage.setItem('trading_goal', goal);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleKotakLogin = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:5000/api/kotak/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kotakCreds)
      });
      const result = await response.json();
      if (result.success) {
        setLoginStep(2);
        alert('Login Step 1 Successful! Please enter TOTP.');
      } else {
        alert('Login Failed: ' + result.error);
      }
    } catch (error) {
      alert('Error connecting to backend.');
    }
    setLoading(false);
  };

  const handleValidateTOTP = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:5000/api/kotak/validate-totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totp })
      });
      const result = await response.json();
      if (result.success) {
        alert('Account Linked Successfully!');
        setLoginStep(1);
      } else {
        alert('TOTP Validation Failed.');
      }
    } catch (error) {
      alert('Error connecting to backend.');
    }
    setLoading(false);
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

        <div className="glass-panel" style={{ padding: '30px' }}>
           <h3 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Shield size={20} color="var(--primary)" />
              BROKER INTEGRATION (KOTAK NEO)
           </h3>
           <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              {loginStep === 1 ? (
                <>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>CONSUMER KEY</label>
                    <input 
                      type="password" 
                      placeholder="Enter Consumer Key" 
                      value={kotakCreds.consumerKey}
                      onChange={(e) => setKotakCreds({...kotakCreds, consumerKey: e.target.value})}
                      style={{ width: '100%', padding: '10px', marginTop: '5px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '6px', color: 'white' }} 
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>CONSUMER SECRET</label>
                    <input 
                      type="password" 
                      placeholder="Enter Consumer Secret" 
                      value={kotakCreds.consumerSecret}
                      onChange={(e) => setKotakCreds({...kotakCreds, consumerSecret: e.target.value})}
                      style={{ width: '100%', padding: '10px', marginTop: '5px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '6px', color: 'white' }} 
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>NEO ID / MOBILE</label>
                    <input 
                      type="text" 
                      placeholder="Enter Neo ID" 
                      value={kotakCreds.neoId}
                      onChange={(e) => setKotakCreds({...kotakCreds, neoId: e.target.value})}
                      style={{ width: '100%', padding: '10px', marginTop: '5px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '6px', color: 'white' }} 
                    />
                  </div>
                  <button 
                    onClick={handleKotakLogin}
                    disabled={loading}
                    style={{ padding: '10px', background: 'rgba(0, 255, 136, 0.1)', border: '1px solid var(--primary)', borderRadius: '6px', color: 'var(--primary)', fontWeight: 700, cursor: 'pointer' }}>
                    {loading ? 'PROCESSING...' : 'LINK KOTAK NEO ACCOUNT'}
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>ENTER TOTP (from Authenticator App)</label>
                    <input 
                      type="text" 
                      placeholder="6-digit TOTP" 
                      value={totp}
                      onChange={(e) => setTotp(e.target.value)}
                      style={{ width: '100%', padding: '10px', marginTop: '5px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '6px', color: 'white', textAlign: 'center', fontSize: '20px', letterSpacing: '8px' }} 
                    />
                  </div>
                  <button 
                    onClick={handleValidateTOTP}
                    disabled={loading}
                    style={{ padding: '10px', background: 'var(--primary)', border: 'none', borderRadius: '6px', color: 'black', fontWeight: 900, cursor: 'pointer' }}>
                    {loading ? 'VALIDATING...' : 'VALIDATE & COMPLETE'}
                  </button>
                  <button 
                    onClick={() => setLoginStep(1)}
                    style={{ padding: '10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', color: 'white', cursor: 'pointer' }}>
                    BACK TO LOGIN
                  </button>
                </>
              )}
              <p style={{ fontSize: '10px', color: 'var(--warning)', fontStyle: 'italic' }}>
                 *API credentials are encrypted and stored locally.
              </p>
           </div>
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
