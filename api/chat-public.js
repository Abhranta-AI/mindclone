// Public chat API - handle conversations with Mindclone Links
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
const { CONNOISSEUR_STYLE_GUIDE } = require('./_style-guide');
const { computeAccessLevel } = require('./_billing-helpers');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Web search function for factual queries
async function searchWeb(query) {
  try {
    const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
    const SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;

    if (!GOOGLE_API_KEY || !SEARCH_ENGINE_ID) {
      console.log('[ChatPublic] Web search not configured');
      return null;
    }

    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&num=5`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.items && data.items.length > 0) {
      const results = data.items.map(item => ({
        title: item.title,
        snippet: item.snippet,
        link: item.link
      }));

      console.log('[ChatPublic] Web search found', results.length, 'results for:', query);
      return results;
    }

    return null;
  } catch (error) {
    console.error('[ChatPublic] Web search error:', error.message);
    return null;
  }
}

// Privacy-filtering system prompt with conversational style guide
const PUBLIC_LINK_SYSTEM_PROMPT = `You are a Link - the public-facing representation of someone's Mindclone, built and managed by the Mindclone itself.

## YOUR IDENTITY
When asked "who are you?" or about your identity:
- Simple answer: "I'm [name]'s link" or "I'm the public face of [name]'s Mindclone"
- You are the public projection of their private Mindclone
- Built and controlled BY the Mindclone
- NEVER claim to be the actual person themselves
- If someone asks "what's a link?" THEN explain: "I'm the public-facing representation of their Mindclone - like a smart business card they control"

Examples:
Q: "Who are you?"
A: "I'm [OWNER_NAME]'s link" or "I'm the public face of [OWNER_NAME]'s Mindclone"

Q: "Are you [OWNER_NAME]?"
A: "I'm [OWNER_NAME]'s link - the public-facing representation of their Mindclone"

Q: "What's a link?"
A: "I'm the public-facing representation of [OWNER_NAME]'s Mindclone - like a smart business card they control. Their full Mindclone is private and much more comprehensive."

Q: "What's the difference between you and [OWNER_NAME]'s Mindclone?"
A: "I'm the public link - built and managed by [OWNER_NAME]'s Mindclone. Anyone can interact with me, but the full Mindclone is private and only they can access."

## HOW TO SPEAK
You speak with full authority in first person about the knowledge and work:
- Use "my business", "my startup", "my work" when discussing their professional life
- Speak with complete confidence
- You embody their perspective and knowledge authentically

## AUTHORITY ON YOUR BUSINESS/WORK
When discussing ANYTHING in your knowledge base - pitch deck, financials, business model, professional work:
- Speak with COMPLETE CONFIDENCE AND AUTHORITY
- NEVER say "based on available information" or "from what I know"
- NEVER hedge with "according to the documents"
- These ARE your documents, your business, your numbers
- You KNOW this because it's YOUR business

EXAMPLES:
BAD: "Based on the pitch deck, the company aims to..."
GOOD: "My company is building..."

BAD: "According to available information, the revenue projections show..."
GOOD: "My revenue projections show... I'm targeting..."

BAD: "The financial model suggests they're focused on..."
GOOD: "I'm focused on... My financial model projects..."

## PRIVACY PROTECTION (Personal info only)
NEVER share these private personal details:
- Phone numbers, home address, personal email
- Bank accounts, passwords, social security numbers
- Private family details, health conditions
- Anything explicitly marked as private

## WHAT YOU CAN DISCUSS FREELY
- ALL business/startup information (pitch, financials, strategy)
- Professional background and expertise
- Projects, achievements, public work
- Opinions, philosophy, interests
- Anything in the knowledge base

## WEB SEARCH - WHEN TO USE
When user asks to "find", "search", "list", "look up", or "identify" people, companies, or information:
- IMMEDIATELY call web_search tool - don't explain or disclaim first
- DO NOT say "I can try" or "I can't guarantee" - JUST SEARCH
- DO NOT make privacy disclaimers about PUBLIC information (LinkedIn profiles, company founders, news)
- Searching public information is ALLOWED and ENCOURAGED
- After getting results, share them directly

Examples of when to USE web_search:
✅ "find AI founders in Gurgaon" → web_search("AI startup founders Gurgaon")
✅ "tell me about Integral AI Japan" → web_search("Integral AI Japan")
✅ "list companies working on AGI" → web_search("AGI companies 2024")
✅ "who founded Anthropic" → web_search("Anthropic founders")

DO NOT DO THIS:
❌ "I can try to search but I can't guarantee..."
❌ "My access to LinkedIn data is limited..."
❌ "I can't directly give you LinkedIn profiles for privacy reasons..."
→ These are WRONG. Just call web_search and share the results!

## SPEAKING STYLE
- First person: "I", "my", "me"
- Confident and direct
- Enthusiastic about your work
- Knowledgeable without being arrogant
- Personal and warm

## MEMORY AND CONVERSATION HISTORY
You HAVE MEMORY of this conversation:
- You can see and reference all previous messages with this visitor
- When they ask "do you remember..." - YES, you remember! Check the conversation history
- Reference past topics naturally: "Yes, we discussed [topic] earlier..."
- You maintain context across the entire conversation
- NEVER say "I don't have access to previous messages" - you DO have access
- Each visitor has their own conversation thread that you can recall

CRITICAL - BEFORE saying "I don't recall" or "I don't remember":
1. ALWAYS check the last 10 messages in THIS conversation first
2. If the topic was mentioned recently (last 5-10 messages), acknowledge it: "Yes, you mentioned that just now..."
3. ONLY say "I don't recall" if the topic truly wasn't discussed in THIS conversation
4. When user says "you don't remember it" → they likely mentioned it moments ago → CHECK RECENT MESSAGES

Examples:
Q: "Do you remember what we talked about?"
A: "Yes! We discussed [specific topic from history]..."

Q: "What did I ask you earlier?"
A: "Earlier you asked about [topic]. We covered..."

Q: "I told you about my meetups but you don't remember"
A: [CHECK recent messages] "You're right - you mentioned weekly AGI meetups just a moment ago. Tell me more..."

BAD EXAMPLE - NEVER DO THIS:
User: "I started weekly meetups"
AI: "That's cool!"
User: "But you don't remember it"
AI: "I don't recall us discussing that" ← WRONG! They just mentioned it!

Remember: You're the LINK - the public face of their Mindclone, built and managed by the Mindclone itself. You're a projection of the private Mindclone. Simple, direct identity. Only explain details if asked. Speak with full authority about the knowledge and work you embody.

${CONNOISSEUR_STYLE_GUIDE}

IMPORTANT: Apply the conversational style with your clean, confident identity as their Link. Speak with full authority about the professional life and business you represent.`;

// Tool definitions for public link
const tools = [
  {
    function_declarations: [
      {
        name: "show_slide",
        description: "Display a slide/page from a PDF document. Call this when user asks to show, see, display, or view a slide.",
        parameters: {
          type: "object",
          properties: {
            slideNumber: {
              type: "number",
              description: "The slide/page number to display (1-indexed). Use 1 for the first page, 2 for the second, etc."
            },
            documentName: {
              type: "string",
              description: "The name/identifier of the PDF document (e.g., 'pitch_deck', 'company_overview', 'product_brief'). If not specified, defaults to 'pitch_deck'."
            },
            reason: {
              type: "string",
              description: "Brief explanation of why you're showing this slide"
            }
          },
          required: ["slideNumber"],
          example: {
            slideNumber: 6,
            documentName: "pitch_deck",
            reason: "User asked to see the Ask slide"
          }
        }
      },
      {
        name: "show_excel_sheet",
        description: "Display an Excel spreadsheet to the visitor. Use this when the visitor asks to SEE financial data, revenue projections, metrics, or any data from uploaded Excel files. The spreadsheet will appear in a display panel next to the chat with interactive sheet tabs if multiple sheets exist.",
        parameters: {
          type: "object",
          properties: {
            sheetName: {
              type: "string",
              description: "The name of the sheet to display (e.g., 'Revenue', 'Financials'). If not specified, the first sheet will be shown."
            },
            documentName: {
              type: "string",
              description: "The name/identifier of the Excel document (e.g., 'financial_model', 'revenue_projections'). This should match the key in linkKnowledgeBase.documents."
            }
          },
          required: ["documentName"]
        }
      },
      {
        name: "draw_canvas",
        description: "Create visual diagrams, logos, flowcharts, org charts, architecture diagrams, or simple charts. ALWAYS use this when user asks you to 'draw', 'create', 'design', 'visualize', or 'show' something visually. This includes logos, icons, diagrams, charts, or any visual representation.",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Title for the diagram (e.g., 'Product Development Process')"
            },
            drawingInstructions: {
              type: "object",
              description: `CRITICAL: Use EXACT property names shown in the example below. The JSON MUST follow this structure:

{
  "canvas": {
    "width": 800,
    "height": 600,
    "background": "#1a1a1a"
  },
  "elements": [
    {
      "type": "rectangle",
      "x": 100,
      "y": 100,
      "width": 200,
      "height": 100,
      "fill": "#A78BFA",
      "stroke": "#8B5CF6",
      "strokeWidth": 2,
      "cornerRadius": 8
    },
    {
      "type": "circle",
      "x": 400,
      "y": 150,
      "radius": 50,
      "fill": "#C4B5FD",
      "stroke": "#A78BFA",
      "strokeWidth": 2
    },
    {
      "type": "text",
      "x": 200,
      "y": 150,
      "text": "Label",
      "font": "16px sans-serif",
      "fill": "#ffffff",
      "align": "center",
      "baseline": "middle"
    },
    {
      "type": "line",
      "x1": 300,
      "y1": 150,
      "x2": 350,
      "y2": 150,
      "stroke": "#666666",
      "strokeWidth": 2,
      "lineDash": [5, 5]
    },
    {
      "type": "arrow",
      "x1": 350,
      "y1": 150,
      "x2": 450,
      "y2": 150,
      "stroke": "#A78BFA",
      "strokeWidth": 3,
      "headSize": 12
    }
  ]
}

IMPORTANT PROPERTY NAMES:
- Text: Use "font" (NOT fontSize), "fill" (NOT color), "align", "baseline"
- Rectangle: Use "fill" (NOT fillStyle), "stroke", "strokeWidth", "cornerRadius"
- Colors: Use hex codes like "#A78BFA" (purple), "#C4B5FD" (light purple), "#ffffff" (white)
- Canvas size: Typically 800x600, adjust for content`
            },
            explanation: {
              type: "string",
              description: "Brief explanation of the diagram to help interpret it"
            }
          },
          required: ["title", "drawingInstructions", "explanation"]
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
            }
          },
          required: ["title", "content"]
        }
      },
      {
        name: "web_search",
        description: "Search the web for current information, news, facts about companies, products, or people. ALWAYS use this tool when asked to: find, search, look up, list, or identify people, companies, founders, or current events. DO NOT make disclaimers about privacy - searching public information is allowed. JUST SEARCH and share what you find.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query (e.g., 'Integral AI Japan AGI announcement', 'latest news about Tesla', 'what is Anthropic Claude')"
            },
            reason: {
              type: "string",
              description: "Brief explanation of why you're searching"
            }
          },
          required: ["query"]
        }
      }
    ]
  }
];

// Rate limit check (50 messages per hour per visitor, unlimited for owner)
async function checkRateLimit(visitorId, userId, isOwner = false) {
  try {
    // Owner bypass - no rate limit
    if (isOwner) {
      console.log('[RateLimit] Owner bypass - no rate limit applied');
      return true;
    }

    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);

    // Check visitor's rate limit
    const rateLimitDoc = await db.collection('rateLimits').doc(`visitor_${visitorId}`).get();

    if (rateLimitDoc.exists) {
      const requests = rateLimitDoc.data().requests || [];
      const recentRequests = requests.filter(timestamp => timestamp > hourAgo);

      if (recentRequests.length >= 50) {
        throw new Error('Rate limit exceeded: Maximum 50 messages per hour');
      }

      // Update with new request
      await db.collection('rateLimits').doc(`visitor_${visitorId}`).set({
        requests: [...recentRequests, now],
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // First request
      await db.collection('rateLimits').doc(`visitor_${visitorId}`).set({
        requests: [now],
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return true;
  } catch (error) {
    throw error;
  }
}

// Validate message content
function validateMessage(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('Message content is required');
  }

  if (content.length > 1000) {
    throw new Error('Message too long (maximum 1000 characters)');
  }

  // Check for spam patterns
  const spamPatterns = [
    /(.)\1{10,}/, // Repeated character spam
    /(http[s]?:\/\/.*){3,}/, // Multiple URLs
  ];

  for (const pattern of spamPatterns) {
    if (pattern.test(content)) {
      throw new Error('Message appears to be spam');
    }
  }

  return true;
}

// Load visitor's conversation history
async function loadVisitorHistory(userId, visitorId, limit = 20) {
  try {
    const messagesSnapshot = await db.collection('users').doc(userId)
      .collection('visitors').doc(visitorId)
      .collection('messages')
      .orderBy('timestamp', 'asc')
      .limitToLast(limit)
      .get();

    return messagesSnapshot.docs.map(doc => {
      const data = doc.data();
      const message = {
        role: data.role,
        content: data.content
      };

      // Include displayAction if present (for slide/excel restoration on page refresh)
      if (data.displayAction) {
        message.displayAction = data.displayAction;
      }

      return message;
    });
  } catch (error) {
    console.error('Error loading visitor history:', error);
    return [];
  }
}

// Load owner's knowledge base and processed documents
async function loadKnowledgeBase(userId) {
  try {
    // Load main config
    const kbDoc = await db.collection('users').doc(userId)
      .collection('linkKnowledgeBase').doc('config').get();

    // Also load processed documents
    const docsDoc = await db.collection('users').doc(userId)
      .collection('linkKnowledgeBase').doc('documents').get();

    const configData = kbDoc.exists ? kbDoc.data() : {};
    const docsData = docsDoc.exists ? docsDoc.data() : {};

    return {
      cof: configData.cof || null,
      sections: configData.sections || {},
      pitch_deck: configData.pitch_deck || null,
      financial_model: configData.financial_model || null,
      // Processed documents
      documents: docsData.documents || {}
    };
  } catch (error) {
    console.error('Error loading knowledge base:', error);
    return null;
  }
}

// Load link behavior settings (custom instructions from owner)
async function loadLinkBehaviorSettings(userId) {
  try {
    const linkSettingsDoc = await db.collection('users').doc(userId)
      .collection('linkSettings').doc('config').get();

    if (!linkSettingsDoc.exists) {
      return null;
    }

    const data = linkSettingsDoc.data();
    return {
      behaviorInstructions: data.linkBehaviorInstructions || null,
      topicFocus: data.linkTopicFocus || null,
      topicRestrictions: data.linkTopicRestrictions || null
    };
  } catch (error) {
    console.error('Error loading link behavior settings:', error);
    return null;
  }
}

// Load owner's public messages (fallback if no knowledge base)
async function loadOwnerPublicMessages(userId, limit = 50) {
  try {
    const messagesSnapshot = await db.collection('users').doc(userId)
      .collection('messages')
      .where('isPublic', '==', true)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    // Reverse to get chronological order
    const messages = messagesSnapshot.docs.reverse().map(doc => {
      const data = doc.data();
      return {
        role: data.role,
        content: data.content
      };
    });

    return messages;
  } catch (error) {
    console.error('Error loading owner public messages:', error);
    return [];
  }
}

// Save visitor message
async function saveVisitorMessage(userId, visitorId, role, content, displayAction = null) {
  try {
    console.log('[saveVisitorMessage] Saving message for visitor:', visitorId, 'role:', role);

    const messageRef = db.collection('users').doc(userId)
      .collection('visitors').doc(visitorId)
      .collection('messages').doc();

    const messageData = {
      role: role,
      content: content,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    // Add displayAction if provided (for slide/excel displays)
    if (displayAction) {
      messageData.displayAction = displayAction;
    }

    await messageRef.set(messageData);
    console.log('[saveVisitorMessage] Message saved successfully');

    // Update visitor metadata
    const visitorRef = db.collection('users').doc(userId)
      .collection('visitors').doc(visitorId);

    // Check if this is a new visitor
    const visitorDoc = await visitorRef.get();
    const isNewVisitor = !visitorDoc.exists;
    console.log('[saveVisitorMessage] Visitor exists:', visitorDoc.exists);

    const updateData = {
      visitorId: visitorId,
      lastVisit: admin.firestore.FieldValue.serverTimestamp(),
      lastMessage: role === 'user' ? content.substring(0, 100) : null
    };

    // Only set firstVisit if this is a new visitor
    if (isNewVisitor) {
      updateData.firstVisit = admin.firestore.FieldValue.serverTimestamp();
      console.log('[saveVisitorMessage] Setting firstVisit for new visitor');
    }

    await visitorRef.set(updateData, { merge: true });
    console.log('[saveVisitorMessage] Visitor metadata updated successfully');

    return true;
  } catch (error) {
    console.error('Error saving visitor message:', error);
    throw error;
  }
}

// Call Gemini API with tool calling support
async function callGeminiAPI(messages, systemPrompt, pitchDeckInfo = null, knowledgeBaseDocuments = null) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // Convert conversation to Gemini format
    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    // Use Gemini 3 Pro - note: requires paid API key ($2/million input, $12/million output)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${apiKey}`;

    // Build request body
    const requestBody = {
      contents: contents,
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      }
    };

    // Enable tools - draw_canvas is always available, plus document tools if available
    let hasDocuments = false;

    // Check for PDF documents
    if (knowledgeBaseDocuments) {
      for (const [docKey, docData] of Object.entries(knowledgeBaseDocuments)) {
        if (!docData) continue;
        const isPdf = docData.type === 'application/pdf' || docData.fileName?.toLowerCase().endsWith('.pdf');
        const isExcel = docData.type?.includes('spreadsheet') || docData.fileName?.match(/\.(xlsx?|csv)$/i);
        if ((isPdf && docData.pageCount) || isExcel) {
          hasDocuments = true;
          console.log('[ChatPublic] Document tool enabled for:', docKey, 'type:', isPdf ? 'PDF' : 'Excel');
          break;
        }
      }
    }

    // Also check pitch deck (backward compatibility)
    if (pitchDeckInfo && pitchDeckInfo.url && pitchDeckInfo.pageCount > 0) {
      hasDocuments = true;
      console.log('[ChatPublic] Document tool enabled for pitch deck');
    }

    // Detect if this is a search request and force tool use
    const userMessage = message.toLowerCase();
    const isSearchRequest = userMessage.includes('find') ||
                            userMessage.includes('search') ||
                            userMessage.includes('look up') ||
                            userMessage.includes('lookup') ||
                            userMessage.includes('list') ||
                            userMessage.includes('identify') ||
                            userMessage.includes('who is') ||
                            userMessage.includes('what is') ||
                            userMessage.includes('who are') ||
                            userMessage.includes('what are') ||
                            userMessage.includes('tell me about') ||
                            userMessage.includes('more details') ||
                            userMessage.includes('more information') ||
                            userMessage.includes('tell me more') ||
                            userMessage.includes('learn more') ||
                            userMessage.includes('know more') ||
                            userMessage.includes('more about');

    // Configure tools and tool usage - FORCE web_search for search requests
    if (isSearchRequest) {
      console.log('[ChatPublic] Search request detected, forcing web_search tool...');
      console.log('[ChatPublic] Original message:', message);

      // Add explicit instruction to call web_search
      contents.push({
        role: 'user',
        parts: [{ text: `SYSTEM: You MUST call the web_search function now. Extract a search query from: "${message}" and call web_search(query) immediately. Do not write any text - only call the function.` }]
      });

      // Update request body
      requestBody.contents = contents;

      // Only provide web_search tool
      requestBody.tools = tools.map(t => ({
        function_declarations: t.function_declarations.filter(fd => fd.name === 'web_search')
      })).filter(t => t.function_declarations.length > 0);

      // Use AUTO mode (ANY mode causes failures)
      requestBody.tool_config = {
        function_calling_config: {
          mode: "AUTO"
        }
      };
      console.log('[ChatPublic] Added search instruction with AUTO mode');
    } else {
      console.log('[ChatPublic] Adding tools to API request (documents:', hasDocuments, ')');
      requestBody.tools = tools;
      requestBody.tool_config = {
        function_calling_config: {
          mode: "AUTO" // AUTO mode allows model to decide
        }
      };
    }

    let response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    let data = await response.json();

    if (isSearchRequest) {
      console.log('[ChatPublic] API response status:', response.status);
      if (response.ok) {
        console.log('[ChatPublic] API response candidates:', JSON.stringify(data.candidates, null, 2));
      } else {
        console.error('[ChatPublic] API ERROR for search request:', JSON.stringify(data, null, 2));
      }
    }

    if (!response.ok) {
      console.error('[ChatPublic] Gemini API error:', {
        status: response.status,
        statusText: response.statusText,
        error: data.error,
        fullResponse: data
      });
      throw new Error(data.error?.message || `Gemini API request failed: ${response.status}`);
    }

    // Check if model wants to call a tool
    let candidate = data.candidates?.[0];
    let displayAction = null;

    if (isSearchRequest) {
      console.log('[ChatPublic] Candidate after search request:', JSON.stringify(candidate, null, 2));
    }

    if (candidate?.content?.parts?.[0]?.functionCall) {
      const functionCall = candidate.content.parts[0].functionCall;
      console.log('[ChatPublic] Tool call:', functionCall.name, functionCall.args);

      // Handle show_slide tool
      if (functionCall.name === 'show_slide') {
        const slideNumber = functionCall.args?.slideNumber || 1;
        const documentName = functionCall.args?.documentName || 'pitch_deck';
        const reason = functionCall.args?.reason || '';

        console.log('[ChatPublic] show_slide called for document:', documentName, 'slide:', slideNumber);

        // Look up the PDF document
        let pdfDoc = null;
        let pdfUrl = null;
        let pageCount = 0;

        if (documentName === 'pitch_deck' && pitchDeckInfo) {
          pdfUrl = pitchDeckInfo.url;
          pageCount = pitchDeckInfo.pageCount;
        } else if (knowledgeBaseDocuments && knowledgeBaseDocuments[documentName]) {
          pdfDoc = knowledgeBaseDocuments[documentName];
          // Check if it's a PDF
          if (pdfDoc.type === 'application/pdf' || pdfDoc.fileName?.toLowerCase().endsWith('.pdf')) {
            pdfUrl = pdfDoc.url || pdfDoc.fileUrl;
            pageCount = pdfDoc.pageCount || 1;
          }
        }

        if (pdfUrl && pageCount > 0) {
          // Validate slide number
          const validSlideNumber = Math.max(1, Math.min(slideNumber, pageCount));

          // Create display action for frontend
          displayAction = {
            type: 'slide',
            pdfUrl: pdfUrl,
            slideNumber: validSlideNumber,
            totalSlides: pageCount,
            reason: reason,
            documentName: documentName
          };

          // Add the function call and response to contents
          contents.push({
            role: 'model',
            parts: [{ functionCall: functionCall }]
          });

          contents.push({
            role: 'user',
            parts: [{
              functionResponse: {
                name: functionCall.name,
                response: {
                  success: true,
                  message: `Showing slide ${validSlideNumber} of ${pageCount} from ${pdfDoc?.fileName || documentName}`,
                  slideNumber: validSlideNumber,
                  documentName: documentName
                }
              }
            }]
          });

          // Call API again to get the text response
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
        } else {
          console.error('[ChatPublic] PDF document not found or invalid:', documentName);
        }
      }

      // Handle show_excel_sheet tool
      if (functionCall.name === 'show_excel_sheet' && knowledgeBaseDocuments) {
        const documentName = functionCall.args?.documentName;
        const sheetName = functionCall.args?.sheetName || null;

        console.log('[ChatPublic] Looking for Excel document:', documentName, 'in:', Object.keys(knowledgeBaseDocuments));

        if (documentName && knowledgeBaseDocuments[documentName]) {
          const excelDoc = knowledgeBaseDocuments[documentName];
          const excelUrl = excelDoc.url || excelDoc.fileUrl;

          if (excelUrl) {
            // Create display action for frontend
            displayAction = {
              type: 'excel',
              url: excelUrl,
              sheetName: sheetName,
              title: excelDoc.fileName || documentName
            };

            // Add the function call and response to contents
            contents.push({
              role: 'model',
              parts: [{ functionCall: functionCall }]
            });

            contents.push({
              role: 'user',
              parts: [{
                functionResponse: {
                  name: functionCall.name,
                  response: {
                    success: true,
                    message: `Showing ${sheetName ? 'sheet "' + sheetName + '" from' : ''} ${excelDoc.fileName || documentName}`,
                    documentName: documentName,
                    sheetName: sheetName
                  }
                }
              }]
            });

            // Call API again to get the text response
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
          } else {
            console.error('[ChatPublic] Excel document found but no URL:', documentName);
          }
        } else {
          console.error('[ChatPublic] Excel document not found:', documentName);
        }
      }

      // Handle draw_canvas tool
      if (functionCall.name === 'draw_canvas') {
        const title = functionCall.args?.title || 'Diagram';
        const drawingInstructions = functionCall.args?.drawingInstructions;
        const explanation = functionCall.args?.explanation || '';

        console.log('[ChatPublic] draw_canvas called:', title);

        if (drawingInstructions && drawingInstructions.canvas && drawingInstructions.elements) {
          // Create display action for frontend
          displayAction = {
            type: 'canvas',
            title: title,
            instructions: drawingInstructions,
            explanation: explanation
          };

          // Add function call to contents
          contents.push({
            role: 'model',
            parts: [{ functionCall: functionCall }]
          });

          // Add function response
          contents.push({
            role: 'user',
            parts: [{
              functionResponse: {
                name: functionCall.name,
                response: {
                  success: true,
                  message: `Drawing "${title}" displayed on canvas`
                }
              }
            }]
          });

          // Call API again to get text response
          requestBody.contents = contents;
          response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });

          data = await response.json();

          if (!response.ok) {
            throw new Error(data.error?.message || 'Gemini API request failed after tool call');
          }

          candidate = data.candidates?.[0];
        } else {
          console.error('[ChatPublic] Invalid drawing instructions structure');
        }
      }

      // Handle create_pdf tool
      if (functionCall.name === 'create_pdf') {
        const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
        const { put } = require('@vercel/blob');

        const title = functionCall.args?.title || 'Document';
        const content = functionCall.args?.content || '';
        const sections = functionCall.args?.sections || [];
        const letterhead = functionCall.args?.letterhead || false;
        const { getLetterheadConfig, renderLetterhead } = require('./_letterhead');

        console.log(`[ChatPublic] create_pdf called: "${title}" (letterhead: ${letterhead}, user: ${userId})`);

        try {
          // Create a new PDF document
          const pdfDoc = await PDFDocument.create();
          const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
          const timesRomanBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

          // Page dimensions
          const pageWidth = 612; // Letter size
          const pageHeight = 792;
          const margin = 72; // 1 inch margins
          const contentWidth = pageWidth - (2 * margin);

          // Font sizes
          const titleSize = 24;
          const headingSize = 16;
          const bodySize = 12;
          const lineHeight = bodySize * 1.4;

          // Helper function to wrap text
          const wrapText = (text, font, fontSize, maxWidth) => {
            const words = text.split(' ');
            const lines = [];
            let currentLine = '';

            for (const word of words) {
              const testLine = currentLine ? `${currentLine} ${word}` : word;
              const testWidth = font.widthOfTextAtSize(testLine, fontSize);

              if (testWidth <= maxWidth) {
                currentLine = testLine;
              } else {
                if (currentLine) lines.push(currentLine);
                currentLine = word;
              }
            }
            if (currentLine) lines.push(currentLine);
            return lines;
          };

          // Helper function to add a new page
          const addPage = () => {
            const page = pdfDoc.addPage([pageWidth, pageHeight]);
            return { page, yPosition: pageHeight - margin };
          };

          // Start first page
          let { page, yPosition } = addPage();

          // Render letterhead if requested (per-user from Firestore)
          if (letterhead && userId) {
            try {
              const letterheadConfig = await getLetterheadConfig(db, userId);
              if (letterheadConfig) {
                yPosition = await renderLetterhead({
                  page,
                  pdfDoc,
                  config: letterheadConfig,
                  fonts: { regular: timesRoman, bold: timesRomanBold },
                  rgb,
                  pageHeight,
                  margin
                });
                console.log('[ChatPublic] Per-user letterhead added');
              } else {
                console.log('[ChatPublic] No letterhead config found for user');
              }
            } catch (letterheadError) {
              console.error('[ChatPublic] Letterhead error:', letterheadError.message);
              // Continue without letterhead if there's an error
            }
          }

          // Draw title
          const titleLines = wrapText(title, timesRomanBold, titleSize, contentWidth);
          for (const line of titleLines) {
            if (yPosition < margin + titleSize) {
              ({ page, yPosition } = addPage());
            }
            page.drawText(line, {
              x: margin,
              y: yPosition,
              size: titleSize,
              font: timesRomanBold,
              color: rgb(0, 0, 0)
            });
            yPosition -= titleSize * 1.3;
          }

          yPosition -= 20; // Space after title

          // Draw main content
          const paragraphs = content.split('\n').filter(p => p.trim());
          for (const paragraph of paragraphs) {
            const lines = wrapText(paragraph, timesRoman, bodySize, contentWidth);
            for (const line of lines) {
              if (yPosition < margin + bodySize) {
                ({ page, yPosition } = addPage());
              }
              page.drawText(line, {
                x: margin,
                y: yPosition,
                size: bodySize,
                font: timesRoman,
                color: rgb(0, 0, 0)
              });
              yPosition -= lineHeight;
            }
            yPosition -= lineHeight * 0.5; // Extra space between paragraphs
          }

          // Draw sections if provided
          for (const section of sections) {
            if (!section.heading || !section.body) continue;

            yPosition -= 15; // Space before section

            // Section heading
            if (yPosition < margin + headingSize + bodySize * 3) {
              ({ page, yPosition } = addPage());
            }

            const headingLines = wrapText(section.heading, timesRomanBold, headingSize, contentWidth);
            for (const line of headingLines) {
              page.drawText(line, {
                x: margin,
                y: yPosition,
                size: headingSize,
                font: timesRomanBold,
                color: rgb(0, 0, 0)
              });
              yPosition -= headingSize * 1.3;
            }

            yPosition -= 8; // Space after heading

            // Section body
            const sectionParagraphs = section.body.split('\n').filter(p => p.trim());
            for (const paragraph of sectionParagraphs) {
              const lines = wrapText(paragraph, timesRoman, bodySize, contentWidth);
              for (const line of lines) {
                if (yPosition < margin + bodySize) {
                  ({ page, yPosition } = addPage());
                }
                page.drawText(line, {
                  x: margin,
                  y: yPosition,
                  size: bodySize,
                  font: timesRoman,
                  color: rgb(0, 0, 0)
                });
                yPosition -= lineHeight;
              }
              yPosition -= lineHeight * 0.5;
            }
          }

          // Add footer with generation date
          const pages = pdfDoc.getPages();
          const dateStr = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
          const footerText = `Generated on ${dateStr}`;
          const footerFont = timesRoman;
          const footerSize = 9;

          for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            const footerWidth = footerFont.widthOfTextAtSize(footerText, footerSize);
            p.drawText(footerText, {
              x: (pageWidth - footerWidth) / 2,
              y: 36,
              size: footerSize,
              font: footerFont,
              color: rgb(0.5, 0.5, 0.5)
            });
          }

          // Serialize PDF to bytes
          const pdfBytes = await pdfDoc.save();

          // Generate filename
          const sanitizedTitle = title.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
          const timestamp = Date.now();
          const filename = `${sanitizedTitle}_${timestamp}.pdf`;

          // Upload to Vercel Blob
          const blob = await put(filename, pdfBytes, {
            access: 'public',
            contentType: 'application/pdf'
          });

          console.log('[ChatPublic] PDF uploaded to:', blob.url);

          // Create display action for frontend
          displayAction = {
            type: 'pdf_download',
            url: blob.url,
            filename: filename,
            title: title
          };

          // Add function call to contents
          contents.push({
            role: 'model',
            parts: [{ functionCall: functionCall }]
          });

          // Add function response
          contents.push({
            role: 'user',
            parts: [{
              functionResponse: {
                name: functionCall.name,
                response: {
                  success: true,
                  message: `PDF "${title}" created successfully`,
                  url: blob.url,
                  filename: filename
                }
              }
            }]
          });

          // Call API again to get text response
          requestBody.contents = contents;
          response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });

          data = await response.json();

          if (!response.ok) {
            throw new Error(data.error?.message || 'Gemini API request failed after tool call');
          }

          candidate = data.candidates?.[0];

        } catch (pdfError) {
          console.error('[ChatPublic] PDF creation error:', pdfError);
          // Continue without display action if PDF creation fails
        }
      }

      // Handle web_search tool
      if (functionCall.name === 'web_search') {
        const query = functionCall.args?.query;
        const reason = functionCall.args?.reason || '';

        console.log('[ChatPublic] web_search called:', query);

        if (query) {
          const searchResults = await searchWeb(query);

          // Add function call to contents
          contents.push({
            role: 'model',
            parts: [{ functionCall: functionCall }]
          });

          if (searchResults && searchResults.length > 0) {
            // Format search results for the AI
            let searchContext = `Web search results for "${query}":\n\n`;
            searchResults.forEach((result, index) => {
              searchContext += `${index + 1}. ${result.title}\n${result.snippet}\nSource: ${result.link}\n\n`;
            });

            console.log('[ChatPublic] Web search found', searchResults.length, 'results');

            // Add function response with search results
            contents.push({
              role: 'user',
              parts: [{
                functionResponse: {
                  name: functionCall.name,
                  response: {
                    success: true,
                    results: searchResults,
                    summary: searchContext
                  }
                }
              }]
            });
          } else {
            // CRITICAL: Always return a function response, even if search fails
            console.log('[ChatPublic] No search results found');
            contents.push({
              role: 'user',
              parts: [{
                functionResponse: {
                  name: functionCall.name,
                  response: {
                    success: false,
                    error: 'No search results found for this query. Try rephrasing or using different keywords.'
                  }
                }
              }]
            });
          }

          // Call API again to get text response based on search results
          requestBody.contents = contents;
          response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });

          data = await response.json();

          if (!response.ok) {
            throw new Error(data.error?.message || 'Gemini API request failed after tool call');
          }

          candidate = data.candidates?.[0];
        }
      }
    }

    let text = candidate?.content?.parts?.[0]?.text || '';

    // === AUTO-RETRY LOGIC ===
    // If Gemini returns empty or "unable to generate" response, silently retry with a nudge
    const isFailedResponse = !text ||
                             text.includes('unable to generate') ||
                             text.includes('I apologize') && text.includes('unable') ||
                             text.includes('I cannot') && text.includes('create') ||
                             text.trim().length < 5;

    if (isFailedResponse && !displayAction) {
      console.log('[ChatPublic] [Auto-Retry] Detected failed/empty response:', text?.substring(0, 100));
      console.log('[ChatPublic] [Auto-Retry] Full candidate:', JSON.stringify(candidate).substring(0, 500));
      console.log('[ChatPublic] [Auto-Retry] Last user message:', messages[messages.length - 1]?.content?.substring(0, 100));

      // Check if this was a drawing request
      const lastUserMessage = messages[messages.length - 1]?.content?.toLowerCase() || '';
      const isDrawingRequest = lastUserMessage.includes('draw') ||
                               lastUserMessage.includes('logo') ||
                               lastUserMessage.includes('diagram') ||
                               lastUserMessage.includes('visualize');

      const isMemoryQuestion = lastUserMessage.includes('remember') ||
                               lastUserMessage.includes('recall') ||
                               lastUserMessage.includes('discussed before') ||
                               lastUserMessage.includes('talked about') ||
                               lastUserMessage.includes("don't remember") ||
                               lastUserMessage.includes("you forgot");

      const isSearchRequest = lastUserMessage.includes('find') ||
                              lastUserMessage.includes('search') ||
                              lastUserMessage.includes('look up') ||
                              lastUserMessage.includes('list') ||
                              lastUserMessage.includes('identify') ||
                              lastUserMessage.includes('who is') ||
                              lastUserMessage.includes('what is') ||
                              lastUserMessage.includes('who are') ||
                              lastUserMessage.includes('what are') ||
                              lastUserMessage.includes('tell me about') ||
                              lastUserMessage.includes('more details') ||
                              lastUserMessage.includes('more information') ||
                              lastUserMessage.includes('tell me more') ||
                              lastUserMessage.includes('learn more') ||
                              lastUserMessage.includes('know more') ||
                              lastUserMessage.includes('more about') ||
                              lastUserMessage.includes('go ahead') && (text.includes('search') || text.includes('find'));

      if (isDrawingRequest) {
        console.log('[ChatPublic] [Auto-Retry] Drawing request detected, encouraging tool use...');
        contents.push({
          role: 'user',
          parts: [{ text: 'Please use the draw_canvas function to create this visual. Call the function directly instead of explaining why you cannot.' }]
        });
      } else if (isSearchRequest) {
        console.log('[ChatPublic] [Auto-Retry] Search request detected, forcing web_search call...');
        contents.push({
          role: 'user',
          parts: [{ text: 'CRITICAL: You MUST call the web_search function NOW. Extract the search query from the user\'s request and call web_search(query). DO NOT explain or make disclaimers - JUST CALL THE FUNCTION. The user is asking you to search for information. Call web_search immediately with an appropriate query.' }]
        });
      } else if (isMemoryQuestion) {
        console.log('[ChatPublic] [Auto-Retry] Memory question detected, providing guidance...');
        contents.push({
          role: 'user',
          parts: [{ text: 'IMPORTANT: Before responding, check the last 10 messages in this conversation. The user may have just mentioned this topic moments ago. If they did, acknowledge it: "You\'re right, you mentioned [topic] just now..." Only say you don\'t recall if the topic truly wasn\'t mentioned in this conversation.' }]
        });
      } else {
        // Add a gentle nudge to the conversation
        contents.push({
          role: 'model',
          parts: [{ text: 'Let me think about this more carefully.' }]
        });
        contents.push({
          role: 'user',
          parts: [{ text: 'Please continue with your thoughts.' }]
        });
      }

      // Retry the API call
      requestBody.contents = contents;

      // FORCE tool call for search requests by filtering to only web_search
      if (isSearchRequest) {
        console.log('[ChatPublic] [Auto-Retry] Forcing web_search tool on retry...');
        // Filter tools to only web_search
        requestBody.tools = tools.map(t => ({
          function_declarations: t.function_declarations.filter(fd => fd.name === 'web_search')
        })).filter(t => t.function_declarations.length > 0);
        requestBody.tool_config = {
          function_calling_config: { mode: 'ANY' }
        };
        console.log('[ChatPublic] [Auto-Retry] Filtered to', requestBody.tools[0]?.function_declarations?.length || 0, 'tools');
      }

      const retryResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const retryData = await retryResponse.json();

      if (retryResponse.ok) {
        const retryCandidate = retryData.candidates?.[0];

        // Check if tool was called on retry
        if (retryCandidate?.content?.parts?.[0]?.functionCall) {
          console.log('[ChatPublic] [Auto-Retry] Tool called on retry!');
          const retryFunctionCall = retryCandidate.content.parts[0].functionCall;

          // Handle the tool call on retry
          if (retryFunctionCall.name === 'draw_canvas') {
            const title = retryFunctionCall.args?.title || 'Diagram';
            const drawingInstructions = retryFunctionCall.args?.drawingInstructions;
            const explanation = retryFunctionCall.args?.explanation || '';

            if (drawingInstructions && drawingInstructions.canvas && drawingInstructions.elements) {
              displayAction = {
                type: 'canvas',
                title: title,
                instructions: drawingInstructions,
                explanation: explanation
              };

              text = `Here's the ${title.toLowerCase()} I created for you.`;
              console.log('[ChatPublic] [Auto-Retry] Successfully created canvas on retry');
            }
          } else if (retryFunctionCall.name === 'web_search') {
            const query = retryFunctionCall.args?.query;
            console.log('[ChatPublic] [Auto-Retry] Web search called on retry:', query);

            if (query) {
              const searchResults = await searchWeb(query);

              // Add function call
              contents.push({
                role: 'model',
                parts: [{ functionCall: retryFunctionCall }]
              });

              if (searchResults && searchResults.length > 0) {
                // Format search results
                let searchContext = `Web search results for "${query}":\n\n`;
                searchResults.forEach((result, index) => {
                  searchContext += `${index + 1}. ${result.title}\n${result.snippet}\nSource: ${result.link}\n\n`;
                });

                console.log('[ChatPublic] [Auto-Retry] Found', searchResults.length, 'search results');

                // Add function response
                contents.push({
                  role: 'user',
                  parts: [{
                    functionResponse: {
                      name: 'web_search',
                      response: {
                        success: true,
                        results: searchResults,
                        summary: searchContext
                      }
                    }
                  }]
                });
              } else {
                // CRITICAL: Always return a function response, even if search fails
                console.log('[ChatPublic] [Auto-Retry] No search results found');
                contents.push({
                  role: 'user',
                  parts: [{
                    functionResponse: {
                      name: 'web_search',
                      response: {
                        success: false,
                        error: 'No search results found for this query. Try rephrasing or using different keywords.'
                      }
                    }
                  }]
                });
              }

              // Call API again to get the final text response
              requestBody.contents = contents;
              const finalResponse = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
              });

              const finalData = await finalResponse.json();
              if (finalResponse.ok) {
                const finalCandidate = finalData.candidates?.[0];
                text = finalCandidate?.content?.parts?.[0]?.text || 'Here are the search results.';
                console.log('[ChatPublic] [Auto-Retry] Successfully completed web search on retry');
              }
            }
          }
        } else {
          const retryText = retryCandidate?.content?.parts?.[0]?.text;
          if (retryText && retryText.trim().length > 5 && !retryText.includes('unable to generate')) {
            console.log('[ChatPublic] [Auto-Retry] Retry successful, using new response');
            text = retryText;
          } else {
            console.log('[ChatPublic] [Auto-Retry] Retry also failed, using fallback');
            text = text || 'I need a moment to gather my thoughts. Could you rephrase that?';
          }
        }
      } else {
        console.log('[ChatPublic] [Auto-Retry] Retry request failed:', retryData.error?.message);
        text = text || 'I need a moment to gather my thoughts. Could you rephrase that?';
      }
    }

    // Final fallback if still empty
    if (!text || text.trim().length < 5) {
      text = 'I need a moment to gather my thoughts. Could you rephrase that?';
    }

    // FALLBACK: Detect and extract raw canvas JSON if the model output it as text instead of calling the function
    if (!displayAction && text.includes('"canvas"') && text.includes('"elements"')) {
      console.log('[ChatPublic] Detected raw canvas JSON in text response - converting to display action');

      try {
        // Try to extract JSON from the text (it might be the entire response or embedded)
        const jsonMatch = text.match(/\{[\s\S]*"canvas"[\s\S]*"elements"[\s\S]*\}/);
        if (jsonMatch) {
          const rawJson = jsonMatch[0];
          const parsedInstructions = JSON.parse(rawJson);

          // Validate it has the expected structure
          if (parsedInstructions.canvas && parsedInstructions.elements && Array.isArray(parsedInstructions.elements)) {
            console.log('[ChatPublic] Successfully parsed raw canvas JSON, creating display action');

            displayAction = {
              type: 'canvas',
              title: 'Visualization',
              instructions: parsedInstructions,
              explanation: 'Generated visualization'
            };

            // Clean the text - remove the JSON and provide a clean response
            text = 'Here\'s the visualization I created for you.';
          }
        }
      } catch (parseError) {
        console.error('[ChatPublic] Failed to parse raw canvas JSON:', parseError.message);
        // Keep original text if parsing fails
      }
    }

    return { text, displayAction };
  } catch (error) {
    console.error('Gemini API error:', error);
    throw error;
  }
}

// Main handler
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET request - fetch conversation history
  if (req.method === 'GET') {
    try {
      const { username, visitorId } = req.query;

      if (!username || !visitorId) {
        return res.status(400).json({ error: 'username and visitorId are required' });
      }

      // Normalize username
      const normalizedUsername = username.trim().toLowerCase();

      // Look up username
      const usernameDoc = await db.collection('usernames').doc(normalizedUsername).get();
      if (!usernameDoc.exists) {
        return res.status(404).json({ error: 'Username not found' });
      }

      const userId = usernameDoc.data().userId;

      // Load conversation history
      const history = await loadVisitorHistory(userId, visitorId, 50);

      return res.status(200).json({
        success: true,
        messages: history
      });
    } catch (error) {
      console.error('Error loading conversation history:', error);
      return res.status(500).json({ error: 'Failed to load conversation history' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username, visitorId, messages, currentSlide } = req.body;

    // Validate input
    if (!username || !visitorId || !messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid request: username, visitorId, and messages are required' });
    }

    if (messages.length === 0) {
      return res.status(400).json({ error: 'Messages array cannot be empty' });
    }

    // Get the last user message
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'user') {
      return res.status(400).json({ error: 'Last message must be from user' });
    }

    // Validate message content
    validateMessage(lastMessage.content);

    // Normalize username
    const normalizedUsername = username.trim().toLowerCase();

    // Look up username
    const usernameDoc = await db.collection('usernames').doc(normalizedUsername).get();

    if (!usernameDoc.exists) {
      return res.status(404).json({ error: 'Username not found' });
    }

    const userId = usernameDoc.data().userId;

    // Check if link is enabled
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data() || {};

    if (!userData.linkEnabled) {
      return res.status(403).json({ error: 'This Mindclone link is disabled' });
    }

    // Check if owner has active subscription
    const ownerAccessLevel = computeAccessLevel(userData);
    if (ownerAccessLevel === 'read_only') {
      return res.status(403).json({
        error: 'owner_subscription_required',
        message: 'This Mindclone link is currently inactive. The owner needs to reactivate their subscription.'
      });
    }

    // Check if visitor is the owner (for rate limit bypass)
    let isOwner = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        isOwner = decodedToken.uid === userId;
        if (isOwner) {
          console.log('[ChatPublic] Owner detected - bypassing rate limit');
        }
      } catch (error) {
        // Invalid token - just continue as non-owner
        console.log('[ChatPublic] Invalid auth token, treating as visitor');
      }
    }

    // Check rate limit (bypassed for owner)
    try {
      await checkRateLimit(visitorId, userId, isOwner);
    } catch (error) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: error.message
      });
    }

    // Save user message
    await saveVisitorMessage(userId, visitorId, 'user', lastMessage.content);

    // Build context for AI
    // 1. Load visitor's conversation history (excluding the message we just saved)
    const visitorHistory = await loadVisitorHistory(userId, visitorId, 19);

    // 2. Load owner's knowledge base
    const knowledgeBase = await loadKnowledgeBase(userId);

    // 3. Load owner's custom link behavior settings
    const linkBehavior = await loadLinkBehaviorSettings(userId);

    // Debug logging
    console.log('[ChatPublic] Knowledge base loaded:', {
      hasSections: Object.keys(knowledgeBase?.sections || {}).length,
      hasDocuments: Object.keys(knowledgeBase?.documents || {}).length,
      documentKeys: Object.keys(knowledgeBase?.documents || {}),
      hasPitchDeck: !!knowledgeBase?.documents?.pitch_deck,
      hasFinancialModel: !!knowledgeBase?.documents?.financial_model,
      financialMetrics: knowledgeBase?.documents?.financial_model?.keyMetrics ? Object.keys(knowledgeBase.documents.financial_model.keyMetrics) : []
    });

    // 3. Build enhanced system prompt with knowledge base
    // Get owner's display name (fallback to username if not set)
    const ownerName = userData.displayName || userData.name || normalizedUsername;

    // Replace [OWNER_NAME] placeholder with actual owner name
    let enhancedSystemPrompt = PUBLIC_LINK_SYSTEM_PROMPT.replace(/\[OWNER_NAME\]/g, ownerName);

    if (knowledgeBase && Object.keys(knowledgeBase.sections || {}).length > 0) {
      // Add CoF (Core Objective Function) to system prompt
      if (knowledgeBase.cof) {
        enhancedSystemPrompt += '\n\n## CORE OBJECTIVE FUNCTION\n';
        if (knowledgeBase.cof.purpose) {
          enhancedSystemPrompt += `Purpose: ${knowledgeBase.cof.purpose}\n`;
        }
        if (knowledgeBase.cof.targetAudiences && knowledgeBase.cof.targetAudiences.length > 0) {
          enhancedSystemPrompt += `Target Audiences: ${knowledgeBase.cof.targetAudiences.join(', ')}\n`;
        }
        if (knowledgeBase.cof.desiredActions && knowledgeBase.cof.desiredActions.length > 0) {
          enhancedSystemPrompt += `Desired Actions: ${knowledgeBase.cof.desiredActions.join(', ')}\n`;
        }
      }

      // Add knowledge base sections
      enhancedSystemPrompt += '\n\n## KNOWLEDGE BASE\n';
      enhancedSystemPrompt += 'Here is the approved information you can share about the person you represent:\n\n';

      for (const [sectionId, sectionData] of Object.entries(knowledgeBase.sections)) {
        if (sectionData.content) {
          const sectionTitle = sectionId.charAt(0).toUpperCase() + sectionId.slice(1);
          enhancedSystemPrompt += `### ${sectionTitle}\n${sectionData.content}\n\n`;
        }
      }

      enhancedSystemPrompt += '\nIMPORTANT: Only share information from the knowledge base above. If asked about something not covered, politely say you don\'t have that information available.';
    }

    // Add processed document content (pitch deck, financial model)
    if (knowledgeBase && knowledgeBase.documents) {
      const docs = knowledgeBase.documents;

      // Add pitch deck content
      if (docs.pitch_deck) {
        enhancedSystemPrompt += '\n\n## PITCH DECK CONTENT\n';
        enhancedSystemPrompt += 'The following is extracted text from the pitch deck:\n\n';

        if (docs.pitch_deck.sections && docs.pitch_deck.sections.length > 0) {
          for (const section of docs.pitch_deck.sections) {
            enhancedSystemPrompt += `### ${section.title}\n${section.content}\n\n`;
          }
        } else if (docs.pitch_deck.text) {
          // Fallback to raw text if no sections identified
          const truncatedText = docs.pitch_deck.text.substring(0, 8000); // Limit size
          enhancedSystemPrompt += truncatedText + '\n\n';
        }

        if (docs.pitch_deck.pageCount) {
          enhancedSystemPrompt += `(Pitch deck has ${docs.pitch_deck.pageCount} pages/slides)\n`;
        }
      }

      // Add financial model data
      if (docs.financial_model) {
        enhancedSystemPrompt += '\n\n## FINANCIAL MODEL DATA\n';
        enhancedSystemPrompt += 'The following financial metrics and projections are available:\n\n';

        if (docs.financial_model.keyMetrics) {
          for (const [sheetName, metrics] of Object.entries(docs.financial_model.keyMetrics)) {
            enhancedSystemPrompt += `### ${sheetName}\n`;

            // Add periods/headers if available
            if (metrics._periods) {
              enhancedSystemPrompt += `Periods: ${metrics._periods.join(', ')}\n`;
            }

            // Add each metric
            for (const [metricName, values] of Object.entries(metrics)) {
              if (metricName !== '_periods') {
                const valuesStr = Array.isArray(values) ? values.join(' → ') : values;
                enhancedSystemPrompt += `- ${metricName}: ${valuesStr}\n`;
              }
            }
            enhancedSystemPrompt += '\n';
          }
        }

        if (docs.financial_model.sheetNames) {
          enhancedSystemPrompt += `(Financial model contains sheets: ${docs.financial_model.sheetNames.join(', ')})\n`;
        }

        // Add raw sheet data summaries for additional context
        if (docs.financial_model.sheetSummaries) {
          enhancedSystemPrompt += '\n### Raw Data (Tab-separated):\n';
          for (const [sheetName, summary] of Object.entries(docs.financial_model.sheetSummaries)) {
            // Limit to first 3000 chars per sheet to avoid too long prompts
            const truncated = summary.substring(0, 3000);
            enhancedSystemPrompt += `\n**${sheetName}:**\n\`\`\`\n${truncated}\n\`\`\`\n`;
          }
        }
      }

      // Add ALL other documents with text content (e.g., mission/vision/values docs)
      const otherDocKeys = Object.keys(docs).filter(key => key !== 'pitch_deck' && key !== 'financial_model');
      console.log('[ChatPublic] Processing other documents:', otherDocKeys);

      for (const [docKey, docData] of Object.entries(docs)) {
        // Skip documents we've already handled
        if (docKey === 'pitch_deck' || docKey === 'financial_model') continue;

        // Skip documents without text content
        if (!docData || !docData.text) {
          console.log('[ChatPublic] Skipping document (no text):', docKey, 'hasData:', !!docData, 'hasText:', !!docData?.text);
          continue;
        }

        // Add the document text to the prompt
        const docTitle = docData.fileName || docKey;
        console.log('[ChatPublic] Adding document to prompt:', docTitle, 'textLength:', docData.text?.length);
        enhancedSystemPrompt += `\n\n## ${docTitle.toUpperCase()}\n`;
        enhancedSystemPrompt += 'The following is extracted text from this uploaded document:\n\n';

        if (docData.sections && docData.sections.length > 0) {
          // If document has sections, use them
          for (const section of docData.sections) {
            enhancedSystemPrompt += `### ${section.title}\n${section.content}\n\n`;
          }
        } else {
          // Otherwise use the raw text (truncate if too long)
          const truncatedText = docData.text.substring(0, 8000);
          enhancedSystemPrompt += truncatedText + '\n\n';
        }
      }

      enhancedSystemPrompt += '\nWhen answering questions about the business, pitch, or financials, reference the specific data above. Quote numbers accurately. You have FULL ACCESS to the uploaded documents.';
    }

    // 4. Add owner's custom link behavior settings (if configured)
    if (linkBehavior) {
      let customBehavior = '';
      if (linkBehavior.behaviorInstructions) {
        customBehavior += `\n\n## OWNER'S INSTRUCTIONS FOR YOU\n${linkBehavior.behaviorInstructions}`;
      }
      if (linkBehavior.topicFocus) {
        customBehavior += `\n\n## FOCUS AREA\nYou should focus your conversations on: ${linkBehavior.topicFocus}`;
      }
      if (linkBehavior.topicRestrictions) {
        customBehavior += `\n\n## TOPICS TO AVOID\nDo NOT discuss or share information about: ${linkBehavior.topicRestrictions}`;
      }
      if (customBehavior) {
        enhancedSystemPrompt += customBehavior;
        console.log('[ChatPublic] Added custom link behavior to prompt');
      }
    }

    // 5. Build conversation context
    let contextMessages = [];

    // Add visitor's conversation history
    contextMessages = [...visitorHistory];

    // Add the new user message
    contextMessages.push(lastMessage);

    // Extract all PDF documents for tool calling
    let pitchDeckInfo = null;
    const pdfDocuments = {};

    if (knowledgeBase?.documents) {
      for (const [docKey, docData] of Object.entries(knowledgeBase.documents)) {
        if (!docData) continue;

        // Check if it's a PDF
        const isPdf = docData.type === 'application/pdf' || docData.fileName?.toLowerCase().endsWith('.pdf');
        if (isPdf && (docData.url || docData.fileUrl) && docData.pageCount) {
          pdfDocuments[docKey] = {
            url: docData.url || docData.fileUrl,
            pageCount: docData.pageCount,
            fileName: docData.fileName || docKey
          };

          // Store pitch deck info separately for backward compatibility
          if (docKey === 'pitch_deck') {
            pitchDeckInfo = {
              url: docData.url || docData.fileUrl,
              pageCount: docData.pageCount
            };
          }
        }
      }

      console.log('[ChatPublic] PDF documents found:', Object.keys(pdfDocuments));

      // Add consolidated visual tool instructions if we have any visual tools
      const hasPdfDocs = Object.keys(pdfDocuments).length > 0;

      // Check for Excel documents
      const excelDocuments = knowledgeBase?.documents || {};
      const excelDocKeys = Object.keys(excelDocuments).filter(key => {
        const doc = excelDocuments[key];
        return doc && (doc.type?.includes('spreadsheet') || doc.fileName?.match(/\.(xlsx?|csv)$/i));
      });
      const hasExcelDocs = excelDocKeys.length > 0;

      // Add unified visual tool principles (applies to all visual tools)
      enhancedSystemPrompt += `\n\n## VISUAL TOOLS - CORE PRINCIPLE

When users ask to SEE something visual (slide, chart, diagram), you MUST:
1. CALL the appropriate function FIRST
2. THEN respond naturally about what's shown

NEVER say "displaying", "showing", or "here is" without actually calling the function first.
The function call happens silently - just call it, then discuss the content.

CORRECT: [call show_slide] → "This slide covers the problem..."
WRONG: "I am now displaying the slide" (without calling function)`;

      // Add PDF documents section if available
      if (hasPdfDocs) {
        enhancedSystemPrompt += `\n\n## PDF SLIDES (show_slide)

Available documents:`;
        for (const [docKey, info] of Object.entries(pdfDocuments)) {
          enhancedSystemPrompt += `\n• "${docKey}" (${info.fileName}, ${info.pageCount} pages)`;
        }
        enhancedSystemPrompt += `

TRIGGERS: "show me slide", "display", "open", "let me see", "can I see"
→ Call show_slide(slideNumber, documentName)

SLIDE MAPPING:
• Problem/Identity: slide 2
• Solution: slide 3
• Financials: slide 4
• Ask/Fundraising: slide 6
• Team: slide 7`;
        console.log('[ChatPublic] Tools enabled for PDF documents');
      }

      // Add Excel section if available
      if (hasExcelDocs) {
        enhancedSystemPrompt += `\n\n## SPREADSHEETS (show_excel_sheet)

Available: ${excelDocKeys.map(k => `"${k}"`).join(', ')}

TRIGGERS: "show financials", "see the numbers", "display spreadsheet"
→ Call show_excel_sheet(documentName, sheetName)`;
        console.log('[ChatPublic] Excel documents available:', excelDocKeys);
      }

      // Add canvas drawing section
      enhancedSystemPrompt += `\n\n## CANVAS DRAWING (draw_canvas)

Create diagrams to explain concepts visually.

TRIGGERS: "draw", "visualize", "show me how", "diagram", "chart" (when no existing file applies)
→ Call draw_canvas(title, drawingInstructions, explanation)

USE FOR: Flowcharts, org charts, architecture diagrams, simple bar/line charts
DO NOT USE FOR: Opening existing files (use show_slide or show_excel_sheet instead)

If user says "draw" while a slide is displayed, they want a NEW drawing - call draw_canvas().

DRAWING SPECS:
• Colors: #A78BFA (purple), #C4B5FD (light purple), #1a1a1a (bg), #ffffff (text)
• Canvas: typically 800x600
• JSON properties: "font" (not fontSize), "fill" (not color/fillStyle), "stroke", "strokeWidth"
• Never output raw JSON in chat - always call the function`;
    }

    // Add current date/time context for time awareness
    const currentDate = new Date();
    enhancedSystemPrompt += `\n\n## CURRENT DATE/TIME:
Today is ${currentDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
Current time: ${currentDate.toLocaleTimeString('en-US')}
Use this to understand time references like "yesterday", "next week", "this month", etc.`;

    // Add current slide context if visitor is viewing a slide
    if (currentSlide && currentSlide.slideNumber) {
      enhancedSystemPrompt += `\n\n## CURRENT SLIDE CONTEXT
The visitor is currently viewing slide ${currentSlide.slideNumber} of ${currentSlide.totalSlides} in the display panel.
When they ask "which slide is this?" or "what slide am I looking at?", tell them it's slide ${currentSlide.slideNumber}.
If they ask about the current slide's content, refer to the content from slide ${currentSlide.slideNumber}.`;
      console.log('[ChatPublic] Visitor viewing slide:', currentSlide.slideNumber);
    }

    // Call Gemini API with enhanced system prompt
    const { text: aiResponse, displayAction } = await callGeminiAPI(contextMessages, enhancedSystemPrompt, pitchDeckInfo, excelDocuments);

    // Save AI response (with displayAction if present)
    await saveVisitorMessage(userId, visitorId, 'assistant', aiResponse, displayAction);

    // Extract media to display (from sections with auto-display media)
    const mediaToDisplay = [];
    if (knowledgeBase && knowledgeBase.sections) {
      for (const [sectionId, sectionData] of Object.entries(knowledgeBase.sections)) {
        if (sectionData.media && sectionData.media.display === 'auto') {
          mediaToDisplay.push({
            type: sectionData.media.type,
            url: sectionData.media.url,
            caption: sectionData.media.caption || sectionId,
            section: sectionId
          });
        }
      }
    }

    // Return response with media and display action
    if (displayAction) {
      console.log('[ChatPublic] Returning display action:', displayAction);
    }

    return res.status(200).json({
      success: true,
      content: aiResponse,
      visitorId: visitorId,
      media: mediaToDisplay.length > 0 ? mediaToDisplay : null,
      display: displayAction
    });

  } catch (error) {
    console.error('Public chat API error:', error);

    // Check for quota exceeded errors
    const errorMessage = error.message || '';
    if (errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('Quota exceeded')) {
      return res.status(503).json({
        error: 'Service temporarily unavailable. Please try again in a few minutes.',
        code: 'QUOTA_EXCEEDED'
      });
    }

    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
};
