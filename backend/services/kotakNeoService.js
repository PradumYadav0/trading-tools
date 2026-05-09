const axios = require('axios');
const btoa = (str) => Buffer.from(str).toString('base64');

class KotakNeoService {
    constructor() {
        this.baseUrl = 'https://napi.kotaksecurities.com';
        this.consumerKey = process.env.CONSUMER_KEY;
        this.consumerSecret = process.env.CONSUMER_SECRET;
        this.neoId = process.env.NEO_ID;
        this.neoPassword = process.env.NEO_PASSWORD;
        this.bearerToken = null;
        this.sessionToken = null;
    }

    async getBearerToken() {
        try {
            const auth = btoa(`${this.consumerKey}:${this.consumerSecret}`);
            const response = await axios.post(`${this.baseUrl}/oauth2/token`, 
                'grant_type=client_credentials', 
                {
                    headers: {
                        'Authorization': `Basic ${auth}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );
            this.bearerToken = response.data.access_token;
            return this.bearerToken;
        } catch (error) {
            console.error('Error getting bearer token:', error.response?.data || error.message);
            throw error;
        }
    }

    async login() {
        if (!this.bearerToken) await this.getBearerToken();

        try {
            const response = await axios.post(`${this.baseUrl}/login/v2/validate`, {
                mobileNumber: this.neoId,
                password: this.neoPassword
            }, {
                headers: {
                    'Authorization': `Bearer ${this.bearerToken}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data; // Usually contains the session ID (sid)
        } catch (error) {
            console.error('Login error:', error.response?.data || error.message);
            throw error;
        }
    }

    async validateTOTP(totp) {
        try {
            const response = await axios.post(`${this.baseUrl}/login/v2/validate/otp`, {
                otp: totp
            }, {
                headers: {
                    'Authorization': `Bearer ${this.bearerToken}`,
                    'Content-Type': 'application/json'
                }
            });
            this.sessionToken = response.data.token;
            return this.sessionToken;
        } catch (error) {
            console.error('TOTP Validation error:', error.response?.data || error.message);
            throw error;
        }
    }

    async getQuotes(symbols) {
        try {
            const response = await axios.get(`${this.baseUrl}/quotes/v1/quotes`, {
                params: { instruments: symbols.join(',') },
                headers: {
                    'Authorization': `Bearer ${this.bearerToken}`,
                    'sid': this.sessionToken,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error) {
            console.error('Error fetching quotes:', error.response?.data || error.message);
            throw error;
        }
    }

    async placeOrder(params) {
        try {
            const response = await axios.post(`${this.baseUrl}/orders/v1/place`, params, {
                headers: {
                    'Authorization': `Bearer ${this.bearerToken}`,
                    'sid': this.sessionToken,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error) {
            console.error('Order placement error:', error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = new KotakNeoService();
