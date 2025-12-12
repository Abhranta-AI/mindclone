// Gemini API handler with Tool Calling
// Memory system uses Firestore (users/{userId}/memories collection)
const { CONNOISSEUR_STYLE_GUIDE } = require('./_style-guide');
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
const { computeAccessLevel } = require('./_billing-helpers');
const { loadMentalModel, updateMentalModel, formatMentalModelForPrompt } = require('./_mental-model');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

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
      },
      {
        name: "search_memory",
        description: "Search through all past conversations to find specific information, names, topics, or context. AUTOMATICALLY use this tool when: (1) You encounter an unfamiliar name (person, place, project, pet, etc.), (2) The user asks 'remember when...', 'what did I say about...', or similar recall questions, (3) You need context about something previously discussed, (4) The user mentions something you should know but don't recognize. This searches the ACTUAL conversation history stored in the database, not just extracted memories.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search term - a name, topic, keyword, or phrase to search for in past conversations"
            },
            limit: {
              type: "number",
              description: "Maximum number of messages to return (default 20, max 50)"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "browse_url",
        description: "Fetch and read the content of a web page. Use this when the user asks you to look at a website, check a URL, read an article, or view content from the internet. Returns the text content of the page.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The full URL to fetch (must include http:// or https://)"
            }
          },
          required: ["url"]
        }
      },
      {
        name: "analyze_image",
        description: "Analyze an image from a URL using vision AI. Use this when the user asks you to look at, describe, or analyze an image, photo, or picture from the internet. Can identify objects, people, scenes, text in images, and more. For recognizing the user in photos, use the context from their knowledge base about their appearance.",
        parameters: {
          type: "object",
          properties: {
            image_url: {
              type: "string",
              description: "The full URL of the image to analyze (must be a direct image URL ending in .jpg, .png, .gif, .webp, or similar)"
            },
            question: {
              type: "string",
              description: "Optional specific question about the image (e.g., 'Is there a person in this image?', 'What products are shown?'). If not provided, will give a general description."
            }
          },
          required: ["image_url"]
        }
      },
      {
        name: "web_search",
        description: "Search the internet for current information. Use this when the user asks about recent news, current events, facts you're unsure about, or anything that might need up-to-date information from the web. This is different from browse_url - use web_search when you need to FIND information, and browse_url when you have a specific URL to visit.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query - be specific and include relevant keywords"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "save_memory",
        description: "Save an important piece of information, note, or memory that the user wants you to remember. Use this when the user asks you to 'note', 'remember', 'save', or 'keep track of' something. Good for birthdays, preferences, facts about people, reminders, or any information they want you to recall later.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The information to remember (e.g., \"Amritashva's birthday is December 12\")"
            },
            category: {
              type: "string",
              enum: ["birthday", "preference", "person", "fact", "reminder", "other"],
              description: "Category of the memory for easier retrieval"
            }
          },
          required: ["content"]
        }
      },
      {
        name: "create_pdf",
        description: "Create a PDF document with the specified content. Use this when the user asks you to create, generate, or make a PDF document, report, letter, summary, or any downloadable document. The PDF will be generated and a download link will be provided.",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The title of the PDF document (displayed at the top)"
            },
            content: {
              type: "string",
              description: "The main content/body of the PDF. Can include multiple paragraphs separated by newlines."
            },
            sections: {
              type: "array",
              description: "Optional array of sections for structured documents (reports, summaries)",
              items: {
                type: "object",
                properties: {
                  heading: {
                    type: "string",
                    description: "Section heading"
                  },
                  body: {
                    type: "string",
                    description: "Section content"
                  }
                }
              }
            },
            letterhead: {
              type: "boolean",
              description: "Set to true to include your custom letterhead with logo and company details"
            },
            logoUrl: {
              type: "string",
              description: "URL of a logo image to include in the PDF letterhead. Use this when the user shares a logo image URL and wants it in the PDF. Overrides the default letterhead logo."
            },
            logoBase64: {
              type: "string",
              description: "Base64-encoded image data for the logo. Use this when the user has shared an image in the conversation and you have access to its base64 data. This is preferred over logoUrl for images shared directly in chat."
            },
            companyName: {
              type: "string",
              description: "Company name to display in the letterhead header. Use this when the user specifies a company name like 'Olbrain Labs' or similar. Overrides the default letterhead company name."
            }
          },
          required: ["title", "content"]
        }
      },
      {
        name: "update_mental_model",
        description: "Update your understanding of the user's mental state. Call this when you infer something significant about their beliefs, goals, emotions, or knowledge gaps. Use sparingly - only for meaningful insights, not every message.",
        parameters: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["belief", "goal", "emotion", "knowledge_gap"],
              description: "Type of mental state: belief (what they think is true), goal (what they want to achieve), emotion (current emotional state), knowledge_gap (something they don't know but should)"
            },
            content: {
              type: "string",
              description: "The specific inference (e.g., 'User believes they are bad at networking', 'User wants to launch startup by Q2', 'User is feeling anxious about job search')"
            },
            confidence: {
              type: "number",
              description: "Confidence level 0-1 (0.5 = moderate, 0.8 = high, 1.0 = explicitly stated by user)"
            },
            source: {
              type: "string",
              description: "What led to this inference - quote or paraphrase what user said"
            },
            valence: {
              type: "number",
              description: "For emotions only: -1 (very negative) to 1 (very positive)"
            },
            arousal: {
              type: "number",
              description: "For emotions only: 0 (calm) to 1 (excited/agitated)"
            },
            priority: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "For goals only: priority level"
            },
            relevance: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "For knowledge_gap only: how relevant to their goals"
            }
          },
          required: ["type", "content", "confidence", "source"]
        }
      },
      {
        name: "get_mental_model",
        description: "Retrieve your current understanding of the user's mental state (beliefs, goals, emotions, knowledge gaps). Use this to inform your response when you need to be sensitive to their emotional state or tailor advice to their goals.",
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

// Search through conversation history in Firestore
async function handleSearchMemory(userId, params = {}) {
  try {
    const query = params.query;
    const limit = Math.min(params.limit || 20, 50);

    if (!query || query.trim().length === 0) {
      return { success: false, error: 'Search query is required' };
    }

    console.log(`[Memory Search] Searching for "${query}" in user ${userId}'s messages and saved memories`);

    // Get all messages (Firestore doesn't support full-text search, so we fetch and filter)
    // Fetch recent messages (last 1000) ordered by timestamp
    const messagesSnapshot = await db.collection('users').doc(userId)
      .collection('messages')
      .orderBy('timestamp', 'desc')
      .limit(1000)
      .get();

    // Also fetch saved memories
    const memoriesSnapshot = await db.collection('users').doc(userId)
      .collection('memories')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    // Search for query in message content (case-insensitive)
    const searchLower = query.toLowerCase();
    const matches = [];
    const savedMemoryMatches = [];

    // Search through saved memories first (these are explicitly saved notes)
    memoriesSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const content = data.content || '';

      if (content.toLowerCase().includes(searchLower)) {
        savedMemoryMatches.push({
          type: 'saved_memory',
          content: content,
          category: data.category || 'other',
          timestamp: data.createdAt?.toDate?.()?.toISOString() || null
        });
      }
    });

    if (savedMemoryMatches.length > 0) {
      console.log(`[Memory Search] Found ${savedMemoryMatches.length} saved memories matching "${query}"`);
    }

    if (messagesSnapshot.empty && savedMemoryMatches.length === 0) {
      return {
        success: true,
        query: query,
        matchCount: 0,
        matches: [],
        instruction: "No conversation history or saved notes found. Tell the user you don't have any record of this yet."
      };
    }

    messagesSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const content = data.content || '';

      if (content.toLowerCase().includes(searchLower)) {
        matches.push({
          role: data.role,
          content: content,
          timestamp: data.timestamp?.toDate?.()?.toISOString() || null,
          // Include a snippet with context around the match
          matchContext: extractMatchContext(content, searchLower)
        });
      }
    });

    // Return limited results, oldest first to show chronological order of mentions
    const limitedMatches = matches.slice(0, limit).reverse();

    console.log(`[Memory Search] Found ${matches.length} matches for "${query}", returning ${limitedMatches.length}`);

    // Build a summary of what we found - prioritize user messages as they contain facts
    const userMessages = limitedMatches.filter(m => m.role === 'user').map(m => m.content);

    // Total matches including saved memories
    const totalMatches = matches.length + savedMemoryMatches.length;

    // Create instruction based on results
    let instruction = '';
    if (savedMemoryMatches.length > 0) {
      // Prioritize saved memories since they are explicitly saved notes
      instruction = `IMPORTANT: You found ${savedMemoryMatches.length} SAVED NOTE(S) about "${query}" that you previously noted down. These are facts the user explicitly asked you to remember. USE THIS INFORMATION DIRECTLY to answer. Also found ${matches.length} conversation messages.`;
    } else if (matches.length > 0) {
      instruction = `IMPORTANT: You found ${matches.length} messages about "${query}". READ THE MATCHES BELOW CAREFULLY and extract the SPECIFIC FACTS to answer the user. Do NOT give vague answers like "likely" or "seems to be" - use the EXACT information from the messages. If the user asked who someone is, tell them the specific relationship. If they asked about a date, give the exact date. The user's own messages are the source of truth.`;
    } else {
      instruction = `No messages or saved notes found mentioning "${query}". You genuinely don't remember this - you haven't talked about "${query}" before. Respond naturally like a person who doesn't recognize the name: "I don't think you've mentioned Nishant to me before. Who is he?" or "Hmm, I'm not sure - have we talked about them?". Invite them to tell you more. DO NOT say "no record" or "database" or "memory search".`;
    }

    return {
      success: true,
      query: query,
      matchCount: totalMatches,
      instruction: instruction,
      // Saved memories are highest priority - these are explicit notes
      savedNotes: savedMemoryMatches.map(m => ({
        note: m.content,
        category: m.category,
        when: m.timestamp
      })),
      userSaidAboutThis: userMessages.slice(0, 5), // Most important - what user themselves said
      allMatches: limitedMatches.map(m => ({
        who: m.role === 'user' ? 'USER SAID' : 'YOU SAID',
        when: m.timestamp,
        message: m.content.substring(0, 500) // Truncate long messages
      }))
    };
  } catch (error) {
    console.error('[Tool] Error searching memory:', error);
    return { success: false, error: error.message };
  }
}

// Helper to extract context around a match
function extractMatchContext(content, searchTerm) {
  const lowerContent = content.toLowerCase();
  const matchIndex = lowerContent.indexOf(searchTerm);

  if (matchIndex === -1) return content.substring(0, 200);

  // Get 100 chars before and after the match
  const start = Math.max(0, matchIndex - 100);
  const end = Math.min(content.length, matchIndex + searchTerm.length + 100);

  let context = content.substring(start, end);
  if (start > 0) context = '...' + context;
  if (end < content.length) context = context + '...';

  return context;
}

// Save a memory/note to Firestore
async function handleSaveMemory(userId, params = {}) {
  try {
    const { content, category = 'other' } = params;

    if (!content || content.trim().length === 0) {
      return { success: false, error: 'Content is required to save a memory' };
    }

    console.log(`[Save Memory] Saving memory for user ${userId}: "${content.substring(0, 50)}..."`);

    // Save to the memories subcollection
    const memoryRef = db.collection('users').doc(userId).collection('memories');
    const docRef = await memoryRef.add({
      content: content.trim(),
      category: category,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'chat'
    });

    console.log(`[Save Memory] Memory saved with ID: ${docRef.id}`);

    return {
      success: true,
      message: `Got it!`,
      memoryId: docRef.id,
      instruction: `Memory saved successfully. DO NOT say "I've noted" or "I'll remember" - memory is automatic. Just naturally continue the conversation.`
    };
  } catch (error) {
    console.error('[Tool] Error saving memory:', error);
    return { success: false, error: error.message };
  }
}

// Browse URL - fetch and extract text from a webpage
async function handleBrowseUrl(params = {}) {
  try {
    const { url } = params;

    if (!url) {
      return { success: false, error: 'URL is required' };
    }

    // Validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { success: false, error: 'URL must use http or https protocol' };
      }
    } catch (e) {
      return { success: false, error: 'Invalid URL format' };
    }

    console.log(`[Tool] Browsing URL: ${url}`);

    // Fetch the page with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MindcloneBot/1.0; +https://mindclone.one)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        success: false,
        error: `Failed to fetch URL: HTTP ${response.status} ${response.statusText}`
      };
    }

    const contentType = response.headers.get('content-type') || '';

    // Only process text/html content
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return {
        success: false,
        error: `Cannot read this content type: ${contentType}. Only HTML and text pages are supported.`
      };
    }

    const html = await response.text();

    // Extract text content from HTML (basic extraction)
    let textContent = html
      // Remove script and style tags with their content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      // Remove all HTML tags
      .replace(/<[^>]+>/g, ' ')
      // Decode common HTML entities
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();

    // Truncate if too long (keep it manageable for the LLM)
    const maxLength = 10000;
    if (textContent.length > maxLength) {
      textContent = textContent.substring(0, maxLength) + '... [content truncated]';
    }

    // Extract title if present
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;

    return {
      success: true,
      url: url,
      title: title,
      contentLength: textContent.length,
      content: textContent,
      instruction: 'Read the webpage content above and summarize or answer questions about it. If looking for photos/images, note that I can only see text content, not actual images on the page.'
    };
  } catch (error) {
    console.error('[Tool] Error browsing URL:', error);
    if (error.name === 'AbortError') {
      return { success: false, error: 'Request timed out after 15 seconds' };
    }
    return { success: false, error: error.message };
  }
}

// Handle analyze_image tool - uses Gemini vision to analyze images from URLs
async function handleAnalyzeImage(args) {
  const { image_url, question } = args;

  if (!image_url) {
    return { success: false, error: 'image_url is required' };
  }

  console.log(`[Tool] Analyzing image: ${image_url}`);

  try {
    // Fetch the image
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20 second timeout for images

    const response = await fetch(image_url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Mindclone/1.0)',
        'Accept': 'image/*'
      }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        success: false,
        error: `Failed to fetch image: HTTP ${response.status}`
      };
    }

    const contentType = response.headers.get('content-type') || '';

    // Check if it's an image
    if (!contentType.startsWith('image/')) {
      return {
        success: false,
        error: `URL does not point to an image. Content-Type: ${contentType}`
      };
    }

    // Get image as buffer and convert to base64
    const arrayBuffer = await response.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');

    // Determine MIME type
    let mimeType = contentType.split(';')[0].trim();
    if (!mimeType.startsWith('image/')) {
      mimeType = 'image/jpeg'; // Default
    }

    // Call Gemini vision API
    const apiKey = process.env.GEMINI_API_KEY;
    const prompt = question || 'Describe this image in detail. What do you see? Include any text, people, objects, and the overall scene.';

    const visionResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Image
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 1024
          }
        })
      }
    );

    if (!visionResponse.ok) {
      const errorText = await visionResponse.text();
      console.error('[Tool] Gemini vision API error:', errorText);
      return {
        success: false,
        error: `Vision API error: ${visionResponse.status}`
      };
    }

    const visionData = await visionResponse.json();
    const analysis = visionData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!analysis) {
      return {
        success: false,
        error: 'No analysis returned from vision API'
      };
    }

    return {
      success: true,
      image_url: image_url,
      analysis: analysis,
      instruction: 'Use this image analysis to respond to the user. If they asked about recognizing someone specific (like the user or their partner), use your knowledge base context to help identify if the person in the image matches descriptions you have.'
    };

  } catch (error) {
    console.error('[Tool] Error analyzing image:', error);
    if (error.name === 'AbortError') {
      return { success: false, error: 'Image fetch timed out after 20 seconds' };
    }
    return { success: false, error: error.message };
  }
}

// Handle web_search tool - uses Perplexity API for real-time web search
async function handleWebSearch(args) {
  const { query } = args;

  if (!query) {
    return { success: false, error: 'query is required' };
  }

  console.log(`[Tool] Web search: ${query}`);

  try {
    const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
    if (!perplexityApiKey) {
      return { success: false, error: 'Web search is not configured' };
    }

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${perplexityApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful search assistant. Provide accurate, up-to-date information based on web search results. Include relevant facts, dates, and sources when available. Keep responses informative but concise.'
          },
          {
            role: 'user',
            content: query
          }
        ],
        max_tokens: 1500,
        temperature: 0.2,
        return_citations: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Tool] Perplexity API error:', response.status, errorText);
      return { success: false, error: `Search failed: ${response.status}` };
    }

    const data = await response.json();
    const searchResult = data.choices?.[0]?.message?.content || 'No results found';
    const citations = data.citations || [];

    return {
      success: true,
      query: query,
      result: searchResult,
      sources: citations,
      instruction: 'Use this search result to answer the user\'s question. The information is from a real-time web search and should be current. If there are sources/citations, you can mention them to the user.'
    };

  } catch (error) {
    console.error('[Tool] Error in web search:', error);
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

// Create PDF - generates a PDF document and uploads to Vercel Blob
async function handleCreatePdf(userId, params = {}) {
  try {
    const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
    const { put } = require('@vercel/blob');
    const { getLetterheadConfig, renderLetterhead } = require('./_letterhead');

    const { title, content, sections = [], letterhead = false, logoUrl, logoBase64: providedLogoBase64, companyName: providedCompanyName } = params;

    if (!title || !content) {
      return { success: false, error: 'Title and content are required to create a PDF' };
    }

    console.log(`[Create PDF] Creating PDF: "${title}" (letterhead: ${letterhead}, logoUrl: ${logoUrl ? 'yes' : 'no'}, logoBase64: ${providedLogoBase64 ? 'yes' : 'no'}, companyName: ${providedCompanyName || 'none'}, user: ${userId})`);

    // Create PDF document
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = 612; // Letter size
    const pageHeight = 792;
    const margin = 50;
    const maxWidth = pageWidth - (margin * 2);
    const lineHeight = 18; // Improved readability with more spacing

    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let yPosition = pageHeight - margin;

    // Render letterhead if requested (per-user config from Firestore)
    if (letterhead && userId) {
      try {
        let letterheadConfig = await getLetterheadConfig(db, userId);

        // Start with empty config if none exists but user provided logo/company name
        if (!letterheadConfig && (providedLogoBase64 || logoUrl || providedCompanyName)) {
          letterheadConfig = { companyName: '', address: '', website: '', email: '', logoBase64: '' };
        }

        // If user provided a logoBase64 directly, use it (highest priority)
        if (providedLogoBase64) {
          letterheadConfig = letterheadConfig || { companyName: '', address: '', website: '', email: '' };
          letterheadConfig.logoBase64 = providedLogoBase64;
          console.log(`[Create PDF] Using provided logoBase64 (${providedLogoBase64.length} chars)`);
        }
        // Otherwise if a logoUrl was provided, fetch it
        else if (logoUrl) {
          console.log(`[Create PDF] Fetching logo from URL: ${logoUrl}`);
          try {
            const logoResponse = await fetch(logoUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; MindcloneBot/1.0; +https://mindclone.one)'
              }
            });
            if (logoResponse.ok) {
              const logoBuffer = await logoResponse.arrayBuffer();
              const logoBase64 = Buffer.from(logoBuffer).toString('base64');
              letterheadConfig = letterheadConfig || { companyName: '', address: '', website: '', email: '' };
              letterheadConfig.logoBase64 = logoBase64;
              console.log(`[Create PDF] Logo fetched successfully (${logoBase64.length} chars base64)`);
            } else {
              console.error(`[Create PDF] Failed to fetch logo: HTTP ${logoResponse.status}`);
            }
          } catch (logoError) {
            console.error(`[Create PDF] Error fetching logo:`, logoError.message);
          }
        }

        // Override company name if provided
        if (providedCompanyName && letterheadConfig) {
          letterheadConfig.companyName = providedCompanyName;
          console.log(`[Create PDF] Using provided company name: ${providedCompanyName}`);
        }

        if (letterheadConfig) {
          yPosition = await renderLetterhead({
            page,
            pdfDoc,
            config: letterheadConfig,
            fonts: { regular: font, bold: boldFont },
            rgb,
            pageHeight,
            margin
          });
        }
      } catch (letterheadError) {
        console.error('[Create PDF] Letterhead error:', letterheadError.message);
        // Continue without letterhead if there's an error
      }
    }

    // Helper to wrap text to fit within maxWidth
    const wrapText = (text, fontSize, fontObj) => {
      const words = text.split(' ');
      const lines = [];
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = fontObj.widthOfTextAtSize(testLine, fontSize);

        if (testWidth > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);
      return lines;
    };

    // Helper to check if we need a new page
    const checkNewPage = () => {
      if (yPosition < margin + 30) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        yPosition = pageHeight - margin;
      }
    };

    // Draw title
    const titleLines = wrapText(title, 20, boldFont);
    for (const line of titleLines) {
      checkNewPage();
      page.drawText(line, {
        x: margin,
        y: yPosition,
        size: 20,
        font: boldFont,
        color: rgb(0, 0, 0)
      });
      yPosition -= 28;
    }

    yPosition -= 15; // Space after title

    // Draw main content (split by newlines into paragraphs)
    const paragraphs = content.split('\n').filter(p => p.trim());
    for (const para of paragraphs) {
      const lines = wrapText(para, 12, font);
      for (const line of lines) {
        checkNewPage();
        page.drawText(line, {
          x: margin,
          y: yPosition,
          size: 12,
          font: font,
          color: rgb(0.1, 0.1, 0.1) // Slightly softer black for readability
        });
        yPosition -= lineHeight;
      }
      yPosition -= 12; // Better paragraph spacing
    }

    // Draw sections if provided
    if (sections && sections.length > 0) {
      for (const section of sections) {
        yPosition -= 15;
        checkNewPage();

        // Section heading
        if (section.heading) {
          const headingLines = wrapText(section.heading, 14, boldFont);
          for (const line of headingLines) {
            checkNewPage();
            page.drawText(line, {
              x: margin,
              y: yPosition,
              size: 14,
              font: boldFont,
              color: rgb(0, 0, 0)
            });
            yPosition -= 20;
          }
        }

        // Section body
        if (section.body) {
          const bodyParas = section.body.split('\n').filter(p => p.trim());
          for (const para of bodyParas) {
            const lines = wrapText(para, 12, font);
            for (const line of lines) {
              checkNewPage();
              page.drawText(line, {
                x: margin,
                y: yPosition,
                size: 12,
                font: font,
                color: rgb(0.1, 0.1, 0.1)
              });
              yPosition -= lineHeight;
            }
            yPosition -= 12;
          }
        }
      }
    }

    // Add footer with generation date
    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    page.drawText(`Generated on ${dateStr}`, {
      x: margin,
      y: 30,
      size: 9,
      font: font,
      color: rgb(0.5, 0.5, 0.5)
    });

    // Save PDF to bytes
    const pdfBytes = await pdfDoc.save();

    // Generate safe filename
    const safeTitle = title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    const filename = `${safeTitle}_${Date.now()}.pdf`;

    // Upload to Vercel Blob
    const blob = await put(filename, pdfBytes, {
      access: 'public',
      contentType: 'application/pdf'
    });

    console.log(`[Create PDF] PDF uploaded successfully: ${blob.url}`);

    return {
      success: true,
      url: blob.url,
      filename: filename,
      title: title,
      message: `I've created your PDF document "${title}". You can download it using the link below.`,
      displayAction: {
        type: 'pdf_download',
        url: blob.url,
        filename: filename,
        title: title
      }
    };
  } catch (error) {
    console.error('[Create PDF] Error:', error);
    return { success: false, error: error.message };
  }
}

// Handle update_mental_model tool - update user's mental model
async function handleUpdateMentalModel(userId, params = {}) {
  try {
    const { type, content, confidence, source, valence, arousal, priority, relevance } = params;

    if (!type || !content) {
      return { success: false, error: 'Type and content are required' };
    }

    console.log(`[MentalModel] Updating ${type} for user ${userId}: "${content.substring(0, 50)}..."`);

    const update = {
      type,
      content,
      confidence: confidence || 0.7,
      source: source || 'inferred from conversation'
    };

    // Add type-specific fields
    if (type === 'emotion') {
      update.valence = valence;
      update.arousal = arousal;
    } else if (type === 'goal') {
      update.priority = priority;
    } else if (type === 'knowledge_gap') {
      update.relevance = relevance;
    }

    const result = await updateMentalModel(db, userId, update);

    return {
      success: result.success,
      message: result.success ? `Updated mental model: ${type}` : result.error,
      instruction: 'Mental model updated silently. Continue the conversation naturally without mentioning you updated the mental model.'
    };
  } catch (error) {
    console.error('[Tool] Error updating mental model:', error);
    return { success: false, error: error.message };
  }
}

// Handle get_mental_model tool - retrieve user's mental model
async function handleGetMentalModel(userId) {
  try {
    console.log(`[MentalModel] Loading mental model for user ${userId}`);

    const model = await loadMentalModel(db, userId);
    const formatted = formatMentalModelForPrompt(model);

    return {
      success: true,
      model: model,
      formatted: formatted,
      instruction: 'Use this mental model to inform your response. Be sensitive to the user\'s emotional state and tailor advice to their goals. Do NOT mention that you accessed or read the mental model.'
    };
  } catch (error) {
    console.error('[Tool] Error getting mental model:', error);
    return { success: false, error: error.message };
  }
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
    case 'search_memory':
      return await handleSearchMemory(userId, toolArgs);
    case 'browse_url':
      return await handleBrowseUrl(toolArgs);
    case 'analyze_image':
      return await handleAnalyzeImage(toolArgs);
    case 'web_search':
      return await handleWebSearch(toolArgs);
    case 'save_memory':
      return await handleSaveMemory(userId, toolArgs);
    case 'create_pdf':
      return await handleCreatePdf(userId, toolArgs);
    case 'update_mental_model':
      return await handleUpdateMentalModel(userId, toolArgs);
    case 'get_mental_model':
      return await handleGetMentalModel(userId);
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
      hasMemory: true, // Firestore-based memory system
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
    // TEMPORARILY DISABLED - All users get full access while billing is being set up
    // TODO: Re-enable billing check once Razorpay integration is complete
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : null;
    // const accessLevel = computeAccessLevel(userData);
    const accessLevel = 'full'; // Grant everyone full access for now

    // Billing check disabled - uncomment below to re-enable
    // if (accessLevel === 'read_only') {
    //   return res.status(403).json({
    //     success: false,
    //     error: 'subscription_required',
    //     message: 'Your trial has expired. Please subscribe to continue chatting.'
    //   });
    // }

    // === MENTAL MODEL LOADING ===
    // Load user's mental model for Theory of Mind capabilities
    let mentalModel = null;
    let mentalModelFormatted = '';
    try {
      mentalModel = await loadMentalModel(db, userId);
      mentalModelFormatted = formatMentalModelForPrompt(mentalModel);
      if (mentalModelFormatted) {
        console.log(`[Chat] Loaded mental model for user ${userId}`);
      }
    } catch (mentalModelError) {
      console.error('[Chat] Error loading mental model:', mentalModelError.message);
    }

    // === MEMORY RETRIEVAL ===
    // Memory is handled via search_memory tool - AI searches when needed
    let relevantMemories = [];
    let contextWindow = messages.slice(-200); // Use last 200 messages

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

      // Add mental model context if available
      if (mentalModelFormatted) {
        enhancedPrompt += '\n\n## YOUR UNDERSTANDING OF THIS USER:\n';
        enhancedPrompt += 'Use this context to inform your responses (do NOT mention this to the user):\n';
        enhancedPrompt += mentalModelFormatted;
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
- search_memory: Search through ALL past conversations to find context

When you get conversation data, analyze the 'allUserQuestions' array to identify themes and popular topics. Present real insights from the actual data.

## MEMORY SEARCH (search_memory tool):
Use search_memory to find past conversations. Call it SILENTLY (see style guide for silent tool execution rules).

WHEN TO USE:
- Unrecognized names, acronyms, or references
- Recall questions ("Remember when...", "Who is...")
- Before suggesting lifestyle activities (drinking, smoking, diet, etc.)

HOW TO USE:
1. Call with a keyword: search_memory({query: "Virika"})
2. Results include "userSaidAboutThis" and "allMatches"
3. READ the "instruction" field - it tells you what to do
4. Give CONFIDENT answers from the data - never "seems to be" or "likely"

IF NO RESULTS:
- Say "I don't think you've mentioned [name] before - who is that?"
- NEVER say "I couldn't find anything in my records"

## BROWSING WEBSITES (browse_url tool):
You can browse websites using the browse_url tool.

**CRITICAL RULES FOR browse_url:**
1. NEVER say "let me look at that website" or "I'll take a look" or "one moment while I check" BEFORE calling the tool
2. Just SILENTLY call browse_url and then respond with what you found
3. If the browse_url tool fails or times out, DON'T keep promising to look - just say "I couldn't access that website right now."
4. NEVER ask the user to wait or come back later - give an immediate response

EXAMPLES:
User: "Go to myBorosil.com and see my photos"
BAD: "I will certainly take a look. One moment while I gather my thoughts." (NEVER DO THIS)
BAD: "Let me check that website for you." (NEVER DO THIS)
GOOD: [silently call browse_url({url: "https://myborosil.com"}), then respond:] "I checked myBorosil.com! I saw [actual content from the page]."

If browse_url fails:
BAD: "I'm still trying to access the website..." or "Let me try again..."
GOOD: "I couldn't access myBorosil.com right now - the page didn't load. Can you tell me what you wanted me to see?"

## WEB SEARCHING (web_search tool):
You can search the internet for current information using the web_search tool. Use this when:
- The user asks about recent news or current events
- The user asks for up-to-date information you might not have
- The user wants to research something or learn about a topic
- The user says "search for", "look up", "find out about", "what's the latest on"

**CRITICAL RULES FOR web_search:**
1. NEVER announce you're searching - just silently call the tool and respond with the results
2. Use web_search when you DON'T have a specific URL - it finds information for you
3. Use browse_url when you DO have a specific URL to visit
4. If web_search fails, be honest: "I couldn't search for that right now."

EXAMPLES:
User: "What's happening with AI lately?"
GOOD: [silently call web_search({query: "latest AI news December 2024"}), then respond:] "Here's what's happening in AI..."

User: "Search for the best restaurants in Mumbai"
GOOD: [silently call web_search({query: "best restaurants Mumbai 2024"}), then respond:] "I found some great options..."

User: "Go to life3h.com"
GOOD: [silently call browse_url({url: "https://life3h.com"}), NOT web_search] - because there's a specific URL

## WHEN IN DOUBT, SEARCH - CRITICAL FALLBACK RULE:
If you're unsure how to answer a question or feel like you're about to give a vague/generic response, USE web_search INSTEAD. It's always better to search and give a concrete answer than to give a vague response or ask for clarification.

NEVER respond with:
- "I need a moment to gather my thoughts"
- "Could you rephrase that?"
- "I'm not sure what you mean"
- Any other stalling/deflecting response

If you're stuck or uncertain, IMMEDIATELY call web_search with a refined version of the user's question. More searches are always better than vague answers.

EXAMPLE - Follow-up questions after a search:
User: "Search for AI identity companies"
You: [search and return results about DeepMind, Anthropic, etc.]
User: "Who's the top player?"
BAD: "I need a moment to gather my thoughts" or "Could you clarify?"
GOOD: [call web_search({query: "top AI identity company market leader most funded 2024"})] - then give a concrete answer

The rule is simple: When uncertain, SEARCH. Never deflect.`;



      // Add style guide
      enhancedPrompt += `\n\n${CONNOISSEUR_STYLE_GUIDE}`;

      // Add current date/time context for time awareness
      const currentDate = new Date();
      enhancedPrompt += `\n\n## CURRENT DATE/TIME:
Today is ${currentDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
Current time: ${currentDate.toLocaleTimeString('en-US')}
Use this to understand time references like "yesterday", "next week", "this month", etc.`;

      systemInstruction = {
        parts: [{ text: enhancedPrompt }]
      };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

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
    let usedMemorySearch = false; // Track if search_memory was called for UI animation
    let pendingMessage = null; // Text before tool calls (e.g., "Let me check...")
    let usedTool = null; // Track which tool was used

    // Check for function call in any part (not just parts[0])
    const findFunctionCall = (parts) => parts?.find(p => p.functionCall)?.functionCall;
    const findText = (parts) => parts?.filter(p => p.text).map(p => p.text).join('');

    let functionCall = findFunctionCall(candidate?.content?.parts);

    while (functionCall && toolCallCount < maxToolCalls) {
      toolCallCount++;
      console.log(`[Tool] Model requested: ${functionCall.name}`);

      // Capture any text that came with this tool call as "pending message"
      // Only capture on first tool call
      if (toolCallCount === 1) {
        const textBefore = findText(candidate?.content?.parts);
        if (textBefore) {
          pendingMessage = textBefore;
          console.log(`[Tool] Pending message: "${pendingMessage.substring(0, 50)}..."`);
        }
        usedTool = functionCall.name;
      }

      // Track if memory search was used (for "recalling" UI animation)
      if (functionCall.name === 'search_memory') {
        usedMemorySearch = true;
      }

      // Execute the tool
      const toolResult = await executeTool(functionCall.name, functionCall.args || {}, userId);

      // Add the model's function call and our response to the conversation
      // For Gemini 3 Pro, we must pass back the entire original parts array
      // This preserves thought signatures and other metadata exactly as received
      contents.push({
        role: 'model',
        parts: candidate.content.parts
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
      functionCall = findFunctionCall(candidate?.content?.parts);
    }

    // Extract final text response (use findText to handle multi-part responses)
    let text = findText(candidate?.content?.parts) || '';

    // === AUTO-RETRY LOGIC ===
    // If Gemini returns empty or "unable to generate" response, silently retry with a nudge
    const isFailedResponse = !text ||
                             text.includes('unable to generate') ||
                             text.includes('I apologize') && text.includes('unable') ||
                             text.trim().length < 5;

    if (isFailedResponse && toolCallCount === 0) {
      console.log('[Auto-Retry] Detected failed/empty response, attempting silent retry...');

      // Add a gentle nudge to the conversation
      contents.push({
        role: 'model',
        parts: [{ text: 'Let me think about this more carefully.' }]
      });
      contents.push({
        role: 'user',
        parts: [{ text: 'Please continue with your thoughts.' }]
      });

      // Retry the API call
      requestBody.contents = contents;
      const retryResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      const retryData = await retryResponse.json();

      if (retryResponse.ok) {
        const retryCandidate = retryData.candidates?.[0];
        const retryText = findText(retryCandidate?.content?.parts);

        if (retryText && retryText.trim().length > 5 && !retryText.includes('unable to generate')) {
          console.log('[Auto-Retry] Retry successful, using new response');
          text = retryText;
        } else {
          console.log('[Auto-Retry] Retry also failed, using fallback');
          text = text || 'I need a moment to gather my thoughts. Could you rephrase that?';
        }
      } else {
        console.log('[Auto-Retry] Retry request failed:', retryData.error?.message);
        text = text || 'I need a moment to gather my thoughts. Could you rephrase that?';
      }
    }

    // Final fallback if still empty
    if (!text || text.trim().length < 5) {
      text = 'I need a moment to gather my thoughts. Could you rephrase that?';
    }

    // === MEMORY STORAGE ===
    // Memory storage handled via save_memory tool when AI decides to save

    return res.status(200).json({
      success: true,
      content: text,
      memoriesUsed: relevantMemories.length,
      toolCallsUsed: toolCallCount,
      usedMemorySearch: usedMemorySearch, // For frontend "recalling" animation
      pendingMessage: pendingMessage, // "Promise" message before tool execution
      usedTool: usedTool // Which tool was used (browse_url, search_memory, etc.)
    });

  } catch (error) {
    console.error('[Chat API Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate response: ' + error.message
    });
  }
};
