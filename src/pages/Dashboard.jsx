import React from 'react';
import MainChart from '../components/MainChart';
import SignalPanel from '../components/SignalPanel';
import GlobalMarkets from '../components/GlobalMarkets';
import { Activity, Zap, ShieldCheck, TrendingUp } from 'lucide-react';

const Dashboard = ({ activeSymbol, marketData }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Bar: Market Context */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
        {/* Dynamic Risk Calculator Card */}
        <div className="glass-panel" style={{ padding: '20px', borderLeft: '4px solid var(--warning)' }}>
          <h3 style={{ fontSize: '14px', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '8px' }}>
             <ShieldCheck size={16} /> RISK MANAGER ({activeSymbol})
          </h3>
          <div style={{ marginTop: '15px' }}>
             <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>YOUR CAPITAL</p>
             <h4 style={{ fontSize: '18px', fontWeight: 800 }}>₹25,000</h4>
             <div style={{ marginTop: '10px', padding: '8px', background: 'rgba(255, 184, 0, 0.1)', borderRadius: '6px' }}>
                <p style={{ fontSize: '10px', color: 'var(--warning)' }}>MAX LOTS TO BUY</p>
                <p style={{ fontSize: '16px', fontWeight: 900 }}>
                  {activeSymbol === 'BANKNIFTY' ? '2 LOTS (30 Qty)' : '3 LOTS (150 Qty)'}
                </p>
             </div>
             <p style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '8px' }}>
               *Based on {activeSymbol === 'BANKNIFTY' ? 'high' : 'medium'} volatility.
             </p>
          </div>
        </div>

        {/* Daily Goal Card */}
        <div className="glass-panel" style={{ padding: '20px', borderLeft: '4px solid var(--success)' }}>
          <h3 style={{ fontSize: '14px', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '8px' }}>
             <Zap size={16} /> DAILY GOAL
          </h3>
          <div style={{ marginTop: '15px' }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                <span>PROGRESS</span>
                <span>75%</span>
             </div>
             <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', margin: '8px 0' }}>
                <div style={{ width: '75%', height: '100%', background: 'var(--success)', borderRadius: '10px' }}></div>
             </div>
             <p style={{ fontSize: '12px', fontWeight: 700 }}>₹1,500 / ₹2,000</p>
          </div>
        </div>

        {/* VIX Fear Index */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>VIX (FEAR INDEX)</p>
          <h2 style={{ fontSize: '24px', color: marketData?.vix > 15 ? 'var(--danger)' : 'var(--success)' }}>{marketData?.vix || '12.45'}</h2>
          <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{marketData?.vix > 15 ? '⚠️ High Volatility' : '✅ Stable Market'}</p>
        </div>

        {/* Trade Confidence */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>AI CONFIDENCE</p>
          <h2 style={{ fontSize: '24px', color: 'var(--primary)' }}>{marketData?.confidence || '8.5'}/10</h2>
          <div style={{ display: 'flex', gap: '2px', marginTop: '8px' }}>
            {[...Array(10)].map((_, i) => (
              <div key={i} style={{ flex: 1, height: '4px', background: i < (marketData?.confidence || 8) ? 'var(--primary)' : 'rgba(255,255,255,0.1)', borderRadius: '2px' }}></div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Action Area */}
      {/* Dynamic Sector Health Monitor */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <Activity size={20} color="var(--primary)" />
          {activeSymbol} TOP DRIVERS (LIVE)
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
           {(activeSymbol === 'BANKNIFTY' ? [
             { name: 'HDFC BANK', weight: '29%', trend: 'up', price: '1,452.40' },
             { name: 'ICICI BANK', weight: '23%', trend: 'up', price: '1,085.15' },
             { name: 'SBI', weight: '10%', trend: 'down', price: '765.20' },
             { name: 'AXIS BANK', weight: '9%', trend: 'up', price: '1,045.00' }
           ] : [
             { name: 'RELIANCE', weight: '11%', trend: 'up', price: '2,945.00' },
             { name: 'HDFC BANK', weight: '9%', trend: 'up', price: '1,452.40' },
             { name: 'TCS', weight: '5%', trend: 'down', price: '4,050.20' },
             { name: 'INFOSYS', weight: '4%', trend: 'up', price: '1,560.00' }
           ]).map((stock, i) => (
             <div key={i} className="glass-card" style={{ padding: '15px', borderLeft: stock.trend === 'up' ? '4px solid var(--success)' : '4px solid var(--danger)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                   <span style={{ fontSize: '13px', fontWeight: 800 }}>{stock.name}</span>
                   <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>WT: {stock.weight}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                   <span style={{ fontSize: '14px', fontWeight: 700 }}>₹{stock.price}</span>
                   <span style={{ fontSize: '11px', color: stock.trend === 'up' ? 'var(--success)' : 'var(--danger)' }}>
                      {stock.trend === 'up' ? '▲ BULLISH' : '▼ BEARISH'}
                   </span>
                </div>
             </div>
           ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <MainChart activeSymbol={activeSymbol} data={marketData} />
          <div className="glass-panel" style={{ padding: '20px', borderLeft: '6px solid var(--primary)', background: 'rgba(0, 255, 136, 0.02)' }}>
            <h4 style={{ color: 'var(--primary)', fontSize: '12px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Zap size={14} /> AI QUICK VERDICT:
            </h4>
            <p style={{ fontSize: '16px', fontWeight: 500, color: 'var(--text-secondary)', lineHeight: '1.5' }}>
              "Market is currently in a strong uptrend. {activeSymbol} is holding its support. **Buying on dips** is the best strategy for the next 30 minutes. Avoid shorting."
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <SignalPanel activeSymbol={activeSymbol} data={marketData} />
          
          {/* Simplified Stats */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '15px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={18} color="var(--primary)" />
              TRADING CHECKLIST
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[
                { label: 'Trend Match', status: 'OK', color: 'var(--success)' },
                { label: 'Data Support', status: 'OK', color: 'var(--success)' },
                { label: 'Volatility', status: 'LOW', color: 'var(--primary)' }
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                  <span style={{ fontSize: '13px' }}>{item.label}</span>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: item.color }}>{item.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
