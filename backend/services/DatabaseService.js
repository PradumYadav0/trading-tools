const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

class DatabaseService {
    constructor() {
        this.db = null;
        this.init();
    }

    async init() {
        try {
            this.db = await open({
                filename: path.join(__dirname, '../market_data.db'),
                driver: sqlite3.Database
            });

            // Create Option Chain table
            await this.db.exec(`
                CREATE TABLE IF NOT EXISTS option_chain (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT NOT NULL,
                    spot_price REAL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    chain_data TEXT NOT NULL
                )
            `);
            console.log('SQLite Database Initialized for Option Chain.');
        } catch (error) {
            console.error('Database Initialization Error:', error);
        }
    }

    async saveOptionChain(symbol, spotPrice, chainDataArray) {
        if (!this.db) return;
        try {
            await this.db.run(
                `INSERT INTO option_chain (symbol, spot_price, chain_data) VALUES (?, ?, ?)`,
                [symbol, spotPrice, JSON.stringify(chainDataArray)]
            );
        } catch (error) {
            console.error('Error saving option chain to DB:', error);
        }
    }

    async getHistoricalOptionChain(symbol, limit = 1) {
        if (!this.db) return null;
        try {
            const rows = await this.db.all(
                `SELECT * FROM option_chain WHERE symbol = ? ORDER BY timestamp DESC LIMIT ?`,
                [symbol, limit]
            );
            return rows.map(row => ({
                ...row,
                chain_data: JSON.parse(row.chain_data)
            }));
        } catch (error) {
            console.error('Error fetching historical option chain from DB:', error);
            return null;
        }
    }
}

module.exports = new DatabaseService();
