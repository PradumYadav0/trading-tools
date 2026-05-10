const Parser = require('rss-parser');
const parser = new Parser();

class NewsService {
    constructor() {
        this.cache = [];
        this.lastFetch = 0;
        // Moneycontrol/Economic Times Market News RSS
        this.rssUrl = 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms'; 
    }

    async getLiveNews() {
        // Cache for 5 minutes
        if (Date.now() - this.lastFetch < 5 * 60 * 1000 && this.cache.length > 0) {
            return this.cache;
        }

        try {
            const feed = await parser.parseURL(this.rssUrl);
            const headlines = feed.items.slice(0, 5).map(item => ({
                title: item.title,
                time: item.pubDate
            }));
            
            this.cache = headlines;
            this.lastFetch = Date.now();
            return this.cache;
        } catch (error) {
            console.error('Failed to fetch RSS news:', error);
            return this.cache.length > 0 ? this.cache : [{ title: "Awaiting Live Market News Updates...", time: "" }];
        }
    }
}

module.exports = new NewsService();
