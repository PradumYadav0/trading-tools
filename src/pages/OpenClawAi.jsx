import React, { useState, useEffect } from 'react';
import { 
  Bot, Cpu, Sliders, Play, RefreshCw, Send, CheckCircle, 
  AlertTriangle, ShieldCheck, Terminal, HelpCircle, 
  TrendingUp, Activity, Bell, Info 
} from 'lucide-react';

const OpenClawAi = () => {
  const [symbol, setSymbol] = useState('NIFTY');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Configurations
  const [pcrWeight, setPcrWeight] = useState(40);
  const [chartWeight, setChartWeight] = useState(40);
  const [newsWeight, setNewsWeight] = useState(20);
  const [atrMultiplierTarget, setAtrMultiplierTarget] = useState(3.0);
  const [atrMultiplierSl, setAtrMultiplierSl] = useState(1.5);
  const [rsiPeriod, setRsiPeriod] = useState(14);
  const [interval, setIntervalVal] = useState('5');
  const [tradingProfile, setTradingProfile] = useState('intraday_scalper');
  
  // Terminal Logs State
  const [terminalLogs, setTerminalLogs] = useState([]);
  const [terminalStep, setTerminalStep] = useState('idle'); // 'idle' | 'running' | 'done'
  
  // AI Output Result
  const [analysisResult, setAnalysisResult] = useState(null);
  const [indicatorData, setIndicatorData] = useState(null);

  // Webhook Integrations
  // Webhook Integrations (Synced to SQLite DB)
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [discordWebhook, setDiscordWebhook] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [whatsappApiKey, setWhatsappApiKey] = useState('');
  const [autoAlertsEnabled, setAutoAlertsEnabled] = useState(false);
  const [autoAlertsInterval, setAutoAlertsInterval] = useState(5);
  const [autoAlertsMinConfidence, setAutoAlertsMinConfidence] = useState(75);
  const [notificationStatus, setNotificationStatus] = useState({ type: '', message: '' });
  
  // Live News feed states
  const [newsHeadlines, setNewsHeadlines] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);

  const fetchLiveNews = async () => {
    setNewsLoading(true);
    try {
      const response = await fetch('/api/openclaw/news');
      const result = await response.json();
      if (result.success && result.news) {
        setNewsHeadlines(result.news);
      }
    } catch (e) {
      console.error('Failed to fetch financial news feed:', e);
    } finally {
      setNewsLoading(false);
    }
  };

  const getHeadlineSentiment = (title) => {
    const text = title.toLowerCase();
    const bullishWords = ['rise', 'gain', 'surge', 'up', 'bull', 'rally', 'climb', 'profit', 'jump', 'green', 'high', 'grows', 'growth', 'positive', 'record', 'nifty hits', 'sensex hits'];
    const bearishWords = ['fall', 'drop', 'plunge', 'down', 'bear', 'loss', 'crash', 'slip', 'low', 'negative', 'deficit', 'inflation', 'slide', 'slump', 'hit', 'red', 'worry', 'panic', 'rate hike'];
    
    let score = 0;
    bullishWords.forEach(w => { if (text.includes(w)) score++; });
    bearishWords.forEach(w => { if (text.includes(w)) score--; });
    
    if (score > 0) return 'BULLISH';
    if (score < 0) return 'BEARISH';
    return 'NEUTRAL';
  };

  // Load configuration from backend on mount (with localStorage fallback migration)
  useEffect(() => {
    fetchLiveNews();
    const fetchSettings = async () => {
      try {
        const response = await fetch('/api/openclaw/settings');
        const result = await response.json();
        if (result.success && result.settings) {
          const dbToken = result.settings.telegramToken || '';
          const dbChat = result.settings.telegramChatId || '';
          const dbDiscord = result.settings.discordWebhook || '';
          const dbPhone = result.settings.whatsappPhone || '';
          const dbApiKey = result.settings.whatsappApiKey || '';

          // Sync weight states
          setPcrWeight(result.settings.pcrWeight !== undefined ? result.settings.pcrWeight : 40);
          setChartWeight(result.settings.chartWeight !== undefined ? result.settings.chartWeight : 40);
          setNewsWeight(result.settings.newsWeight !== undefined ? result.settings.newsWeight : 20);
          setTradingProfile(result.settings.tradingProfile !== undefined ? result.settings.tradingProfile : 'intraday_scalper');

          // Check if DB is empty but localStorage has legacy settings
          const localTgToken = localStorage.getItem('openclaw_tg_token') || '';
          const localTgChatId = localStorage.getItem('openclaw_tg_chatid') || '';
          const localDiscord = localStorage.getItem('openclaw_discord_url') || '';
          const localWaPhone = localStorage.getItem('openclaw_wa_phone') || '';
          const localWaApiKey = localStorage.getItem('openclaw_wa_apikey') || '';

          if (!dbToken && !dbChat && !dbPhone && !dbApiKey && (localTgToken || localTgChatId || localWaPhone)) {
            // Migrate local to DB
            setTelegramToken(localTgToken);
            setTelegramChatId(localTgChatId);
            setDiscordWebhook(localDiscord);
            setWhatsappPhone(localWaPhone);
            setWhatsappApiKey(localWaApiKey);
            
            await fetch('/api/openclaw/settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                telegramToken: localTgToken,
                telegramChatId: localTgChatId,
                discordWebhook: localDiscord,
                whatsappPhone: localWaPhone,
                whatsappApiKey: localWaApiKey,
                autoAlertsEnabled: false,
                autoAlertsInterval: 5,
                autoAlertsMinConfidence: 75,
                pcrWeight: 40,
                chartWeight: 40,
                newsWeight: 20
              })
            });
          } else {
            // Use DB values
            setTelegramToken(dbToken);
            setTelegramChatId(dbChat);
            setDiscordWebhook(dbDiscord);
            setWhatsappPhone(dbPhone);
            setWhatsappApiKey(dbApiKey);
            setAutoAlertsEnabled(result.settings.autoAlertsEnabled || false);
            setAutoAlertsInterval(result.settings.autoAlertsInterval || 5);
            setAutoAlertsMinConfidence(result.settings.autoAlertsMinConfidence || 75);
          }
        }
      } catch (err) {
        console.error('Error fetching settings:', err);
      }
    };
    fetchSettings();
  }, []);

  const saveSettings = async (updated) => {
    const payload = {
      telegramToken: updated.telegramToken !== undefined ? updated.telegramToken : telegramToken,
      telegramChatId: updated.telegramChatId !== undefined ? updated.telegramChatId : telegramChatId,
      discordWebhook: updated.discordWebhook !== undefined ? updated.discordWebhook : discordWebhook,
      whatsappPhone: updated.whatsappPhone !== undefined ? updated.whatsappPhone : whatsappPhone,
      whatsappApiKey: updated.whatsappApiKey !== undefined ? updated.whatsappApiKey : whatsappApiKey,
      autoAlertsEnabled: updated.autoAlertsEnabled !== undefined ? updated.autoAlertsEnabled : autoAlertsEnabled,
      autoAlertsInterval: updated.autoAlertsInterval !== undefined ? updated.autoAlertsInterval : autoAlertsInterval,
      autoAlertsMinConfidence: updated.autoAlertsMinConfidence !== undefined ? updated.autoAlertsMinConfidence : autoAlertsMinConfidence,
      pcrWeight: updated.pcrWeight !== undefined ? updated.pcrWeight : pcrWeight,
      chartWeight: updated.chartWeight !== undefined ? updated.chartWeight : chartWeight,
      newsWeight: updated.newsWeight !== undefined ? updated.newsWeight : newsWeight,
      tradingProfile: updated.tradingProfile !== undefined ? updated.tradingProfile : tradingProfile
    };

    // Also update localStorage as a backup
    if (payload.telegramToken) localStorage.setItem('openclaw_tg_token', payload.telegramToken);
    if (payload.telegramChatId) localStorage.setItem('openclaw_tg_chatid', payload.telegramChatId);
    if (payload.discordWebhook) localStorage.setItem('openclaw_discord_url', payload.discordWebhook);
    if (payload.whatsappPhone) localStorage.setItem('openclaw_wa_phone', payload.whatsappPhone);
    if (payload.whatsappApiKey) localStorage.setItem('openclaw_wa_apikey', payload.whatsappApiKey);

    try {
      await fetch('/api/openclaw/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.error('Failed to save settings to backend:', e);
    }
  };

  const handleTelegramTokenChange = (val) => {
    setTelegramToken(val);
    saveSettings({ telegramToken: val });
  };
  
  const handleTelegramChatIdChange = (val) => {
    setTelegramChatId(val);
    saveSettings({ telegramChatId: val });
  };

  const handleDiscordWebhookChange = (val) => {
    setDiscordWebhook(val);
    saveSettings({ discordWebhook: val });
  };

  const handleWhatsappPhoneChange = (val) => {
    setWhatsappPhone(val);
    saveSettings({ whatsappPhone: val });
  };

  const handleWhatsappApiKeyChange = (val) => {
    setWhatsappApiKey(val);
    saveSettings({ whatsappApiKey: val });
  };

  const handleAutoAlertsEnabledChange = (val) => {
    setAutoAlertsEnabled(val);
    saveSettings({ autoAlertsEnabled: val });
  };

  const handleAutoAlertsIntervalChange = (val) => {
    setAutoAlertsInterval(val);
    saveSettings({ autoAlertsInterval: val });
  };

  const handleAutoAlertsMinConfidenceChange = (val) => {
    setAutoAlertsMinConfidence(val);
    saveSettings({ autoAlertsMinConfidence: val });
  };

  const handleWeightChange = (type, newVal) => {
    const value = Math.max(0, Math.min(100, parseInt(newVal, 10) || 0));
    
    if (type === 'pcr') {
      const remaining = 100 - value;
      const oldSum = chartWeight + newsWeight;
      let newChart, newNews;
      if (oldSum > 0) {
        newChart = Math.round((chartWeight / oldSum) * remaining);
        newNews = remaining - newChart;
      } else {
        newChart = Math.round(remaining / 2);
        newNews = remaining - newChart;
      }
      setPcrWeight(value);
      setChartWeight(newChart);
      setNewsWeight(newNews);
      saveSettings({ pcrWeight: value, chartWeight: newChart, newsWeight: newNews });
    } else if (type === 'chart') {
      const remaining = 100 - value;
      const oldSum = pcrWeight + newsWeight;
      let newPcr, newNews;
      if (oldSum > 0) {
        newPcr = Math.round((pcrWeight / oldSum) * remaining);
        newNews = remaining - newPcr;
      } else {
        newPcr = Math.round(remaining / 2);
        newNews = remaining - newPcr;
      }
      setChartWeight(value);
      setPcrWeight(newPcr);
      setNewsWeight(newNews);
      saveSettings({ pcrWeight: newPcr, chartWeight: value, newsWeight: newNews });
    } else if (type === 'news') {
      const remaining = 100 - value;
      const oldSum = pcrWeight + chartWeight;
      let newPcr, newChart;
      if (oldSum > 0) {
        newPcr = Math.round((pcrWeight / oldSum) * remaining);
        newChart = remaining - newPcr;
      } else {
        newPcr = Math.round(remaining / 2);
        newChart = remaining - newPcr;
      }
      setNewsWeight(value);
      setPcrWeight(newPcr);
      setChartWeight(newChart);
      saveSettings({ pcrWeight: newPcr, chartWeight: newChart, newsWeight: value });
    }
  };

  const handleProfileChange = (val) => {
    setTradingProfile(val);
    saveSettings({ tradingProfile: val });
  };

  const sendTestNotification = async () => {
    setNotificationStatus({ type: 'loading', message: 'Sending test alert...' });
    const testMessage = `🔔 *OpenClaw AI: Connection Test* 🔔\n\n` +
      `Congratulations! Your alert channel has been successfully connected to the OpenClaw AI Multi-Agent Hub.\n\n` +
      `📅 Tested on: ${new Date().toLocaleString()}`;

    let successCount = 0;
    let attempted = 0;

    // Telegram
    if (telegramToken && telegramChatId) {
      attempted++;
      try {
        const tgUrl = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
        const res = await fetch(tgUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramChatId,
            text: testMessage,
            parse_mode: 'Markdown'
          })
        });
        if (res.ok) successCount++;
      } catch (e) {
        console.error(e);
      }
    }

    // Discord Webhook
    if (discordWebhook) {
      attempted++;
      try {
        const res = await fetch(discordWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: testMessage.replace(/\*/g, '**')
          })
        });
        if (res.ok) successCount++;
      } catch (e) {
        console.error(e);
      }
    }

    // WhatsApp (CallMeBot)
    if (whatsappPhone && whatsappApiKey) {
      attempted++;
      try {
        const cleanPhone = whatsappPhone.replace(/[^0-9]/g, '');
        const waText = encodeURIComponent(testMessage.replace(/\*/g, ''));
        const waUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${waText}&apikey=${whatsappApiKey}`;
        await fetch(waUrl, { mode: 'no-cors' });
        successCount++;
      } catch (e) {
        console.error(e);
      }
    }

    if (attempted === 0) {
      setNotificationStatus({ 
        type: 'warning', 
        message: 'Please fill in Telegram or WhatsApp credentials first.' 
      });
    } else if (successCount === attempted) {
      setNotificationStatus({ 
        type: 'success', 
        message: `Test alert successfully sent to all ${successCount} channels!` 
      });
    } else {
      setNotificationStatus({ 
        type: 'error', 
        message: `Sent to ${successCount}/${attempted} channels. Verify your keys.` 
      });
    }

    setTimeout(() => setNotificationStatus({ type: '', message: '' }), 5000);
  };

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    setAnalysisResult(null);
    setIndicatorData(null);
    setTerminalLogs([]);
    setTerminalStep('running');

    // Simulated terminal logs function
    const addLog = (text, type = 'info', delay = 0) => {
      return new Promise((resolve) => {
        setTimeout(() => {
          const timestamp = new Date().toLocaleTimeString();
          setTerminalLogs(prev => [...prev, { timestamp, text, type }]);
          resolve();
        }, delay);
      });
    };

    try {
      await addLog('🤖 OpenClaw AI Multi-Agent Core Initialized.', 'success', 200);
      await addLog(`📡 Fetching live Option Chain for ${symbol}...`, 'info', 400);
      
      // Make backend API request
      const response = await fetch('/api/openclaw/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          symbol,
          weights: { pcrWeight, chartWeight, newsWeight },
          profile: tradingProfile
        })
      });
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || 'Failed to complete analysis');
      }

      const { data, indicators } = result;

      await addLog(`📊 Option Chain loaded. Spot Price: ${indicators.spotPrice.toFixed(2)}, PCR: ${indicators.pcr}`, 'success', 400);
      await addLog('🧠 Option Chain Agent: Evaluating PCR velocity & OI wall distribution...', 'info', 600);
      await addLog(`📈 Chart Agent: Reading intraday ${interval}m candles...`, 'info', 500);
      await addLog(`📈 Chart Agent indicators: EMA 9: ${indicators.ema9}, EMA 21: ${indicators.ema21}, RSI: ${indicators.rsi}`, 'success', 500);
      await addLog('🛡️ Risk Orchestrator: Setting dynamic trade targets using ATR...', 'info', 600);
      await addLog(`⚙️ Submitting agent payload to Gemini LLM Engine...`, 'info', 400);

      // Final display
      await addLog('🎉 Analysis completed successfully. Rending trade card...', 'success', 300);
      
      setAnalysisResult(data);
      setIndicatorData(indicators);
      setTerminalStep('done');

      // Auto dispatch notifications upon successful run
      dispatchNotifications(data, indicators);

    } catch (err) {
      setError(err.message || 'Error occurred during agent analysis');
      await addLog(`❌ Analysis failed: ${err.message}`, 'error', 100);
      setTerminalStep('idle');
    } finally {
      setLoading(false);
    }
  };

  const dispatchNotifications = async (resultData = null, indData = null) => {
    const dataToUse = resultData || analysisResult;
    const indicatorsToUse = indData || indicatorData;
    if (!dataToUse) return;
    setNotificationStatus({ type: 'loading', message: 'Sending alerts...' });

    const spotVal = indicatorsToUse ? indicatorsToUse.spotPrice : 'N/A';
    const currentTime = new Date().toLocaleString('en-US', { 
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'medium'
    });

    const messageContent = `🚨 *OpenClaw AI Trade Alert* 🚨\n\n` +
      `*Symbol*: ${symbol}\n` +
      `*Action*: ${dataToUse.action}\n` +
      `*Spot Price*: ${spotVal}\n` +
      `*Confidence*: ${dataToUse.confidence}%\n` +
      `*Buy Range*: ${dataToUse.buyRange}\n` +
      `*Target 1*: ${dataToUse.target1}\n` +
      `*Target 2*: ${dataToUse.target2}\n` +
      `*Stoploss*: ${dataToUse.stoploss}\n` +
      `*Time (IST)*: ${currentTime}\n\n` +
      `*AI Summary*: ${dataToUse.summary}\n\n` +
      `🤖 Powered by OpenClaw AI Multi-Agent Engine.`;

    let successCount = 0;
    let attempted = 0;

    // Dispatch to Telegram if configured
    if (telegramToken && telegramChatId) {
      attempted++;
      try {
        const tgUrl = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
        const res = await fetch(tgUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramChatId,
            text: messageContent,
            parse_mode: 'Markdown'
          })
        });
        if (res.ok) successCount++;
      } catch (e) {
        console.error('Telegram dispatch error:', e);
      }
    }

    // Dispatch to Discord Webhook if configured
    if (discordWebhook) {
      attempted++;
      try {
        const res = await fetch(discordWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: messageContent.replace(/\*/g, '**') // Convert markdown to Discord style
          })
        });
        if (res.ok) successCount++;
      } catch (e) {
        console.error('Discord dispatch error:', e);
      }
    }

    // Dispatch to WhatsApp (CallMeBot) if configured
    if (whatsappPhone && whatsappApiKey) {
      attempted++;
      try {
        const cleanPhone = whatsappPhone.replace(/[^0-9]/g, '');
        const waText = encodeURIComponent(messageContent.replace(/\*/g, ''));
        const waUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${waText}&apikey=${whatsappApiKey}`;
        await fetch(waUrl, { mode: 'no-cors' });
        successCount++;
      } catch (e) {
        console.error('WhatsApp dispatch error:', e);
      }
    }

    if (attempted === 0) {
      if (!resultData) {
        setNotificationStatus({ 
          type: 'warning', 
          message: 'Please configure Telegram, Discord, or WhatsApp settings first.' 
        });
      }
    } else if (successCount === attempted) {
      setNotificationStatus({ 
        type: 'success', 
        message: `Successfully dispatched alerts to ${successCount} channels!` 
      });
    } else {
      setNotificationStatus({ 
        type: 'error', 
        message: `Dispatched to ${successCount}/${attempted} channels. Check credentials.` 
      });
    }

    setTimeout(() => setNotificationStatus({ type: '', message: '' }), 5000);
  };

  const saveSignalToTesting = async () => {
    if (!analysisResult || !indicatorData) return;
    
    try {
      const response = await fetch('/api/signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          type: analysisResult.action === 'CALL' ? 'CALL' : 'PUT',
          entry_price: indicatorData.spotPrice,
          target_price: analysisResult.target1,
          stoploss_price: analysisResult.stoploss,
          source: 'OPENCLAW'
        })
      });
      const res = await response.json();
      if (res.success) {
        alert('Trade signal successfully locked and sent to AI Testing page for backtesting tracker!');
      } else {
        alert('Failed to save signal: ' + res.message);
      }
    } catch (e) {
      console.error(e);
      alert('Network error while saving trade signal');
    }
  };

  return (
    <div className="container">
      {/* Header */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <div className="glow-logo" style={{ background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)', padding: '0.4rem', borderRadius: '8px', boxShadow: '0 0 15px rgba(168, 85, 247, 0.4)' }}>
              <Bot size={20} color="white" />
            </div>
            <h1 style={{ fontSize: '1.75rem', margin: 0 }}>OpenClaw AI Hub</h1>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Autonomous Multi-Agent option chain & technical trend analysis engine.</p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <select 
            value={symbol} 
            onChange={(e) => setSymbol(e.target.value)}
            style={{ 
              background: '#1c2128', 
              color: 'white', 
              border: '1px solid var(--border-color)', 
              padding: '0.5rem 1rem', 
              borderRadius: '8px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            <option value="NIFTY">NIFTY</option>
            <option value="BANKNIFTY">BANKNIFTY</option>
            <option value="FINNIFTY">FINNIFTY</option>
            <option value="MIDCPNIFTY">MIDCPNIFTY</option>
          </select>

          <button
            onClick={runAnalysis}
            disabled={loading}
            style={{
              background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
              color: 'white',
              border: 'none',
              padding: '0.55rem 1.5rem',
              borderRadius: '8px',
              fontWeight: '700',
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 15px rgba(168, 85, 247, 0.3)',
              opacity: loading ? 0.8 : 1,
              transition: 'all 0.3s ease'
            }}
          >
            {loading ? <RefreshCw size={16} className="spin" /> : <Play size={16} fill="white" />}
            {loading ? 'Running Agents...' : 'Run Agent Analysis'}
          </button>
        </div>
      </div>

      {/* Grid Workspace */}
      <div className="workspace-grid">
        
        {/* Left Section - Configuration Panels */}
        <div className="config-column">
          
          {/* Agent Parameters */}
          <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
              <Sliders size={18} style={{ color: 'var(--accent-primary)' }} />
              <h3 style={{ fontSize: '1rem', margin: 0 }}>Agent Decision Weights</h3>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.85rem' }}>
                  <span>Option Chain Agent weight:</span>
                  <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>{pcrWeight}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={pcrWeight} 
                  onChange={(e) => handleWeightChange('pcr', e.target.value)}
                  style={{ width: '100%', cursor: 'pointer', accentColor: '#a855f7' }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.85rem' }}>
                  <span>Chart Pattern Agent weight:</span>
                  <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>{chartWeight}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={chartWeight} 
                  onChange={(e) => handleWeightChange('chart', e.target.value)}
                  style={{ width: '100%', cursor: 'pointer', accentColor: '#6366f1' }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.85rem' }}>
                  <span>News Sentiment Agent weight:</span>
                  <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>{newsWeight}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={newsWeight} 
                  onChange={(e) => handleWeightChange('news', e.target.value)}
                  style={{ width: '100%', cursor: 'pointer', accentColor: '#10b981' }}
                />
              </div>
            </div>
          </div>

          {/* Indicator Threshold Settings */}
          <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
              <Activity size={18} style={{ color: '#10b981' }} />
              <h3 style={{ fontSize: '1rem', margin: 0 }}>Indicators & Risk Setup</h3>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Active Trading Profile</label>
              <select 
                value={tradingProfile}
                onChange={(e) => handleProfileChange(e.target.value)}
                style={{
                  width: '100%',
                  background: '#1c2128',
                  border: '1px solid var(--border-color)',
                  color: '#fff',
                  padding: '0.45rem 0.5rem',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  fontWeight: '600',
                  borderColor: 'rgba(255, 255, 255, 0.1)',
                  outline: 'none'
                }}
              >
                <option value="micro_scalper">🚀 Micro-Scalper (Hold: 5-15 mins, 1m/3m charts)</option>
                <option value="intraday_scalper">📈 Intraday Scalper (Hold: 15-45 mins, 3m/5m charts)</option>
                <option value="short_term_trend">🎯 Short-Term Trend (Hold: 1-3 hours, 5m/15m charts)</option>
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>RSI Period</label>
                <input 
                  type="number" 
                  value={rsiPeriod} 
                  onChange={(e) => setRsiPeriod(Number(e.target.value))}
                  style={{
                    width: '100%',
                    background: '#1c2128',
                    border: '1px solid var(--border-color)',
                    color: '#fff',
                    padding: '0.4rem 0.5rem',
                    borderRadius: '6px',
                    fontSize: '0.85rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Chart Interval</label>
                <select 
                  value={interval}
                  onChange={(e) => setIntervalVal(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#1c2128',
                    border: '1px solid var(--border-color)',
                    color: '#fff',
                    padding: '0.4rem 0.5rem',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    cursor: 'pointer'
                  }}
                >
                  <option value="5">5 Minutes</option>
                  <option value="15">15 Minutes</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Target ATR Mult.</label>
                <input 
                  type="number" 
                  step="0.5"
                  value={atrMultiplierTarget} 
                  onChange={(e) => setAtrMultiplierTarget(Number(e.target.value))}
                  style={{
                    width: '100%',
                    background: '#1c2128',
                    border: '1px solid var(--border-color)',
                    color: '#fff',
                    padding: '0.4rem 0.5rem',
                    borderRadius: '6px',
                    fontSize: '0.85rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Stoploss ATR Mult.</label>
                <input 
                  type="number" 
                  step="0.5"
                  value={atrMultiplierSl} 
                  onChange={(e) => setAtrMultiplierSl(Number(e.target.value))}
                  style={{
                    width: '100%',
                    background: '#1c2128',
                    border: '1px solid var(--border-color)',
                    color: '#fff',
                    padding: '0.4rem 0.5rem',
                    borderRadius: '6px',
                    fontSize: '0.85rem'
                  }}
                />
              </div>
            </div>
          </div>

          {/* Webhook Configuration */}
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
              <Bell size={18} style={{ color: '#eab308' }} />
              <h3 style={{ fontSize: '1rem', margin: 0 }}>Alert Integrations</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              
              {/* Background Auto Alerts Config */}
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '0.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: autoAlertsEnabled ? '#10b981' : 'var(--text-secondary)' }}>
                    {autoAlertsEnabled ? '● Auto-Alerts: ACTIVE' : '○ Auto-Alerts: OFF'}
                  </span>
                  <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '38px', height: '20px' }}>
                    <input 
                      type="checkbox" 
                      checked={autoAlertsEnabled}
                      onChange={(e) => handleAutoAlertsEnabledChange(e.target.checked)}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: autoAlertsEnabled ? '#10b981' : '#30363d',
                      transition: '.4s', borderRadius: '20px'
                    }}>
                      <span style={{
                        position: 'absolute', content: '""', height: '14px', width: '14px', left: '3px', bottom: '3px',
                        backgroundColor: 'white', transition: '.4s', borderRadius: '50%',
                        transform: autoAlertsEnabled ? 'translateX(18px)' : 'translateX(0px)'
                      }}></span>
                    </span>
                  </label>
                </div>

                {autoAlertsEnabled && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.75rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Scan Interval</label>
                      <select
                        value={autoAlertsInterval}
                        onChange={(e) => handleAutoAlertsIntervalChange(parseInt(e.target.value, 10))}
                        style={{
                          width: '100%', background: '#1c2128', border: '1px solid var(--border-color)', color: '#fff',
                          padding: '0.35rem 0.5rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer'
                        }}
                      >
                        <option value="5">5 Minutes</option>
                        <option value="15">15 Minutes</option>
                        <option value="30">30 Minutes</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Min Confidence</label>
                      <input
                        type="number"
                        min="50"
                        max="95"
                        value={autoAlertsMinConfidence}
                        onChange={(e) => handleAutoAlertsMinConfidenceChange(parseInt(e.target.value, 10))}
                        style={{
                          width: '100%', background: '#1c2128', border: '1px solid var(--border-color)', color: '#fff',
                          padding: '0.35rem 0.5rem', borderRadius: '6px', fontSize: '0.8rem'
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Telegram Bot Token</label>
                <input 
                  type="password" 
                  placeholder="Bot API Token"
                  value={telegramToken}
                  onChange={(e) => handleTelegramTokenChange(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#1c2128',
                    border: '1px solid var(--border-color)',
                    color: '#fff',
                    padding: '0.4rem 0.6rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Telegram Chat ID</label>
                <input 
                  type="text" 
                  placeholder="Chat ID (e.g. -100xxx)"
                  value={telegramChatId}
                  onChange={(e) => handleTelegramChatIdChange(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#1c2128',
                    border: '1px solid var(--border-color)',
                    color: '#fff',
                    padding: '0.4rem 0.6rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Discord Webhook URL</label>
                <input 
                  type="password" 
                  placeholder="https://discord.com/api/webhooks/..."
                  value={discordWebhook}
                  onChange={(e) => handleDiscordWebhookChange(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#1c2128',
                    border: '1px solid var(--border-color)',
                    color: '#fff',
                    padding: '0.4rem 0.6rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    marginBottom: '0.75rem'
                  }}
                />
              </div>

              <div style={{ borderTop: '1px dashed rgba(255,255,255,0.08)', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#10b981', fontWeight: '700', marginBottom: '0.25rem' }}>WhatsApp Phone Number</label>
                <input 
                  type="text" 
                  placeholder="e.g. 919876543210 (Int. format)"
                  value={whatsappPhone}
                  onChange={(e) => handleWhatsappPhoneChange(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#1c2128',
                    border: '1px solid var(--border-color)',
                    color: '#fff',
                    padding: '0.4rem 0.6rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    marginBottom: '0.5rem'
                  }}
                />

                <label style={{ display: 'block', fontSize: '0.75rem', color: '#10b981', fontWeight: '700', marginBottom: '0.25rem' }}>CallMeBot API Key</label>
                <input 
                  type="password" 
                  placeholder="Enter API Key"
                  value={whatsappApiKey}
                  onChange={(e) => handleWhatsappApiKeyChange(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#1c2128',
                    border: '1px solid var(--border-color)',
                    color: '#fff',
                    padding: '0.4rem 0.6rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    marginBottom: '0.25rem'
                  }}
                />
                <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-secondary)', lineHeight: '1.3' }}>
                  Send <strong>I allow callmebot to send me messages</strong> to <strong>+34 644 20 28 32</strong> on WhatsApp to get key.
                </span>
              </div>

              {/* Test Alert Channels button */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
                <button
                  onClick={sendTestNotification}
                  disabled={notificationStatus.type === 'loading'}
                  style={{
                    width: '100%',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--border-color)',
                    color: '#fff',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem'
                  }}
                >
                  <Send size={12} />
                  {notificationStatus.type === 'loading' && notificationStatus.message.includes('test') ? 'Testing...' : 'Test Alert Channels'}
                </button>
              </div>
            </div>
          </div>

          {/* Live News Sentiment Feed Card */}
          <div className="glass-panel" style={{ padding: '1.25rem', marginTop: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <TrendingUp size={18} style={{ color: '#10b981' }} />
                <h3 style={{ fontSize: '1rem', margin: 0 }}>Live News Sentiment Feed</h3>
              </div>
              <button 
                onClick={fetchLiveNews} 
                disabled={newsLoading}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s'
                }}
                title="Refresh News Feed"
              >
                <RefreshCw size={14} className={newsLoading ? 'spin' : ''} style={{ color: 'var(--text-secondary)' }} />
              </button>
            </div>

            <div style={{ 
              maxHeight: '280px', 
              overflowY: 'auto', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '0.75rem',
              paddingRight: '0.25rem' 
            }} className="news-scroll-container">
              {newsLoading && newsHeadlines.length === 0 ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  <RefreshCw size={18} className="spin" style={{ marginRight: '0.5rem' }} /> Loading latest financial headlines...
                </div>
              ) : newsHeadlines.length === 0 ? (
                <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  No recent financial headlines found.
                </div>
              ) : (
                newsHeadlines.map((item, idx) => {
                  const sentiment = getHeadlineSentiment(item.title);
                  let sentimentBg = 'rgba(128,128,128,0.1)';
                  let sentimentColor = '#8b949e';
                  let borderClr = 'rgba(255,255,255,0.03)';
                  
                  if (sentiment === 'BULLISH') {
                    sentimentBg = 'rgba(16,185,129,0.1)';
                    sentimentColor = '#10b981';
                  } else if (sentiment === 'BEARISH') {
                    sentimentBg = 'rgba(239,68,68,0.1)';
                    sentimentColor = '#ef4444';
                  }

                  return (
                    <div 
                      key={idx} 
                      style={{ 
                        background: 'rgba(255, 255, 255, 0.01)',
                        padding: '0.75rem', 
                        borderRadius: '6px', 
                        border: `1px solid ${borderClr}`,
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '0.4rem',
                        transition: 'background 0.2s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.01)'}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                        <a 
                          href={item.link} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          style={{ 
                            fontSize: '0.82rem', 
                            color: '#e6edf3', 
                            textDecoration: 'none',
                            fontWeight: '500',
                            lineHeight: '1.4',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden'
                          }}
                        >
                          {item.title}
                        </a>
                        <span style={{ 
                          fontSize: '0.65rem', 
                          fontWeight: '700', 
                          padding: '0.15rem 0.4rem', 
                          borderRadius: '4px',
                          background: sentimentBg,
                          color: sentimentColor,
                          whiteSpace: 'nowrap'
                        }}>
                          {sentiment}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                        <span>Google News RSS</span>
                        <span>{new Date(item.pubDate).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>

        {/* Right Section - Terminal Output & Recommendation */}
        <div className="terminal-column">
          
          {/* Animated Console Terminal */}
          <div className="terminal-box">
            <div className="terminal-header">
              <div style={{ display: 'flex', gap: '6px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }}></div>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#eab308' }}></div>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e' }}></div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#8b949e', fontSize: '0.75rem' }}>
                <Terminal size={12} />
                <span>OpenClaw Multi-Agent Engine Logs</span>
              </div>
            </div>

            <div className="terminal-body">
              {terminalLogs.length === 0 && (
                <div className="terminal-idle">
                  <Cpu size={24} style={{ marginBottom: '0.5rem', opacity: 0.5 }} />
                  <div>OpenClaw AI terminal status: <strong>IDLE</strong></div>
                  <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', opacity: 0.7 }}>Awaiting parameters config. Click "Run Agent Analysis" above.</div>
                </div>
              )}
              
              {terminalLogs.map((log, index) => (
                <div key={index} className="terminal-line" style={{ animation: 'terminalSlideIn 0.3s ease' }}>
                  <span className="terminal-time">[{log.timestamp}]</span>
                  <span className={`terminal-text ${log.type}`}> {log.text}</span>
                </div>
              ))}
              
              {loading && (
                <div className="terminal-line blink" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#58a6ff' }}>
                  <span>●</span> <span>Agent cluster executing...</span>
                </div>
              )}
            </div>
          </div>

          {/* Trade Recommendation Card */}
          {terminalStep === 'done' && analysisResult && (
            <div className="trade-card" style={{ 
              border: `2px solid ${
                analysisResult.action === 'CALL' ? 'rgba(0, 200, 5, 0.4)' : 
                analysisResult.action === 'PUT' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(234, 179, 8, 0.4)'
              }`,
              boxShadow: `0 4px 30px ${
                analysisResult.action === 'CALL' ? 'rgba(0, 200, 5, 0.1)' : 
                analysisResult.action === 'PUT' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(234, 179, 8, 0.1)'
              }`
            }}>
              
              {/* Badges / Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>RECOMMENDED ACTION</span>
                  <span className={`action-badge ${analysisResult.action}`}>
                    {analysisResult.action === 'CALL' ? 'BUY CALL / BULLISH' : 
                     analysisResult.action === 'PUT' ? 'BUY PUT / BEARISH' : 'WAIT / NEUTRAL'}
                  </span>
                </div>
                
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>AGENT CONFIDENCE</span>
                  <span style={{ 
                    fontSize: '1.5rem', 
                    fontWeight: '800', 
                    color: analysisResult.confidence > 75 ? 'var(--bullish)' : analysisResult.confidence > 50 ? '#eab308' : 'var(--text-secondary)'
                  }}>
                    {analysisResult.confidence}%
                  </span>
                </div>
              </div>

              {/* Confidence Progress Bar */}
              <div style={{ height: '6px', width: '100%', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', marginBottom: '1.5rem', overflow: 'hidden' }}>
                <div style={{ 
                  height: '100%', 
                  width: `${analysisResult.confidence}%`, 
                  background: analysisResult.action === 'CALL' ? 'var(--bullish)' : 
                              analysisResult.action === 'PUT' ? 'var(--bearish)' : '#eab308',
                  borderRadius: '3px',
                  boxShadow: '0 0 10px rgba(168,85,247,0.5)',
                  transition: 'width 1s ease-in-out'
                }}></div>
              </div>

              {/* Trade Coordinates Grid */}
              <div className="coordinates-grid">
                <div className="coordinate-item">
                  <span className="coord-label">Suggested Buy Range</span>
                  <span className="coord-value">{analysisResult.buyRange}</span>
                </div>
                <div className="coordinate-item">
                  <span className="coord-label">Target 1</span>
                  <span className="coord-value" style={{ color: 'var(--bullish)' }}>{analysisResult.target1}</span>
                </div>
                <div className="coordinate-item">
                  <span className="coord-label">Target 2</span>
                  <span className="coord-value" style={{ color: 'var(--bullish)' }}>{analysisResult.target2}</span>
                </div>
                <div className="coordinate-item">
                  <span className="coord-label">Stoploss</span>
                  <span className="coord-value" style={{ color: 'var(--bearish)' }}>{analysisResult.stoploss}</span>
                </div>
              </div>

              {/* Sub-Agent Thoughts Accordion */}
              <div style={{ marginBottom: '1.25rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem' }}>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <Cpu size={14} style={{ color: 'var(--accent-primary)' }} /> Agent Analysis Thoughts
                </h4>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.8rem' }}>
                  <div style={{ background: 'rgba(255,255,255,0.01)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: '3px solid #a855f7' }}>
                    <span style={{ fontWeight: 'bold', color: '#a855f7', display: 'block', marginBottom: '0.15rem' }}>Option Chain Agent:</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{analysisResult.agentThoughts.optionChainAgent}</span>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.01)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: '3px solid #6366f1' }}>
                    <span style={{ fontWeight: 'bold', color: '#6366f1', display: 'block', marginBottom: '0.15rem' }}>Chart Pattern Agent:</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{analysisResult.agentThoughts.chartAgent}</span>
                  </div>
                  {analysisResult.agentThoughts.newsAgent && (
                    <div style={{ background: 'rgba(255,255,255,0.01)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: '3px solid #eab308' }}>
                      <span style={{ fontWeight: 'bold', color: '#eab308', display: 'block', marginBottom: '0.15rem' }}>News Sentiment Agent:</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{analysisResult.agentThoughts.newsAgent}</span>
                    </div>
                  )}
                  <div style={{ background: 'rgba(255,255,255,0.01)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: '3px solid #10b981' }}>
                    <span style={{ fontWeight: 'bold', color: '#10b981', display: 'block', marginBottom: '0.15rem' }}>Risk Orchestrator:</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{analysisResult.agentThoughts.riskOrchestrator}</span>
                  </div>
                </div>
              </div>

              {/* Rationale Bullet Points */}
              <div style={{ marginBottom: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#fff' }}>Key Takeaways (Hinglish):</h4>
                <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.5' }}>
                  {analysisResult.reasoning.map((item, index) => (
                    <li key={index} style={{ marginBottom: '0.25rem' }}>{item}</li>
                  ))}
                </ul>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem', flexWrap: 'wrap' }}>
                <button
                  onClick={saveSignalToTesting}
                  style={{
                    flex: 1,
                    minWidth: '150px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid var(--border-color)',
                    color: '#fff',
                    padding: '0.6rem 1rem',
                    borderRadius: '8px',
                    fontWeight: '600',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    transition: 'var(--transition-smooth)'
                  }}
                >
                  <ShieldCheck size={16} color="#10b981" />
                  Save to AI Testing
                </button>

                <button
                  onClick={dispatchNotifications}
                  disabled={notificationStatus.type === 'loading'}
                  style={{
                    flex: 1,
                    minWidth: '150px',
                    background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
                    border: 'none',
                    color: '#fff',
                    padding: '0.6rem 1rem',
                    borderRadius: '8px',
                    fontWeight: '700',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    transition: 'var(--transition-smooth)'
                  }}
                >
                  <Send size={16} />
                  {notificationStatus.type === 'loading' ? 'Sending...' : 'Send Live Alerts'}
                </button>
              </div>

              {notificationStatus.message && (
                <div style={{ 
                  marginTop: '1rem', 
                  padding: '0.5rem 1rem', 
                  borderRadius: '6px', 
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  background: notificationStatus.type === 'success' ? 'rgba(16,185,129,0.1)' : 
                              notificationStatus.type === 'warning' ? 'rgba(234,179,8,0.1)' : 'rgba(239,68,68,0.1)',
                  color: notificationStatus.type === 'success' ? '#10b981' : 
                         notificationStatus.type === 'warning' ? '#eab308' : '#ef4444',
                  border: `1px solid ${
                    notificationStatus.type === 'success' ? 'rgba(16,185,129,0.2)' : 
                    notificationStatus.type === 'warning' ? 'rgba(234,179,8,0.2)' : 'rgba(239,68,68,0.2)'
                  }`
                }}>
                  <Info size={14} />
                  <span>{notificationStatus.message}</span>
                </div>
              )}

            </div>
          )}

          {error && (
            <div style={{ 
              background: 'rgba(239, 68, 68, 0.1)', 
              border: '1px solid rgba(239, 68, 68, 0.2)', 
              color: '#FCA5A5', 
              padding: '1rem', 
              borderRadius: '8px', 
              marginTop: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
          )}

        </div>

      </div>

      <style>{`
        .workspace-grid {
          display: grid;
          grid-template-columns: 4fr 6fr;
          gap: 1.5rem;
          margin-bottom: 2rem;
        }
        
        .config-column {
          display: flex;
          flex-direction: column;
        }

        .terminal-column {
          display: flex;
          flex-direction: column;
        }

        .terminal-box {
          background: #0b0e14;
          border: 1px solid var(--border-color);
          border-radius: 12px;
          overflow: hidden;
          font-family: 'Courier New', Courier, monospace;
          min-height: 230px;
          max-height: 350px;
          display: flex;
          flex-direction: column;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        }

        .terminal-header {
          background: #161b22;
          padding: 0.5rem 1rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--border-color);
        }

        .terminal-body {
          padding: 1rem;
          overflow-y: auto;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }

        .terminal-idle {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          height: 100%;
          color: #8b949e;
          text-align: center;
          padding: 2rem 0;
        }

        .terminal-line {
          font-size: 0.8rem;
          line-height: 1.4;
          word-break: break-all;
        }

        .terminal-time {
          color: #8b949e;
        }

        .terminal-text.info {
          color: #c9d1d9;
        }

        .terminal-text.success {
          color: #58a6ff;
        }

        .terminal-text.error {
          color: #ff7b72;
        }

        .trade-card {
          margin-top: 1.5rem;
          background: rgba(255, 255, 255, 0.01);
          backdrop-filter: blur(10px);
          border-radius: 12px;
          padding: 1.5rem;
          animation: slideUp 0.5s ease-in-out;
        }

        .action-badge {
          display: inline-block;
          padding: 0.35rem 1rem;
          border-radius: 6px;
          font-weight: 800;
          font-size: 1.1rem;
          letter-spacing: 0.5px;
          text-align: center;
        }

        .action-badge.CALL {
          background: rgba(0, 200, 5, 0.15);
          color: #00c805;
          border: 1px solid rgba(0, 200, 5, 0.3);
        }

        .action-badge.PUT {
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .action-badge.WAIT {
          background: rgba(234, 179, 8, 0.15);
          color: #eab308;
          border: 1px solid rgba(234, 179, 8, 0.3);
        }

        .coordinates-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1rem;
          margin-bottom: 1.5rem;
        }

        .coordinate-item {
          background: rgba(255,255,255,0.02);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 0.75rem 0.5rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .coord-label {
          font-size: 0.7rem;
          color: var(--text-secondary);
          margin-bottom: 0.25rem;
        }

        .coord-value {
          font-size: 1.1rem;
          font-weight: 800;
          color: #fff;
        }

        .blink {
          animation: blinkText 1.5s infinite;
        }

        @keyframes blinkText {
          0% { opacity: 0.4; }
          50% { opacity: 1; }
          100% { opacity: 0.4; }
        }

        @keyframes terminalSlideIn {
          from { opacity: 0; transform: translateX(-5px); }
          to { opacity: 1; transform: translateX(0); }
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (max-width: 1024px) {
          .workspace-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 768px) {
          .coordinates-grid {
            grid-template-columns: 1fr 1fr;
          }
        }
      `}</style>
    </div>
  );
};

export default OpenClawAi;
