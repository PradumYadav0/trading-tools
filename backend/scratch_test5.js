const axios = require('axios');

async function getRealDate() {
    const res = await axios.get('http://worldtimeapi.org/api/timezone/Asia/Kolkata');
    console.log("Real date:", res.data.datetime);
}
getRealDate();
