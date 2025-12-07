// Gemini API handler with Mem0 integration
const { CONNOISSEUR_STYLE_GUIDE } = require('./_style-guide');
const { MemoryClient } = require('mem0ai');

// Initialize Mem0 client (reuse across requests)
let memoryClient = null;

function getMemoryClient() {
  if (!memoryClient && process.env.MEM0_API_KEY) {
    memoryClient = new MemoryClient(process.env.MEM0_API_KEY);
  }
  return memoryClient;
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      provider: 'gemini',
      hasApiKey: !!process.env.GEMINI_API_KEY,
      hasMem0: !!process.env.MEM0_API_KEY
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY not configured'
      });
    }

    const { messages, systemPrompt, userId } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Messages array required'
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId required for memory management'
      });
    }

    // === MEM0 INTEGRATION ===
    let relevantMemories = [];
    let contextWindow = messages;

    const mem0 = getMemoryClient();
    if (mem0) {
      try {
        // Get the last user message to search for relevant memories
        const lastUserMessage = messages[messages.length - 1];

        // Search for relevant memories
        const memorySearchResult = await mem0.search(lastUserMessage.content, {
          user_id: userId,
          limit: 50
        });

        if (memorySearchResult && memorySearchResult.results) {
          relevantMemories = memorySearchResult.results.map(m => m.memory);
        }

        // Use only last 100 messages to save context (instead of all messages)
        contextWindow = messages.slice(-100);

        console.log(`[Mem0] Found ${relevantMemories.length} relevant memories for user ${userId}`);
      } catch (memError) {
        console.error('[Mem0] Memory search error:', memError);
        // Continue without memories if Mem0 fails
      }
    } else {
      // If no Mem0, use last 200 messages as fallback
      contextWindow = messages.slice(-200);
    }

    // Convert conversation history to Gemini format
    const contents = contextWindow.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    // Build enhanced system prompt with memories
    let systemInstruction = undefined;
    if (systemPrompt) {
      let enhancedPrompt = systemPrompt;

      // Add relevant memories to system prompt
      if (relevantMemories.length > 0) {
        enhancedPrompt += '\n\n## RELEVANT MEMORIES:\n';
        enhancedPrompt += 'Here are important facts and preferences you should remember:\n';
        relevantMemories.forEach((memory, idx) => {
          enhancedPrompt += `${idx + 1}. ${memory}\n`;
        });
      }

      // Add style guide
      enhancedPrompt += `\n\n${CONNOISSEUR_STYLE_GUIDE}`;

      systemInstruction = {
        parts: [{ text: enhancedPrompt }]
      };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: contents
    };

    if (systemInstruction) {
      requestBody.systemInstruction = systemInstruction;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Gemini API request failed');
    }

    const text = data.candidates[0].content.parts[0].text;

    // === STORE NEW MEMORIES ===
    if (mem0) {
      try {
        // Add the conversation to memory (Mem0 will extract important facts)
        const conversationToStore = [
          {
            role: 'user',
            content: messages[messages.length - 1].content
          },
          {
            role: 'assistant',
            content: text
          }
        ];

        await mem0.add(conversationToStore, {
          user_id: userId
        });

        console.log(`[Mem0] Stored new memories for user ${userId}`);
      } catch (memError) {
        console.error('[Mem0] Memory storage error:', memError);
        // Continue even if memory storage fails
      }
    }

    return res.status(200).json({
      success: true,
      content: text,
      memoriesUsed: relevantMemories.length
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Failed to generate response: ' + error.message
    });
  }
};
