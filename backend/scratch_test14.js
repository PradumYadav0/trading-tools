const axios = require('axios');

async function testFormats() {
    const urls = [
        'https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod/2026-05-11/transformed/nse_fo.csv',
        'https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod/11-05-2026/transformed/nse_fo.csv',
        'https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod/11052026/transformed/nse_fo.csv',
        'https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod/20260511/transformed/nse_fo.csv',
        'https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod/masterscrip/transformed/nse_fo.csv',
        'https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod/latest/transformed/nse_fo.csv'
    ];

    for (let url of urls) {
        try {
            console.log("Fetching:", url);
            const resp = await axios.get(url, { headers: { 'Range': 'bytes=0-1000' } });
            const dataStr = resp.data.substring(0, 500);
            if (dataStr.includes('1469716200')) {
                console.log("-> Returned 2016 file.");
            } else {
                console.log("-> DIFFERENT FILE FOUND!");
                console.log(dataStr);
            }
        } catch (e) {
            console.log("-> Failed:", e.message);
        }
    }
}
testFormats();
