// Moltbook Debug Endpoint - Simple version that won't hang
// DELETE THIS FILE AFTER DEBUGGING

module.exports = async (req, res) => {
  const debug = {
    timestamp: new Date().toISOString(),
    envVars: {
      MOLTBOOK_API_KEY: process.env.MOLTBOOK_API_KEY ? `set (${process.env.MOLTBOOK_API_KEY.length} chars)` : 'NOT SET',
      CRON_SECRET: process.env.CRON_SECRET ? 'set' : 'NOT SET',
      NODE_ENV: process.env.NODE_ENV || 'not set'
    }
  };

  // Only proceed if API key is set
  if (!process.env.MOLTBOOK_API_KEY) {
    debug.error = 'MOLTBOOK_API_KEY is not set in Vercel environment variables!';
    debug.fix = 'Go to Vercel Dashboard > Project > Settings > Environment Variables > Add MOLTBOOK_API_KEY';
    return res.status(200).json(debug);
  }

  // Try to make a simple request to Moltbook
  try {
    debug.step = 'testing_moltbook_api';
    const response = await fetch('https://www.moltbook.com/api/v1/agents/status', {
      headers: {
        'Authorization': `Bearer ${process.env.MOLTBOOK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    debug.moltbookResponse = {
      status: response.status,
      data: data
    };
  } catch (e) {
    debug.moltbookError = e.message;
  }

  // Try Firebase
  try {
    debug.step = 'testing_firebase';
    const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
    initializeFirebaseAdmin();
    const db = admin.firestore();

    const stateDoc = await db.doc('system/moltbook-state').get();
    debug.firebaseState = stateDoc.exists ? stateDoc.data() : 'no state doc';

    const settingsDoc = await db.doc('system/moltbook-settings').get();
    debug.firebaseSettings = settingsDoc.exists ? 'exists' : 'no settings doc';
  } catch (e) {
    debug.firebaseError = e.message;
  }

  debug.step = 'complete';
  return res.status(200).json(debug);
};
