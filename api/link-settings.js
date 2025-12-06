// Link settings API - manage public link configuration
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Verify Firebase ID token
async function verifyToken(idToken) {
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken.uid;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

// Get link settings
async function getSettings(userId) {
  try {
    // Get user document
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data() || {};

    // Get link settings
    const settingsDoc = await db.collection('users').doc(userId)
      .collection('linkSettings').doc('config').get();
    const settingsData = settingsDoc.data() || {};

    // Calculate stats
    const stats = await calculateStats(userId);

    return {
      username: userData.username || null,
      linkEnabled: userData.linkEnabled || false,
      displayName: settingsData.displayName || userData.displayName || '',
      bio: settingsData.bio || '',
      customGreeting: settingsData.customGreeting || '',
      analyticsEnabled: settingsData.analyticsEnabled || false,
      stats: stats
    };
  } catch (error) {
    console.error('Error getting settings:', error);
    throw error;
  }
}

// Calculate visitor statistics
async function calculateStats(userId) {
  try {
    // Count total visitors
    const visitorsSnapshot = await db.collection('users').doc(userId)
      .collection('visitors').get();
    const totalVisitors = visitorsSnapshot.size;

    // Count total visitor messages
    let totalMessages = 0;
    for (const visitorDoc of visitorsSnapshot.docs) {
      const messagesSnapshot = await db.collection('users').doc(userId)
        .collection('visitors').doc(visitorDoc.id)
        .collection('messages').get();
      totalMessages += messagesSnapshot.size;
    }

    // Count public messages
    const publicMessagesSnapshot = await db.collection('users').doc(userId)
      .collection('messages')
      .where('isPublic', '==', true)
      .get();
    const publicMessages = publicMessagesSnapshot.size;

    return {
      totalVisitors,
      totalMessages,
      publicMessages
    };
  } catch (error) {
    console.error('Error calculating stats:', error);
    return {
      totalVisitors: 0,
      totalMessages: 0,
      publicMessages: 0
    };
  }
}

// Save link settings
async function saveSettings(userId, settings) {
  try {
    // Validate settings
    if (settings.bio && settings.bio.length > 200) {
      throw new Error('Bio must be 200 characters or less');
    }

    // Update user document (linkEnabled only)
    await db.collection('users').doc(userId).set({
      linkEnabled: settings.linkEnabled || false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Update link settings
    await db.collection('users').doc(userId)
      .collection('linkSettings').doc('config').set({
        displayName: settings.displayName || '',
        bio: settings.bio || '',
        customGreeting: settings.customGreeting || '',
        analyticsEnabled: settings.analyticsEnabled !== undefined ? settings.analyticsEnabled : false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    throw error;
  }
}

// Main handler
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    const idToken = authHeader ? authHeader.replace('Bearer ', '') : req.body?.idToken;

    if (!idToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = await verifyToken(idToken);

    if (req.method === 'GET') {
      // Get settings
      const settings = await getSettings(userId);
      return res.status(200).json(settings);
    }

    if (req.method === 'POST') {
      // Save settings
      const { linkEnabled, displayName, bio, customGreeting, analyticsEnabled } = req.body;

      await saveSettings(userId, {
        linkEnabled,
        displayName,
        bio,
        customGreeting,
        analyticsEnabled
      });

      return res.status(200).json({
        success: true,
        message: 'Settings saved successfully'
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Link settings API error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
};
