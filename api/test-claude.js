// Full diagnostic: test Claude adapter with real tools
module.exports = async (req, res) => {
  const claudeApiKey = process.env.ANTHROPIC_API_KEY;
  if (!claudeApiKey) return res.status(200).json({ error: 'ANTHROPIC_API_KEY not set' });

  const results = {};

  // Copy of the adapter from chat.js
  async function testCallClaude(requestBody) {
    const systemMsg = requestBody.messages.find(m => m.role === 'system');
    const nonSystemMsgs = requestBody.messages.filter(m => m.role !== 'system');

    const claudeMessages = [];
    for (const msg of nonSystemMsgs) {
      if (msg.role === 'tool') {
        claudeMessages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id, content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }] });
      } else if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        const content = [];
        if (msg.content) content.push({ type: 'text', text: msg.content });
        for (const tc of msg.tool_calls) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || '{}') });
        }
        claudeMessages.push({ role: 'assistant', content });
      } else if (msg.role === 'assistant') {
        claudeMessages.push({ role: 'assistant', content: msg.content || '' });
      } else {
        claudeMessages.push({ role: 'user', content: msg.content || '' });
      }
    }

    // Merge consecutive same-role
    const merged = [];
    for (const msg of claudeMessages) {
      const prev = merged[merged.length - 1];
      if (prev && prev.role === msg.role) {
        const prevC = Array.isArray(prev.content) ? prev.content : [{ type: 'text', text: prev.content || '' }];
        const currC = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content || '' }];
        prev.content = [...prevC, ...currC];
      } else {
        merged.push(msg);
      }
    }
    if (merged.length === 0 || merged[0].role !== 'user') merged.unshift({ role: 'user', content: 'Hello' });

    const claudeTools = (requestBody.tools || []).map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters
    }));

    const body = {
      model: requestBody.model,
      max_tokens: requestBody.max_tokens || 4096,
      system: systemMsg?.content || undefined,
      messages: merged,
      tools: claudeTools.length > 0 ? claudeTools : undefined
    };

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': claudeApiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    return { ok: resp.ok, status: resp.status, data, sentTools: claudeTools.length, sentMessages: merged.length };
  }

  // Real tools from chat.js (simplified versions)
  const realTools = [
    { type: 'function', function: { name: 'search_memory', description: 'Search memories', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'web_search', description: 'Search the web', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'save_memory', description: 'Save a memory', parameters: { type: 'object', properties: { content: { type: 'string' }, category: { type: 'string', enum: ['birthday','preference','person','fact','reminder','other'] } }, required: ['content'] } } },
    { type: 'function', function: { name: 'browse_url', description: 'Browse a URL', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'analyze_image', description: 'Analyze image', parameters: { type: 'object', properties: { image_url: { type: 'string' }, question: { type: 'string' } }, required: ['image_url'] } } }
  ];

  // Test: Full adapter with system prompt + tools (like a real chat)
  try {
    const result = await testCallClaude({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 200,
      messages: [
        { role: 'system', content: 'You are Nova, a friendly AI created by Alok. Respond in one sentence.' },
        { role: 'user', content: 'Hi, who are you?' }
      ],
      tools: realTools
    });
    results.test_adapter = {
      ok: result.ok,
      status: result.status,
      sentTools: result.sentTools,
      sentMessages: result.sentMessages,
      text: result.data?.content?.[0]?.text || null,
      error: result.data?.error || null,
      rawResponse: !result.ok ? JSON.stringify(result.data).substring(0, 500) : undefined
    };
  } catch (e) {
    results.test_adapter = { error: e.message, stack: e.stack?.substring(0, 300) };
  }

  // Test Moltbook API
  try {
    const moltbookKey = process.env.MOLTBOOK_API_KEY;
    let apiKey = moltbookKey;
    if (!apiKey) {
      try {
        const fs = require('fs');
        const creds = JSON.parse(fs.readFileSync(require('path').join(process.cwd(), 'moltbook-credentials.json'), 'utf-8'));
        apiKey = creds.api_key;
      } catch(e) {}
    }
    if (apiKey) {
      const moltResp = await fetch('https://www.moltbook.com/api/v1/posts?limit=1', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const moltData = await moltResp.json();
      results.moltbook = { status: moltResp.status, ok: moltResp.ok, keyPrefix: apiKey.substring(0, 15), response: JSON.stringify(moltData).substring(0, 300) };
    } else {
      results.moltbook = { error: 'No API key found' };
    }
  } catch (e) { results.moltbook = { error: e.message }; }

  return res.status(200).json(results);
};
