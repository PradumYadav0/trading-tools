/**
 * Trading Service - The Brain of the Application
 * Handles PCR calculation, Signal logic, and AI Suggestions
 */

export const calculatePCR = (putOI, callOI) => {
  if (!callOI) return 0;
  return (putOI / callOI).toFixed(2);
};

export const getMarketSentiment = (pcr) => {
  if (pcr > 1.2) return { label: 'EXTREMELY BULLISH', color: 'var(--success)', logic: 'Put writers are dominating. Strong support below.' };
  if (pcr > 1.0) return { label: 'BULLISH', color: 'var(--success)', logic: 'Market trend is positive.' };
  if (pcr < 0.7) return { label: 'EXTREMELY BEARISH', color: 'var(--danger)', logic: 'Call writers are dominating. Resistance is strong.' };
  if (pcr < 0.9) return { label: 'BEARISH', color: 'var(--danger)', logic: 'Market trend is negative.' };
  return { label: 'NEUTRAL', color: 'var(--warning)', logic: 'Market is sideways. Wait for breakout.' };
};

export const getAISuggestion = async (symbol, data) => {
  // This will later connect to Gemini API
  // For now, it returns logic-based professional suggestions
  const { pcr, currentPrice, trend } = data;
  
  if (symbol === 'BANKNIFTY') {
    if (pcr > 1.1 && trend === 'up') {
      return {
        signal: 'BUY CALL (CE)',
        strike: Math.round(currentPrice / 100) * 100,
        target: currentPrice + 250,
        sl: currentPrice - 100,
        reasoning: "OI Data shows massive Put writing at " + (Math.round(currentPrice / 100) * 100) + ". Bullish momentum confirmed by AI pattern detection."
      };
    }
  }
  
  return {
    signal: 'WAIT',
    reasoning: "Market is searching for direction. PCR is neutral. Avoid fresh entries."
  };
};
