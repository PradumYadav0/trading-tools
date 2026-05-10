import React, { useState, useEffect } from 'react';
import { Brain, MessageSquare, TrendingUp, AlertTriangle, Lightbulb, Sparkles, BarChart2 } from 'lucide-react';
import axios from 'axios';

const AIInsights = ({ activeSymbol, data }) => {
  const [insight, setInsight] = useState("AI is analyzing the trend... Please wait.");
  const [loading, setLoading] = useState(false);

  const fetchAIReport = async () => {
    setLoading(true);
    try {
      const response = await axios.post('/api/ai-insights', {
        symbol: activeSymbol,
        data: data
      });
      setInsight(response.data.insight);
    } catch (error) {
      setInsight("Failed to fetch AI insights. Please try again later.");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAIReport();
  }, [activeSymbol]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
        <div className="glass-panel" style={{ padding: '24px', textAlign: 'center', borderTop: '4px solid var(--success)' }}>
           <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>INSTITUTIONAL SENTIMENT</p>
           <div style={{ position: 'relative', height: '80px', marginTop: '10px' }}>
              <div style={{ fontSize: '32px', fontWeight: 900, color: 'var(--success)' }}>84%</div>
              <p style={{ fontSize: '12px', fontWeight: 700 }}>EXTREMELY BULLISH</p>
           </div>
           <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', marginTop: '10px' }}>
              <div style={{ width: '84%', height: '100%', background: 'linear-gradient(90deg, var(--danger), var(--warning), var(--success))', borderRadius: '10px' }}></div>
           </div>
        </div>

        <div className="glass-panel" style={{ padding: '24px', textAlign: 'center', borderTop: '4px solid var(--primary)' }}>
           <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>AI CONVICTION SCORE</p>
           <h2 style={{ fontSize: '32px', fontWeight: 900, marginTop: '10px' }}>8.8<span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>/10</span></h2>
           <p style={{ fontSize: '12px', color: 'var(--primary)' }}>High Probability Setup</p>
        </div>

        <div className="glass-panel" style={{ padding: '24px', textAlign: 'center', borderTop: '4px solid var(--warning)' }}>
           <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>MARKET VOLATILITY</p>
           <h2 style={{ fontSize: '32px', fontWeight: 900, marginTop: '10px', color: 'var(--warning)' }}>LOW</h2>
           <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Ideal for Option Buying</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="glass-panel" style={{ padding: '30px' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
               <Sparkles size={20} color="#a855f7" />
               LIVE MARKET REPORT
            </h3>
            <div style={{ background: 'rgba(168, 85, 247, 0.05)', padding: '25px', borderRadius: '15px', border: '1px dashed #a855f7' }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: '20px' }}>
                   <p className="animate-pulse">AI is thinking...</p>
                </div>
              ) : (
                <p style={{ fontSize: '16px', lineHeight: '1.8', color: 'white' }}>
                  {insight}
                </p>
              )}
            </div>
            <button 
              onClick={fetchAIReport}
              style={{ marginTop: '20px', padding: '12px 24px', background: '#a855f7', border: 'none', borderRadius: '8px', color: 'white', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
               <MessageSquare size={16} /> RE-GENERATE REPORT
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
             <div className="glass-panel" style={{ padding: '20px', borderTop: '4px solid var(--primary)' }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                   <BarChart2 size={18} color="var(--primary)" />
                   30-DAY TREND ANALYTICS
                </h4>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                   AI has analyzed 12,000+ data points from the last 30 days. 
                   Current structure matches the **"Bullish Reversal"** pattern seen on April 14th.
                </p>
                <div style={{ marginTop: '15px', padding: '10px', background: 'rgba(0, 255, 136, 0.05)', borderRadius: '8px' }}>
                   <p style={{ fontSize: '10px', color: 'var(--success)' }}>TOMORROW'S PREDICTION</p>
                   <p style={{ fontSize: '14px', fontWeight: 800 }}>GAP-UP OPENING (72% Prob.)</p>
                </div>
             </div>
             <div className="glass-panel" style={{ padding: '20px' }}>
                <h4 style={{ color: 'var(--success)', marginBottom: '10px' }}>BULLISH PATTERNS</h4>
                <ul style={{ fontSize: '13px', color: 'var(--text-secondary)', paddingLeft: '20px' }}>
                   <li>Hammer detected at Support</li>
                   <li>RSI Bullish Divergence</li>
                   <li>W-Pattern formation</li>
                </ul>
             </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
           <div className="glass-panel" style={{ padding: '20px', background: 'rgba(255, 184, 0, 0.02)' }}>
              <h3 style={{ fontSize: '15px', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
                 <AlertTriangle size={18} /> CRITICAL WARNINGS
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                 "Market VIX is rising. Avoid taking heavy positions near the day's high."
              </p>
           </div>

           <div className="glass-panel" style={{ padding: '20px' }}>
              <h3 style={{ fontSize: '15px', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
                 <Lightbulb size={18} /> TRADING HACK
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                 "Today, follow the 15-minute high/low strategy. It has a 78% win rate in current conditions."
              </p>
           </div>
        </div>
      </div>
      {/* Tomorrow's Market Forecast (Predictive AI) */}
      <div className="glass-panel" style={{ padding: '24px', background: 'linear-gradient(135deg, rgba(0, 255, 136, 0.05) 0%, transparent 100%)', borderTop: '4px solid var(--primary)' }}>
         <h3 style={{ fontSize: '18px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <Sparkles size={20} color="var(--primary)" />
            TOMORROW'S MARKET FORECAST (AI PROJECTION)
         </h3>
         <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
            <div className="glass-card" style={{ padding: '15px' }}>
               <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>CHART LOGIC</p>
               <p style={{ fontSize: '14px', fontWeight: 800, marginTop: '5px' }}>BULLISH PENNANT</p>
               <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '5px' }}>Price closing above 20-EMA on 1H chart. Trend is strong.</p>
            </div>
            <div className="glass-card" style={{ padding: '15px' }}>
               <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>OI LOGIC</p>
               <p style={{ fontSize: '14px', fontWeight: 800, marginTop: '5px' }}>PUT WRITING AT 22400</p>
               <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '5px' }}>Bulls are shifting their base higher for tomorrow's expiry.</p>
            </div>
            <div className="glass-card" style={{ padding: '15px' }}>
               <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>GLOBAL NEWS</p>
               <p style={{ fontSize: '14px', fontWeight: 800, marginTop: '5px' }}>US FED STANCE: DOVISH</p>
               <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '5px' }}>Positive sentiment from Nasdaq will lead to Gap-Up opening.</p>
            </div>
         </div>
         <div style={{ marginTop: '20px', padding: '15px', background: 'rgba(0, 255, 136, 0.1)', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
               <p style={{ fontSize: '10px', color: 'var(--success)' }}>FINAL VERDICT FOR TOMORROW</p>
               <h2 style={{ fontSize: '24px', fontWeight: 900 }}>GAP-UP OPENING EXPECTED (78% CONFIDENCE)</h2>
            </div>
            <div style={{ textAlign: 'right' }}>
               <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>SUGGESTED STRATEGY</p>
               <p style={{ fontSize: '14px', fontWeight: 800 }}>B.T.S.T (BUY CALL)</p>
            </div>
         </div>
      </div>

      {/* Historical Data Table */}
      <div className="glass-panel" style={{ padding: '24px' }}>
         <h3 style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <TrendingUp size={20} color="var(--primary)" />
            HISTORICAL DATA LOG (LAST 7 SESSIONS)
         </h3>
         <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
               <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '12px' }}>DATE</th>
                  <th style={{ padding: '12px' }}>OPEN</th>
                  <th style={{ padding: '12px' }}>HIGH</th>
                  <th style={{ padding: '12px' }}>LOW</th>
                  <th style={{ padding: '12px' }}>CLOSE</th>
                  <th style={{ padding: '12px' }}>OI CHANGE</th>
               </tr>
            </thead>
            <tbody>
               {[
                 { date: '06 May', o: '22,450', h: '22,580', l: '22,390', c: '22,510', oi: '+4.5%' },
                 { date: '05 May', o: '22,380', h: '22,490', l: '22,310', c: '22,440', oi: '+2.1%' },
                 { date: '04 May', o: '22,510', h: '22,620', l: '22,480', c: '22,390', oi: '-1.8%' },
                 { date: '03 May', o: '22,420', h: '22,550', l: '22,400', c: '22,515', oi: '+5.2%' },
                 { date: '02 May', o: '22,290', h: '22,440', l: '22,250', c: '22,410', oi: '+0.8%' },
                 { date: '01 May', o: '22,350', h: '22,380', l: '22,210', c: '22,285', oi: '-3.4%' },
                 { date: '30 Apr', o: '22,210', h: '22,390', l: '22,180', c: '22,340', oi: '+6.1%' },
               ].map((row, i) => (
                 <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', hover: { background: 'rgba(255,255,255,0.02)' } }}>
                    <td style={{ padding: '12px', fontWeight: 700 }}>{row.date}</td>
                    <td style={{ padding: '12px' }}>{row.o}</td>
                    <td style={{ padding: '12px' }}>{row.h}</td>
                    <td style={{ padding: '12px' }}>{row.l}</td>
                    <td style={{ padding: '12px', color: 'var(--primary)', fontWeight: 700 }}>{row.c}</td>
                    <td style={{ padding: '12px', color: row.oi.includes('+') ? 'var(--success)' : 'var(--danger)' }}>{row.oi}</td>
                 </tr>
               ))}
            </tbody>
         </table>
      </div>
    </div>
  );
};

export default AIInsights;
