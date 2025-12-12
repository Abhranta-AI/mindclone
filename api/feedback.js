// Feedback submission endpoint
// Receives user feedback with optional screenshot and stores it for review

const { put } = require('@vercel/blob');
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

// Initialize Firebase
initializeFirebaseAdmin();
const db = admin.firestore();

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
    const { userId, userEmail, type, message, screenshot, timestamp, userAgent, url } = req.body;

    if (!message || message.trim().length < 10) {
      return res.status(400).json({ error: 'Feedback message must be at least 10 characters' });
    }

    console.log('[Feedback] Received feedback from:', userEmail || userId);

    let screenshotUrl = null;

    // Upload screenshot to Vercel Blob if provided
    if (screenshot && process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        // Remove data URL prefix
        const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const filename = `feedback/${userId || 'anonymous'}/${Date.now()}-screenshot.jpg`;
        const blob = await put(filename, buffer, {
          access: 'public',
          contentType: 'image/jpeg',
          token: process.env.BLOB_READ_WRITE_TOKEN
        });

        screenshotUrl = blob.url;
        console.log('[Feedback] Screenshot uploaded:', screenshotUrl);
      } catch (uploadError) {
        console.error('[Feedback] Screenshot upload failed:', uploadError.message);
        // Continue without screenshot - don't fail the whole submission
      }
    }

    // Save feedback to Firestore
    const feedbackDoc = {
      userId: userId || 'anonymous',
      userEmail: userEmail || 'anonymous',
      type: type || 'other',
      message: message.trim(),
      screenshotUrl,
      userAgent,
      pageUrl: url,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
      clientTimestamp: timestamp,
      status: 'new', // new, reviewed, resolved
      notes: null // for admin notes
    };

    const docRef = await db.collection('feedback').add(feedbackDoc);
    console.log('[Feedback] Saved to Firestore:', docRef.id);

    return res.status(200).json({
      success: true,
      feedbackId: docRef.id,
      message: 'Feedback submitted successfully'
    });

  } catch (error) {
    console.error('[Feedback] Error:', error.message, error.stack);
    return res.status(500).json({
      error: 'Failed to submit feedback',
      details: error.message
    });
  }
};
