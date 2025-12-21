// DEPRECATED: This endpoint redirects to the unified /api/chat endpoint
// All public link functionality is now handled by /api/chat with context='public'

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Return deprecation notice with redirect instructions
  console.log('[chat-public] DEPRECATED: Received request, should use /api/chat with context="public"');

  return res.status(410).json({
    error: 'This endpoint is deprecated',
    message: 'Please use /api/chat with context="public" instead',
    migration: {
      oldEndpoint: '/api/chat-public',
      newEndpoint: '/api/chat',
      requiredParams: {
        context: 'public',
        username: 'required - the mindclone username',
        visitorId: 'required - unique visitor identifier',
        messages: 'required - conversation history'
      }
    }
  });
};
