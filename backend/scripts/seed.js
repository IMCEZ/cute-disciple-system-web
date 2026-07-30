const path = require('path');
const { initDatabase } = require('../database/init');
const fs = require('fs');
const db = initDatabase(path.join(__dirname, '..', 'data', 'app.db'));
const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'seed.sql'), 'utf8');
db.exec(sql);
console.log('[Seed] Default data inserted');
