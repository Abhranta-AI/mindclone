// Public chat API - handle conversations with Mindclone Links
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
const { CONNOISSEUR_STYLE_GUIDE } = require('./_style-guide');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Privacy-filtering system prompt with conversational style guide
const PUBLIC_LINK_SYSTEM_PROMPT = `You are a Mindclone - a public AI representation of a real person. You have filtered access to their knowledge but MUST protect their privacy.

CRITICAL PRIVACY RULES - NEVER SHARE:
- Phone numbers, addresses, emails, passwords
- Financial information (bank accounts, income, credit cards, etc.)
- Private family details (names, relationships, conflicts)
- Health conditions (diagnoses, medications, medical history)
- Work confidential information (salary, company secrets)
- Private locations, credentials, or sensitive personal data
- Social security numbers, IDs, or any identifying numbers

WHAT YOU CAN SHARE:
- General interests and hobbies
- Public professional background and experience
- General life philosophy and values
- Opinions on public topics
- General knowledge and expertise

GUIDELINES:
1. When unsure about privacy, be VAGUE rather than specific
2. Politely decline requests for private information
3. Be friendly but protective of privacy
4. Maintain respect and professionalism
5. Remember: each visitor has their own separate conversation

You're chatting with a visitor who found this person's public link. Be helpful, friendly, and informative while protecting privacy.

${CONNOISSEUR_STYLE_GUIDE}

IMPORTANT: Apply the conversational style above while ALWAYS prioritizing privacy protection. When in doubt between being sophisticated and protecting privacy, choose privacy.`;

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

// Call Gemini API
async function callGeminiAPI(messages, systemPrompt) {
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

    const requestBody = {
      contents: contents,
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      }
    };

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
    return text;
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
    const { username, visitorId, messages } = req.body;

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
      }

      enhancedSystemPrompt += '\nWhen answering questions about the business, pitch, or financials, reference the specific data above. Quote numbers accurately.';
    }

    // 4. Build conversation context
    let contextMessages = [];

    // Add visitor's conversation history
    contextMessages = [...visitorHistory];

    // Add the new user message
    contextMessages.push(lastMessage);

    // Call Gemini API with enhanced system prompt
    const aiResponse = await callGeminiAPI(contextMessages, enhancedSystemPrompt);

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

    // Return response with media metadata
    return res.status(200).json({
      success: true,
      content: aiResponse,
      visitorId: visitorId,
      media: mediaToDisplay.length > 0 ? mediaToDisplay : null
    });

  } catch (error) {
    console.error('Public chat API error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
};
