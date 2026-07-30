const { getDB } = require('../database/init');
class BaseModel {
  constructor(t) { this.table = t; }
  findById(id) { return getDB().prepare('SELECT * FROM ' + this.table + ' WHERE id = ?').get(id); }
  findAll() { return getDB().prepare('SELECT * FROM ' + this.table).all(); }
  create(data) { const keys=Object.keys(data),vals=Object.values(data),ph=keys.map(()=>'?').join(','); const r=getDB().prepare('INSERT INTO '+this.table+' ('+keys.join(',')+') VALUES ('+ph+')').run(...vals); return {id:r.lastInsertRowid,...data}; }
  update(id, data) { const keys=Object.keys(data),vals=Object.values(data); getDB().prepare('UPDATE '+this.table+' SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=?').run(...vals,id); return this.findById(id); }
  delete(id) { getDB().prepare('DELETE FROM '+this.table+' WHERE id=?').run(id); return {deleted:true}; }
}
class DiscipleModel extends BaseModel { constructor() { super('disciples'); } findByWorldId(wid) { return getDB().prepare('SELECT * FROM disciples WHERE world_id=?').all(wid); } }
class NPCModel extends BaseModel { constructor() { super('npcs'); } findByDiscipleId(did) { return getDB().prepare('SELECT * FROM npcs WHERE disciple_id=?').all(did); } findByName(n) { return getDB().prepare('SELECT * FROM npcs WHERE name=?').get(n); } }
class ItemModel extends BaseModel { constructor() { super('items'); } findByTier(t) { return getDB().prepare('SELECT * FROM items WHERE tier=?').all(t); } }
class WorldModel extends BaseModel { constructor() { super('worlds'); } }
class SnapshotModel extends BaseModel { constructor() { super('snapshots'); } }
class MessageModel extends BaseModel { constructor() { super('messages'); } }
class NewsModel extends BaseModel { constructor() { super('news'); } }
class ChatHistoryModel extends BaseModel { constructor() { super('chat_history'); } }
module.exports = { DiscipleModel, NPCModel, ItemModel, WorldModel, SnapshotModel, MessageModel, NewsModel, ChatHistoryModel };
