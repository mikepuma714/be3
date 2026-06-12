/* ============================================================
   CENTURY 21 BE3 — /api/interview
   Streaming serverless function (@vercel/node)

   POST { messages: [{role, content}], lead: {firstName} }

   - Prepends the system prompt server-side (never exposed to client)
   - Calls OpenAI Chat Completions with stream:true
   - Parses SSE delta.content and res.write()s plain UTF-8 text
   - Errors are JSON; the 200 streaming body is plain text (kept distinct)
   ============================================================ */

'use strict';

const { buildPrompt } = require('./_prompt');

/* ── best-effort in-memory rate limiter ──────────────────────── */
const ipWindows = new Map(); // ip → number[]

function isRateLimited(ip) {
  const now = Date.now();
  const WINDOW_MS = 60_000; // 1 minute
  const MAX_REQ   = 30;     // requests per window per IP

  let timestamps = ipWindows.get(ip) || [];
  timestamps = timestamps.filter(t => now - t < WINDOW_MS);
  if (timestamps.length >= MAX_REQ) return true;
  timestamps.push(now);
  ipWindows.set(ip, timestamps);
  return false;
}

/* ── main handler ────────────────────────────────────────────── */
module.exports = async (req, res) => {
  /* POST only */
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  /* Rate limit */
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests — please slow down.' });
  }

  /* Parse body */
  let body;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { messages, lead } = body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  /* Validate individual messages */
  for (const m of messages) {
    if (!m || !['user', 'assistant', 'system'].includes(m.role) || typeof m.content !== 'string') {
      return res.status(400).json({ error: 'Invalid message format' });
    }
    if (m.content.length > 4000) {
      return res.status(400).json({ error: 'Message too long' });
    }
  }

  /* API key */
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  /* Build message array:
     system prompt + last 16 turns from client history */
  const firstName = (lead?.firstName || '').trim();
  const systemPrompt = buildPrompt(firstName);

  const slicedHistory = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-16)
    .map(({ role, content }) => ({ role, content: content.slice(0, 4000) }));

  const openAIMessages = [
    { role: 'system', content: systemPrompt },
    ...slicedHistory,
  ];

  /* Call OpenAI with stream:true */
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  let openAIRes;
  try {
    openAIRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: openAIMessages,
        stream: true,
        temperature: 0.5,
        max_tokens: 800,
      }),
    });
  } catch (err) {
    console.error('OpenAI fetch error:', err);
    return res.status(500).json({ error: 'Failed to reach AI service' });
  }

  if (!openAIRes.ok) {
    const errText = await openAIRes.text().catch(() => '');
    console.error('OpenAI error response:', openAIRes.status, errText);
    return res.status(502).json({ error: 'AI service error' });
  }

  /* Stream plain UTF-8 text to the client.
     OpenAI SSE format: "data: {json}\n\n", last line: "data: [DONE]\n\n"
     We parse delta.content from each chunk and res.write() it raw. */
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if present

  const reader = openAIRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        let parsed;
        try { parsed = JSON.parse(data); } catch { continue; }

        const delta = parsed?.choices?.[0]?.delta?.content;
        if (delta) res.write(delta);
      }
    }
  } catch (err) {
    /* Client likely disconnected mid-stream — not an error worth logging loudly */
    if (err.name !== 'AbortError') {
      console.error('Stream error:', err.message);
    }
  } finally {
    res.end();
  }
};
