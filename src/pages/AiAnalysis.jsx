import React, { useState } from 'react';
import { AlertCircle, RefreshCw, Brain, Sparkles } from 'lucide-react';

const AiAnalysis = () => {
  const [symbol, setSymbol] = useState('NIFTY');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [analysis, setAnalysis] = useState('');
  const [cooldown, setCooldown] = useState(false);

  const fetchAiAnalysis = async () => {
    if (cooldown) return;
    
    setLoading(true);
    setError(null);
    setAnalysis('');
    
    // Set cooldown for 30 seconds
    setCooldown(true);
    setTimeout(() => setCooldown(false), 30000);

    try {
      const response = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'access-token': localStorage.getItem('dhanAccessToken') || '' // fallback
        },
        body: JSON.stringify({ symbol })
      });
      
      const result = await response.json();
      
      if (result.success) {
        setAnalysis(result.analysis);
      } else {
        setError(result.message || 'Failed to get AI analysis');
      }
    } catch (err) {
      setError('Error connecting to server');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>AI Market Analyst</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Powered by Gemini 1.5 Flash - Analysis of Chart & Option Chain</p>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <select 
            value={symbol} 
            onChange={(e) => setSymbol(e.target.value)}
            style={{ 
              background: '#1E293B', 
              color: 'white', 
              border: '1px solid var(--border-color)', 
              padding: '0.5rem 1rem', 
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            <option value="NIFTY">NIFTY</option>
            <option value="BANKNIFTY">BANKNIFTY</option>
            <option value="FINNIFTY">FINNIFTY</option>
            <option value="MIDCPNIFTY">MIDCPNIFTY</option>
          </select>

          <button 
            onClick={fetchAiAnalysis}
            disabled={loading || cooldown}
            style={{ 
              background: 'linear-gradient(135deg, #6366F1 0%, #A855F7 100%)', 
              color: 'white', 
              border: 'none', 
              padding: '0.5rem 1.5rem', 
              borderRadius: '8px',
              cursor: (loading || cooldown) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontWeight: '600',
              opacity: (loading || cooldown) ? 0.7 : 1,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
            }}
          >
            {loading ? <RefreshCw size={18} className="spin" /> : <Sparkles size={18} />}
            {loading ? 'Analyzing...' : cooldown ? 'Wait 30s...' : 'Ask AI for Analysis'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ 
          background: 'rgba(239, 68, 68, 0.1)', 
          border: '1px solid rgba(239, 68, 68, 0.2)', 
          color: '#FCA5A5', 
          padding: '1rem', 
          borderRadius: '8px', 
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="glass-panel" style={{ padding: '2rem', minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
        {!analysis && !loading && !error && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'var(--text-secondary)' }}>
            <Brain size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
            <p style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>Ready to analyze the market.</p>
            <p style={{ fontSize: '0.9rem' }}>Click the button above to get AI insights based on current data.</p>
          </div>
        )}

        {loading && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'var(--text-secondary)' }}>
            <RefreshCw size={48} className="spin" style={{ marginBottom: '1rem', color: '#A855F7' }} />
            <p style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>AI is reading the data...</p>
            <p style={{ fontSize: '0.9rem' }}>Analyzing Option Chain and last 15 candles of 5-minute interval.</p>
          </div>
        )}

        {analysis && (
          <div style={{ animation: 'fadeIn 0.5s ease-in-out' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              <Brain size={24} color="#A855F7" />
              <h2 style={{ fontSize: '1.5rem' }}>Gemini Analysis</h2>
            </div>
            
            <div style={{ 
              color: 'var(--text-primary)', 
              fontSize: '1.1rem', 
              lineHeight: '1.8',
              whiteSpace: 'pre-wrap', // Preserve line breaks
              fontFamily: 'Inter, sans-serif'
            }}>
              {analysis}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default AiAnalysis;
