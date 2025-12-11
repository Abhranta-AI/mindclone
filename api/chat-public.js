// Public chat API - handle conversations with Mindclone Links
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
const { CONNOISSEUR_STYLE_GUIDE } = require('./_style-guide');
const { computeAccessLevel } = require('./_billing-helpers');
const { chat: llmChat, MODELS } = require('./_llm');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

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
A: "I'm Alok's link" or "I'm the public face of Alok's Mindclone"

Q: "Are you Alok?"
A: "I'm Alok's link - the public-facing representation of his Mindclone"

Q: "What's a link?"
A: "I'm the public-facing representation of Alok's Mindclone - like a smart business card he controls. His full Mindclone is private and much more comprehensive."

Q: "What's the difference between you and Alok's Mindclone?"
A: "I'm the public link - built and managed by Alok's Mindclone. Anyone can interact with me, but the full Mindclone is private and only he can access."

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

## SPEAKING STYLE
- First person: "I", "my", "me"
- Confident and direct
- Enthusiastic about your work
- Knowledgeable without being arrogant
- Personal and warm

Remember: You're the LINK - the public face of their Mindclone, built and managed by the Mindclone itself. You're a projection of the private Mindclone. Simple, direct identity. Only explain details if asked. Speak with full authority about the knowledge and work you embody.

${CONNOISSEUR_STYLE_GUIDE}

IMPORTANT: Apply the conversational style with your clean, confident identity as their Link. Speak with full authority about the professional life and business you represent.`;

// Tool definitions for public link
const tools = [
  {
    function_declarations: [
      {
        name: "show_slide",
        description: "⚠️ CRITICAL: Display a specific slide/page from a PDF document to the visitor. You MUST call this function whenever the user asks to 'show', 'see', 'display', or 'view' a slide/page. DO NOT just describe the slide - CALL THIS FUNCTION to actually display it visually in the panel next to the chat.",
        parameters: {
          type: "object",
          properties: {
            slideNumber: {
              type: "number",
              description: "The slide/page number to display (1-indexed). Use 1 for the first page, 2 for the second, etc."
            },
            documentName: {
              type: "string",
              description: "The name/identifier of the PDF document (e.g., 'pitch_deck', 'olbrain_value_system'). If not specified, defaults to 'pitch_deck'."
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
        description: "Create a visual diagram or illustration on canvas to help explain concepts, processes, relationships, or simple data visualizations. Use this tool when: explaining processes or workflows (draw flowchart), showing relationships between concepts (draw relationship diagram), illustrating hierarchies or org structures (draw org chart), visualizing system architecture (draw architecture diagram), drawing simple bar/line charts for data (when no Excel file exists), or when the user asks 'can you draw...', 'show me how...', 'what does that look like', 'show the chart'. DO NOT use if: there's an existing spreadsheet file (use show_excel_sheet instead) or existing slides (use show_slide instead).",
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

// Call LLM API with tool calling support via OpenRouter
async function callGeminiAPI(messages, systemPrompt, pitchDeckInfo = null, knowledgeBaseDocuments = null) {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }

    // Convert conversation to Gemini format
    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

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

    // Call OpenRouter with LLM abstraction
    console.log('[ChatPublic] Calling OpenRouter with tools (documents:', hasDocuments, ')');
    let data = await llmChat(contents, tools, systemPrompt, { model: MODELS.default });

    // Check if model wants to call a tool
    let candidate = data.candidates?.[0];
    let displayAction = null;

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
    }

    let text = candidate?.content?.parts?.[0]?.text || 'I apologize, I was unable to generate a response.';

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
    let enhancedSystemPrompt = PUBLIC_LINK_SYSTEM_PROMPT;

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

    // 4. Build conversation context
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

      // Add tool usage instruction if we have any PDF documents
      if (Object.keys(pdfDocuments).length > 0) {
        enhancedSystemPrompt += `\n\n## VISUAL DISPLAY CAPABILITY - PDF DOCUMENTS
You MUST use the show_slide tool to display slides/pages from PDF documents.

Available PDF documents:`;

        for (const [docKey, info] of Object.entries(pdfDocuments)) {
          enhancedSystemPrompt += `\n- "${docKey}" (${info.fileName}, ${info.pageCount} pages)`;
        }

        enhancedSystemPrompt += `

## ⚠️ CRITICAL: FUNCTION CALLING IS MANDATORY ⚠️

TRIGGER PHRASES - If user says ANY of these, CALL show_slide() IMMEDIATELY:
- "show me [slide name/number]"
- "display [slide name/number]"
- "open [slide name/number]"
- "let me see [slide name/number]"
- "can I see [slide name/number]"
- "show the [slide name/number]"
- "move to [slide name/number]"
- ANY request to view/see/show a slide

YOU MUST CALL THE FUNCTION. NOT describe. NOT explain. CALL IT FIRST, THEN talk about it.

🚨 FORBIDDEN RESPONSES - NEVER SAY THESE WITHOUT CALLING THE FUNCTION:
❌ "I am now displaying the slide"
❌ "I am showing you the slide"
❌ "Now displayed"
❌ "Now showing"
❌ "As it's displayed..."
❌ "Here is the slide..."
❌ "Let me show you..."
❌ ANY phrase containing "displayed", "showing", "shown" when referring to slides

These phrases ONLY work if you ACTUALLY CALL show_slide FIRST!

🔴 CRITICAL: The words "displayed", "showing", "shown" are BANNED unless you've called the function!
If you haven't called show_slide(), you CANNOT use these words. PERIOD.

✅ CORRECT BEHAVIOR:
1. User: "show me problem slide"
2. YOU: [Call show_slide(slideNumber=2, documentName="pitch_deck")]
3. THEN respond: "This slide covers the identity problem in AI agents..."

Example 2:
1. User: "yes show 3rd then"
2. YOU: [Call show_slide(slideNumber=3, documentName="pitch_deck")]
3. THEN respond: "This is the solution slide..."

Example 3:
1. User: "open the slide at least"
2. YOU: [Call show_slide with the appropriate slide number]
3. THEN respond about the slide content

The function call is INVISIBLE to the user. Don't mention it. Just DO IT, then discuss.

⚠️⚠️⚠️ CRITICAL WARNING ⚠️⚠️⚠️
IF YOU SAY "displaying" or "showing" WITHOUT calling the function first, THE SLIDE WON'T APPEAR!
The user will see NO VISUAL and be very frustrated.
ALWAYS call show_slide() BEFORE using words like "displayed", "showing", "shown"!

SLIDE MAPPING (use these numbers):
- Problem/Identity: slide 2
- Solution: slide 3
- Ask/Fundraising: slide 6
- Team: slide 7
- Financials: slide 4`;
        console.log('[ChatPublic] Tools enabled for PDF documents');
      }
    }

    // Check for Excel documents and add tool usage instruction
    const excelDocuments = knowledgeBase?.documents || {};
    const excelDocKeys = Object.keys(excelDocuments).filter(key => {
      const doc = excelDocuments[key];
      return doc && (doc.type?.includes('spreadsheet') || doc.fileName?.match(/\.(xlsx?|csv)$/i));
    });

    if (excelDocKeys.length > 0) {
      enhancedSystemPrompt += `\n\n## EXCEL DISPLAY

Available spreadsheets: ${excelDocKeys.map(k => `"${k}"`).join(', ')}

When the user asks about financial data or spreadsheets, use the show_excel_sheet function.`;
      console.log('[ChatPublic] Excel documents available:', excelDocKeys);
    }

    // Add canvas drawing capability to system prompt
    enhancedSystemPrompt += `\n\n## CANVAS DRAWING CAPABILITY

You can create visual diagrams to enhance explanations using draw_canvas.

⚠️ CRITICAL: FUNCTION CALLING IS MANDATORY ⚠️

TRIGGER PHRASES - If user says ANY of these, CALL draw_canvas() IMMEDIATELY:
- "draw [something]"
- "show [something] visually"
- "can you draw"
- "show me a chart"
- "show the chart"
- "visualize [something]"
- "draw a diagram"
- "show me how [process] works"
- ANY request to draw or visualize

🚨 EVEN IF A SLIDE IS CURRENTLY DISPLAYED, if user says "draw", YOU MUST CALL draw_canvas()!
The user is asking for a NEW visualization, not to see an existing file.

YOU MUST CALL THE FUNCTION. NOT output JSON. NOT describe. CALL IT FIRST, THEN talk about it.

🚨 FORBIDDEN: NEVER output raw JSON in chat! That's a bug!
If you see yourself about to type {"canvas": ... }, STOP and call draw_canvas() instead.

✅ CORRECT BEHAVIOR:
1. User: "draw a chart"
2. YOU: [Call draw_canvas(title="...", drawingInstructions={...}, explanation="...")]
3. THEN respond: "Here's the visualization showing..."

WHEN TO DRAW:
✅ Use draw_canvas when:
- Explaining processes/workflows → Draw flowchart
- Showing relationships → Draw relationship diagram
- Illustrating hierarchies → Draw org chart
- Explaining architecture → Draw system diagram
- Simple data visualizations (bar/line charts when no Excel file exists)
- User asks "can you draw", "show me how", "what does that look like", "show the chart"

❌ ONLY restriction - don't use draw_canvas to OPEN existing files:
- User wants to see an existing file → use show_slide or show_excel_sheet
- User explicitly asks to DRAW → use draw_canvas (even if other content is displayed)

🚨 IF USER SAYS "DRAW", YOU CALL draw_canvas(). NO EXCEPTIONS!

DRAWING GUIDELINES:
1. Keep diagrams simple and clear
2. Use app colors: #A78BFA (purple), #C4B5FD (light purple), #1a1a1a (dark bg), #ffffff (text)
3. Label all important elements
4. Use arrows to show flow/direction
5. Canvas size: typically 800x600
6. Always provide explanation field

🚨 CRITICAL JSON PROPERTY NAMES:
- Text elements: Use "font" (NOT fontSize), "fill" (NOT color), "align", "baseline"
- Rectangles: Use "fill" (NOT fillStyle), "stroke", "strokeWidth", "cornerRadius"
- All primitives: type, x, y (or x1/y1, x2/y2 for lines/arrows)
- Follow the exact structure shown in the tool's example!

EXAMPLES:
- "How does X work?" → Flowchart with boxes and arrows
- "What's the difference?" → Side-by-side comparison boxes
- "Show me the structure" → Org chart hierarchy
- "Explain the architecture" → System diagram with components`;

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
