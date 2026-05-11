const axios = require('axios');
const moment = require('moment');

async function testV2() {
    const checkDate = moment().format('YYYY-MM-DD');
    const urls = [
        `https://lapi.kotaksecurities.com/wso2-scripmaster/v2/prod/${checkDate}/transformed/nse_fo.csv`,
        `https://lapi.kotaksecurities.com/wso2-scripmaster/v1.0/prod/${checkDate}/transformed/nse_fo.csv`,
        `https://napi.kotaksecurities.com/wso2-scripmaster/v1/prod/${checkDate}/transformed/nse_fo.csv`
    ];
    for (const url of urls) {
        try {
            console.log(`Checking ${url}...`);
            const resp = await axios.get(url);
            console.log(`Success! Length: ${resp.data.length}`);
        } catch(e) {
            console.log(`Failed: ${e.response ? e.response.status : e.message}`);
        }
    }
}
testV2();
