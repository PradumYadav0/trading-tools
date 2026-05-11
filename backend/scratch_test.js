const axios = require('axios');
const csv = require('csv-parser');
const moment = require('moment');

async function testKotakCSV() {
    const today = moment().format('YYYY-MM-DD');
    const csvUrl = `https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod/${today}/transformed/nse_fo.csv`;
    
    try {
        const response = await axios({ method: 'get', url: csvUrl, responseType: 'stream' });

        let count = 0;
        let niftyTokens = [];

        response.data.pipe(csv())
        .on('data', (row) => {
            const keys = Object.keys(row);
            const getVal = (keyStr) => {
                const key = keys.find(k => k.toLowerCase().includes(keyStr.toLowerCase()));
                return key ? row[key] : null;
            };

            const symbol = row['pSymbolName'];
            const instType = row['pInstType'];
            const token = row['pSymbol'];
            const strikeRaw = row['dStrikePrice;'] || row['dStrikePrice'] || getVal('strikeprice');
            const precision = parseInt(row['lPrecision'] || '2');
            const strike = parseFloat(strikeRaw) / Math.pow(10, precision);
            const optType = row['pOptionType'];
            const expiryUnix = parseInt(row['pExpiryDate'] || getVal('expiry'));
            const expiry = moment.unix(expiryUnix).format('DD-MMM-YYYY');

            if (instType === 'OPTIDX' && token && symbol === 'NIFTY') {
                if (niftyTokens.length < 5) {
                    niftyTokens.push({ token, strike, optType, expiry, symbol });
                }
            }
            count++;
        })
        .on('end', () => {
            console.log(`Parsed ${count} rows. Found NIFTY:`, niftyTokens);
        });
    } catch (e) {
        console.error("Error", e);
    }
}

testKotakCSV();
