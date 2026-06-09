import React, { useEffect, useState } from 'react';
import { 
  AlertCircle, 
  RefreshCw, 
  CheckCircle, 
  XCircle, 
  Clock, 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  Zap, 
  TrendingUp as BullishIcon, 
  Brain, 
  Compass, 
  Layers,
  Trash2
} from 'lucide-react';
import { getIstDateString } from '../utils/market';

const AiTesting = () => {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview'); // 'overview', 'option_chain', 'chart', 'all'

  useEffect(() => {
    fetchSignals();
  }, []);

  const fetchSignals = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/signals');
      const result = await response.json();
      if (result.success) {
        const aiSignals = result.data.filter(s => s.source !== 'OPENCLAW');
        setSignals(aiSignals);
      } else {
        setError(result.message || 'Failed to fetch signals');
      }
    } catch (err) {
      setError('Error connecting to server');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const deleteSignal = async (id) => {
    if (!confirm('Are you sure you want to delete this signal log?')) return;
    try {
      const response = await fetch(`/api/signals/${id}`, { method: 'DELETE' });
      const result = await response.json();
      if (result.success) {
        fetchSignals();
      } else {
        alert('Failed to delete: ' + result.message);
      }
    } catch (err) {
      console.error(err);
      alert('Error deleting signal');
    }
  };

  const clearAllSignals = async () => {
    if (!confirm('WARNING: Are you sure you want to delete ALL signals history? This cannot be undone.')) return;
    try {
      const response = await fetch('/api/signals?source=AI_TESTING', { method: 'DELETE' });
      const result = await response.json();
      if (result.success) {
        fetchSignals();
      } else {
        alert('Failed to clear logs: ' + result.message);
      }
    } catch (err) {
      console.error(err);
      alert('Error clearing signals');
    }
  };

  // Separate signals by source
  const optionChainSignals = signals.filter(s => !s.source || s.source === 'OPTION_CHAIN');
  const chartSignals = signals.filter(s => s.source === 'CHART');
  const hybridSignals = signals.filter(s => s.source === 'HYBRID');

  // Stats calculation helper
  const calculateStats = (filteredSignals) => {
    const total = filteredSignals.length;
    const success = filteredSignals.filter(s => s.status === 'SUCCESS').length;
    const failed = filteredSignals.filter(s => s.status === 'FAILED').length;
    const pending = filteredSignals.filter(s => s.status === 'PENDING').length;
    
    // Win Rate logic (ignore pending trades)
    const activeTrades = success + failed;
    const winRate = activeTrades > 0 ? parseFloat(((success / activeTrades) * 100).toFixed(1)) : 0;

    let netPoints = 0;
    filteredSignals.forEach(signal => {
      let exitPrice = signal.exit_price;
      if (!exitPrice || exitPrice <= 0) {
        if (signal.status === 'SUCCESS') exitPrice = signal.target_price;
        else if (signal.status === 'FAILED') exitPrice = signal.stoploss_price;
      }

      if (exitPrice && exitPrice > 0) {
        if (signal.type === 'CALL') {
          netPoints += (exitPrice - signal.entry_price);
        } else if (signal.type === 'PUT') {
          netPoints += (signal.entry_price - exitPrice);
        }
      } else if (signal.status === 'SUCCESS') {
        if (signal.type === 'CALL') {
          netPoints += (signal.target_price - signal.entry_price);
        } else if (signal.type === 'PUT') {
          netPoints += (signal.entry_price - signal.target_price);
        }
      } else if (signal.status === 'FAILED') {
        if (signal.type === 'CALL') {
          netPoints += (signal.stoploss_price - signal.entry_price); // Negative
        } else if (signal.type === 'PUT') {
          netPoints += (signal.entry_price - signal.stoploss_price); // Negative
        }
      }
    });

    return { total, success, failed, pending, winRate, netPoints };
  };

  const optionChainStats = calculateStats(optionChainSignals);
  const chartStats = calculateStats(chartSignals);
  const hybridStats = calculateStats(hybridSignals);
  const overallStats = calculateStats(signals);

  // Calculate stats for TODAY (combining all sources for quick overview)
  const todayStr = getIstDateString(new Date());
  const todaySignals = signals.filter(s => {
    const dateStr = s.created_at.endsWith('Z') || s.created_at.endsWith('UTC') ? s.created_at : s.created_at + ' UTC';
    return getIstDateString(new Date(dateStr)) === todayStr;
  });
  const todayStats = calculateStats(todaySignals);

  // Find the winner
  const getWinnerInfo = () => {
    if (optionChainStats.total === 0 && chartStats.total === 0 && hybridStats.total === 0) {
      return { winner: 'NONE', text: 'Abhi dono systems me data load nahi hua hai. Run tools to generate signals!' };
    }

    const ocRate = optionChainStats.winRate;
    const chartRate = chartStats.winRate;
    const hybridRate = hybridStats.winRate;
    const ocPoints = optionChainStats.netPoints;
    const chartPoints = chartStats.netPoints;
    const hybridPoints = hybridStats.netPoints;

    if (hybridStats.total > 0 && hybridRate >= Math.max(ocRate, chartRate) && hybridRate >= 50) {
      return {
        winner: 'HYBRID',
        text: `Hybrid Convergence Model sabse accurate hai! Iski Win Rate ${hybridRate}% (Net P&L: +${hybridPoints.toFixed(1)} pts) hai. Option Chain (${ocRate}%) aur Chart (${chartRate}%) isse piche hain. Convergence filtering works best!`
      };
    }

    if (ocRate > chartRate && ocPoints > chartPoints) {
      return {
        winner: 'OPTION_CHAIN',
        text: `Option Chain is clearly winning! Iski Win Rate (${ocRate}%) aur Net P&L (+${ocPoints.toFixed(1)} pts) dono Chart indicators se kaafi behtar chal rahe hain.`
      };
    } else if (chartRate > ocRate && chartPoints > ocPoints) {
      return {
        winner: 'CHART',
        text: `Chart Analysis is winning! Iski Win Rate (${chartRate}%) aur Net P&L (+${chartPoints.toFixed(1)} pts) dono Option Chain data se behtar performance de rahe hain.`
      };
    } else if (ocRate > chartRate) {
      return {
        winner: 'OPTION_CHAIN',
        text: `Option Chain ki Accuracy (Win Rate: ${ocRate}%) higher hai, halanki Chart Analysis ne net points P&L (+${chartPoints.toFixed(1)} pts) better capture kiye hain.`
      };
    } else if (chartRate > ocRate) {
      return {
        winner: 'CHART',
        text: `Chart Analysis ki Accuracy (Win Rate: ${chartRate}%) higher hai, halanki Option Chain ne net points P&L (+${ocPoints.toFixed(1)} pts) better catch kiye hain.`
      };
    } else {
      return {
        winner: 'TIE',
        text: `Dono models ki accuracy tied hai (${ocRate}% vs ${chartRate}%). Apne risk reward and volume indicators ko review karein trading entry se pehle.`
      };
    }
  };

  const winnerInfo = getWinnerInfo();

  // Filter signals for table display
  const getFilteredSignals = () => {
    if (activeTab === 'option_chain') return optionChainSignals;
    if (activeTab === 'chart') return chartSignals;
    if (activeTab === 'hybrid') return hybridSignals;
    return signals; // 'all' or 'overview' shows all
  };

  const displaySignals = getFilteredSignals();

  return (
    <div className="container" style={{ padding: '2rem', color: 'white', maxWidth: '1400px', margin: '0 auto' }}>
      
      {/* Title Header */}
      <div style={{ marginBottom: '2.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '2.2rem', fontWeight: '800', marginBottom: '0.5rem', background: 'linear-gradient(135deg, #FFF 0%, #A5B4FC 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            AI & Algorithmic Backtesting
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>
            Compare accuracy of Option Chain (Open Interest) vs Chart Analysis (Multi-Indicator Consensus) to find the best trading strategy.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button 
            onClick={clearAllSignals}
            disabled={loading || signals.length === 0}
            style={{ 
              background: 'rgba(239, 68, 68, 0.1)', 
              color: '#FCA5A5', 
              border: '1px solid rgba(239, 68, 68, 0.3)', 
              padding: '0.65rem 1.25rem', 
              borderRadius: '10px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontWeight: '600',
              transition: 'all 0.2s'
            }}
          >
            <Trash2 size={16} />
            Clear All History
          </button>

          <button 
            onClick={fetchSignals}
            disabled={loading}
            className="btn-primary"
            style={{ 
              background: 'var(--primary-color)', 
              color: 'white', 
              border: 'none', 
              padding: '0.65rem 1.25rem', 
              borderRadius: '10px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontWeight: '600',
              transition: 'all 0.2s',
              boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)'
            }}
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Refresh & Sync Data
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
          marginBottom: '2.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Tabs Menu */}
      <div style={{ 
        display: 'flex', 
        gap: '0.5rem', 
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)', 
        marginBottom: '2rem',
        paddingBottom: '0.5rem',
        flexWrap: 'wrap'
      }}>
        {[
          { id: 'overview', name: 'Accuracy Comparison', icon: <Activity size={16} /> },
          { id: 'option_chain', name: 'Option Chain Signals', icon: <Layers size={16} /> },
          { id: 'chart', name: 'Chart Analysis Signals', icon: <Compass size={16} /> },
          { id: 'hybrid', name: 'Hybrid Convergence', icon: <Brain size={16} /> },
          { id: 'all', name: 'All Signals Log', icon: <Zap size={16} /> }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: activeTab === tab.id ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
              color: activeTab === tab.id ? '#A5B4FC' : 'var(--text-secondary)',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #6366F1' : '2px solid transparent',
              padding: '0.75rem 1.25rem',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '0.95rem',
              transition: 'all 0.2s',
              borderRadius: '6px 6px 0 0'
            }}
          >
            {tab.icon}
            {tab.name}
          </button>
        ))}
      </div>

      {/* 1. OVERVIEW COMPARISON TAB */}
      {activeTab === 'overview' && (
        <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
          
          {/* Winner Head-to-Head Banner */}
          <div className="glass-panel" style={{ 
            padding: '1.5rem 2rem', 
            marginBottom: '2.5rem', 
            borderRadius: '16px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            background: winnerInfo.winner === 'OPTION_CHAIN' 
              ? 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(99, 102, 241, 0.08) 100%)'
              : winnerInfo.winner === 'CHART'
              ? 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(168, 85, 247, 0.08) 100%)'
              : winnerInfo.winner === 'HYBRID'
              ? 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(16, 185, 129, 0.08) 100%)'
              : 'rgba(30, 41, 59, 0.8)',
            display: 'flex',
            alignItems: 'center',
            gap: '1.5rem',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)'
          }}>
            <div style={{
              background: winnerInfo.winner === 'OPTION_CHAIN' 
                ? 'rgba(99, 102, 241, 0.2)' 
                : winnerInfo.winner === 'CHART' 
                ? 'rgba(168, 85, 247, 0.2)' 
                : winnerInfo.winner === 'HYBRID' 
                ? 'rgba(16, 185, 129, 0.2)' 
                : 'rgba(255,255,255,0.05)',
              padding: '1rem',
              borderRadius: '12px',
              color: winnerInfo.winner === 'OPTION_CHAIN' 
                ? '#A5B4FC' 
                : winnerInfo.winner === 'CHART' 
                ? '#F472B6' 
                : winnerInfo.winner === 'HYBRID' 
                ? '#10B981' 
                : 'white',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center'
            }}>
              <Brain size={32} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 'bold', color: 'var(--accent-primary)', marginBottom: '0.25rem' }}>
                Performance Winner (कौन है ज़्यादा Accurate?)
              </h3>
              <p style={{ fontSize: '1.05rem', color: '#E2E8F0', lineHeight: '1.5' }}>
                {winnerInfo.text}
              </p>
            </div>
          </div>

          {/* Head-to-Head Model Comparison Grid */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', 
            gap: '1.5rem', 
            marginBottom: '2.5rem',
            alignItems: 'stretch'
          }}>
            
            {/* Model A: Option Chain */}
            <div className="glass-panel" style={{ 
              padding: '2rem', 
              borderRadius: '16px',
              border: '1.5px solid rgba(99, 102, 241, 0.2)',
              background: 'linear-gradient(180deg, rgba(99, 102, 241, 0.03) 0%, rgba(30, 41, 59, 0.4) 100%)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Layers size={22} color="#818CF8" />
                    <h3 style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#A5B4FC' }}>Option Chain Model</h3>
                  </div>
                  <span style={{ fontSize: '0.8rem', background: 'rgba(99,102,241,0.2)', color: '#A5B4FC', padding: '0.25rem 0.5rem', borderRadius: '4px', fontWeight: '600' }}>
                    Open Interest Math
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '1.5rem' }}>
                  <span style={{ fontSize: '3rem', fontWeight: '800', color: '#FFF' }}>{optionChainStats.winRate}%</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Win Rate</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Total Signal</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{optionChainStats.total}</div>
                  </div>
                  <div style={{ background: 'rgba(16,185,129,0.05)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ color: '#34D399', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Success</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#34D399' }}>{optionChainStats.success}</div>
                  </div>
                  <div style={{ background: 'rgba(239,68,68,0.05)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ color: '#F87171', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Failed</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#F87171' }}>{optionChainStats.failed}</div>
                  </div>
                </div>
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Net Profit/Loss Points:</span>
                <span style={{ 
                  fontSize: '1.4rem', 
                  fontWeight: '800', 
                  color: optionChainStats.netPoints >= 0 ? '#34D399' : '#F87171' 
                }}>
                  {optionChainStats.netPoints >= 0 ? `+${optionChainStats.netPoints.toFixed(1)}` : optionChainStats.netPoints.toFixed(1)}
                </span>
              </div>
            </div>

            {/* Model B: Chart Analysis Model */}
            <div className="glass-panel" style={{ 
              padding: '2rem', 
              borderRadius: '16px',
              border: '1.5px solid rgba(168, 85, 247, 0.2)',
              background: 'linear-gradient(180deg, rgba(168, 85, 247, 0.03) 0%, rgba(30, 41, 59, 0.4) 100%)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Compass size={22} color="#C084FC" />
                    <h3 style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#E9D5FF' }}>Chart Analysis Model</h3>
                  </div>
                  <span style={{ fontSize: '0.8rem', background: 'rgba(168,85,247,0.2)', color: '#E9D5FF', padding: '0.25rem 0.5rem', borderRadius: '4px', fontWeight: '600' }}>
                    Multi-Indicator Consensus
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '1.5rem' }}>
                  <span style={{ fontSize: '3rem', fontWeight: '800', color: '#FFF' }}>{chartStats.winRate}%</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Win Rate</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Total Signal</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{chartStats.total}</div>
                  </div>
                  <div style={{ background: 'rgba(16,185,129,0.05)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ color: '#34D399', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Success</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#34D399' }}>{chartStats.success}</div>
                  </div>
                  <div style={{ background: 'rgba(239,68,68,0.05)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ color: '#F87171', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Failed</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#F87171' }}>{chartStats.failed}</div>
                  </div>
                </div>
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Net Profit/Loss Points:</span>
                <span style={{ 
                  fontSize: '1.4rem', 
                  fontWeight: '800', 
                  color: chartStats.netPoints >= 0 ? '#34D399' : '#F87171' 
                }}>
                  {chartStats.netPoints >= 0 ? `+${chartStats.netPoints.toFixed(1)}` : chartStats.netPoints.toFixed(1)}
                </span>
              </div>
            </div>

            {/* Model C: Hybrid Convergence Model */}
            <div className="glass-panel" style={{ 
              padding: '2rem', 
              borderRadius: '16px',
              border: '1.5px solid rgba(16, 185, 129, 0.2)',
              background: 'linear-gradient(180deg, rgba(16, 185, 129, 0.03) 0%, rgba(30, 41, 59, 0.4) 100%)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Brain size={22} color="#34D399" />
                    <h3 style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#A7F3D0' }}>Hybrid Convergence</h3>
                  </div>
                  <span style={{ fontSize: '0.8rem', background: 'rgba(16,185,129,0.2)', color: '#34D399', padding: '0.25rem 0.5rem', borderRadius: '4px', fontWeight: '600' }}>
                    Double Confirmation
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '1.5rem' }}>
                  <span style={{ fontSize: '3rem', fontWeight: '800', color: '#FFF' }}>{hybridStats.winRate}%</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Win Rate</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Total Signal</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{hybridStats.total}</div>
                  </div>
                  <div style={{ background: 'rgba(16,185,129,0.05)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ color: '#34D399', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Success</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#34D399' }}>{hybridStats.success}</div>
                  </div>
                  <div style={{ background: 'rgba(239,68,68,0.05)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ color: '#F87171', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Failed</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#F87171' }}>{hybridStats.failed}</div>
                  </div>
                </div>
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Net Profit/Loss Points:</span>
                <span style={{ 
                  fontSize: '1.4rem', 
                  fontWeight: '800', 
                  color: hybridStats.netPoints >= 0 ? '#34D399' : '#F87171' 
                }}>
                  {hybridStats.netPoints >= 0 ? `+${hybridStats.netPoints.toFixed(1)}` : hybridStats.netPoints.toFixed(1)}
                </span>
              </div>
            </div>

          </div>

          {/* Today's performance banner ("कितना दूध कितना पानी") */}
          <div className="glass-panel" style={{ 
            padding: '1.5rem 2rem', 
            marginBottom: '2.5rem',
            border: '1px solid rgba(255, 255, 255, 0.05)'
          }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '1.25rem', color: 'var(--accent-primary)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Zap size={18} /> Today's Performance Breakdown (कितना दूध कितना पानी)
            </h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem' }}>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.25rem 1rem', borderRadius: '10px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.03)' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.35rem' }}>Trades Generated Today</div>
                <div style={{ fontSize: '1.8rem', fontWeight: '800' }}>{todayStats.total}</div>
              </div>
              <div style={{ background: 'rgba(16,185,129,0.03)', padding: '1.25rem 1rem', borderRadius: '10px', textAlign: 'center', border: '1px solid rgba(16,185,129,0.1)' }}>
                <div style={{ color: '#34D399', fontSize: '0.85rem', marginBottom: '0.35rem' }}>Success</div>
                <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#34D399' }}>{todayStats.success}</div>
              </div>
              <div style={{ background: 'rgba(239,68,68,0.03)', padding: '1.25rem 1rem', borderRadius: '10px', textAlign: 'center', border: '1px solid rgba(239,68,68,0.1)' }}>
                <div style={{ color: '#F87171', fontSize: '0.85rem', marginBottom: '0.35rem' }}>Failed</div>
                <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#F87171' }}>{todayStats.failed}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.25rem 1rem', borderRadius: '10px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.03)' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.35rem' }}>Today's Net Points</div>
                <div style={{ fontSize: '1.8rem', fontWeight: '800', color: todayStats.netPoints >= 0 ? '#34D399' : '#F87171' }}>
                  {todayStats.netPoints >= 0 ? `+${todayStats.netPoints.toFixed(1)}` : todayStats.netPoints.toFixed(1)}
                </div>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* 2. STATS DISPLAY FOR INDIVIDUAL SIGNALS TABS */}
      {activeTab !== 'overview' && (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', 
          gap: '1.25rem', 
          marginBottom: '2rem',
          animation: 'fadeIn 0.3s ease-in-out'
        }}>
          <div className="glass-panel" style={{ padding: '1.25rem', textAlign: 'center' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Filtered Signals</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
              {activeTab === 'option_chain' ? optionChainStats.total : activeTab === 'chart' ? chartStats.total : activeTab === 'hybrid' ? hybridStats.total : overallStats.total}
            </div>
          </div>
          <div className="glass-panel" style={{ padding: '1.25rem', textAlign: 'center' }}>
            <div style={{ color: '#34D399', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Success</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#34D399' }}>
              {activeTab === 'option_chain' ? optionChainStats.success : activeTab === 'chart' ? chartStats.success : activeTab === 'hybrid' ? hybridStats.success : overallStats.success}
            </div>
          </div>
          <div className="glass-panel" style={{ padding: '1.25rem', textAlign: 'center' }}>
            <div style={{ color: '#F87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Failed</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#F87171' }}>
              {activeTab === 'option_chain' ? optionChainStats.failed : activeTab === 'chart' ? chartStats.failed : activeTab === 'hybrid' ? hybridStats.failed : overallStats.failed}
            </div>
          </div>
          <div className="glass-panel" style={{ padding: '1.25rem', textAlign: 'center', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(168, 85, 247, 0.1) 100%)' }}>
            <div style={{ color: '#C084FC', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Strategy Win Rate</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#C084FC' }}>
              {activeTab === 'option_chain' ? optionChainStats.winRate : activeTab === 'chart' ? chartStats.winRate : activeTab === 'hybrid' ? hybridStats.winRate : overallStats.winRate}%
            </div>
          </div>
          <div className="glass-panel" style={{ padding: '1.25rem', textAlign: 'center' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Net P&L Points</div>
            <div style={{ 
              fontSize: '1.8rem', 
              fontWeight: 'bold', 
              color: (activeTab === 'option_chain' ? optionChainStats.netPoints : activeTab === 'chart' ? chartStats.netPoints : activeTab === 'hybrid' ? hybridStats.netPoints : overallStats.netPoints) >= 0 ? '#34D399' : '#F87171'
            }}>
              {(activeTab === 'option_chain' ? optionChainStats.netPoints : activeTab === 'chart' ? chartStats.netPoints : activeTab === 'hybrid' ? hybridStats.netPoints : overallStats.netPoints) >= 0 ? '+' : ''}
              {(activeTab === 'option_chain' ? optionChainStats.netPoints : activeTab === 'chart' ? chartStats.netPoints : activeTab === 'hybrid' ? hybridStats.netPoints : overallStats.netPoints).toFixed(1)}
            </div>
          </div>
        </div>
      )}

      {/* SIGNALS TABLE LOG */}
      <div className="glass-panel" style={{ padding: '1.75rem', overflowX: 'auto', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '700' }}>
            {activeTab === 'overview' ? 'Recent Signals Feed (All Sources)' : `${activeTab === 'option_chain' ? 'Option Chain' : activeTab === 'chart' ? 'Chart Technical' : activeTab === 'hybrid' ? 'Hybrid Convergence' : 'All'} Signals Logs`}
          </h2>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Showing {displaySignals.length} records
          </span>
        </div>
        
        {displaySignals.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
            No signals captured for the current view yet. Active background tracker is analyzing indices...
          </div>
        ) : (
          <div style={{ maxHeight: '520px', overflowY: 'auto', paddingRight: '0.25rem' }} className="signals-table-container">
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '950px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                <th style={{ padding: '1rem 0.75rem', whiteSpace: 'nowrap' }}>Timestamp</th>
                <th style={{ padding: '1rem 0.75rem', whiteSpace: 'nowrap' }}>Symbol</th>
                <th style={{ padding: '1rem 0.75rem', whiteSpace: 'nowrap' }}>Source / Type</th>
                <th style={{ padding: '1rem 0.75rem', whiteSpace: 'nowrap' }}>Trade Type</th>
                <th style={{ padding: '1rem 0.75rem', whiteSpace: 'nowrap' }}>Entry Price</th>
                <th style={{ padding: '1rem 0.75rem', whiteSpace: 'nowrap' }}>Exit Price</th>
                <th style={{ padding: '1rem 0.75rem', whiteSpace: 'nowrap' }}>Target Price</th>
                <th style={{ padding: '1rem 0.75rem', whiteSpace: 'nowrap' }}>Stop Loss</th>
                <th style={{ padding: '1rem 0.75rem', whiteSpace: 'nowrap' }}>Status</th>
                <th style={{ padding: '1rem 0.75rem', whiteSpace: 'nowrap' }}>Trade ID</th>
                <th style={{ padding: '1rem 0.75rem', textAlign: 'center', whiteSpace: 'nowrap' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...displaySignals].map(signal => {
                return (
                  <tr key={signal.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', fontSize: '0.92rem', transition: 'background 0.2s' }} className="table-row-hover">
                    <td style={{ padding: '1rem 0.75rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                      <div style={{ fontWeight: '500', color: '#FFF' }}>
                        {(() => {
                          const dateStr = signal.created_at.endsWith('Z') || signal.created_at.endsWith('UTC') ? signal.created_at : signal.created_at + ' UTC';
                          return new Date(dateStr).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
                        })()}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                        Entry: {(() => {
                          const dateStr = signal.created_at.endsWith('Z') || signal.created_at.endsWith('UTC') ? signal.created_at : signal.created_at + ' UTC';
                          return new Date(dateStr).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' });
                        })()}
                      </div>
                      {signal.status !== 'PENDING' && (
                        <div style={{ fontSize: '0.8rem', color: '#A5B4FC', marginTop: '0.1rem' }}>
                          Exit: {(() => {
                            const exitTimeVal = signal.exit_time || signal.updated_at;
                            const dateStr = exitTimeVal.endsWith('Z') || exitTimeVal.endsWith('UTC') ? exitTimeVal : exitTimeVal + ' UTC';
                            return new Date(dateStr).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' });
                          })()}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '1rem 0.75rem', fontWeight: 'bold' }}>{signal.symbol}</td>
                    
                    {/* Source Badge */}
                    <td style={{ padding: '1rem 0.75rem', whiteSpace: 'nowrap' }}>
                      <span style={{ 
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        padding: '0.25rem 0.6rem',
                        borderRadius: '12px',
                        display: 'inline-block',
                        whiteSpace: 'nowrap',
                        background: signal.source === 'OPTION_CHAIN' 
                          ? 'rgba(99, 102, 241, 0.15)' 
                          : signal.source === 'CHART'
                          ? 'rgba(168, 85, 247, 0.15)'
                          : 'rgba(16, 185, 129, 0.15)',
                        color: signal.source === 'OPTION_CHAIN' 
                          ? '#A5B4FC' 
                          : signal.source === 'CHART'
                          ? '#F472B6'
                          : '#34D399',
                        border: signal.source === 'OPTION_CHAIN' 
                          ? '1px solid rgba(99, 102, 241, 0.3)' 
                          : signal.source === 'CHART'
                          ? '1px solid rgba(168, 85, 247, 0.3)'
                          : '1px solid rgba(16, 185, 129, 0.3)'
                      }}>
                        {signal.source === 'OPTION_CHAIN' ? 'Option Chain' : signal.source === 'CHART' ? 'Chart Analysis' : 'Hybrid Convergence'}
                      </span>
                    </td>
                    
                    {/* CALL / PUT Badge */}
                    <td style={{ padding: '1rem 0.75rem' }}>
                      <span style={{ 
                        color: signal.type === 'CALL' ? 'var(--bullish)' : 'var(--bearish)',
                        fontWeight: '800',
                        fontSize: '0.95rem'
                      }}>
                        {signal.type}
                      </span>
                    </td>
                    
                    <td style={{ padding: '1rem 0.75rem', fontFamily: 'monospace' }}>{signal.entry_price.toFixed(2)}</td>
                    <td style={{ padding: '1rem 0.75rem', fontFamily: 'monospace', color: signal.status === 'SUCCESS' ? '#34D399' : signal.status === 'FAILED' ? '#F87171' : 'var(--text-secondary)' }}>
                      {(() => {
                        if (signal.exit_price && signal.exit_price > 0) return signal.exit_price.toFixed(2);
                        if (signal.status === 'SUCCESS' && signal.target_price) return signal.target_price.toFixed(2);
                        if (signal.status === 'FAILED' && signal.stoploss_price) return signal.stoploss_price.toFixed(2);
                        return '-';
                      })()}
                    </td>
                    <td style={{ padding: '1rem 0.75rem', color: '#34D399', fontFamily: 'monospace', fontWeight: '600' }}>
                      {signal.target_price ? signal.target_price.toFixed(2) : 'N/A'}
                    </td>
                    <td style={{ padding: '1rem 0.75rem', color: '#F87171', fontFamily: 'monospace', fontWeight: '600' }}>
                      {signal.stoploss_price ? signal.stoploss_price.toFixed(2) : 'N/A'}
                    </td>
                    
                    {/* Status Badge */}
                    <td style={{ padding: '1rem 0.75rem' }}>
                      <span style={{ 
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        color: signal.status === 'SUCCESS' ? '#34D399' : signal.status === 'FAILED' ? '#F87171' : '#FBBF24',
                        fontWeight: 'bold',
                        fontSize: '0.9rem'
                      }}>
                        {signal.status === 'SUCCESS' && <CheckCircle size={15} />}
                        {signal.status === 'FAILED' && <XCircle size={15} />}
                        {signal.status === 'PENDING' && <Clock size={15} />}
                        {signal.status}
                      </span>
                    </td>
                    <td style={{ padding: '1rem 0.75rem' }}>
                      <span style={{
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        background: 'rgba(99,102,241,0.1)',
                        color: '#a5b4fc',
                        border: '1px solid rgba(99,102,241,0.2)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        whiteSpace: 'nowrap'
                      }}>
                        CLAW-{signal.symbol}-{signal.id}
                      </span>
                    </td>
                    <td style={{ padding: '1rem 0.75rem', textAlign: 'center' }}>
                      <button
                        onClick={() => deleteSignal(signal.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#F87171',
                          cursor: 'pointer',
                          padding: '4px',
                          borderRadius: '4px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s'
                        }}
                        title="Delete Signal Log"
                        onMouseEnter={(e) => e.currentTarget.style.color = '#EF4444'}
                        onMouseLeave={(e) => e.currentTarget.style.color = '#F87171'}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .table-row-hover:hover {
          background: rgba(255, 255, 255, 0.02);
        }
        .signals-table-container::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .signals-table-container::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.01);
          border-radius: 4px;
        }
        .signals-table-container::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
        }
        .signals-table-container::-webkit-scrollbar-thumb:hover {
          background: rgba(99, 102, 241, 0.3);
        }
      `}</style>
    </div>
  );
};

export default AiTesting;
