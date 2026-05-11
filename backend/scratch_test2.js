const axios = require('axios');
const csv = require('csv-parser');
const moment = require('moment');

async function checkCSVHeaders() {
    const today = moment().format('YYYY-MM-DD');
    const csvUrl = `https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod/${today}/transformed/nse_fo.csv`;
    
    try {
        const response = await axios({ method: 'get', url: csvUrl, responseType: 'stream' });

        let rowCount = 0;
        response.data.pipe(csv())
        .on('data', (row) => {
            if (rowCount === 0) {
                console.log("FIRST ROW KEYS:");
                console.log(Object.keys(row));
                console.log("FIRST ROW VALUES:");
                console.log(row);
                rowCount++;
            }
        })
        .on('end', () => {
            console.log(`Stream ended.`);
        });
    } catch (e) {
        console.error("Error", e.message);
    }
}
checkCSVHeaders();
