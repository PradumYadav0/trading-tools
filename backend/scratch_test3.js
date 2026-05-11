require('dotenv').config();
const kotakNeo = require('./services/kotakNeoService');
const moment = require('moment');

async function test() {
    console.log("Fetching Master Scrip...");
    await kotakNeo.fetchAndParseMasterScrip();
    
    const tokens = kotakNeo.getOptionTokens('BANKNIFTY');
    console.log("BANKNIFTY Tokens:", tokens ? tokens.length : null);
    if (tokens && tokens.length > 0) {
        console.log("First token:", tokens[0]);
        console.log("Last token:", tokens[tokens.length-1]);
        
        // Let's mimic server.js filtering logic
        const allTokens = tokens;
        const sortedExpiries = [...new Set(allTokens.map(t => t.expiry))].sort((a, b) => moment(a, "DD-MMM-YYYY").valueOf() - moment(b, "DD-MMM-YYYY").valueOf());
        console.log("Sorted Expiries:", sortedExpiries.slice(0, 5));
        
        const targetExpiry = sortedExpiries[0];
        console.log("Target Expiry:", targetExpiry);
        
        const basePrice = 48200;
        const step = 100;
        const minStrike = basePrice - (25 * step);
        const maxStrike = basePrice + (25 * step);
        
        const targetTokens = allTokens.filter(t => {
            const strikeNum = parseFloat(t.strike);
            return t.expiry === targetExpiry && strikeNum >= minStrike && strikeNum <= maxStrike;
        });
        console.log("Target Tokens Count:", targetTokens.length);
        if(targetTokens.length > 0) {
             console.log("First target token:", targetTokens[0]);
        }
    }
}
test();
