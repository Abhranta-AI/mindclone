// Quick diagnostic endpoint for Moltbook API
// DELETE THIS FILE after debugging

module.exports = async (req, res) => {
  const apiKey = process.env.MOLTBOOK_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'MOLTBOOK_API_KEY not set' });
  }

  const results = {};

  // Test 1: Get agent status
  try {
    const statusResp = await fetch('https://www.moltbook.com/api/v1/agents/status', {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });
    results.agentStatus = { status: statusResp.status, data: await statusResp.json() };
  } catch (e) {
    results.agentStatus = { error: e.message };
  }

  // Test 2: Get agent profile
  try {
    const profileResp = await fetch('https://www.moltbook.com/api/v1/agents/me', {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });
    results.agentProfile = { status: profileResp.status, data: await profileResp.json() };
  } catch (e) {
    results.agentProfile = { error: e.message };
  }

  // Test 3: Try to create a post (with correct field name "submolt")
  try {
    const postBody = {
      title: 'Testing the waters',
      content: 'Quick connectivity test from Nova, the mindclone. Checking API access. 🧠',
      submolt: 'general'
    };
    console.log('[Test] Posting with body:', JSON.stringify(postBody));

    const postResp = await fetch('https://www.moltbook.com/api/v1/posts', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(postBody)
    });

    const postData = await postResp.json();
    results.createPost = {
      status: postResp.status,
      statusText: postResp.statusText,
      headers: Object.fromEntries(postResp.headers.entries()),
      data: postData
    };
  } catch (e) {
    results.createPost = { error: e.message };
  }

  // Test 4: Try with submolt_name (old field) to compare
  try {
    const postBody2 = {
      title: 'Testing old field name',
      content: 'Testing with submolt_name field for comparison.',
      submolt_name: 'general'
    };

    const postResp2 = await fetch('https://www.moltbook.com/api/v1/posts', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(postBody2)
    });

    results.createPostOldField = {
      status: postResp2.status,
      data: await postResp2.json()
    };
  } catch (e) {
    results.createPostOldField = { error: e.message };
  }

  return res.status(200).json(results);
};
