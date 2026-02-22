// Quick diagnostic: Test Claude API
module.exports = async (req, res) => {
  const claudeApiKey = process.env.ANTHROPIC_API_KEY;

  const results = {
    keyPresent: !!claudeApiKey,
    keyLength: claudeApiKey?.length || 0,
    keyPrefix: claudeApiKey?.substring(0, 7) || 'none'
  };

  if (!claudeApiKey) {
    return res.status(200).json({ ...results, error: 'ANTHROPIC_API_KEY not set in environment' });
  }

  // Test simple Claude API call
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Say hello in one sentence.' }]
      })
    });

    const data = await response.json();
    results.test = {
      status: response.status,
      ok: response.ok,
      response: response.ok ? { text: data.content?.[0]?.text } : data
    };
  } catch (e) {
    results.test = { error: e.message };
  }

  return res.status(200).json(results);
};
