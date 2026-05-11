const axios = require('axios');
const csv = require('csv-parser');
const moment = require('moment');
const btoa = (str) => Buffer.from(str).toString('base64');

class KotakNeoService {
    constructor() {
        this.baseUrl = 'https://napi.kotaksecurities.com'; 
        this.loginUrl = 'https://mis.kotaksecurities.com';
        this.accessToken = process.env.CONSUMER_KEY; 
        this.neoId = process.env.NEO_ID;
        this.neoPassword = process.env.NEO_PASSWORD;
        this.sessionToken = null;
        this.sid = null;
        this.instrumentMap = {
            'NIFTY': { spot: 'Nifty 50', tokens: [] },
            'BANKNIFTY': { spot: 'Nifty Bank', tokens: [] }
        };
        this.masterScripLoaded = false;
    }

    async login() {
        try {
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
            
            this.sessionToken = response.data.token || response.headers['auth'];
            this.sid = response.data.sid || response.headers['sid'];
            return this.sessionToken;
        } catch (error) {
            console.error('TOTP Validation error:', error.response?.data || error.message);
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
                    'Authorization': `Bearer ${this.sessionToken}`,
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

    // Download and Parse Kotak Master CSV
    async fetchAndParseMasterScrip() {
        console.log("Downloading Kotak Master Scrip CSV...");
        try {
            const today = moment().format('YYYY-MM-DD');
            const csvUrl = `https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod/${today}/transformed/nse_fo.csv`;
            
            console.log("Fetching from:", csvUrl);
            
            const response = await axios({
                method: 'get',
                url: csvUrl,
                responseType: 'stream'
            });

            // Reset Map
            this.instrumentMap = {
                'NIFTY': { spot: 'Nifty 50', tokens: [] },
                'BANKNIFTY': { spot: 'Nifty Bank', tokens: [] }
            };

            return new Promise((resolve, reject) => {
                response.data.pipe(csv())
                .on('data', (row) => {
                    const keys = Object.keys(row);
                    const symbol = row['pSymbolName'];
                    const instType = row['pInstType'];
                    const token = row['pSymbol'];
                    const precision = parseInt(row['lPrecision'] || '2');
                    
                    let strikeRaw = row['dStrikePrice;'] || row['dStrikePrice'];
                    if (!strikeRaw && keys) {
                        const strikeKey = keys.find(k => k.toLowerCase().includes('strikeprice'));
                        strikeRaw = strikeKey ? row[strikeKey] : 0;
                    }
                    const strike = parseFloat(strikeRaw) / Math.pow(10, precision);
                    const optType = row['pOptionType'];
                    
                    let expiryUnix = parseInt(row['pExpiryDate']);
                    if (isNaN(expiryUnix) && keys) {
                        const expKey = keys.find(k => k.toLowerCase().includes('expirydate'));
                        expiryUnix = parseInt(expKey ? row[expKey] : 0);
                    }
                    const expiry = moment.unix(expiryUnix).format('DD-MMM-YYYY');

                    if (instType === 'OPTIDX' && token) {
                        if (symbol === 'NIFTY') {
                            this.instrumentMap['NIFTY'].tokens.push({ token, strike, optType, expiry });
                        } else if (symbol === 'BANKNIFTY') {
                            this.instrumentMap['BANKNIFTY'].tokens.push({ token, strike, optType, expiry });
                        }
                    }
                })
                .on('end', () => {
                    this.masterScripLoaded = true;
                    console.log(`Master Scrip Loaded successfully!`);
                    console.log(`Mapped NIFTY Options: ${this.instrumentMap['NIFTY'].tokens.length}`);
                    console.log(`Mapped BANKNIFTY Options: ${this.instrumentMap['BANKNIFTY'].tokens.length}`);
                    resolve({ success: true, message: "Master Scrip downloaded and tokens mapped." });
                })
                .on('error', (err) => {
                    console.error("CSV Parsing error", err);
                    reject(err);
                });
            });

        } catch (error) {
            console.error('Error in Master Scrip Download:', error.message);
            // Check if it's 404 (maybe weekend or file not generated yet)
            if (error.response && error.response.status === 404) {
                 console.log("Master Scrip for today not found. Market might be closed or file not generated yet.");
            }
            return { success: false, message: error.message };
        }
    }

    // Function to get Tokens for a Symbol
    getOptionTokens(symbol) {
        if (!this.masterScripLoaded) return null;
        return this.instrumentMap[symbol]?.tokens || null;
    }

    async placeOrder(params) {
        try {
            const response = await axios.post(`${this.baseUrl}/orders/v1/place`, params, {
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
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
