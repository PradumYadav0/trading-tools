const axios = require('axios');
const csv = require('csv-parser');
const moment = require('moment');

async function findLatestFile() {
    let checkDate = moment();
    for (let i = 0; i < 30; i++) {
        const dateStr = checkDate.format('YYYY-MM-DD');
        const csvUrl = `https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod/${dateStr}/transformed/nse_fo.csv`;
        try {
            console.log(`Checking ${dateStr}...`);
            const resp = await axios.get(csvUrl);
            console.log(`Found file for ${dateStr}, length: ${resp.data.length}`);
            // Let's check the first few lines
            const preview = resp.data.substring(0, 1000);
            if (preview.includes('2026') || preview.includes('2024') || preview.includes('2025')) {
                console.log("VALID EXPIRIES IN FILE!");
                break;
            } else {
                console.log("File contains old expiries (e.g. 2016). Continuing search...");
            }
        } catch (e) {
            console.log(`Not found for ${dateStr}`);
        }
        checkDate = checkDate.subtract(1, 'days');
    }
}
findLatestFile();
