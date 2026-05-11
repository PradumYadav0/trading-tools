const axios = require('axios');

async function testNapi() {
    try {
        const resp = await axios.get('https://napi.kotaksecurities.com/wso2-scripmaster/v1/prod/2026-05-11/transformed/nse_fo.csv');
        console.log("NAPI response:", resp.data.substring(0, 1000));
    } catch(e) {
        console.log("Failed", e.message);
    }
}
testNapi();
