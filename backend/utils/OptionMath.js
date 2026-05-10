const greeks = require('greeks');
const iv = require('implied-volatility');
const moment = require('moment');

class OptionMath {
    static calculateGreeks(type, spotPrice, strikePrice, optionPrice, expiryDateStr) {
        try {
            // Calculate time to expiry in years
            const expiry = moment(expiryDateStr, "DD-MMM-YYYY");
            const now = moment();
            let daysToExpiry = expiry.diff(now, 'days');
            
            // Avoid division by zero on expiry day
            if (daysToExpiry <= 0) daysToExpiry = 0.01;
            
            const timeToExpiryYears = daysToExpiry / 365;
            const riskFreeRate = 0.07; // 7% Indian Risk Free Rate approx

            // Calculate Implied Volatility
            const impliedVol = iv.getImpliedVolatility(
                optionPrice, 
                spotPrice, 
                strikePrice, 
                timeToExpiryYears, 
                riskFreeRate, 
                type === 'CE' ? 'call' : 'put'
            ) || 0.20; // fallback to 20% IV if calculation fails

            // Calculate Greeks
            const delta = greeks.getDelta(spotPrice, strikePrice, timeToExpiryYears, impliedVol, riskFreeRate, type === 'CE' ? 'call' : 'put');
            const gamma = greeks.getGamma(spotPrice, strikePrice, timeToExpiryYears, impliedVol, riskFreeRate);
            const theta = greeks.getTheta(spotPrice, strikePrice, timeToExpiryYears, impliedVol, riskFreeRate, type === 'CE' ? 'call' : 'put');
            const vega = greeks.getVega(spotPrice, strikePrice, timeToExpiryYears, impliedVol, riskFreeRate);

            return {
                iv: (impliedVol * 100).toFixed(2),
                delta: delta.toFixed(3),
                gamma: gamma.toFixed(4),
                theta: (theta / 365).toFixed(2), // Daily theta
                vega: (vega / 100).toFixed(2) // Vega per 1% change in IV
            };
        } catch (error) {
            return { iv: "0.00", delta: "0.000", gamma: "0.0000", theta: "0.00", vega: "0.00" };
        }
    }
}

module.exports = OptionMath;
