const axios = require('axios');

async function checkUrl() {
    try {
        const resp = await axios.get('https://lapi.kotaksecurities.com/script-details/v1/masterscrip/file-paths');
        console.log("Response:", resp.data);
    } catch(e) {
        console.error("Failed:", e.message);
    }
}
checkUrl();
