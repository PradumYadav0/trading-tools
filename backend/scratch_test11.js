const axios = require('axios');
const csv = require('csv-parser');
const moment = require('moment');

async function findLatestFile() {
    let checkDate = moment();
    for (let i = 0; i < 5; i++) {
        const dateStr = checkDate.format('YYYY-MM-DD');
        const csvUrl = `https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod/${dateStr}/transformed/nse_fo.csv`;
        try {
            console.log(`Checking ${dateStr}...`);
            const resp = await axios.get(csvUrl);
            const preview = resp.data.substring(0, 1000);
            if (preview.includes('2026') || preview.includes('2025')) {
                console.log("VALID EXPIRIES IN FILE!");
                break;
            } else {
                console.log(`File for ${dateStr} has old expiries.`);
            }
        } catch (e) {
            console.log(`Not found for ${dateStr}`);
        }
        checkDate = checkDate.subtract(1, 'days');
    }
}
findLatestFile();
