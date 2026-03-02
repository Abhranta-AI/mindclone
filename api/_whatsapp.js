// WhatsApp Messaging Service - Twilio integration for proactive messaging
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

initializeFirebaseAdmin();
const db = admin.firestore();

// Twilio client (lazy init)
let twilioClient = null;
function getTwilioClient() {
  if (!twilioClient) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set');
    }
    twilioClient = require('twilio')(accountSid, authToken);
  }
  return twilioClient;
}

/**
 * Send a WhatsApp message via Twilio
 * @param {string} to - Phone number with country code (e.g., "+917897057481")
 * @param {string} message - Message text (max ~1600 chars for WhatsApp)
 * @returns {object} Twilio message SID and status
 */
async function sendWhatsApp(to, message) {
  const client = getTwilioClient();
  const from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
  
  // Format phone number for WhatsApp
  const toWhatsApp = to.startsWith('whatsapp:') ? to : `whatsapp:${to.replace(/\s/g, '')}`;
  
  // Truncate if too long
  const truncatedMsg = message.length > 1500 
    ? message.substring(0, 1497) + '...' 
    : message;
  
  console.log(`[WhatsApp] Sending to ${toWhatsApp}: ${truncatedMsg.substring(0, 50)}...`);
  
  const result = await client.messages.create({
    from: from,
    to: toWhatsApp,
    body: truncatedMsg
  });
  
  console.log(`[WhatsApp] Sent! SID: ${result.sid}, Status: ${result.status}`);
  return { sid: result.sid, status: result.status };
}

/**
 * Queue a WhatsApp message for async delivery
 * This is the preferred method — messages are processed by the queue cron job
 * @param {string} userId - Firestore user ID
 * @param {string} message - Message to send
 * @param {string} type - Message type: "news" | "visitor" | "task"
 */
async function queueWhatsApp(userId, message, type = 'general') {
  try {
    // Get user's WhatsApp config
    const config = await getWhatsAppConfig(userId);
    
    if (!config.enabled) {
      console.log(`[WhatsApp] Notifications disabled for ${userId}, skipping`);
      return null;
    }
    
    if (!config.phoneNumber) {
      console.log(`[WhatsApp] No phone number for ${userId}, skipping`);
      return null;
    }
    
    // Check if this trigger type is enabled
    if (config.triggers && config.triggers[type] === false) {
      console.log(`[WhatsApp] Trigger '${type}' disabled for ${userId}, skipping`);
      return null;
    }
    
    // Format message for WhatsApp (strip markdown)
    const formattedMsg = formatForWhatsApp(message);
    
    // Add to queue
    const queueRef = await db.collection('whatsappQueue').add({
      userId,
      phoneNumber: config.phoneNumber,
      message: formattedMsg,
      type,
      attempts: 0,
      maxAttempts: 3,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      nextRetry: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`[WhatsApp] Queued message ${queueRef.id} for ${userId} (type: ${type})`);
    return queueRef.id;
  } catch (error) {
    console.error(`[WhatsApp] Error queuing message:`, error.message);
    return null;
  }
}

/**
 * Get user's WhatsApp configuration
 */
async function getWhatsAppConfig(userId) {
  try {
    const configDoc = await db.collection('users').doc(userId)
      .collection('settings').doc('whatsapp').get();
    
    if (!configDoc.exists) {
      // Return defaults — disabled until user sets up
      return {
        enabled: false,
        phoneNumber: null,
        triggers: { news: true, visitors: true, tasks: true },
        quietHours: { start: 22, end: 8 }, // 10pm-8am IST
        dailyLimit: 20,
        messagesToday: 0
      };
    }
    
    return configDoc.data();
  } catch (error) {
    console.error(`[WhatsApp] Error loading config:`, error.message);
    return { enabled: false };
  }
}

/**
 * Check if it's quiet hours for the user
 */
function isQuietHours(config) {
  // Use IST (UTC+5:30) by default
  const now = new Date();
  const istHour = (now.getUTCHours() + 5 + (now.getUTCMinutes() + 30 >= 60 ? 1 : 0)) % 24;
  
  const start = config.quietHours?.start ?? 22;
  const end = config.quietHours?.end ?? 8;
  
  if (start > end) {
    // Overnight quiet hours (e.g., 22-8)
    return istHour >= start || istHour < end;
  } else {
    // Daytime quiet hours (unusual but supported)
    return istHour >= start && istHour < end;
  }
}

/**
 * Format message for WhatsApp (strip markdown, keep links)
 */
function formatForWhatsApp(text) {
  if (!text) return '';
  
  return text
    // Convert markdown bold to WhatsApp bold
    .replace(/\*\*(.*?)\*\*/g, '*$1*')
    // Convert markdown links [text](url) to "text: url"
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2')
    // Remove markdown headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove HTML tags
    .replace(/<[^>]+>/g, '')
    // Collapse multiple newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = {
  sendWhatsApp,
  queueWhatsApp,
  getWhatsAppConfig,
  isQuietHours,
  formatForWhatsApp
};
