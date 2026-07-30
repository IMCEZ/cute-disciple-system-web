require('dotenv').config();
module.exports = {
  port: process.env.PORT || 3001,
  dbPath: process.env.DB_PATH || './data/app.db',
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY || '', baseUrl: 'https://api.openai.com/v1' },
    claude: { apiKey: process.env.CLAUDE_API_KEY || '', baseUrl: 'https://api.anthropic.com/v1' },
    gemini: { apiKey: process.env.GEMINI_API_KEY || '', baseUrl: 'https://generativelanguage.googleapis.com/v1' }
  }
};
