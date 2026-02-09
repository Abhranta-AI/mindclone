// Active Searches API
// Get user's active people searches

const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');

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

    // Get active searches
    const searchesSnapshot = await db.collection('users').doc(userId)
      .collection('activeSearches')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const searches = [];
    for (const doc of searchesSnapshot.docs) {
      const search = doc.data();

      // Get associated matches count
      const matchesSnapshot = await db.collection('matches')
        .where('searchId', '==', search.searchId)
        .get();

      searches.push({
        searchId: search.searchId,
        intent: search.intent,
        status: search.status,
        extractedCriteria: search.extractedCriteria,
        matchCount: matchesSnapshot.size,
        createdAt: search.createdAt?.toDate?.()?.toISOString() || null,
        updatedAt: search.updatedAt?.toDate?.()?.toISOString() || null
      });
    }

    return res.status(200).json({
      success: true,
      searches,
      hasSearches: searches.length > 0
    });

  } catch (error) {
    console.error('[Active Searches API] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
