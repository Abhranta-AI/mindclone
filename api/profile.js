// Public profile API - lookup username and return public profile data
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Get public profile by username
async function getPublicProfile(username) {
  try {
    // Normalize username
    const normalizedUsername = username.trim().toLowerCase();

    // Look up username in usernames collection
    const usernameDoc = await db.collection('usernames').doc(normalizedUsername).get();

    if (!usernameDoc.exists) {
      return {
        error: 'not_found',
        message: 'Username not found'
      };
    }

    const userId = usernameDoc.data().userId;

    // Get user document
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data() || {};

    // Check if link is enabled
    if (!userData.linkEnabled) {
      return {
        error: 'disabled',
        message: 'This Mindclone link is currently disabled'
      };
    }

    // Get link settings
    const settingsDoc = await db.collection('users').doc(userId)
      .collection('linkSettings').doc('config').get();
    const settingsData = settingsDoc.data() || {};

    // Return public profile
    return {
      username: normalizedUsername,
      displayName: settingsData.displayName || userData.displayName || 'Mindclone User',
      bio: settingsData.bio || '',
      customGreeting: settingsData.customGreeting || 'Hello! Ask me anything.',
      photoURL: userData.photoURL || null,
      linkEnabled: true
    };
  } catch (error) {
    console.error('Error getting public profile:', error);
    throw error;
  }
}

// Main handler
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username } = req.query;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const profile = await getPublicProfile(username);

    if (profile.error === 'not_found') {
      return res.status(404).json({
        error: 'Username not found',
        message: profile.message
      });
    }

    if (profile.error === 'disabled') {
      return res.status(403).json({
        error: 'Link disabled',
        message: profile.message
      });
    }

    return res.status(200).json(profile);
  } catch (error) {
    console.error('Profile API error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
};
