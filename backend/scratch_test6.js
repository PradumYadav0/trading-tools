const axios = require('axios');
async function testUrls() {
   const urls = [
       'https://napi.kotaksecurities.com/script-details/v1/masterscrip/file-paths',
       'https://lapi.kotaksecurities.com/script-details/v1/masterscrip/file-paths',
       'https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod/masterscrip/file-paths'
   ];
   for(let url of urls) {
       try {
           console.log(`Testing ${url}`);
           const resp = await axios.get(url);
           console.log("Success:", resp.data);
       } catch(e) {
           console.log("Failed:", e.message);
       }
   }
}
testUrls();
