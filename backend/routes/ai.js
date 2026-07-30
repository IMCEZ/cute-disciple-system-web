const express = require('express');
const router = express.Router();

/* AI 代理：浏览器 → 本地后端 → AI 供应商（后端无 CORS 限制）
   请求体：{ provider, apiUrl, apiKey, model, messages, temperature, topP, maxTokens }
   以 SSE 流式把 AI 增量回传给前端，前端按 OpenAI 风格 data: 解析。 */

function deriveOpenAIUrl(url) {
  let u = (url || '').trim().replace(/\/+$/, '');
  if (!u) return 'https://api.openai.com/v1/chat/completions';
  if (/\/chat\/completions$/.test(u) || /\/completions$/.test(u)) return u;
  if (!/\/v1$/.test(u)) u += '/v1';
  return u + '/chat/completions';
}
function deriveClaudeUrl(url) {
  let u = (url || '').trim().replace(/\/+$/, '');
  if (!u) return 'https://api.anthropic.com/v1/messages';
  if (/\/messages$/.test(u)) return u;
  if (!/\/v1$/.test(u)) u += '/v1';
  return u + '/messages';
}
function deriveGeminiUrl(url, model, key) {
  let base = (url || 'https://generativelanguage.googleapis.com/v1beta').trim().replace(/\/+$/, '');
  base = base.replace(/\/models(\/.*)?$/, '');
  if (!/\/v1(beta)?$/.test(base)) base += '/v1beta';
  return base + '/models/' + model + ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(key);
}

router.post('/chat', async (req, res) => {
  const b = req.body || {};
  const provider = b.provider || 'openai';
  const model = b.model, key = b.apiKey, messages = b.messages || [];
  const temperature = b.temperature != null ? b.temperature : 0.8;
  const topP = b.topP != null ? b.topP : 0.9;
  const maxTokens = b.maxTokens || 2048;
  const stream = b.stream !== false;   // 默认流式；前端可传 false
  if (!key || !model) return res.status(400).json({ error: '缺少 apiKey 或 model' });

  // 统一以 SSE 回传前端（前端按 OpenAI delta 解析）
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const sendDelta = (text) => res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n');
  const done = () => { res.write('data: [DONE]\n\n'); res.end(); };
  const fail = (msg) => { res.write('data: ' + JSON.stringify({ error: msg }) + '\n\n'); res.end(); };

  try {
    let url, headers, payload;
    if (provider === 'claude') {
      url = deriveClaudeUrl(b.apiUrl);
      const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
      const msgs = messages.filter(m => m.role !== 'system');
      headers = { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
      payload = { model, system: sys, messages: msgs, max_tokens: maxTokens, temperature, top_p: topP, stream: true };
    } else if (provider === 'gemini') {
      url = deriveGeminiUrl(b.apiUrl, model, key);
      const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
      const contents = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      headers = { 'Content-Type': 'application/json' };
      payload = { systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: { temperature, topP, maxOutputTokens: maxTokens } };
    } else {
      url = deriveOpenAIUrl(b.apiUrl);
      headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
      // 推理/思考类模型（o1/o3/o4-mini/deepseek-reasoner/*-thinking）：上游要求 temperature=1 且不能传 top_p，
      // 否则报 "invalid request / top_p must be unset"。与前端 callOpenAI 的特判保持一致。
      const isThinking = /think|reason|o1|o3|o4-mini/i.test(model || '');
      payload = { model, messages, max_tokens: maxTokens, stream: true };
      if (isThinking) { payload.temperature = 1; }
      else { payload.temperature = temperature; payload.top_p = topP; }
    }

    const upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!upstream.ok) {
      const t = await upstream.text();
      return fail('HTTP ' + upstream.status + ': ' + t.slice(0, 300));
    }

    // 解析上游 SSE，抽取增量文本，按统一格式回传
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done: rd, value } = await reader.read();
      if (rd) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (let ln of lines) {
        ln = ln.trim();
        if (ln.indexOf('data:') !== 0) continue;
        const data = ln.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          let delta = '';
          if (provider === 'claude') {
            if (j.type === 'content_block_delta' && j.delta && j.delta.text) delta = j.delta.text;
          } else if (provider === 'gemini') {
            delta = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text || '';
          } else {
            delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content || '';
          }
          if (delta) sendDelta(delta);
        } catch (e) { /* 忽略非 JSON 行 */ }
      }
    }
    done();
  } catch (e) {
    fail(e.message || String(e));
  }
});

/* 模型列表代理 */
router.post('/models', async (req, res) => {
  const b = req.body || {};
  const provider = b.provider || 'openai', key = b.apiKey, url = b.apiUrl;
  if (!key) return res.status(400).json({ error: '缺少 apiKey' });
  try {
    let mu, headers = {}, models = [];
    if (provider === 'gemini') {
      let base = (url || 'https://generativelanguage.googleapis.com/v1beta').trim().replace(/\/+$/, '').replace(/\/models(\/.*)?$/, '');
      if (!/\/v1(beta)?$/.test(base)) base += '/v1beta';
      mu = base + '/models?key=' + encodeURIComponent(key);
    } else if (provider === 'claude') {
      let base = (url || 'https://api.anthropic.com').trim().replace(/\/+$/, '').replace(/\/messages$/, '').replace(/\/models$/, '');
      if (!/\/v1$/.test(base)) base += '/v1';
      mu = base + '/models';
      headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
    } else {
      let base = (url || 'https://api.openai.com').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '').replace(/\/completions$/, '').replace(/\/models$/, '');
      if (!/\/v1$/.test(base)) base += '/v1';
      mu = base + '/models';
      headers = { 'Authorization': 'Bearer ' + key };
    }
    const r = await fetch(mu, { headers });
    const t = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: 'HTTP ' + r.status + ': ' + t.slice(0, 200) });
    let j;
    try { j = JSON.parse(t); } catch (e) { return res.status(500).json({ error: '返回非JSON: ' + t.slice(0, 150) }); }
    if (provider === 'gemini') models = (j.models || []).map(m => (m.name || '').replace('models/', '')).filter(Boolean);
    else { const arr = j.data || j.models || (Array.isArray(j) ? j : []); models = arr.map(m => m.id || m.name || m).filter(Boolean); }
    res.json({ models });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

module.exports = router;
