// Quick diagnostic: Test Gemini OpenAI-compatible endpoint
module.exports = async (req, res) => {
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!geminiApiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not set' });
  }

  const results = {};

  // Test 1: Simple chat (no tools)
  try {
    const resp1 = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${geminiApiKey}`
      },
      body: JSON.stringify({
        model: 'gemini-2.0-flash',
        max_tokens: 100,
        messages: [
          { role: 'system', content: 'You are a helpful AI.' },
          { role: 'user', content: 'Say hello in one sentence.' }
        ]
      })
    });
    const data1 = await resp1.json();
    results.test1_simple = { status: resp1.status, ok: resp1.ok, response: data1 };
  } catch (e) {
    results.test1_simple = { error: e.message };
  }

  // Test 2: With a simple tool
  try {
    const resp2 = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${geminiApiKey}`
      },
      body: JSON.stringify({
        model: 'gemini-2.0-flash',
        max_tokens: 100,
        messages: [
          { role: 'user', content: 'Search for "test query"' }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'web_search',
            description: 'Search the web',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query' }
              },
              required: ['query']
            }
          }
        }]
      })
    });
    const data2 = await resp2.json();
    results.test2_with_tool = { status: resp2.status, ok: resp2.ok, response: data2 };
  } catch (e) {
    results.test2_with_tool = { error: e.message };
  }

  // Test 3: Native Gemini API (not OpenAI-compatible)
  try {
    const resp3 = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Say hello in one sentence.' }] }],
        generationConfig: { maxOutputTokens: 100 }
      })
    });
    const data3 = await resp3.json();
    results.test3_native = { status: resp3.status, ok: resp3.ok, response: data3 };
  } catch (e) {
    results.test3_native = { error: e.message };
  }

  return res.status(200).json(results);
};
