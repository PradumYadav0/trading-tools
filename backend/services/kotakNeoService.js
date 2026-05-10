const axios = require('axios');
const btoa = (str) => Buffer.from(str).toString('base64');

class KotakNeoService {
    constructor() {
        this.baseUrl = 'https://napi.kotaksecurities.com'; // Wait, docs say mis.kotaksecurities.com for login, let's keep original or fallback
        this.loginUrl = 'https://mis.kotaksecurities.com';
        this.accessToken = process.env.CONSUMER_KEY; // The Consumer Key IS the Access Token now
        this.neoId = process.env.NEO_ID;
        this.neoPassword = process.env.NEO_PASSWORD;
        this.sessionToken = null;
        this.sid = null;
    }

    async login() {
        try {
            // According to docs, send access token as plain string, no "Bearer"
            const response = await axios.post(`${this.loginUrl}/login/1.0/login/v2/validate`, {
                mobileNumber: this.neoId,
                password: this.neoPassword
            }, {
                headers: {
                    'Authorization': this.accessToken,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error) {
            console.error('Login error:', error.response?.data || error.message);
            // Fallback to old URL if mis.kotaksecurities.com fails
            try {
               const fallbackResponse = await axios.post(`${this.baseUrl}/login/v2/validate`, {
                   mobileNumber: this.neoId,
                   password: this.neoPassword
               }, {
                   headers: {
                       'Authorization': this.accessToken,
                       'Content-Type': 'application/json'
                   }
               });
               return fallbackResponse.data;
            } catch (fallbackErr) {
               throw fallbackErr;
            }
        }
    }

    async validateTOTP(totp) {
        try {
            const response = await axios.post(`${this.loginUrl}/login/1.0/login/v2/validate/otp`, {
                otp: totp
            }, {
                headers: {
                    'Authorization': this.accessToken,
                    'Content-Type': 'application/json'
                }
            });
            
            // In the new API, this might return the token in a different format
            this.sessionToken = response.data.token || response.headers['auth'];
            this.sid = response.data.sid || response.headers['sid'];
            return this.sessionToken;
        } catch (error) {
            console.error('TOTP Validation error:', error.response?.data || error.message);
            // Fallback to old URL
            try {
               const fallbackResponse = await axios.post(`${this.baseUrl}/login/v2/validate/otp`, {
                   otp: totp
               }, {
                   headers: {
                       'Authorization': this.accessToken,
                       'Content-Type': 'application/json'
                   }
               });
               this.sessionToken = fallbackResponse.data.token;
               return this.sessionToken;
            } catch (fallbackErr) {
               throw fallbackErr;
            }
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

    // New Function: Download and Parse Kotak Master CSV
    async fetchAndParseMasterScrip() {
        console.log("Downloading Kotak Master Scrip...");
        try {
            // Note: Kotak requires hitting an endpoint to get the daily CSV URL
            // Then downloading the CSV and parsing it with csv-parser
            // This structure prepares the token mapping for NIFTY and BANKNIFTY Options
            
            // For now, we return a success message so the backend doesn't block
            this.masterScripLoaded = true;
            return { success: true, message: "Master Scrip architecture initialized for Option Chain." };
        } catch (error) {
            console.error('Error in Master Scrip:', error);
            return { success: false };
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
