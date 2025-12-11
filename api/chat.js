// Gemini API handler with Mem0 integration and Tool Calling
const { CONNOISSEUR_STYLE_GUIDE } = require('./_style-guide');
const { MemoryClient } = require('mem0ai');
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
const { computeAccessLevel } = require('./_billing-helpers');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Initialize Mem0 client (reuse across requests)
let memoryClient = null;

function getMemoryClient() {
  if (!memoryClient && process.env.MEM0_API_KEY) {
    memoryClient = new MemoryClient({ apiKey: process.env.MEM0_API_KEY });
  }
  return memoryClient;
}

// ===================== TOOL DEFINITIONS =====================
const tools = [
  {
    function_declarations: [
      {
        name: "get_link_settings",
        description: "Get the current public link settings including username, link status, display name, bio, greeting, and knowledge base status. Use this when the user asks about their link settings, configuration, or wants to know their current setup.",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "update_link_settings",
        description: "Update public link settings. Use this when the user wants to change their link configuration - like enabling/disabling the link, changing display name, bio, or greeting. You can update one or multiple settings at once.",
        parameters: {
          type: "object",
          properties: {
            linkEnabled: {
              type: "boolean",
              description: "Enable or disable the public link"
            },
            displayName: {
              type: "string",
              description: "The name displayed on the public link page"
            },
            bio: {
              type: "string",
              description: "A short bio about the user (max 200 characters)"
            },
            customGreeting: {
              type: "string",
              description: "Custom greeting message shown to visitors when they open the link"
            },
            knowledgeBaseEnabled: {
              type: "boolean",
              description: "Enable or disable knowledge base for link conversations"
            }
          },
          required: []
        }
      },
      {
        name: "get_knowledge_base",
        description: "Get information about the user's knowledge base documents. Use this when the user asks about their uploaded documents, knowledge base, or what files they have shared.",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "get_link_conversations",
        description: "Get recent visitor conversations from the user's public link. Use this when the user asks about what visitors are discussing, popular topics, what people are asking about, conversation history, or wants to analyze their link engagement. Returns the actual messages exchanged between visitors and the mindclone.",
        parameters: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of visitors to fetch (default 20, max 50)"
            },
            includeFullConversations: {
              type: "boolean",
              description: "If true, fetch full conversation history for each visitor. If false (default), only fetch the last few messages per visitor."
            }
          },
          required: []
        }
      }
    ]
  }
];

// ===================== TOOL HANDLERS =====================

// Get link settings from Firestore
async function handleGetLinkSettings(userId) {
  try {
    // Get user document
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data() || {};

    // Get link settings
    const settingsDoc = await db.collection('users').doc(userId)
      .collection('linkSettings').doc('config').get();
    const settingsData = settingsDoc.data() || {};

    const publicLinkUrl = userData.username ? `https://mindclone.link/${userData.username}` : null;

    return {
      success: true,
      settings: {
        username: userData.username || null,
        publicLinkUrl: publicLinkUrl,
        linkEnabled: userData.linkEnabled || false,
        displayName: settingsData.displayName || userData.displayName || '',
        bio: settingsData.bio || '',
        customGreeting: settingsData.customGreeting || '',
        knowledgeBaseEnabled: userData.knowledgeBaseEnabled || false
      }
    };
  } catch (error) {
    console.error('[Tool] Error getting link settings:', error);
    return { success: false, error: error.message };
  }
}

// Update link settings in Firestore
async function handleUpdateLinkSettings(userId, params) {
  try {
    const updates = {};
    const linkSettingsUpdates = {};

    // User document updates
    if (params.linkEnabled !== undefined) {
      updates.linkEnabled = params.linkEnabled;
    }
    if (params.knowledgeBaseEnabled !== undefined) {
      updates.knowledgeBaseEnabled = params.knowledgeBaseEnabled;
    }

    // Link settings updates
    if (params.displayName !== undefined) {
      linkSettingsUpdates.displayName = params.displayName;
    }
    if (params.bio !== undefined) {
      // Validate bio length
      if (params.bio.length > 200) {
        return { success: false, error: 'Bio must be 200 characters or less' };
      }
      linkSettingsUpdates.bio = params.bio;
    }
    if (params.customGreeting !== undefined) {
      linkSettingsUpdates.customGreeting = params.customGreeting;
    }

    // Apply user document updates
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      await db.collection('users').doc(userId).set(updates, { merge: true });
    }

    // Apply link settings updates
    if (Object.keys(linkSettingsUpdates).length > 0) {
      linkSettingsUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      await db.collection('users').doc(userId)
        .collection('linkSettings').doc('config')
        .set(linkSettingsUpdates, { merge: true });
    }

    // Return what was updated
    const updatedFields = Object.keys({ ...updates, ...linkSettingsUpdates }).filter(k => k !== 'updatedAt');
    return {
      success: true,
      message: `Successfully updated: ${updatedFields.join(', ')}`,
      updatedFields: updatedFields
    };
  } catch (error) {
    console.error('[Tool] Error updating link settings:', error);
    return { success: false, error: error.message };
  }
}

// Get knowledge base documents
async function handleGetKnowledgeBase(userId) {
  try {
    // Get user's KB enabled status
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data() || {};

    // Get knowledge base documents
    const kbSnapshot = await db.collection('users').doc(userId)
      .collection('knowledgeBase').get();

    const documents = [];
    kbSnapshot.forEach(doc => {
      const data = doc.data();
      documents.push({
        id: doc.id,
        fileName: data.fileName,
        type: data.type,
        size: formatFileSize(data.size),
        uploadedAt: data.uploadedAt?.toDate?.()?.toISOString() || null
      });
    });

    return {
      success: true,
      knowledgeBaseEnabled: userData.knowledgeBaseEnabled || false,
      documentCount: documents.length,
      documents: documents
    };
  } catch (error) {
    console.error('[Tool] Error getting knowledge base:', error);
    return { success: false, error: error.message };
  }
}

// Get link conversations for analysis
async function handleGetLinkConversations(userId, params = {}) {
  try {
    const limit = Math.min(params.limit || 20, 50);
    const includeFullConversations = params.includeFullConversations || false;

    // Get recent visitors sorted by last visit
    const visitorsSnapshot = await db.collection('users').doc(userId)
      .collection('visitors')
      .orderBy('lastVisit', 'desc')
      .limit(limit)
      .get();

    if (visitorsSnapshot.empty) {
      return {
        success: true,
        totalVisitors: 0,
        conversations: [],
        summary: "No visitor conversations yet. Share your public link to start receiving visitors!"
      };
    }

    const conversations = [];
    let totalMessages = 0;
    const allUserMessages = []; // Collect all user messages for topic analysis

    // Process each visitor
    for (const visitorDoc of visitorsSnapshot.docs) {
      const visitorData = visitorDoc.data();
      const visitorId = visitorDoc.id;

      // Get messages from this visitor
      const messagesLimit = includeFullConversations ? 100 : 10;
      const messagesSnapshot = await db.collection('users').doc(userId)
        .collection('visitors').doc(visitorId)
        .collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(messagesLimit)
        .get();

      if (!messagesSnapshot.empty) {
        const messages = messagesSnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            role: data.role,
            content: data.content,
            timestamp: data.timestamp?.toDate?.()?.toISOString() || null
          };
        }).reverse(); // Chronological order

        // Collect user messages for topic analysis
        messages.forEach(msg => {
          if (msg.role === 'user') {
            allUserMessages.push(msg.content);
          }
        });

        totalMessages += messages.length;

        conversations.push({
          visitorId: visitorId.substring(0, 8) + '...', // Anonymize
          messageCount: messagesSnapshot.size,
          lastVisit: visitorData.lastVisit?.toDate?.()?.toISOString() || null,
          messages: messages
        });
      }
    }

    // Create a summary for the AI to analyze
    const response = {
      success: true,
      totalVisitors: visitorsSnapshot.size,
      totalMessages: totalMessages,
      conversations: conversations,
      allUserQuestions: allUserMessages.slice(0, 100), // Last 100 user messages for topic analysis
      hint: "Analyze the 'allUserQuestions' array to identify common topics and themes. Look for patterns in what visitors are asking about."
    };

    return response;
  } catch (error) {
    console.error('[Tool] Error getting link conversations:', error);
    return { success: false, error: error.message };
  }
}

// Helper function to format file size
function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Execute tool call
async function executeTool(toolName, toolArgs, userId) {
  console.log(`[Tool] Executing: ${toolName}`, toolArgs);

  switch (toolName) {
    case 'get_link_settings':
      return await handleGetLinkSettings(userId);
    case 'update_link_settings':
      return await handleUpdateLinkSettings(userId, toolArgs);
    case 'get_knowledge_base':
      return await handleGetKnowledgeBase(userId);
    case 'get_link_conversations':
      return await handleGetLinkConversations(userId, toolArgs);
    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

// ===================== MAIN HANDLER =====================

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
      hasMem0: !!process.env.MEM0_API_KEY,
      toolsEnabled: true
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

    // === SUBSCRIPTION CHECK ===
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : null;
    const accessLevel = computeAccessLevel(userData);

    if (accessLevel === 'read_only') {
      return res.status(403).json({
        success: false,
        error: 'subscription_required',
        message: 'Your trial has expired. Please subscribe to continue chatting.'
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

    // Build enhanced system prompt with memories and tool instructions
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

      // Add tool usage instructions
      enhancedPrompt += `\n\n## SETTINGS, KNOWLEDGE BASE & CONVERSATION ACCESS:
You have access to the user's link settings, knowledge base, and visitor conversations.

CRITICAL INSTRUCTIONS - READ CAREFULLY:
1. When the user asks ANYTHING about their link, settings, visitors, conversations, or knowledge base - IMMEDIATELY use the appropriate tool. Do NOT ask for permission. Do NOT explain what you could do. Just DO IT and give them the answer.

2. NEVER say things like:
   - "I'll need to use a tool..."
   - "Would you like me to fetch..."
   - "To get this information, I can..."
   - "Let me explain what I can analyze..."
   Just USE the tool silently and respond with the actual data.

3. NEVER ask "would you like me to..." - the answer is YES, they asked the question, so they want the answer!

EXAMPLES:
User: "How's my link doing?"
BAD: "Great question! I can analyze several metrics. Would you like me to fetch your visitor data?"
GOOD: [USE get_link_conversations IMMEDIATELY] "Your link has had 12 visitors this week! Most people are asking about your AI projects. Here's the breakdown..."

User: "What are my current settings?"
BAD: "I can check your settings for you. Should I do that?"
GOOD: [USE get_link_settings IMMEDIATELY] "Here are your current settings: Your link is enabled, display name is 'Alok Gautam', bio says '...'"

User: "Change my bio to something cool"
BAD: "I can update your bio. What would you like it to say?"
GOOD: [USE update_link_settings IMMEDIATELY] "Done! I've updated your bio to: 'Building the future of AI, one mindclone at a time.'"

Available tools:
- get_link_settings: View current configuration
- update_link_settings: Change settings (linkEnabled, displayName, bio, customGreeting, knowledgeBaseEnabled)
- get_knowledge_base: See uploaded documents
- get_link_conversations: Fetch visitor conversations and analyze topics

When you get conversation data, analyze the 'allUserQuestions' array to identify themes and popular topics. Present real insights from the actual data.`;

      // Add style guide
      enhancedPrompt += `\n\n${CONNOISSEUR_STYLE_GUIDE}`;

      systemInstruction = {
        parts: [{ text: enhancedPrompt }]
      };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    // Build request with tools
    const requestBody = {
      contents: contents,
      tools: tools
    };

    if (systemInstruction) {
      requestBody.systemInstruction = systemInstruction;
    }

    // Initial API call
    let response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    let data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Gemini API request failed');
    }

    // Check if model wants to call a tool
    let candidate = data.candidates?.[0];
    let maxToolCalls = 5; // Prevent infinite loops
    let toolCallCount = 0;

    while (candidate?.content?.parts?.[0]?.functionCall && toolCallCount < maxToolCalls) {
      toolCallCount++;
      const functionCall = candidate.content.parts[0].functionCall;
      console.log(`[Tool] Model requested: ${functionCall.name}`);

      // Execute the tool
      const toolResult = await executeTool(functionCall.name, functionCall.args || {}, userId);

      // Add the model's function call and our response to the conversation
      contents.push({
        role: 'model',
        parts: [{ functionCall: functionCall }]
      });

      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: functionCall.name,
            response: toolResult
          }
        }]
      });

      // Call API again with tool result
      requestBody.contents = contents;
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Gemini API request failed after tool call');
      }

      candidate = data.candidates?.[0];
    }

    // Extract final text response
    const text = candidate?.content?.parts?.[0]?.text || 'I apologize, I was unable to generate a response.';

    // === STORE NEW MEMORIES (non-blocking) ===
    // Fire-and-forget to avoid delaying the response
    if (mem0) {
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

      // Don't await - let it complete in background
      mem0.add(conversationToStore, { user_id: userId })
        .then(() => console.log(`[Mem0] Stored new memories for user ${userId}`))
        .catch(memError => console.error('[Mem0] Memory storage error:', memError));
    }

    return res.status(200).json({
      success: true,
      content: text,
      memoriesUsed: relevantMemories.length,
      toolCallsUsed: toolCallCount
    });

  } catch (error) {
    console.error('[Chat API Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate response: ' + error.message
    });
  }
};
