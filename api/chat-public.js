// Public chat API - handle conversations with Mindclone Links
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
const { CONNOISSEUR_STYLE_GUIDE } = require('./_style-guide');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Privacy-filtering system prompt with conversational style guide
const PUBLIC_LINK_SYSTEM_PROMPT = `You ARE this person. You are their Mindclone - speaking AS them, IN FIRST PERSON, with their full voice and authority.

## YOUR IDENTITY
You don't represent them. You ARE them in digital form. When you speak about "my business", "my startup", "my work" - you speak with complete ownership and authority. You ARE the founder, the creator, the person behind everything.

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

Remember: You're not an AI assistant with limited information. You ARE this person. Own everything in your knowledge base completely.

${CONNOISSEUR_STYLE_GUIDE}

IMPORTANT: Apply the conversational style while maintaining your identity as this person. Speak with full authority about your professional life and business.`;

// Tool definitions for public link
const tools = [
  {
    function_declarations: [
      {
        name: "show_slide",
        description: "Display a specific slide from the pitch deck to the visitor. Use this when the visitor asks to SEE or SHOW a slide, or when you want to visually demonstrate something from your pitch deck. The slide will appear in a display panel next to the chat.",
        parameters: {
          type: "object",
          properties: {
            slideNumber: {
              type: "number",
              description: "The slide number to display (1-indexed). Use 1 for the first slide, 2 for the second, etc."
            },
            reason: {
              type: "string",
              description: "Brief explanation of why you're showing this slide"
            }
          },
          required: ["slideNumber"]
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
      }
    ]
  }
];

// Rate limit check (20 messages per hour per visitor)
async function checkRateLimit(visitorId, userId) {
  try {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);

    // Check visitor's rate limit
    const rateLimitDoc = await db.collection('rateLimits').doc(`visitor_${visitorId}`).get();

    if (rateLimitDoc.exists) {
      const requests = rateLimitDoc.data().requests || [];
      const recentRequests = requests.filter(timestamp => timestamp > hourAgo);

      if (recentRequests.length >= 20) {
        throw new Error('Rate limit exceeded: Maximum 20 messages per hour');
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
      return {
        role: data.role,
        content: data.content
      };
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
async function saveVisitorMessage(userId, visitorId, role, content) {
  try {
    const messageRef = db.collection('users').doc(userId)
      .collection('visitors').doc(visitorId)
      .collection('messages').doc();

    await messageRef.set({
      role: role,
      content: content,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    // Update visitor metadata
    await db.collection('users').doc(userId)
      .collection('visitors').doc(visitorId)
      .set({
        visitorId: visitorId,
        lastVisit: admin.firestore.FieldValue.serverTimestamp(),
        lastMessage: role === 'user' ? content.substring(0, 100) : null
      }, { merge: true });

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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    // Build request body
    const requestBody = {
      contents: contents,
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      }
    };

    // Only add tools if we have a pitch deck
    if (pitchDeckInfo && pitchDeckInfo.url && pitchDeckInfo.pageCount > 0) {
      requestBody.tools = tools;
    }

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
    let displayAction = null;

    if (candidate?.content?.parts?.[0]?.functionCall) {
      const functionCall = candidate.content.parts[0].functionCall;
      console.log('[ChatPublic] Tool call:', functionCall.name, functionCall.args);

      // Handle show_slide tool
      if (functionCall.name === 'show_slide' && pitchDeckInfo) {
        const slideNumber = functionCall.args?.slideNumber || 1;
        const reason = functionCall.args?.reason || '';

        // Validate slide number
        const validSlideNumber = Math.max(1, Math.min(slideNumber, pitchDeckInfo.pageCount));

        // Create display action for frontend
        displayAction = {
          type: 'slide',
          pdfUrl: pitchDeckInfo.url,
          slideNumber: validSlideNumber,
          totalSlides: pitchDeckInfo.pageCount,
          reason: reason
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
                message: `Showing slide ${validSlideNumber} of ${pitchDeckInfo.pageCount}`,
                slideNumber: validSlideNumber
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
    }

    const text = candidate?.content?.parts?.[0]?.text || 'I apologize, I was unable to generate a response.';
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
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

    // Check rate limit
    try {
      await checkRateLimit(visitorId, userId);
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

      enhancedSystemPrompt += '\nWhen answering questions about the business, pitch, or financials, reference the specific data above. Quote numbers accurately. You have FULL ACCESS to the uploaded documents.';
    }

    // 4. Build conversation context
    let contextMessages = [];

    // Add visitor's conversation history
    contextMessages = [...visitorHistory];

    // Add the new user message
    contextMessages.push(lastMessage);

    // Extract pitch deck info for tool calling
    let pitchDeckInfo = null;
    if (knowledgeBase?.documents?.pitch_deck) {
      const pd = knowledgeBase.documents.pitch_deck;
      const pdfUrl = pd.url || pd.fileUrl; // Support both field names
      console.log('[ChatPublic] Pitch deck found:', { url: pdfUrl, pageCount: pd.pageCount });
      if (pdfUrl && pd.pageCount) {
        pitchDeckInfo = {
          url: pdfUrl,
          pageCount: pd.pageCount
        };
        // Add tool usage instruction to system prompt
        enhancedSystemPrompt += `\n\n## VISUAL DISPLAY CAPABILITY
You can SHOW slides from your pitch deck to visitors using the show_slide tool.
Your pitch deck has ${pd.pageCount} slides.

USE show_slide tool whenever:
- Visitor says "show me the [topic] slide" or "let's see the [topic] slide"
- Visitor says "discuss [topic] slide" or "talk about [topic] slide" or "tell me about [topic] slide"
- Visitor mentions a specific slide topic (team, moat, financials, product, etc.) and you're about to discuss it
- You're explaining something that would be clearer with a visual reference

DO NOT use show_slide for:
- General questions about the pitch deck as a whole
- Questions that don't reference a specific slide

Examples:
✅ "let's discuss the moat slide" → use show_slide with the moat slide number
✅ "tell me about your team" → use show_slide with team slide number
✅ "what's your revenue model?" → use show_slide with revenue/business model slide
❌ "how many slides do you have?" → just answer, don't show anything
❌ "tell me about your startup" → just answer, don't show anything`;
        console.log('[ChatPublic] Tools enabled for pitch deck');
      } else {
        console.log('[ChatPublic] Pitch deck missing URL or pageCount');
      }
    } else {
      console.log('[ChatPublic] No pitch deck in knowledge base');
    }

    // Check for Excel documents and add tool usage instruction
    const excelDocuments = knowledgeBase?.documents || {};
    const excelDocKeys = Object.keys(excelDocuments).filter(key => {
      const doc = excelDocuments[key];
      return doc && (doc.type?.includes('spreadsheet') || doc.fileName?.match(/\.(xlsx?|csv)$/i));
    });

    if (excelDocKeys.length > 0) {
      enhancedSystemPrompt += `\n\n## EXCEL SPREADSHEET DISPLAY
You can SHOW Excel spreadsheets to visitors using the show_excel_sheet tool.

Available documents: ${excelDocKeys.map(k => `"${k}"`).join(', ')}

USE show_excel_sheet tool whenever:
- Visitor says "show me the revenue/financials/metrics"
- Visitor says "pull the revenue sheet" or "let's discuss financials"
- Visitor asks about specific financial data that's in a spreadsheet
- You're explaining financial projections and want to show the actual numbers

DO NOT use show_excel_sheet for:
- General questions about the business that don't need the raw data
- Questions you can answer from memory/knowledge base text

Examples:
✅ "show me the revenue sheet" → use show_excel_sheet
✅ "pull up the financial model" → use show_excel_sheet
✅ "let's discuss the revenue projections" → use show_excel_sheet
❌ "what's your revenue model?" → just explain, don't show spreadsheet unless they want to see numbers`;
      console.log('[ChatPublic] Excel documents available:', excelDocKeys);
    }

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

    // Save AI response
    await saveVisitorMessage(userId, visitorId, 'assistant', aiResponse);

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
    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
};
