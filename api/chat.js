// Mindclone Studio Chat API Handler
// This handles requests to /api/chat

module.exports = async function handler(req, res) {
  // Set CORS headers to allow requests from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests (OPTIONS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Handle GET requests - return API info instead of error
  if (req.method === 'GET') {
    return res.status(200).json({
      service: 'Mindclone Studio Chat API',
      status: 'operational',
      version: '1.0.0',
      methods: ['POST'],
      message: 'Send POST requests with messages array to use this API',
      timestamp: new Date().toISOString()
    });
  }

  // Only allow POST for actual chat requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Use POST to send messages.' 
    });
  }

  try {
    // Check if API key exists
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('❌ ANTHROPIC_API_KEY not found in environment variables');
      return res.status(500).json({ 
        success: false, 
        error: 'API key not configured. Please check environment variables.' 
      });
    }

    // Log incoming request (helpful for debugging)
    console.log('✅ Received chat request:', {
      timestamp: new Date().toISOString(),
      hasMessages: !!req.body?.messages,
      messageCount: req.body?.messages?.length || 0
    });

    // Get request body
    const { messages, systemPrompt } = req.body;

    // Validate messages
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Messages array is required' 
      });
    }

    if (messages.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Messages array cannot be empty' 
      });
    }

    // Call Anthropic API
    console.log('📤 Calling Anthropic API...');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt || 'You are a helpful AI assistant.',
        messages: messages
      })
    });

    const data = await response.json();

    // Check for Anthropic API errors
    if (!response.ok) {
      console.error('❌ Anthropic API error:', {
        status: response.status,
        error: data.error
      });
      return res.status(500).json({ 
        success: false, 
        error: data.error?.message || 'Failed to get response from AI' 
      });
    }

    // Success! Return the AI's response
    console.log('✅ Successfully received AI response');
    return res.status(200).json({
      success: true,
      content: data.content[0].text,
      model: data.model,
      usage: data.usage
    });

  } catch (error) {
    // Catch any unexpected errors
    console.error('❌ Server error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
};
