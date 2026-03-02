// WhatsApp Webhook - Receives incoming WhatsApp messages via Twilio and responds via Samantha
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
const { sendWhatsApp, getWhatsAppConfig } = require('./_whatsapp');

initializeFirebaseAdmin();
const db = admin.firestore();

// Parse URL-encoded body (Twilio sends form data, not JSON)
function parseFormBody(body) {
  // Handle Buffer (Vercel sometimes passes raw Buffer)
  if (Buffer.isBuffer(body)) {
    body = body.toString('utf-8');
  }
  // If already a plain object with expected Twilio fields, use it directly
  if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
    if (body.Body || body.From || body.MessageSid) {
      return body; // Already parsed by Vercel
    }
    // Could be some other object format, try to use as-is
    return body;
  }
  // Parse URL-encoded string
  if (typeof body !== 'string') {
    console.log(`[WhatsApp Webhook] Unexpected body type: ${typeof body}`);
    return {};
  }
  const params = {};
  body.split('&').forEach(pair => {
    const [key, val] = pair.split('=').map(s => {
      try { return decodeURIComponent((s || '').replace(/\+/g, ' ')); }
      catch(e) { return s || ''; }
    });
    if (key) params[key] = val || '';
  });
  return params;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    // Parse Twilio's form-encoded webhook payload
    console.log(`[WhatsApp Webhook] Request received. Content-Type: ${req.headers['content-type']}, Body type: ${typeof req.body}`);
    console.log(`[WhatsApp Webhook] Raw body keys: ${typeof req.body === 'object' ? Object.keys(req.body).join(', ') : 'not object'}`);

    const params = parseFormBody(req.body);
    const fromNumber = (params.From || '').replace('whatsapp:', '');
    const messageBody = params.Body || '';
    const messageSid = params.MessageSid || '';

    console.log(`[WhatsApp Webhook] Parsed: from=${fromNumber}, body="${messageBody.substring(0, 100)}", sid=${messageSid}`);

    if (!fromNumber || !messageBody) {
      console.log(`[WhatsApp Webhook] Missing from or body, returning empty TwiML`);

      // Return TwiML empty response (Twilio expects XML)
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send('<Response></Response>');
    }

    // Find which user owns this phone number
    // Primary: use MINDCLONE_OWNER_UID (fast, no index needed)
    let userId = null;
    const ownerUid = process.env.MINDCLONE_OWNER_UID;

    if (ownerUid) {
      // Check if the owner's phone number matches
      try {
        const ownerConfig = await db.collection('users').doc(ownerUid)
          .collection('settings').doc('whatsapp').get();

        if (ownerConfig.exists) {
          const storedPhone = (ownerConfig.data().phoneNumber || '').replace(/\s/g, '');
          const incomingPhone = fromNumber.replace(/\s/g, '');
          console.log(`[WhatsApp Webhook] Comparing phones: stored="${storedPhone}" vs incoming="${incomingPhone}"`);

          if (storedPhone === incomingPhone) {
            userId = ownerUid;
          }
        } else {
          console.log(`[WhatsApp Webhook] No WhatsApp config found for owner ${ownerUid}`);
          // If no config exists but MINDCLONE_OWNER_UID is set, just use it (single-user app)
          userId = ownerUid;
        }
      } catch (lookupErr) {
        console.error(`[WhatsApp Webhook] Owner lookup error: ${lookupErr.message}`);
        // Still use owner UID as fallback for single-user setup
        userId = ownerUid;
      }
    }

    // Secondary fallback: collectionGroup query (needs Firestore index)
    if (!userId) {
      try {
        const usersSnap = await db.collectionGroup('whatsapp')
          .where('phoneNumber', '==', fromNumber)
          .limit(1)
          .get();
        if (!usersSnap.empty) {
          const docPath = usersSnap.docs[0].ref.path;
          userId = docPath.split('/')[1];
        }
      } catch (cgErr) {
        console.error(`[WhatsApp Webhook] CollectionGroup query failed (index may be needed): ${cgErr.message}`);
      }
    }

    if (!userId) {
      console.log(`[WhatsApp Webhook] No user found for number ${fromNumber}. MINDCLONE_OWNER_UID=${ownerUid || 'NOT SET'}`);
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send('<Response></Response>');
    }

    console.log(`[WhatsApp Webhook] Matched user: ${userId}`);

    // Load recent conversation history from WhatsApp messages
    const conversationHistory = [];
    try {
      const historySnap = await db.collection('users').doc(userId)
        .collection('whatsappMessages')
        .orderBy('timestamp', 'desc')
        .limit(20)
        .get();

      historySnap.docs.reverse().forEach(doc => {
        const d = doc.data();
        if (d.role && d.content) {
          conversationHistory.push({ role: d.role, content: d.content });
        }
      });
      console.log(`[WhatsApp Webhook] Loaded ${conversationHistory.length} history messages`);
    } catch (histErr) {
      console.error(`[WhatsApp Webhook] History query failed (non-fatal): ${histErr.message}`);
      // Continue without history — at minimum we'll have the new message
    }

    // Add the new user message
    conversationHistory.push({ role: 'user', content: messageBody });

    // Save user message to WhatsApp conversation history
    await db.collection('users').doc(userId)
      .collection('whatsappMessages').add({
        role: 'user',
        content: messageBody,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        twilioSid: messageSid,
        fromNumber: fromNumber
      });

    // Call the chat API internally to get Samantha's response
    console.log(`[WhatsApp Webhook] Calling chat API for ${userId}`);

    const chatResponse = await callChatAPI(userId, conversationHistory);

    if (!chatResponse) {
      await sendWhatsApp(fromNumber, "Sorry, I'm having trouble thinking right now. Try again in a moment!");
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send('<Response></Response>');
    }

    // Save assistant response to WhatsApp conversation history
    await db.collection('users').doc(userId)
      .collection('whatsappMessages').add({
        role: 'assistant',
        content: chatResponse,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

    // Send response via WhatsApp
    console.log(`[WhatsApp Webhook] Sending response: "${chatResponse.substring(0, 80)}..."`);
    await sendWhatsApp(fromNumber, chatResponse);

    // Return empty TwiML (we send the response via API, not TwiML)
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send('<Response></Response>');

  } catch (error) {
    console.error('[WhatsApp Webhook] Error:', error);
    // Always return valid TwiML to Twilio
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send('<Response></Response>');
  }
};

/**
 * Call the internal chat API to get Samantha's response
 */
async function callChatAPI(userId, messages) {
  try {
    // Always use production URL — VERCEL_URL is deployment-specific and unreliable
    const chatApiUrl = 'https://mindclone.one/api/chat';

    // Use AbortController for timeout (100s — we have 120s function limit)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 100000);

    const requestBody = {
      userId: userId,
      context: 'private',
      messages: messages
    };

    console.log(`[WhatsApp Webhook] Calling: ${chatApiUrl} with ${messages.length} messages for user ${userId}`);
    console.log(`[WhatsApp Webhook] Last message: "${messages[messages.length - 1]?.content?.substring(0, 50)}"`);

    const response = await fetch(chatApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(requestBody)
    });

    clearTimeout(timeoutId);

    const responseText = await response.text();
    console.log(`[WhatsApp Webhook] Chat API response: status=${response.status}, length=${responseText.length}, first200="${responseText.substring(0, 200)}"`);

    if (!response.ok) {
      console.error(`[WhatsApp Webhook] Chat API returned ${response.status}: ${responseText.substring(0, 500)}`);
      return null;
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error(`[WhatsApp Webhook] JSON parse failed. Raw response: ${responseText.substring(0, 500)}`);
      // If response is plain text (not JSON), use it directly
      if (responseText && responseText.length > 0 && responseText.length < 2000) {
        return responseText.trim();
      }
      return null;
    }

    console.log(`[WhatsApp Webhook] Parsed data keys: ${Object.keys(data).join(', ')}`);

    // Chat API returns { success: true, content: "..." }
    let text = data.content || data.response || data.message || data.text || '';

    if (typeof text !== 'string') {
      text = JSON.stringify(text);
    }

    // Strip any markdown that slipped through
    text = text
      .replace(/\*\*(.*?)\*\*/g, '$1')  // Remove bold
      .replace(/#{1,6}\s+/g, '')          // Remove headers
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2') // Links to plain text
      .trim();

    // Truncate if too long for WhatsApp
    if (text.length > 1500) {
      text = text.substring(0, 1497) + '...';
    }

    console.log(`[WhatsApp Webhook] Final response text (${text.length} chars): "${text.substring(0, 80)}..."`);
    return text || null;

  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('[WhatsApp Webhook] Chat API call TIMED OUT after 100s');
    } else {
      console.error(`[WhatsApp Webhook] Error calling chat API: ${error.name}: ${error.message}`);
    }
    return null;
  }
}
