import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, Shield, Key, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';

const Settings = () => {
  const [clientId, setClientId] = useState('');
  const [pin, setPin] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash');
  
  const [status, setStatus] = useState({ loading: true, data: null });
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await axios.get('/api/settings');
      if (response.data.success) {
        setStatus({ loading: false, data: response.data });
        setClientId(response.data.clientId || '');
        if (response.data.geminiModel) {
          setGeminiModel(response.data.geminiModel);
        }
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
      setStatus({ loading: false, data: null });
    }
  };

  const handleSave = async () => {
    setMessage({ type: '', text: '' });
    try {
      const payload = { clientId, geminiModel };
      if (pin) payload.pin = pin;
      if (totpSecret) payload.totpSecret = totpSecret;
      if (geminiApiKey) payload.geminiApiKey = geminiApiKey;

      const response = await axios.post('/api/settings', payload);
      if (response.data.success) {
        setMessage({ type: 'success', text: 'Settings saved successfully!' });
        setPin('');
        setTotpSecret('');
        fetchSettings();
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to save settings' });
    }
  };

  const handleRefresh = async () => {
    setMessage({ type: '', text: '' });
    setIsRefreshing(true);
    try {
      const response = await axios.post('/api/settings/refresh-token');
      if (response.data.success) {
        setMessage({ type: 'success', text: 'Access Token generated successfully!' });
        fetchSettings();
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to generate token' });
    } finally {
      setIsRefreshing(false);
    }
  };

  if (status.loading) {
    return <div className="container flex-center">Loading settings...</div>;
  }

  return (
    <div className="container">
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Settings</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Configure your Dhan API credentials for Auto-TOTP Login.</p>
      </div>

      <div className="glass-panel" style={{ padding: '2rem', maxWidth: '600px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <Shield size={24} color="var(--accent-primary)" />
          <h2 style={{ fontSize: '1.5rem' }}>Dhan Auto-Login Configuration</h2>
        </div>

        {message.text && (
          <div style={{ 
            marginBottom: '1.5rem', 
            padding: '1rem', 
            borderRadius: '8px',
            background: message.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            color: message.type === 'success' ? 'var(--bullish)' : 'var(--bearish)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            {message.text}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Client ID</label>
            <input 
              type="text" 
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Enter your Dhan Client ID" 
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                padding: '0.75rem',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                outline: 'none'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Dhan PIN
              {status.data?.hasPin && <span style={{ marginLeft: '10px', color: 'var(--bullish)', fontSize: '0.8rem' }}>(Set)</span>}
            </label>
            <input 
              type="password" 
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder={status.data?.hasPin ? "Enter new PIN to update" : "Enter your 6-digit PIN"}
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                padding: '0.75rem',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                outline: 'none'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              TOTP Secret
              {status.data?.hasTotpSecret && <span style={{ marginLeft: '10px', color: 'var(--bullish)', fontSize: '0.8rem' }}>(Set)</span>}
            </label>
            <div style={{ position: 'relative' }}>
              <Key size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input 
                type="password" 
                value={totpSecret}
                onChange={(e) => setTotpSecret(e.target.value)}
                placeholder={status.data?.hasTotpSecret ? "Enter new TOTP secret to update" : "Enter your TOTP Secret Key"}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '0.75rem 0.75rem 0.75rem 2.5rem',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Gemini API Key
              {status.data?.hasGeminiKey && <span style={{ marginLeft: '10px', color: 'var(--bullish)', fontSize: '0.8rem' }}>(Set)</span>}
            </label>
            <div style={{ position: 'relative' }}>
              <Key size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input 
                type="password" 
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder={status.data?.hasGeminiKey ? "Enter new API key to update" : "Enter your Gemini API Key"}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '0.75rem 0.75rem 0.75rem 2.5rem',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Gemini AI Model
            </label>
            <select
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                padding: '0.75rem',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="gemini-2.5-flash">Gemini 2.5 Flash (Recommended - Fast & Free Quota)</option>
              <option value="gemini-3.5-flash">Gemini 3.5 Flash (Latest - Free Quota)</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro (High Reasoning & Accuracy)</option>
              <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (Fast, lightweight)</option>
              <option value="gemini-2.0-flash">Gemini 2.0 Flash (Fast - Free Tier restricted in some regions)</option>
              <option value="gemini-2.0-flash-lite">Gemini 2.0 Flash-Lite (Ultra-fast, lower quota)</option>
              <option value="gemini-flash-latest">Gemini 1.5 Flash (Legacy - Stable & Free Quota)</option>
              <option value="gemini-pro-latest">Gemini 1.5 Pro (Legacy - High Intelligence)</option>
              <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash-Lite (Next-gen Lite Preview)</option>
              <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Next-gen Pro Preview)</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <button 
              onClick={handleSave}
              style={{
                background: 'var(--accent-primary)',
                color: 'black',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '10px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                transition: 'var(--transition-smooth)'
              }}
            >
              <Save size={18} />
              Save Credentials
            </button>

            <button 
              onClick={handleRefresh}
              disabled={isRefreshing || !status.data?.hasPin || !status.data?.hasTotpSecret}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                padding: '0.75rem 1.5rem',
                borderRadius: '10px',
                fontWeight: '600',
                cursor: (!status.data?.hasPin || !status.data?.hasTotpSecret) ? 'not-allowed' : 'pointer',
                opacity: (!status.data?.hasPin || !status.data?.hasTotpSecret) ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                transition: 'var(--transition-smooth)'
              }}
            >
              <RefreshCw size={18} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
              {isRefreshing ? 'Generating...' : 'Generate Access Token Now'}
            </button>
          </div>

          <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Status</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                {status.data?.hasAccessToken ? <CheckCircle size={14} color="var(--bullish)" /> : <AlertCircle size={14} color="var(--bearish)" />}
                Access Token: {status.data?.hasAccessToken ? 'Active' : 'Missing'}
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CheckCircle size={14} color="var(--bullish)" />
                Auto-Refresh: The backend will automatically refresh the token every 23 hours if PIN and TOTP are set.
              </li>
            </ul>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default Settings;
