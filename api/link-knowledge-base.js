// Knowledge Base API - Handles CoF and structured knowledge for public links
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {

    // Extract and verify auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    // GET - Retrieve knowledge base
    if (req.method === 'GET') {
      const kbDoc = await db.collection('users').doc(userId)
        .collection('linkKnowledgeBase').doc('config').get();

      if (!kbDoc.exists) {
        return res.status(200).json({
          success: true,
          cof: null,
          knowledgeBase: {},
          isEmpty: true
        });
      }

      const data = kbDoc.data();
      return res.status(200).json({
        success: true,
        cof: data.cof || null,
        knowledgeBase: data.sections || {},
        lastUpdated: data.lastUpdated,
        isEmpty: false
      });
    }

    // POST - Create or update knowledge base
    if (req.method === 'POST') {
      const { cof, sections } = req.body;

      // Validate CoF structure
      if (cof && typeof cof !== 'object') {
        return res.status(400).json({ error: 'CoF must be an object' });
      }

      // Validate sections structure
      if (sections && typeof sections !== 'object') {
        return res.status(400).json({ error: 'Sections must be an object' });
      }

      const updateData = {
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      };

      if (cof) {
        updateData.cof = {
          purpose: cof.purpose || '',
          targetAudiences: cof.targetAudiences || [],
          desiredActions: cof.desiredActions || [],
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
      }

      if (sections) {
        updateData.sections = sections;
      }

      await db.collection('users').doc(userId)
        .collection('linkKnowledgeBase').doc('config')
        .set(updateData, { merge: true });

      return res.status(200).json({
        success: true,
        message: 'Knowledge base updated successfully'
      });
    }

    // PUT - Update specific section
    if (req.method === 'PUT') {
      const { sectionId, content } = req.body;

      if (!sectionId || !content) {
        return res.status(400).json({ error: 'sectionId and content required' });
      }

      const updatePath = `sections.${sectionId}`;
      await db.collection('users').doc(userId)
        .collection('linkKnowledgeBase').doc('config')
        .update({
          [updatePath]: {
            content: content,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            approved: true
          },
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });

      return res.status(200).json({
        success: true,
        message: `Section ${sectionId} updated successfully`
      });
    }

    // DELETE - Remove specific section
    if (req.method === 'DELETE') {
      const { sectionId } = req.body;

      if (!sectionId) {
        return res.status(400).json({ error: 'sectionId required' });
      }

      const updatePath = `sections.${sectionId}`;
      await db.collection('users').doc(userId)
        .collection('linkKnowledgeBase').doc('config')
        .update({
          [updatePath]: admin.firestore.FieldValue.delete(),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });

      return res.status(200).json({
        success: true,
        message: `Section ${sectionId} deleted successfully`
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Knowledge base API error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
};
