import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import axios from 'axios';
import { 
  AreaChart, RefreshCw, TrendingUp, TrendingDown, Target, ShieldAlert,
  Play, Briefcase, Clock, AlertTriangle, CheckCircle, XCircle, Maximize2, ShieldCheck
} from 'lucide-react';
import { isMarketOpen } from '../utils/market';

const ScalpCharts = () => {
  const chartContainerRef = useRef();
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const priceLinesRef = useRef([]);

  // Page state
  const [symbol, setSymbol] = useState('NIFTY');
  const [interval, setInterval] = useState('5');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Signals & Selected signal state
  const [signals, setSignals] = useState([]);
  const [selectedSignal, setSelectedSignal] = useState(null);
  const [spotPrice, setSpotPrice] = useState(null);
  const [paperLoading, setPaperLoading] = useState(false);

  // Fetch signals and chart data
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch Chart Data
      const chartUrl = interval === 'D'
        ? `/api/charts/historical?symbol=${symbol}`
        : `/api/charts/intraday?symbol=${symbol}&interval=${interval}`;
      
      const chartResponse = await axios.get(chartUrl);
      if (chartResponse.data.success && chartResponse.data.data && chartResponse.data.data.length > 0) {
        const sortedData = chartResponse.data.data
          .filter(item => typeof item.time === 'number' && !isNaN(item.time))
          .sort((a, b) => a.time - b.time);
        
        // Deduplicate
        const uniqueData = [];
        const seenTimes = new Set();
        for (const item of sortedData) {
          if (!seenTimes.has(item.time)) {
            seenTimes.add(item.time);
            uniqueData.push(item);
          }
        }

        if (candlestickSeriesRef.current) {
          candlestickSeriesRef.current.setData(uniqueData);
          if (uniqueData.length > 0) {
            const lastCandle = uniqueData[uniqueData.length - 1];
            setSpotPrice(lastCandle.close);
          }
        }
      } else {
        setError(chartResponse.data.message || 'No chart candles returned.');
      }

      // 2. Fetch Signals
      const signalsRes = await axios.get('/api/signals');
      if (signalsRes.data.success) {
        const allSignals = signalsRes.data.data;
        setSignals(allSignals);
        
        // Auto-select or update the active focused signal
        const symbolActiveSignals = allSignals.filter(
          s => s.symbol === symbol && s.status === 'PENDING'
        );

        if (symbolActiveSignals.length > 0) {
          // If we had a selected signal, see if it is still in the active list
          const stillActive = symbolActiveSignals.find(s => s.id === selectedSignal?.id);
          if (stillActive) {
            setSelectedSignal(stillActive);
          } else {
            // Otherwise, default to the latest one
            setSelectedSignal(symbolActiveSignals[0]);
          }
        } else {
          setSelectedSignal(null);
        }
      }
    } catch (err) {
      console.error(err);
      setError('Failed to fetch scalp charts or signals data.');
    } finally {
      setLoading(false);
    }
  };

  // Initialize TradingView chart
  useEffect(() => {
    if (chartContainerRef.current) {
      try {
        const chart = createChart(chartContainerRef.current, {
          width: chartContainerRef.current.clientWidth || 800,
          height: 480,
          layout: {
            background: { color: '#0B0E14' },
            textColor: '#94A3B8',
          },
          grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
          },
          crosshair: { mode: 1 },
          timeScale: { timeVisible: true, secondsVisible: false },
          rightPriceScale: {
            borderColor: 'rgba(255, 255, 255, 0.05)',
            autoScale: true,
          },
        });

        const candlestickSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#10B981',
          downColor: '#EF4444',
          borderUpColor: '#10B981',
          borderDownColor: '#EF4444',
          wickUpColor: '#10B981',
          wickDownColor: '#EF4444',
        });

        chartRef.current = chart;
        candlestickSeriesRef.current = candlestickSeries;

        const handleResize = () => {
          if (chartContainerRef.current && chartRef.current) {
            chartRef.current.applyOptions({ 
              width: chartContainerRef.current.clientWidth 
            });
          }
        };

        window.addEventListener('resize', handleResize);
        fetchData();

        return () => {
          window.removeEventListener('resize', handleResize);
          chart.remove();
        };
      } catch (e) {
        console.error('Error creating chart:', e);
        setError('Error initializing lightweight-charts: ' + e.message);
      }
    }
  }, [symbol]); // Re-init on symbol change to keep scales clean

  // Fetch data on symbol/interval changes
  useEffect(() => {
    fetchData();
    const intervalId = setInterval(() => {
      if (isMarketOpen()) {
        fetchData();
      }
    }, 15000); // Live update every 15s during market open
    
    return () => clearInterval(intervalId);
  }, [symbol, interval]);

  // Handle overlay of horizontal price levels when selected signal changes
  useEffect(() => {
    // 1. Clear previous price lines
    if (priceLinesRef.current && priceLinesRef.current.length > 0) {
      priceLinesRef.current.forEach(line => {
        try {
          candlestickSeriesRef.current.removePriceLine(line);
        } catch (e) {
          console.error(e);
        }
      });
      priceLinesRef.current = [];
    }

    // 2. Draw new price lines if there is a selected signal
    if (selectedSignal && candlestickSeriesRef.current) {
      const { entry_price, target_price, stoploss_price } = selectedSignal;

      const entryLine = candlestickSeriesRef.current.createPriceLine({
        price: entry_price,
        color: '#06B6D4', // Cyan
        lineWidth: 2,
        lineStyle: 1, // Dashed
        axisLabelVisible: true,
        title: `Entry: ₹${entry_price.toFixed(2)}`,
      });

      const targetLine = candlestickSeriesRef.current.createPriceLine({
        price: target_price,
        color: '#10B981', // Green
        lineWidth: 2,
        lineStyle: 1,
        axisLabelVisible: true,
        title: `Target: ₹${target_price.toFixed(2)}`,
      });

      const stoplossLine = candlestickSeriesRef.current.createPriceLine({
        price: stoploss_price,
        color: '#EF4444', // Red
        lineWidth: 2,
        lineStyle: 1,
        axisLabelVisible: true,
        title: `SL: ₹${stoploss_price.toFixed(2)}`,
      });

      priceLinesRef.current = [entryLine, targetLine, stoplossLine];

      // Fit chart content to make sure lines are visible
      try {
        chartRef.current.timeScale().fitContent();
      } catch (e) {
        // Safe catch
      }
    }
  }, [selectedSignal]);

  // Execute Paper Trade shortcut
  const handleExecutePaper = async (sig) => {
    if (!sig) return;
    setPaperLoading(true);
    try {
      const lots = prompt(`Enter number of lots to buy (1 lot size NIFTY=50, BANKNIFTY=15, FINNIFTY=40, MIDCPNIFTY=75):`, "1");
      if (lots === null || isNaN(lots) || Number(lots) <= 0) {
        setPaperLoading(false);
        return;
      }

      // Quick fetch to retrieve ATM option details from openclaw analyzer
      const ocRes = await axios.post('/api/openclaw/analyze', { symbol: sig.symbol });
      if (ocRes.data.success) {
        const optionData = ocRes.data.data;
        const payload = {
          symbol: sig.symbol,
          type: sig.type,
          contract_name: optionData.suggestedOptionContract,
          qty: Number(lots),
          entry_premium: Number(optionData.optionPremiumLtp),
          entry_spot: sig.entry_price,
          target_premium: optionData.optionTarget1 ? Number(optionData.optionTarget1) : null,
          stoploss_premium: optionData.optionStoploss ? Number(optionData.optionStoploss) : null
        };

        const res = await axios.post('/api/paper/trade', payload);
        if (res.data.success) {
          alert(`Successfully purchased ${lots} lot(s) of ${optionData.suggestedOptionContract} via Paper Portfolio!`);
        }
      } else {
        alert('Could not auto-generate virtual option premium values. Please use manual orders in Paper Trading page.');
      }
    } catch (err) {
      console.error(err);
      alert('Error launching paper trade: ' + (err.response?.data?.message || err.message));
    } finally {
      setPaperLoading(false);
    }
  };

  const toggleFullScreen = () => {
    const element = chartContainerRef.current;
    if (!document.fullscreenElement) {
      element.requestFullscreen().catch(err => {
        alert(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  // Filter signals for the active symbol
  const activeSignals = signals.filter(s => s.symbol === symbol && s.status === 'PENDING');
  const pastSignals = signals.filter(s => s.symbol === symbol && s.status !== 'PENDING').slice(0, 5);

  // Spot P&L logic
  const getPnl = (sig) => {
    if (!spotPrice || !sig) return { pts: 0, pct: 0, isProfit: false };
    const diff = spotPrice - sig.entry_price;
    const pts = sig.type === 'CALL' ? diff : -diff;
    const pct = (pts / sig.entry_price) * 100;
    return {
      pts: pts.toFixed(2),
      pct: pct.toFixed(2),
      isProfit: pts >= 0
    };
  };

  const activePnl = selectedSignal ? getPnl(selectedSignal) : null;

  return (
    <div className="container" style={{ padding: '2rem', color: 'white' }}>
      
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <div className="glow-logo" style={{ background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)', padding: '0.4rem', borderRadius: '8px', boxShadow: '0 0 15px rgba(99, 102, 241, 0.4)' }}>
              <AreaChart size={20} color="white" />
            </div>
            <h1 style={{ fontSize: '1.75rem', margin: 0 }}>Scalp Level Charts</h1>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Real-time index charts with live signal targets and trailing SL overlays.</p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <select 
            value={symbol} 
            onChange={(e) => {
              setSymbol(e.target.value);
              setSelectedSignal(null);
            }}
            style={{ padding: '0.5rem 1rem', background: '#1c2128', color: 'white', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}
          >
            <option value="NIFTY">NIFTY</option>
            <option value="BANKNIFTY">BANKNIFTY</option>
            <option value="FINNIFTY">FINNIFTY</option>
            <option value="MIDCPNIFTY">MIDCPNIFTY</option>
          </select>

          <select 
            value={interval} 
            onChange={(e) => setInterval(e.target.value)}
            style={{ padding: '0.5rem 1rem', background: '#1c2128', color: 'white', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}
          >
            <option value="1">1 Min</option>
            <option value="5">5 Min</option>
            <option value="15">15 Min</option>
            <option value="60">1 Hour</option>
            <option value="D">Daily</option>
          </select>

          <div style={{
            background: isMarketOpen() ? 'rgba(0, 200, 5, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            color: isMarketOpen() ? '#00c805' : '#ef4444',
            border: `1px solid ${isMarketOpen() ? '#00c805' : '#ef4444'}`,
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            fontSize: '0.9rem',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem'
          }}>
            <span style={{ fontSize: '0.6rem' }}>●</span> {isMarketOpen() ? 'Live' : 'Closed'}
          </div>

          <button 
            onClick={fetchData}
            disabled={loading}
            style={{ 
              background: 'rgba(255, 255, 255, 0.05)', 
              color: 'white', 
              border: '1px solid var(--border-color)', 
              padding: '0.5rem 1rem', 
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
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
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.9rem'
        }}>
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Main Layout grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '2rem', alignItems: 'start', flexWrap: 'wrap' }}>
        
        {/* Left Side: Candlestick Chart */}
        <div className="glass-panel" style={{ padding: '1rem', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', padding: '0 0.5rem' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
              {symbol} {interval === 'D' ? 'Daily' : `${interval}m`} Spot Price: {spotPrice ? `₹${spotPrice.toFixed(2)}` : 'Loading...'}
            </span>
            <button 
              onClick={toggleFullScreen}
              style={{
                background: 'rgba(30, 41, 59, 0.6)', 
                border: '1px solid var(--border-color)', 
                color: 'white', 
                padding: '0.4rem', 
                borderRadius: '6px', 
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Toggle Fullscreen"
            >
              <Maximize2 size={16} />
            </button>
          </div>
          
          <div ref={chartContainerRef} style={{ width: '100%', height: '480px', borderRadius: '8px', overflow: 'hidden' }} />
        </div>

        {/* Right Side: Active Signals Panel & Legend */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Legend / Details Box */}
          <div className="glass-panel" style={{ padding: '1.25rem', border: selectedSignal ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid var(--border-color)' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Target size={18} color="var(--accent-primary)" /> Signal Overlay Focus
            </h3>

            {selectedSignal ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <div>
                    <span style={{ 
                      fontWeight: '800', 
                      fontSize: '1.1rem',
                      color: selectedSignal.type === 'CALL' ? 'var(--bullish)' : 'var(--bearish)'
                    }}>
                      {selectedSignal.symbol} {selectedSignal.type}
                    </span>
                    <span style={{
                      marginLeft: '0.5rem',
                      fontSize: '0.75rem',
                      padding: '0.15rem 0.4rem',
                      borderRadius: '4px',
                      background: 'rgba(99, 102, 241, 0.1)',
                      color: 'var(--accent-primary)',
                      fontWeight: 'bold'
                    }}>
                      {selectedSignal.source}
                    </span>
                  </div>
                  
                  <span className="pulse" style={{
                    fontSize: '0.75rem',
                    padding: '0.2rem 0.5rem',
                    borderRadius: '4px',
                    background: 'rgba(245, 158, 11, 0.1)',
                    color: '#f59e0b',
                    fontWeight: 'bold'
                  }}>
                    {selectedSignal.status}
                  </span>
                </div>

                {/* Level Details Grid */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '0.25rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Entry Spot:</span>
                    <span style={{ fontWeight: 'bold' }}>₹{selectedSignal.entry_price.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '0.25rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Current Spot:</span>
                    <span style={{ fontWeight: 'bold' }}>₹{spotPrice ? spotPrice.toFixed(2) : 'Loading...'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '0.25rem' }}>
                    <span style={{ color: 'var(--bullish)' }}>Target:</span>
                    <span style={{ fontWeight: 'bold', color: 'var(--bullish)' }}>₹{selectedSignal.target_price.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '0.25rem' }}>
                    <span style={{ color: 'var(--bearish)' }}>Stop Loss:</span>
                    <span style={{ fontWeight: 'bold', color: 'var(--bearish)' }}>₹{selectedSignal.stoploss_price.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '0.25rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Max Spot Seen:</span>
                    <span style={{ fontWeight: 'bold', color: 'var(--accent-secondary)' }}>
                      ₹{selectedSignal.max_spot_seen ? selectedSignal.max_spot_seen.toFixed(2) : selectedSignal.entry_price.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Live P&L Widget */}
                {activePnl && (
                  <div style={{
                    background: activePnl.isProfit ? 'rgba(0, 200, 5, 0.05)' : 'rgba(239, 68, 68, 0.05)',
                    border: `1px solid ${activePnl.isProfit ? 'rgba(0, 200, 5, 0.15)' : 'rgba(239, 68, 68, 0.15)'}`,
                    padding: '0.75rem',
                    borderRadius: '8px',
                    textAlign: 'center',
                    marginBottom: '1.25rem'
                  }}>
                    <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Current Spot Return</span>
                    <span style={{
                      fontSize: '1.25rem',
                      fontWeight: '800',
                      color: activePnl.isProfit ? 'var(--bullish)' : 'var(--bearish)'
                    }}>
                      {activePnl.isProfit ? '+' : ''}{activePnl.pts} pts ({activePnl.pct}%)
                    </span>
                  </div>
                )}

                {/* Trailing Stop Loss Info */}
                <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1.25rem', lineHeight: '1.4' }}>
                  <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: '2px', color: 'var(--accent-secondary)' }} />
                  <span>Trailing Stop-Loss is live. When spot price moves in favor, the SL level automatically trails to protect profits.</span>
                </div>

                {/* One click Paper Trade */}
                <button
                  onClick={() => handleExecutePaper(selectedSignal)}
                  disabled={paperLoading}
                  style={{
                    width: '100%',
                    background: 'linear-gradient(135deg, var(--accent-primary) 0%, #4f46e5 100%)',
                    color: 'white',
                    border: 'none',
                    padding: '0.6rem 1rem',
                    borderRadius: '8px',
                    cursor: paperLoading ? 'not-allowed' : 'pointer',
                    fontWeight: '700',
                    fontSize: '0.9rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)'
                  }}
                >
                  <Briefcase size={16} /> Execute Paper Trade
                </button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1.5rem 0' }}>
                <Clock size={24} style={{ marginBottom: '0.5rem', color: 'var(--text-muted)' }} />
                <div>Select an active signal from the list below to overlay its entry and target levels on the chart.</div>
              </div>
            )}
          </div>

          {/* Active Signals List */}
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Play size={16} fill="white" /> Active Signals ({activeSignals.length})
            </h3>
            
            {activeSignals.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '1rem 0' }}>
                No active signals for {symbol}.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {activeSignals.map((sig) => {
                  const isSelected = selectedSignal?.id === sig.id;
                  const isCall = sig.type === 'CALL';
                  return (
                    <div 
                      key={sig.id}
                      onClick={() => setSelectedSignal(sig)}
                      style={{
                        background: isSelected ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255,255,255,0.01)',
                        border: `1px solid ${isSelected ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                        padding: '0.75rem',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'var(--transition-smooth)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '0.9rem', color: isCall ? 'var(--bullish)' : 'var(--bearish)' }}>
                          {sig.type}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {new Date(sig.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Entry: ₹{sig.entry_price} | Tar: ₹{sig.target_price}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Signal Outcomes */}
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={16} /> Recent Outcomes
            </h3>
            
            {pastSignals.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '1rem 0' }}>
                No past signals found today.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {pastSignals.map((sig) => {
                  const isSuccess = sig.status === 'SUCCESS';
                  return (
                    <div 
                      key={sig.id}
                      style={{
                        background: 'rgba(255,255,255,0.01)',
                        border: '1px solid var(--border-color)',
                        padding: '0.65rem',
                        borderRadius: '8px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>
                          {sig.type} ({sig.source})
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          Entry: ₹{sig.entry_price.toFixed(0)} | Close: ₹{sig.max_spot_seen ? sig.max_spot_seen.toFixed(0) : sig.entry_price.toFixed(0)}
                        </div>
                      </div>

                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        color: isSuccess ? 'var(--bullish)' : 'var(--bearish)'
                      }}>
                        {isSuccess ? <CheckCircle size={14} /> : <XCircle size={14} />}
                        {sig.status}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};

export default ScalpCharts;
