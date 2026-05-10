const axios = require('axios');

class NseFetcher {
    constructor() {
        this.cookies = '';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
        };
    }

    async fetchCookies() {
        try {
            const response = await axios.get('https://www.nseindia.com', { headers: this.headers, timeout: 5000 });
            const setCookie = response.headers['set-cookie'];
            if (setCookie) {
                this.cookies = setCookie.map(cookie => cookie.split(';')[0]).join('; ');
            }
        } catch (error) {
            console.error('Error fetching NSE cookies:', error.message);
        }
    }

    async getOptionChain(symbol) {
        try {
            if (!this.cookies) await this.fetchCookies();

            const url = `https://www.nseindia.com/api/option-chain-indices?symbol=${symbol}`;
            const response = await axios.get(url, {
                headers: { ...this.headers, 'Cookie': this.cookies },
                timeout: 5000
            });

            return response.data;
        } catch (error) {
            console.error('Error fetching NSE Option Chain:', error.message);
            // If it fails (due to NSE blocking), retry once by resetting cookies
            this.cookies = '';
            return null;
        }
    }
}

module.exports = new NseFetcher();
