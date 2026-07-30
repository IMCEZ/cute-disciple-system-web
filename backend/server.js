const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 数据库可选：原生模块在部分环境编译失败时不影响 AI 代理
let dbReady = false;
try {
  const { initDatabase } = require('./database/init');
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');
  initDatabase(dbPath);
  dbReady = true;
  console.log('[DB] initialized');
} catch (e) {
  console.warn('[DB] 跳过数据库初始化（' + e.message + '）—— AI 代理仍可用');
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', db: dbReady }));

// AI 代理路由（无数据库依赖）
app.use('/api/ai', require('./routes/ai'));

// 预设管理路由（内存存储，无需数据库）
app.use('/api/presets', require('./routes/presets'));

// 业务路由（依赖数据库，未就绪时跳过）
if (dbReady) {
  app.use('/api', require('./routes/api'));
}

app.use((req, res) => res.status(404).json({ error: { code: 404, message: 'Not found' } }));
app.use((err, req, res, nxt) => { console.error(err.message); res.status(500).json({ error: { code: 500, message: err.message } }); });
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('[Server] Running on :' + PORT));
