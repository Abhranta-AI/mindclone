// Gemini API handler with Mem0 integration and Tool Calling
const { CONNOISSEUR_STYLE_GUIDE } = require('./_style-guide');
const { MemoryClient } = require('mem0ai');
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

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
      enhancedPrompt += `\n\n## SETTINGS & KNOWLEDGE BASE ACCESS:
You have access to the user's link settings and knowledge base. You can:
1. **View settings** - Check the user's public link configuration (username, link status, display name, bio, greeting, knowledge base status)
2. **Update settings** - Change any link setting the user requests (enable/disable link, change bio, etc.)
3. **View knowledge base** - See what documents the user has uploaded

When the user asks about their link, settings, or knowledge base, use the appropriate tool.
When they want to change settings, use update_link_settings with only the fields they want to change.
After making changes, confirm what was updated and offer to help with anything else.`;

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
