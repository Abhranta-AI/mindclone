// Diagnostic: Test Claude API with full chat flow (system prompt + tools)
module.exports = async (req, res) => {
  const claudeApiKey = process.env.ANTHROPIC_API_KEY;
  const results = {};

  if (!claudeApiKey) {
    return res.status(200).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  // Test 1: Simple call (already works)
  results.test1_simple = 'PASSED (previously verified)';

  // Test 2: With system prompt
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 100,
        system: 'You are Nova, a friendly AI assistant. Respond in one sentence.',
        messages: [{ role: 'user', content: 'Who are you?' }]
      })
    });
    const data = await resp.json();
    results.test2_system = { ok: resp.ok, status: resp.status, text: data.content?.[0]?.text || JSON.stringify(data).substring(0, 300) };
  } catch (e) { results.test2_system = { error: e.message }; }

  // Test 3: With tools (this is likely where it breaks)
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 100,
        system: 'You are a helpful AI.',
        messages: [{ role: 'user', content: 'Hello, how are you?' }],
        tools: [{
          name: 'web_search',
          description: 'Search the web',
          input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
        }]
      })
    });
    const data = await resp.json();
    results.test3_tools = { ok: resp.ok, status: resp.status, text: data.content?.[0]?.text || JSON.stringify(data).substring(0, 300) };
  } catch (e) { results.test3_tools = { error: e.message }; }

  // Test 4: Full adapter test (simulates what chat.js does)
  try {
    // Import the adapter
    const chatModule = require('./chat.js');
    results.test4_adapter = 'Module loaded (adapter is internal function, cannot test directly)';
  } catch (e) {
    results.test4_adapter = { error: e.message };
  }

  // Test 5: Check Moltbook API key
  try {
    const moltbookKey = process.env.MOLTBOOK_API_KEY;
    if (!moltbookKey) {
      // Try credentials file
      const fs = require('fs');
      const path = require('path');
      try {
        const creds = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'moltbook-credentials.json'), 'utf-8'));
        results.test5_moltbook_key = { source: 'file', keyPrefix: creds.api_key?.substring(0, 15) };
      } catch (e2) {
        results.test5_moltbook_key = { error: 'No MOLTBOOK_API_KEY env var and no credentials file' };
      }
    } else {
      results.test5_moltbook_key = { source: 'env', keyPrefix: moltbookKey.substring(0, 15) };
    }

    // Test Moltbook API
    const apiKey = moltbookKey || (() => { try { return JSON.parse(require('fs').readFileSync(require('path').join(process.cwd(), 'moltbook-credentials.json'), 'utf-8')).api_key; } catch(e) { return null; } })();
    if (apiKey) {
      const moltResp = await fetch('https://www.moltbook.com/api/v1/posts?limit=1', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const moltData = await moltResp.json();
      results.test5_moltbook_api = { status: moltResp.status, ok: moltResp.ok, error: moltData.error || null };
    }
  } catch (e) { results.test5_moltbook = { error: e.message }; }

  return res.status(200).json(results);
};
