// Moltbook Settings API - Configure mindclone's behavior on Moltbook
// Now user-specific: each user has their own settings

const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
const { DEFAULT_SETTINGS } = require('./_moltbook-settings');

initializeFirebaseAdmin();
const db = admin.firestore();

/**
 * Verify Firebase auth token and get user ID
 */
async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No authorization token provided');
  }

  const idToken = authHeader.split('Bearer ')[1];
  const decodedToken = await admin.auth().verifyIdToken(idToken);
  return decodedToken.uid;
}

/**
 * Get user-specific Moltbook settings
 */
async function getUserMoltbookSettings(userId) {
  const doc = await db.collection('users').doc(userId).collection('settings').doc('moltbook').get();
  if (doc.exists) {
    return { ...DEFAULT_SETTINGS, ...doc.data() };
  }
  return DEFAULT_SETTINGS;
}

/**
 * Update user-specific Moltbook settings
 */
async function updateUserMoltbookSettings(userId, updates) {
  const currentSettings = await getUserMoltbookSettings(userId);
  const newSettings = {
    ...currentSettings,
    ...updates,
    updatedAt: new Date().toISOString()
  };

  await db.collection('users').doc(userId).collection('settings').doc('moltbook').set(newSettings);
  return newSettings;
}

// API handler
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Verify authentication
    const userId = await verifyAuth(req);

    if (req.method === 'GET') {
      const settings = await getUserMoltbookSettings(userId);
      return res.status(200).json({ success: true, settings });
    }

    if (req.method === 'POST') {
      const updates = req.body;

      // Validate updates
      const allowedFields = [
        'enabled', 'objective', 'postingEnabled', 'maxPostsPerDay',
        'minHoursBetweenPosts', 'upvotingEnabled', 'maxUpvotesPerDay',
        'commentingEnabled', 'maxCommentsPerDay', 'commentProbability',
        'repliesEnabled', 'maxRepliesPerHeartbeat', 'topics', 'customPosts',
        'useDefaultPosts', 'agentName', 'agentDescription', 'humanCreator',
        'humanCreatorHandle', 'profileLink', 'commentStyle', 'includeCallToAction',
        'businessName', 'businessUrl', 'businessTagline', 'promotionFrequency'
      ];

      const filteredUpdates = {};
      for (const key of allowedFields) {
        if (updates[key] !== undefined) {
          filteredUpdates[key] = updates[key];
        }
      }

      const newSettings = await updateUserMoltbookSettings(userId, filteredUpdates);
      return res.status(200).json({ success: true, settings: newSettings });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('[Moltbook Settings] Error:', error);

    if (error.message.includes('authorization') || error.message.includes('token')) {
      return res.status(401).json({ error: 'Unauthorized', message: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
};
