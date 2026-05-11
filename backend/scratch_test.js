const axios = require('axios');
const csv = require('csv-parser');
const moment = require('moment');

async function checkSymbols() {
    const today = moment().format('YYYY-MM-DD');
    const csvUrl = `https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod/${today}/transformed/nse_fo.csv`;
    
    let symbols = new Set();

    try {
        const response = await axios({ method: 'get', url: csvUrl, responseType: 'stream' });

        response.data.pipe(csv())
        .on('data', (row) => {
            const keys = Object.keys(row);
            const instType = row['pInstType'];
            const symbol = row['pSymbolName'];
            if (instType === 'OPTIDX') {
                symbols.add(symbol);
            }
        })
        .on('end', () => {
            console.log(`Found symbols:`, Array.from(symbols));
        });
    } catch (e) {
        console.error("Error", e.message);
    }
}
checkSymbols();
