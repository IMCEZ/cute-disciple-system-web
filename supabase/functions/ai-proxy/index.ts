// Supabase Edge Function：AI 代理（纯转发，不做任何存储，数据全部留在客户端本地）
//
// 作用：前端 WebView 直连裸 IP + 明文 HTTP 的 new-api 中转站时，WebView 会用
// chunked 传输且不带 Content-Length，导致中转站读不到 body 长度而返回
// "HTTP 400 invalid JSON request body"。本函数用 Deno 的标准 fetch 转发（天然带
// Content-Length），彻底绕开该问题。逻辑与 backend/routes/ai.js 一致。
//
// 部署（需要 supabase CLI）：
//   supabase functions deploy ai-proxy
// 部署后地址形如：https://<project-ref>.supabase.co/functions/v1/ai-proxy
// 前端「设置 → 后端地址」填这个地址即可（不要带结尾斜杠）。

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}

function deriveOpenAIUrl(url: string): string {
  let u = (url || "").trim().replace(/\/+$/, "");
  if (!u) return "https://api.openai.com/v1/chat/completions";
  if (/\/chat\/completions$/.test(u) || /\/completions$/.test(u)) return u;
  if (!/\/v1$/.test(u)) u += "/v1";
  return u + "/chat/completions";
}
function deriveClaudeUrl(url: string): string {
  let u = (url || "").trim().replace(/\/+$/, "");
  if (!u) return "https://api.anthropic.com/v1/messages";
  if (/\/messages$/.test(u)) return u;
  if (!/\/v1$/.test(u)) u += "/v1";
  return u + "/messages";
}
function deriveGeminiUrl(url: string, model: string, key: string): string {
  let base = (url || "https://generativelanguage.googleapis.com/v1beta").trim().replace(/\/+$/, "");
  base = base.replace(/\/models(\/.*)?$/, "");
  if (!/\/v1(beta)?$/.test(base)) base += "/v1beta";
  return base + "/models/" + model + ":streamGenerateContent?alt=sse&key=" + encodeURIComponent(key);
}

/** This proxy must never become an SSRF endpoint.  Only public HTTPS model APIs
 * are accepted; API keys still come from the signed-in caller and are never stored. */
function isSafeUpstream(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return false;
    if (/^127\./.test(h) || /^0\.0\.0\.0$/.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "::1" || h.startsWith("fc") || h.startsWith("fd")) return false;
    return true;
  } catch (_e) { return false; }
}

// ---------------- /api/ai/chat：SSE 流式转发 ----------------
async function handleChat(b: any): Promise<Response> {
  const provider = b.provider || "openai";
  const model = b.model, key = b.apiKey, messages = b.messages || [];
  const temperature = b.temperature != null ? b.temperature : 0.8;
  const topP = b.topP != null ? b.topP : 0.9;
  const maxTokens = b.maxTokens || 2048;
  if (!key || !model) return json({ error: "缺少 apiKey 或 model" }, 400);

  let url: string, headers: Record<string, string>, payload: any;
  if (provider === "claude") {
    url = deriveClaudeUrl(b.apiUrl);
    const sys = messages.filter((m: any) => m.role === "system").map((m: any) => m.content).join("\n");
    const msgs = messages.filter((m: any) => m.role !== "system");
    headers = { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" };
    payload = { model, system: sys, messages: msgs, max_tokens: maxTokens, temperature, top_p: topP, stream: true };
  } else if (provider === "gemini") {
    url = deriveGeminiUrl(b.apiUrl, model, key);
    const sys = messages.filter((m: any) => m.role === "system").map((m: any) => m.content).join("\n");
    const contents = messages.filter((m: any) => m.role !== "system").map((m: any) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    headers = { "Content-Type": "application/json" };
    payload = { systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: { temperature, topP, maxOutputTokens: maxTokens } };
  } else {
    url = deriveOpenAIUrl(b.apiUrl);
    headers = { "Content-Type": "application/json", "Authorization": "Bearer " + key };
    // 推理/思考类模型：上游要求 temperature=1 且不能传 top_p，与前端 callOpenAI 特判一致
    const isThinking = /think|reason|o1|o3|o4-mini/i.test(model || "");
    payload = { model, messages, max_tokens: maxTokens, stream: true };
    if (isThinking) payload.temperature = 1;
    else { payload.temperature = temperature; payload.top_p = topP; }
  }

  if (!isSafeUpstream(url)) return sseError("Only public HTTPS AI endpoints are allowed");

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  } catch (e) {
    return sseError((e as Error).message || String(e));
  }
  if (!upstream.ok || !upstream.body) {
    const t = await upstream.text().catch(() => "");
    return sseError("HTTP " + upstream.status + ": " + t.slice(0, 300));
  }

  // 解析上游 SSE，抽取增量文本，按统一的 OpenAI delta 格式回传前端
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = "";
  const stream = new ReadableStream({
    async pull(ctrl) {
      const sendDelta = (text: string) =>
        ctrl.enqueue(encoder.encode("data: " + JSON.stringify({ choices: [{ delta: { content: text } }] }) + "\n\n"));
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
          ctrl.close();
          return;
        }
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (let ln of lines) {
          ln = ln.trim();
          if (ln.indexOf("data:") !== 0) continue;
          const data = ln.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const j = JSON.parse(data);
            let delta = "";
            if (provider === "claude") {
              if (j.type === "content_block_delta" && j.delta && j.delta.text) delta = j.delta.text;
            } else if (provider === "gemini") {
              delta = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
            } else {
              delta = j?.choices?.[0]?.delta?.content || "";
            }
            if (delta) sendDelta(delta);
          } catch (_e) { /* 忽略非 JSON 行 */ }
        }
        return; // 每次 pull 处理一个 chunk，交回控制权保持背压
      }
    },
    cancel() { reader.cancel().catch(() => {}); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...CORS,
    },
  });
}

function sseError(msg: string): Response {
  const body = "data: " + JSON.stringify({ error: msg }) + "\n\ndata: [DONE]\n\n";
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", ...CORS },
  });
}

// ---------------- /api/ai/models：模型列表转发 ----------------
async function handleModels(b: any): Promise<Response> {
  const provider = b.provider || "openai", key = b.apiKey, url = b.apiUrl;
  if (!key) return json({ error: "缺少 apiKey" }, 400);
  try {
    let mu: string, headers: Record<string, string> = {};
    if (provider === "gemini") {
      let base = (url || "https://generativelanguage.googleapis.com/v1beta").trim().replace(/\/+$/, "").replace(/\/models(\/.*)?$/, "");
      if (!/\/v1(beta)?$/.test(base)) base += "/v1beta";
      mu = base + "/models?key=" + encodeURIComponent(key);
    } else if (provider === "claude") {
      let base = (url || "https://api.anthropic.com").trim().replace(/\/+$/, "").replace(/\/messages$/, "").replace(/\/models$/, "");
      if (!/\/v1$/.test(base)) base += "/v1";
      mu = base + "/models";
      headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
    } else {
      let base = (url || "https://api.openai.com").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "").replace(/\/completions$/, "").replace(/\/models$/, "");
      if (!/\/v1$/.test(base)) base += "/v1";
      mu = base + "/models";
      headers = { "Authorization": "Bearer " + key };
    }
    if (!isSafeUpstream(mu)) return json({ error: "Only public HTTPS AI endpoints are allowed" }, 400);
    const r = await fetch(mu, { headers });
    const t = await r.text();
    if (!r.ok) return json({ error: "HTTP " + r.status + ": " + t.slice(0, 200) }, r.status);
    let j: any;
    try { j = JSON.parse(t); } catch (_e) { return json({ error: "返回非JSON: " + t.slice(0, 150) }, 500); }
    let models: string[] = [];
    if (provider === "gemini") models = (j.models || []).map((m: any) => (m.name || "").replace("models/", "")).filter(Boolean);
    else {
      const arr = j.data || j.models || (Array.isArray(j) ? j : []);
      models = arr.map((m: any) => m.id || m.name || m).filter(Boolean);
    }
    return json({ models });
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const path = new URL(req.url).pathname;
  if (path.endsWith("/api/health")) return json({ status: "ok", db: false });

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let b: any;
  try { b = await req.json(); } catch (_e) { return json({ error: "invalid JSON body" }, 400); }

  if (path.endsWith("/api/ai/chat")) return await handleChat(b);
  if (path.endsWith("/api/ai/models")) return await handleModels(b);

  return json({ error: { code: 404, message: "Not found" } }, 404);
});
