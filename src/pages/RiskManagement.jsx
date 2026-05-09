import React from 'react';
import { ShieldCheck, AlertTriangle, Target, TrendingDown } from 'lucide-react';

const RiskManagement = () => {
  const rules = [
    { title: 'Max Loss Per Day', value: '₹2,000', status: 'Safe', color: 'var(--success)' },
    { title: 'Max Trades Per Day', value: '3', status: 'Warning', color: 'var(--warning)' },
    { title: 'Risk-Reward Ratio', value: '1:2.5', status: 'Ideal', color: 'var(--primary)' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="glass-panel" style={{ padding: '24px', borderLeft: '6px solid var(--primary)' }}>
        <h1 style={{ fontSize: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ShieldCheck size={28} color="var(--primary)" />
          RISK CONTROL & PSYCHOLOGY
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>Your safety shield against market volatility</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
        {rules.map((rule, idx) => (
          <div key={idx} className="glass-panel" style={{ padding: '20px', textAlign: 'center' }}>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>{rule.title}</p>
            <h2 style={{ fontSize: '28px', fontWeight: 800 }}>{rule.value}</h2>
            <span style={{ fontSize: '11px', color: rule.color, fontWeight: 700, background: 'rgba(255,255,255,0.05)', padding: '4px 12px', borderRadius: '20px', marginTop: '12px', display: 'inline-block' }}>
              {rule.status}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertTriangle color="var(--danger)" />
            PSYCHOLOGY ALERTS
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="glass-card" style={{ padding: '16px', background: 'rgba(255, 62, 62, 0.05)' }}>
              <p style={{ fontSize: '14px', lineHeight: '1.5' }}>
                "Aapne pichle trade mein loss liya hai. Abhi turant doosra trade mat lijiye (Revenge Trading). 15 minute ka break lein aur thanda paani piyein."
              </p>
            </div>
            <div className="glass-card" style={{ padding: '16px', background: 'rgba(0, 255, 136, 0.05)' }}>
              <p style={{ fontSize: '14px', lineHeight: '1.5' }}>
                "Market abhi sideways hai. Yahan trade lena 'Kapital' jalane jaisa hai. Wait for a clear breakout."
              </p>
            </div>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Target color="var(--primary)" />
            DAILY GOALS
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                <span>Daily Profit Target (₹5,000)</span>
                <span>40% achieved</span>
              </div>
              <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px' }}>
                <div style={{ width: '40%', height: '100%', background: 'var(--primary)', borderRadius: '10px' }}></div>
              </div>
            </div>
            <div className="glass-card" style={{ padding: '12px', marginTop: '10px' }}>
              <h4 style={{ fontSize: '13px', color: 'var(--success)' }}>AI MOTIVATION:</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: '4px' }}>
                "Consistency is better than intensity. Chote profits lene ki aadat dalein."
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RiskManagement;
