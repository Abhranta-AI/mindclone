// Analytics API - visitor statistics for link owners
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

// Get visitor statistics
async function getVisitorStats(userId) {
  try {
    console.log('[Analytics] Getting stats for userId:', userId);

    // Get all visitors - try with orderBy first, fall back to simple get if index missing
    let visitorsSnapshot;
    try {
      visitorsSnapshot = await db.collection('users').doc(userId)
        .collection('visitors')
        .orderBy('lastVisit', 'desc')
        .get();
    } catch (orderError) {
      console.log('[Analytics] OrderBy failed, trying simple get:', orderError.message);
      // Fall back to getting all without order
      visitorsSnapshot = await db.collection('users').doc(userId)
        .collection('visitors')
        .get();
    }

    console.log('[Analytics] Visitors found:', visitorsSnapshot.size);
    const totalVisitors = visitorsSnapshot.size;
    let totalMessages = 0;
    const recentVisitors = [];

    // Process each visitor
    for (const visitorDoc of visitorsSnapshot.docs) {
      const visitorData = visitorDoc.data();
      const visitorId = visitorDoc.id;

      // Count messages for this visitor
      const messagesSnapshot = await db.collection('users').doc(userId)
        .collection('visitors').doc(visitorId)
        .collection('messages')
        .get();

      const messageCount = messagesSnapshot.size;
      totalMessages += messageCount;

      // Add to recent visitors (limit to 10)
      if (recentVisitors.length < 10) {
        recentVisitors.push({
          visitorId: visitorId,
          firstVisit: visitorData.firstVisit || visitorData.lastVisit,
          lastVisit: visitorData.lastVisit,
          messageCount: messageCount,
          lastMessage: visitorData.lastMessage || 'No messages yet'
        });
      }
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
      publicMessages,
      recentVisitors
    };
  } catch (error) {
    console.error('Error getting visitor stats:', error);
    throw error;
  }
}

// Get detailed visitor info
async function getVisitorDetails(userId, visitorId) {
  try {
    // Get visitor metadata
    const visitorDoc = await db.collection('users').doc(userId)
      .collection('visitors').doc(visitorId).get();

    if (!visitorDoc.exists) {
      throw new Error('Visitor not found');
    }

    const visitorData = visitorDoc.data();

    // Get visitor messages
    const messagesSnapshot = await db.collection('users').doc(userId)
      .collection('visitors').doc(visitorId)
      .collection('messages')
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();

    const messages = messagesSnapshot.docs.map(doc => {
      const data = doc.data();
      const message = {
        messageId: doc.id,
        role: data?.role,
        content: data?.content,
        timestamp: data?.timestamp
      };

      // Include displayAction if present (for slide/excel displays)
      if (data?.displayAction) {
        message.displayAction = data.displayAction;
      }

      return message;
    });

    return {
      visitorId: visitorId,
      firstVisit: visitorData?.firstVisit || visitorData?.lastVisit,
      lastVisit: visitorData?.lastVisit,
      messageCount: messages.length,
      messages: messages
    };
  } catch (error) {
    console.error('Error getting visitor details:', error);
    throw error;
  }
}

// Get time-based statistics
async function getTimeBasedStats(userId, days = 30) {
  try {
    console.log('[Analytics] Getting time-based stats for userId:', userId, 'days:', days);
    const now = Date.now();
    const startTime = now - (days * 24 * 60 * 60 * 1000);
    const startDate = admin.firestore.Timestamp.fromMillis(startTime);

    // Get visitors - try with where filter, fall back to getting all and filtering
    let visitorsSnapshot;
    try {
      visitorsSnapshot = await db.collection('users').doc(userId)
        .collection('visitors')
        .where('lastVisit', '>=', startDate)
        .get();
    } catch (whereError) {
      console.log('[Analytics] Where query failed, getting all visitors:', whereError.message);
      // Fall back to getting all visitors
      const allVisitors = await db.collection('users').doc(userId)
        .collection('visitors')
        .get();
      // Filter manually
      visitorsSnapshot = {
        docs: allVisitors.docs.filter(doc => {
          const lastVisit = doc.data().lastVisit;
          return lastVisit && lastVisit.toMillis() >= startTime;
        }),
        size: 0
      };
      visitorsSnapshot.size = visitorsSnapshot.docs.length;
    }

    console.log('[Analytics] Time-based visitors found:', visitorsSnapshot.size);
    const totalVisitors = visitorsSnapshot.size;

    // Count recent messages
    let totalMessages = 0;
    const recentVisitors = [];

    for (const visitorDoc of visitorsSnapshot.docs) {
      const visitorData = visitorDoc.data();
      let messageCount = 0;

      try {
        const messagesSnapshot = await db.collection('users').doc(userId)
          .collection('visitors').doc(visitorDoc.id)
          .collection('messages')
          .where('timestamp', '>=', startDate)
          .get();
        messageCount = messagesSnapshot.size;
      } catch (msgError) {
        // Fall back to counting all messages
        const allMessages = await db.collection('users').doc(userId)
          .collection('visitors').doc(visitorDoc.id)
          .collection('messages')
          .get();
        // Filter manually
        messageCount = allMessages.docs.filter(doc => {
          const timestamp = doc.data().timestamp;
          return timestamp && timestamp.toMillis() >= startTime;
        }).length;
      }

      totalMessages += messageCount;

      // Add to recent visitors list (limit to 10)
      if (recentVisitors.length < 10) {
        recentVisitors.push({
          visitorId: visitorDoc.id,
          firstVisit: visitorData.firstVisit || visitorData.lastVisit,
          lastVisit: visitorData.lastVisit,
          messageCount: messageCount,
          lastMessage: visitorData.lastMessage || 'No messages yet'
        });
      }
    }

    // Return data with field names matching what frontend expects
    return {
      period: `${days} days`,
      totalVisitors: totalVisitors,
      totalMessages: totalMessages,
      publicMessages: 0, // Not tracked for time-based
      recentVisitors: recentVisitors,
      startDate: startDate.toDate()
    };
  } catch (error) {
    console.error('Error getting time-based stats:', error);
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

    const { visitorId, period } = req.query;

    // Get specific visitor details
    if (visitorId) {
      const visitorDetails = await getVisitorDetails(userId, visitorId);
      return res.status(200).json(visitorDetails);
    }

    // Get time-based stats
    if (period) {
      const days = parseInt(period, 10);
      if (isNaN(days) || days < 1 || days > 365) {
        return res.status(400).json({ error: 'Period must be between 1 and 365 days' });
      }

      const timeStats = await getTimeBasedStats(userId, days);
      return res.status(200).json(timeStats);
    }

    // Get overall visitor statistics
    const stats = await getVisitorStats(userId);
    return res.status(200).json(stats);

  } catch (error) {
    console.error('Analytics API error:', error);
    return res.status(500).json({
      error: error?.message || 'Internal server error'
    });
  }
};
