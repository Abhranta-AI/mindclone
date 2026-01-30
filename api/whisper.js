// Whisper API - Owner sends hidden instructions to Mindclone for team conversations
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Verify Firebase ID token - must be the owner
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    let decodedToken;

    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (authError) {
      console.error('[Whisper] Token verification failed:', authError);
      return res.status(401).json({ error: 'Invalid token' });
    }

    const ownerId = decodedToken.uid;
    const ownerEmail = decodedToken.email;

    // POST - Send a whisper to a visitor conversation
    if (req.method === 'POST') {
      const { visitorId, instruction } = req.body;

      if (!visitorId || !instruction) {
        return res.status(400).json({ error: 'visitorId and instruction are required' });
      }

      // Verify this visitor belongs to this owner
      const visitorRef = db.collection('users').doc(ownerId)
        .collection('visitors').doc(visitorId);

      const visitorDoc = await visitorRef.get();
      if (!visitorDoc.exists) {
        return res.status(404).json({ error: 'Visitor not found' });
      }

      // Store the whisper
      const whisperRef = visitorRef.collection('whispers').doc();
      await whisperRef.set({
        instruction: instruction.trim(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ownerEmail: ownerEmail,
        active: true
      });

      console.log(`[Whisper] Owner ${ownerEmail} sent whisper to visitor ${visitorId}: "${instruction.substring(0, 50)}..."`);

      return res.status(200).json({
        success: true,
        whisperId: whisperRef.id,
        message: 'Whisper sent successfully'
      });
    }

    // GET - Get all whispers for a visitor (owner only)
    if (req.method === 'GET') {
      const { visitorId } = req.query;

      if (!visitorId) {
        return res.status(400).json({ error: 'visitorId is required' });
      }

      const whispersRef = db.collection('users').doc(ownerId)
        .collection('visitors').doc(visitorId)
        .collection('whispers')
        .where('active', '==', true)
        .orderBy('timestamp', 'desc')
        .limit(10);

      const whispersSnapshot = await whispersRef.get();
      const whispers = whispersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate?.()?.toISOString() || null
      }));

      return res.status(200).json({ whispers });
    }

    // DELETE - Deactivate a whisper
    if (req.method === 'DELETE') {
      const { visitorId, whisperId } = req.body || req.query;

      if (!visitorId || !whisperId) {
        return res.status(400).json({ error: 'visitorId and whisperId are required' });
      }

      const whisperRef = db.collection('users').doc(ownerId)
        .collection('visitors').doc(visitorId)
        .collection('whispers').doc(whisperId);

      await whisperRef.update({ active: false });

      console.log(`[Whisper] Owner ${ownerEmail} deactivated whisper ${whisperId}`);

      return res.status(200).json({
        success: true,
        message: 'Whisper deactivated'
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('[Whisper] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};
