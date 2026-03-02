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
    const historySnap = await db.collection('users').doc(userId)
      .collection('whatsappMessages')
      .orderBy('timestamp', 'desc')
      .limit(20)
      .get();

    const conversationHistory = [];
    historySnap.docs.reverse().forEach(doc => {
      const data = doc.data();
      conversationHistory.push({
        role: data.role,
        content: data.content
      });
    });

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
    const chatApiUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}/api/chat`
      : 'https://mindclone.one/api/chat';

    // Build a WhatsApp-specific system prompt addition
    const whatsappContext = `\n\nIMPORTANT: You are responding via WhatsApp. Keep your responses concise and conversational — ideally 1-3 short paragraphs. No markdown formatting (no **bold**, no headers, no bullet points with -). Use plain text only. Use line breaks for readability. Remember: this is a quick WhatsApp chat, not a long email.`;

    // Use AbortController for timeout (50s — Vercel functions have 60s max)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50000);

    console.log(`[WhatsApp Webhook] Calling: ${chatApiUrl}`);

    const response = await fetch(chatApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        userId: userId,
        context: 'private',
        messages: messages,
        whatsappMode: true, // Signal to chat API this is WhatsApp
        systemPromptAddition: whatsappContext
      })
    });

    clearTimeout(timeout);

    const responseText = await response.text();
    console.log(`[WhatsApp Webhook] Chat API status: ${response.status}, body length: ${responseText.length}`);

    if (!response.ok) {
      console.error(`[WhatsApp Webhook] Chat API error: ${response.status} - ${responseText.substring(0, 200)}`);
      return null;
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error(`[WhatsApp Webhook] Failed to parse chat response: ${responseText.substring(0, 200)}`);
      return null;
    }

    // Chat API returns { success: true, content: "..." }
    let text = data.content || data.response || data.message || '';

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

    return text || null;

  } catch (error) {
    console.error('[WhatsApp Webhook] Error calling chat API:', error.message);
    return null;
  }
}
