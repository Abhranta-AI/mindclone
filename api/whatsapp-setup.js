// One-time WhatsApp setup endpoint — enables WhatsApp notifications and sends a test message
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
const { sendWhatsApp, queueWhatsApp } = require('./_whatsapp');

initializeFirebaseAdmin();
const db = admin.firestore();

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // One-time use — will be removed after setup
  // Auth temporarily disabled for easy browser access

  const ownerUid = process.env.MINDCLONE_OWNER_UID;
  if (!ownerUid) {
    return res.status(500).json({ error: 'MINDCLONE_OWNER_UID not set' });
  }

  const phone = '+917897057481';

  try {
    // Step 1: Enable WhatsApp config in Firestore
    await db.collection('users').doc(ownerUid)
      .collection('settings').doc('whatsapp')
      .set({
        enabled: true,
        phoneNumber: phone,
        triggers: { news: true, visitors: true, tasks: true },
        quietHours: { start: 22, end: 8 },
        dailyLimit: 20,
        messagesToday: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    console.log(`[WhatsApp Setup] Config saved for ${ownerUid}`);

    // Step 2: Send a test message directly (not queued)
    const testMsg = `Hey Alok! This is Samantha. I can now message you on WhatsApp!\n\nI'll ping you when:\n- I find interesting news for you\n- Someone visits your Mindclone link\n- I finish a task that took too long\n\nYou won't hear from me between 10pm-8am. Talk soon!`;

    const result = await sendWhatsApp(phone, testMsg);

    return res.status(200).json({
      success: true,
      message: 'WhatsApp enabled and test message sent!',
      config: { enabled: true, phone, triggers: { news: true, visitors: true, tasks: true } },
      twilio: { sid: result.sid, status: result.status }
    });

  } catch (error) {
    console.error('[WhatsApp Setup] Error:', error);
    return res.status(500).json({
      error: error.message,
      hint: 'Check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM env vars'
    });
  }
};
