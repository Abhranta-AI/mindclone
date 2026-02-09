// Notifications API
// Get and manage user notifications

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
    const idToken = authHeader ? authHeader.replace('Bearer ', '') : null;

    if (!idToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = await verifyToken(idToken);

    // GET - List notifications
    if (req.method === 'GET') {
      const { unreadOnly = 'true', limit = '20' } = req.query;

      let query = db.collection('users').doc(userId)
        .collection('notifications')
        .orderBy('createdAt', 'desc')
        .limit(parseInt(limit));

      if (unreadOnly === 'true') {
        query = db.collection('users').doc(userId)
          .collection('notifications')
          .where('read', '==', false)
          .orderBy('createdAt', 'desc')
          .limit(parseInt(limit));
      }

      const snapshot = await query.get();

      const notifications = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        notifications.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || null
        });
      });

      // Count unread
      const unreadSnapshot = await db.collection('users').doc(userId)
        .collection('notifications')
        .where('read', '==', false)
        .get();

      return res.status(200).json({
        success: true,
        notifications,
        unreadCount: unreadSnapshot.size
      });
    }

    // POST - Mark notifications as read
    if (req.method === 'POST') {
      const { action, notificationIds } = req.body;

      if (action === 'markRead' && notificationIds && Array.isArray(notificationIds)) {
        const batch = db.batch();

        for (const notifId of notificationIds) {
          const ref = db.collection('users').doc(userId)
            .collection('notifications').doc(notifId);
          batch.update(ref, { read: true });
        }

        await batch.commit();

        return res.status(200).json({
          success: true,
          message: `Marked ${notificationIds.length} notifications as read`
        });
      }

      if (action === 'markAllRead') {
        const snapshot = await db.collection('users').doc(userId)
          .collection('notifications')
          .where('read', '==', false)
          .get();

        const batch = db.batch();
        snapshot.forEach(doc => {
          batch.update(doc.ref, { read: true });
        });

        await batch.commit();

        return res.status(200).json({
          success: true,
          message: `Marked ${snapshot.size} notifications as read`
        });
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('[Notifications API] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
