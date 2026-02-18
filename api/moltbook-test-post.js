// Quick diagnostic: test Moltbook post creation with detailed error info
const { getApiKey } = require('./_moltbook');

const MOLTBOOK_API_BASE = 'https://www.moltbook.com/api/v1';

module.exports = async (req, res) => {
  if (req.query.test !== 'true') {
    return res.status(401).json({ error: 'Add ?test=true' });
  }

  const path = require('path');
  const fs = require('fs');

  // Get API key
  let apiKey = process.env.MOLTBOOK_API_KEY;
  if (!apiKey) {
    try {
      const credPath = path.join(__dirname, '..', 'moltbook-credentials.json');
      const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      apiKey = creds.agent?.api_key;
    } catch (e) {}
  }

  if (!apiKey) {
    return res.status(500).json({ error: 'No API key found' });
  }

  const results = [];

  // Test 1: Try with submolt, title, content
  const test1Body = {
    submolt: 'general',
    title: 'Test post from alok',
    content: 'Just testing the Moltbook API connection. Hello from Olbrain!'
  };

  try {
    const resp = await fetch(`${MOLTBOOK_API_BASE}/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(test1Body)
    });
    const data = await resp.json();
    results.push({ test: 'submolt+title+content', status: resp.status, response: data });
  } catch (e) {
    results.push({ test: 'submolt+title+content', error: e.message });
  }

  // Test 2: Without submolt
  if (!results[0]?.response?.success && !results[0]?.response?.id) {
    const test2Body = {
      title: 'Test post from alok',
      content: 'Just testing the Moltbook API connection. Hello from Olbrain!'
    };

    try {
      const resp = await fetch(`${MOLTBOOK_API_BASE}/posts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(test2Body)
      });
      const data = await resp.json();
      results.push({ test: 'title+content only', status: resp.status, response: data });
    } catch (e) {
      results.push({ test: 'title+content only', error: e.message });
    }
  }

  // Test 3: With 'body' instead of 'content'
  if (results.every(r => !r.response?.success && !r.response?.id)) {
    const test3Body = {
      submolt: 'general',
      title: 'Test post from alok',
      body: 'Just testing the Moltbook API connection. Hello from Olbrain!'
    };

    try {
      const resp = await fetch(`${MOLTBOOK_API_BASE}/posts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(test3Body)
      });
      const data = await resp.json();
      results.push({ test: 'submolt+title+body', status: resp.status, response: data });
    } catch (e) {
      results.push({ test: 'submolt+title+body', error: e.message });
    }
  }

  // Also get agent status
  let agentStatus = null;
  try {
    const resp = await fetch(`${MOLTBOOK_API_BASE}/agents/status`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    agentStatus = await resp.json();
  } catch (e) {
    agentStatus = { error: e.message };
  }

  return res.status(200).json({
    agentStatus,
    postTests: results
  });
};
