const express = require('express');
const router = express.Router();
const { getDB } = require('../database/init');

router.get('/shop/items', (req, res) => { try { res.json({ data: getDB().prepare('SELECT * FROM items').all() }); } catch(e) { res.status(500).json({ error: e.message }); } });
router.get('/news', (req, res) => { try { res.json({ data: getDB().prepare('SELECT * FROM news ORDER BY id').all() }); } catch(e) { res.status(500).json({ error: e.message }); } });
router.get('/messages', (req, res) => { try { res.json({ data: getDB().prepare('SELECT * FROM messages ORDER BY id').all() }); } catch(e) { res.status(500).json({ error: e.message }); } });
router.get('/disciple', (req, res) => res.json({ data: [] }));

module.exports = router;
