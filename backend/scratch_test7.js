const axios = require('axios');
async function test() {
   try {
       const resp = await axios.get('https://timeapi.io/api/Time/current/zone?timeZone=Asia/Kolkata');
       console.log("Real date:", resp.data);
   } catch(e) {
       console.log("Failed:", e.message);
   }
}
test();
