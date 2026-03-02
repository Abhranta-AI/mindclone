// WhatsApp Webhook - Receives incoming WhatsApp messages via Twilio and responds via Samantha
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
const { sendWhatsApp, getWhatsAppConfig } = require('./_whatsapp');

initializeFirebaseAdmin();
const db = admin.firestore();

// Parse URL-encoded body (Twilio sends form data, not JSON)
function parseFormBody(body) {
  if (typeof body === 'object') return body; // Already parsed
  if (typeof body !== 'string') return {};
  const params = {};
  body.split('&').forEach(pair => {
    const [key, val] = pair.split('=').map(decodeURIComponent);
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
    const params = parseFormBody(req.body);
    const fromNumber = (params.From || '').replace('whatsapp:', '');
    const messageBody = params.Body || '';
    const messageSid = params.MessageSid || '';

    console.log(`[WhatsApp Webhook] Incoming from ${fromNumber}: "${messageBody.substring(0, 100)}"`);

    if (!fromNumber || !messageBody) {
      // Return TwiML empty response (Twilio expects XML)
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send('<Response></Response>');
    }

    // Find which user owns this phone number
    const usersSnap = await db.collectionGroup('whatsapp')
      .where('phoneNumber', '==', fromNumber)
      .limit(1)
      .get();

    let userId = null;

    if (!usersSnap.empty) {
      // Path is: users/{userId}/settings/whatsapp
      const docPath = usersSnap.docs[0].ref.path;
      userId = docPath.split('/')[1]; // Extract userId from path
    }

    // Fallback: check MINDCLONE_OWNER_UID if phone matches
    if (!userId) {
      const ownerUid = process.env.MINDCLONE_OWNER_UID;
      if (ownerUid) {
        const ownerConfig = await db.collection('users').doc(ownerUid)
          .collection('settings').doc('whatsapp').get();
        if (ownerConfig.exists && ownerConfig.data().phoneNumber === fromNumber) {
          userId = ownerUid;
        }
      }
    }

    if (!userId) {
      console.log(`[WhatsApp Webhook] No user found for number ${fromNumber}`);
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

    const response = await fetch(chatApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId,
        context: 'private',
        messages: messages,
        whatsappMode: true, // Signal to chat API this is WhatsApp
        systemPromptAddition: whatsappContext
      })
    });

    if (!response.ok) {
      console.error(`[WhatsApp Webhook] Chat API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Extract text response (chat API returns in various formats)
    let text = data.response || data.message || data.content || '';

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
