// Mindclone Studio Chat API Handler - Google Gemini Version
// This handles requests to /api/chat using Google's Gemini API

module.exports = async function handler(req, res) {
  // Set CORS headers to allow requests from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests (OPTIONS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Handle GET requests - return API info
  if (req.method === 'GET') {
    return res.status(200).json({
      service: 'Mindclone Studio Chat API',
      status: 'operational',
      version: '1.0.0',
      provider: 'Google Gemini',
      model: 'gemini-pro',
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
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('❌ GEMINI_API_KEY not found in environment variables');
      return res.status(500).json({ 
        success: false, 
        error: 'API key not configured. Please add GEMINI_API_KEY to environment variables.' 
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

    // Build the conversation for Gemini
    // Gemini expects a different format than OpenAI
    let conversationText = '';
    
    // Add system prompt if provided
    if (systemPrompt) {
      conversationText += `${systemPrompt}\n\n`;
    }

    // Add conversation history
    for (const msg of messages) {
      const role = msg.role === 'assistant' ? 'AI' : 'User';
      conversationText += `${role}: ${msg.content}\n`;
    }

    // Add final prompt for AI response
    conversationText += `AI:`;

    // Call Gemini API
    console.log('📤 Calling Gemini API...');
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
    
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: conversationText
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
        }
      })
    });

    const data = await response.json();

    // Check for Gemini API errors
    if (!response.ok) {
      console.error('❌ Gemini API error:', {
        status: response.status,
        error: data.error
      });
      return res.status(500).json({ 
        success: false, 
        error: data.error?.message || 'Failed to get response from AI' 
      });
    }

    // Extract the response text
    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!aiResponse) {
      console.error('❌ Unexpected Gemini response format:', data);
      return res.status(500).json({ 
        success: false, 
        error: 'Unexpected response format from AI' 
      });
    }

    // Success! Return the AI's response
    console.log('✅ Successfully received Gemini response');
    return res.status(200).json({
      success: true,
      content: aiResponse.trim(),
      model: 'gemini-pro',
      provider: 'Google Gemini'
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
