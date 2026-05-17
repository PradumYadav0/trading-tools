import React from 'react';
import { ArrowUpRight, ArrowDownRight, Activity, Zap } from 'lucide-react';

const Dashboard = () => {
  return (
    <div className="container">
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Welcome Back, Trader</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Here is your market summary and suggestions for today.</p>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <div className="glass-panel" style={{ flex: '1', minWidth: '240px', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>NIFTY 50</span>
            <span style={{ color: 'var(--bullish)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <ArrowUpRight size={16} /> +0.85%
            </span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: '700' }}>22,450.20</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>Live Spot Price</div>
        </div>

        <div className="glass-panel" style={{ flex: '1', minWidth: '240px', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>BANK NIFTY</span>
            <span style={{ color: 'var(--bearish)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <ArrowDownRight size={16} /> -0.32%
            </span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: '700' }}>48,210.50</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>Live Spot Price</div>
        </div>

        <div className="glass-panel" style={{ flex: '1', minWidth: '240px', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>PCR (Nifty)</span>
            <span style={{ color: 'var(--bullish)', fontWeight: '500' }}>Bullish</span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: '700' }}>1.15</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>Put Call Ratio</div>
        </div>
      </div>

      {/* Suggestion Box */}
      <div className="glass-panel" style={{ padding: '2rem', border: '1px solid var(--border-glow)', background: 'rgba(99, 102, 241, 0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ width: '32px', height: '32px', background: 'rgba(99, 102, 241, 0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center' }}>
            <Zap size={18} color="var(--accent-primary)" fill="var(--accent-primary)" />
          </div>
          <h2 style={{ fontSize: '1.5rem' }}>Today's Top Suggestion</h2>
        </div>
        <p style={{ fontSize: '1.1rem', marginBottom: '1rem', lineHeight: '1.6' }}>
          Nifty is showing strong support at <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>22,400</span>. Heavy put writing observed. 
          RSI on 15-min chart is approaching oversold territory. 
          <span style={{ color: 'var(--bullish)', fontWeight: '600' }}> Suggestion: Look for long opportunities on dips near 22,410-22,420.</span>
        </p>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Activity size={16} /> Confidence: 85%
          </div>
          <div>|</div>
          <div>Valid for: Intraday</div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
