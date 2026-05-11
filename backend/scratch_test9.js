require('dotenv').config();
const axios = require('axios');
const kotakNeo = require('./services/kotakNeoService');

async function checkDate() {
    try {
        console.log("Authenticating...");
        await kotakNeo.authenticate();
        console.log("Auth success! Token:", kotakNeo.sessionToken ? "Exists" : "None");
        
        console.log("Fetching file paths...");
        const resp = await axios.get('https://lapi.kotaksecurities.com/script-details/v1/masterscrip/file-paths', {
            headers: {
                'Authorization': `Bearer ${kotakNeo.sessionToken}`,
                'sid': kotakNeo.sessionToken
            }
        });
        console.log("File paths:", resp.data);
    } catch(e) {
        console.error("Failed:", e.response ? e.response.data : e.message);
    }
}
checkDate();
