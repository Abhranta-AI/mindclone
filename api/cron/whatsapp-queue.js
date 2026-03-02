// WhatsApp Queue Processor - Runs every 2 minutes to send queued messages
const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');
const { sendWhatsApp, getWhatsAppConfig, isQuietHours } = require('../_whatsapp');

initializeFirebaseAdmin();
const db = admin.firestore();

const BATCH_SIZE = 10; // Process up to 10 messages per run
const RETRY_DELAYS = [120000, 300000, 900000]; // 2min, 5min, 15min

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
  // Auth check (same pattern as other crons)
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = req.headers.authorization;
  const providedToken = authHeader?.replace('Bearer ', '').trim();
  const isManualAuth = cronSecret && providedToken === cronSecret;
  
  if (!isVercelCron && !isManualAuth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  console.log('[WhatsApp Queue] Starting queue processing');
  
  try {
    const now = admin.firestore.Timestamp.now();
    
    // Fetch pending messages ready to send
    const queueSnap = await db.collection('whatsappQueue')
      .where('status', '==', 'pending')
      .where('nextRetry', '<=', now)
      .orderBy('nextRetry')
      .limit(BATCH_SIZE)
      .get();
    
    if (queueSnap.empty) {
      console.log('[WhatsApp Queue] No pending messages');
      return res.status(200).json({ status: 'ok', processed: 0 });
    }
    
    console.log(`[WhatsApp Queue] Found ${queueSnap.size} messages to process`);
    
    let sent = 0, failed = 0, deferred = 0;
    
    for (const doc of queueSnap.docs) {
      const msg = doc.data();
      
      try {
        // Check if WhatsApp is still enabled for this user
        const config = await getWhatsAppConfig(msg.userId);
        
        if (!config.enabled) {
          console.log(`[WhatsApp Queue] Disabled for ${msg.userId}, removing from queue`);
          await doc.ref.update({ status: 'cancelled', reason: 'disabled' });
          continue;
        }
        
        // Check quiet hours — defer, don't fail
        if (isQuietHours(config)) {
          console.log(`[WhatsApp Queue] Quiet hours for ${msg.userId}, deferring`);
          // Set next retry to 8am IST tomorrow
          const nextMorning = new Date();
          nextMorning.setUTCHours(2, 30, 0, 0); // 8am IST = 2:30 UTC
          if (nextMorning <= new Date()) {
            nextMorning.setDate(nextMorning.getDate() + 1);
          }
          await doc.ref.update({ nextRetry: admin.firestore.Timestamp.fromDate(nextMorning) });
          deferred++;
          continue;
        }
        
        // Check daily limit
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        const todayCount = (await db.collection('whatsappQueue')
          .where('userId', '==', msg.userId)
          .where('status', '==', 'sent')
          .where('sentAt', '>=', admin.firestore.Timestamp.fromDate(dayStart))
          .get()).size;
        
        if (todayCount >= (config.dailyLimit || 20)) {
          console.log(`[WhatsApp Queue] Daily limit reached for ${msg.userId}`);
          await doc.ref.update({ status: 'cancelled', reason: 'daily_limit' });
          continue;
        }
        
        // Send the message
        const result = await sendWhatsApp(msg.phoneNumber, msg.message);
        
        // Mark as sent
        await doc.ref.update({
          status: 'sent',
          twilioSid: result.sid,
          sentAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        sent++;
        console.log(`[WhatsApp Queue] Sent ${doc.id} to ${msg.phoneNumber}`);
        
      } catch (error) {
        console.error(`[WhatsApp Queue] Error processing ${doc.id}:`, error.message);
        
        const attempts = (msg.attempts || 0) + 1;
        
        if (attempts >= (msg.maxAttempts || 3)) {
          // Max retries exhausted
          await doc.ref.update({
            status: 'failed',
            attempts,
            lastError: error.message,
            failedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          failed++;
        } else {
          // Schedule retry with backoff
          const delay = RETRY_DELAYS[attempts - 1] || 900000;
          const nextRetry = new Date(Date.now() + delay);
          await doc.ref.update({
            attempts,
            lastError: error.message,
            nextRetry: admin.firestore.Timestamp.fromDate(nextRetry)
          });
          deferred++;
        }
      }
    }
    
    console.log(`[WhatsApp Queue] Done: ${sent} sent, ${failed} failed, ${deferred} deferred`);
    
    return res.status(200).json({
      status: 'ok',
      processed: queueSnap.size,
      sent,
      failed,
      deferred
    });
    
  } catch (error) {
    console.error('[WhatsApp Queue] Fatal error:', error);
    return res.status(500).json({ error: error.message });
  }
};
