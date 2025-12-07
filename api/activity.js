// Activity Feed API - fetch recent visitor conversations
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

// Get recent visitor activity
async function getRecentActivity(userId, limit = 20) {
  try {
    // Get recent visitors sorted by last visit
    const visitorsSnapshot = await db.collection('users').doc(userId)
      .collection('visitors')
      .orderBy('lastVisit', 'desc')
      .limit(limit)
      .get();

    if (visitorsSnapshot.empty) {
      return [];
    }

    const activities = [];

    // Process each visitor
    for (const visitorDoc of visitorsSnapshot.docs) {
      const visitorData = visitorDoc.data();
      const visitorId = visitorDoc.id;

      // Get last 2 messages from this visitor (user message + AI response)
      const messagesSnapshot = await db.collection('users').doc(userId)
        .collection('visitors').doc(visitorId)
        .collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(2)
        .get();

      if (!messagesSnapshot.empty) {
        const messages = messagesSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        // Find last user message and AI response
        let lastMessage = null;
        let lastResponse = null;

        for (const msg of messages) {
          if (msg.role === 'user' && !lastMessage) {
            lastMessage = msg.content;
          } else if (msg.role === 'assistant' && !lastResponse) {
            lastResponse = msg.content;
          }
        }

        // Use lastMessage from visitor data as fallback
        if (!lastMessage && visitorData.lastMessage) {
          lastMessage = visitorData.lastMessage;
        }

        // Only add if we have at least a user message
        if (lastMessage) {
          activities.push({
            visitorId: visitorId,
            lastMessage: lastMessage,
            lastResponse: lastResponse,
            lastTimestamp: visitorData.lastVisit || messages[0]?.timestamp,
            isNew: false // TODO: Implement real-time "new" detection in Phase 3
          });
        }
      }
    }

    return activities;
  } catch (error) {
    console.error('Error getting recent activity:', error);
    throw error;
  }
}

// Main handler
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    const idToken = authHeader ? authHeader.replace('Bearer ', '') : null;

    if (!idToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = await verifyToken(idToken);

    // Get limit from query params (default 20, max 50)
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);

    // Get recent activity
    const activities = await getRecentActivity(userId, limit);

    return res.status(200).json({
      activities: activities,
      count: activities.length
    });

  } catch (error) {
    console.error('Activity API error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
};
