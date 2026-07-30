const express = require('express');
const router = express.Router();

/* 预设存储（内存 + 后续可改为 SQLite）
   采用双模式：后端可用时走这里，不可用时前端 fallback 到 localStorage */

let presets = [];           // 内存存储
let nextId = 1;

/* 从预设 JSON 中提取名称 */
function extractName(data) {
  if (data.name) return data.name;
  if (data.prompts && data.prompts.length > 0) {
    // 找第一个非 marker 的词条名称
    for (const p of data.prompts) {
      if (!p.marker && p.name) return p.name;
    }
    return data.prompts[0].name || '未命名预设';
  }
  return '未命名预设';
}

/* 解析预设 JSON，返回标准化结构 */
function parsePreset(data) {
  const globalParams = {
    temperature: data.temperature != null ? data.temperature : 1.0,
    frequency_penalty: data.frequency_penalty != null ? data.frequency_penalty : 0,
    presence_penalty: data.presence_penalty != null ? data.presence_penalty : 0,
    top_p: data.top_p != null ? data.top_p : 0.88,
    top_k: data.top_k != null ? data.top_k : 40,
    top_a: data.top_a != null ? data.top_a : 0,
    min_p: data.min_p != null ? data.min_p : 0,
    repetition_penalty: data.repetition_penalty != null ? data.repetition_penalty : 1,
    max_context_unlocked: data.max_context_unlocked || false,
    openai_max_context: data.openai_max_context || 2000000,
    openai_max_tokens: data.openai_max_tokens || 65535,
    send_if_empty: data.send_if_empty || '',
    impersonation_prompt: data.impersonation_prompt || '',
    continue_nudge_prompt: data.continue_nudge_prompt || '',
    new_chat_prompt: data.new_chat_prompt || '',
    stream_openai: data.stream_openai !== false,
    bias_preset_selected: data.bias_preset_selected || 'Default (none)',
    wi_format: data.wi_format || '',
    scenario_format: data.scenario_format || '',
    personality_format: data.personality_format || '',
    group_nudge_prompt: data.group_nudge_prompt || '',
    names_behavior: data.names_behavior != null ? data.names_behavior : 0,
    tool_reasoning_mode: data.tool_reasoning_mode || 'disabled'
  };

  const entries = (data.prompts || []).map((p, idx) => ({
    id: p.identifier || ('entry_' + idx + '_' + Date.now()),
    name: p.name || '未命名词条',
    enabled: p.enabled !== false,   // 默认为 true（保持与导入一致）
    content: p.content || '',
    role: p.role || 'system',
    isMarker: p.name && (p.name.startsWith('----') || p.name.startsWith('--') || p.marker === true),
    injectionPosition: p.injection_position || 0,
    injectionDepth: p.injection_depth || 4,
    injectionOrder: p.injection_order || 100,
    systemPrompt: p.system_prompt || false,
    forbidOverrides: p.forbid_overrides || false
  }));

  return { globalParams, entries };
}

/* POST /api/presets/import — 导入预设 JSON */
router.post('/import', (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.prompts || !Array.isArray(data.prompts) || data.prompts.length === 0) {
      return res.status(422).json({
        success: false,
        errors: ['"prompts" 字段必须是数组，且至少包含一个元素']
      });
    }

    const parsed = parsePreset(data);
    const name = extractName(data);
    const version = (data.name || '').match(/V(\d+)/i);
    const preset = {
      id: String(nextId++),
      name: name,
      version: version ? 'V' + version[1] : '',
      entryCount: parsed.entries.length,
      globalParams: parsed.globalParams,
      entries: parsed.entries,
      createdAt: new Date().toISOString()
    };

    presets.push(preset);

    res.json({
      success: true,
      preset: {
        id: preset.id,
        name: preset.name,
        version: preset.version,
        entryCount: preset.entryCount,
        globalParams: preset.globalParams,
        createdAt: preset.createdAt
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, errors: [e.message || String(e)] });
  }
});

/* GET /api/presets — 获取预设列表 */
router.get('/', (req, res) => {
  const list = presets.map(p => ({
    id: p.id,
    name: p.name,
    version: p.version,
    entryCount: p.entryCount,
    createdAt: p.createdAt
  }));
  res.json({ success: true, presets: list });
});

/* GET /api/presets/:id — 获取预设详情（含完整词条） */
router.get('/:id', (req, res) => {
  const p = presets.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, errors: ['预设不存在'] });
  res.json({ success: true, data: p });
});

/* PUT /api/presets/:id/entries/:entryId — 更新词条 */
router.put('/:id/entries/:entryId', (req, res) => {
  const p = presets.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, errors: ['预设不存在'] });

  const entry = p.entries.find(e => e.id === req.params.entryId);
  if (!entry) return res.status(404).json({ success: false, errors: ['词条不存在'] });

  const body = req.body || {};
  if (body.content !== undefined) entry.content = body.content;
  if (body.enabled !== undefined) entry.enabled = !!body.enabled;
  if (body.name !== undefined) entry.name = body.name;

  res.json({ success: true, entry: entry });
});

/* DELETE /api/presets/:id — 删除预设 */
router.delete('/:id', (req, res) => {
  const idx = presets.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, errors: ['预设不存在'] });
  presets.splice(idx, 1);
  res.json({ success: true });
});

/* POST /api/presets/:id/build — 根据预设+角色卡组装消息 */
router.post('/:id/build', (req, res) => {
  const p = presets.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, errors: ['预设不存在'] });

  const { characterCard } = req.body || {};
  const enabledEntries = p.entries.filter(e => e.enabled && !e.isMarker);

  // 按 injectionOrder 排序
  enabledEntries.sort((a, b) => (a.injectionOrder || 100) - (b.injectionOrder || 100));

  const messages = [];
  let combinedSystem = '';

  // 收集所有 system 角色的词条内容
  for (const entry of enabledEntries) {
    if (entry.role === 'system') {
      combinedSystem += entry.content + '\n\n';
    } else {
      // user/assistant 角色作为示例对话
      messages.push({
        role: entry.role,
        content: entry.content
      });
    }
  }

  // 如果有角色卡，附加到系统提示
  if (characterCard) {
    try {
      const cardStr = typeof characterCard === 'string' ? characterCard : JSON.stringify(characterCard, null, 2);
      combinedSystem += '\n[角色卡数据]\n' + cardStr;
    } catch (e) {
      combinedSystem += '\n[角色卡加载失败]';
    }
  }

  messages.unshift({ role: 'system', content: combinedSystem });

  res.json({
    success: true,
    messages: messages,
    globalParams: p.globalParams
  });
});

module.exports = router;
