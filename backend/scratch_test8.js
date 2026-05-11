const axios = require('axios');
const moment = require('moment');

async function getRealDateFromYahoo() {
    try {
        const resp = await axios.get('https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI');
        const timestamp = resp.data.chart.result[0].meta.regularMarketTime;
        const realDate = moment.unix(timestamp).format('YYYY-MM-DD');
        console.log("Real date from Yahoo:", realDate);
    } catch(e) {
        console.error("Failed:", e.message);
    }
}
getRealDateFromYahoo();
