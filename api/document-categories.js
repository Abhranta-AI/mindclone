// Document Categories API - Manage sensitive privacy categories for knowledge base documents
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Valid sensitive categories
const VALID_CATEGORIES = ['financial', 'legal', 'health', 'relationships', 'personal_struggles'];

// Category metadata for frontend display
const CATEGORY_INFO = {
  financial: { name: 'Financial', icon: '💰', description: 'Money, debts, investments, salary' },
  legal: { name: 'Legal', icon: '⚖️', description: 'Lawsuits, disputes, legal matters' },
  health: { name: 'Health', icon: '🏥', description: 'Medical conditions, mental health' },
  relationships: { name: 'Relationships', icon: '💔', description: 'Partner issues, family conflicts' },
  personal_struggles: { name: 'Personal', icon: '😔', description: 'Insecurities, fears, emotions' }
};

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
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - Bearer token required' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const userId = await verifyToken(idToken);

    // GET - Get categories for a document or list all category definitions
    if (req.method === 'GET') {
      const { docId, action } = req.query;

      // Return category definitions
      if (action === 'definitions') {
        return res.status(200).json({
          success: true,
          categories: CATEGORY_INFO,
          validCategories: VALID_CATEGORIES
        });
      }

      // Get categories for specific document
      if (!docId) {
        return res.status(400).json({ error: 'docId query parameter required' });
      }

      const docRef = await db.collection('users').doc(userId)
        .collection('knowledgeBase').doc(docId).get();

      if (!docRef.exists) {
        return res.status(404).json({ error: 'Document not found' });
      }

      const docData = docRef.data();
      return res.status(200).json({
        success: true,
        docId,
        fileName: docData.fileName,
        categories: docData.sensitiveCategories || [],
        manuallyTagged: docData.manuallyTagged || false,
        categoryConfidence: docData.categoryConfidence || 0
      });
    }

    // PUT - Update categories for a document
    if (req.method === 'PUT') {
      const { docId, categories } = req.body;

      if (!docId) {
        return res.status(400).json({ error: 'docId required in request body' });
      }

      // Validate categories array
      if (!Array.isArray(categories)) {
        return res.status(400).json({ error: 'categories must be an array' });
      }

      // Filter to only valid categories
      const validCategories = categories.filter(c => VALID_CATEGORIES.includes(c));

      // Get the document to find its docKey
      const kbDocRef = db.collection('users').doc(userId)
        .collection('knowledgeBase').doc(docId);
      const kbDoc = await kbDocRef.get();

      if (!kbDoc.exists) {
        return res.status(404).json({ error: 'Document not found' });
      }

      const docKey = kbDoc.data()?.docKey;

      // Update knowledgeBase collection
      await kbDocRef.update({
        sensitiveCategories: validCategories,
        manuallyTagged: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Also update linkKnowledgeBase/documents if docKey exists
      if (docKey) {
        try {
          const linkKbRef = db.collection('users').doc(userId)
            .collection('linkKnowledgeBase').doc('documents');
          await linkKbRef.update({
            [`documents.${docKey}.sensitiveCategories`]: validCategories,
            [`documents.${docKey}.manuallyTagged`]: true
          });
          console.log(`[Categories] Updated linkKnowledgeBase for docKey: ${docKey}`);
        } catch (linkError) {
          console.log('[Categories] Could not update linkKnowledgeBase:', linkError.message);
          // Continue even if this fails - the main knowledgeBase is updated
        }
      }

      console.log(`[Categories] Updated doc ${docId} with categories: ${validCategories.join(', ') || 'none'}`);

      return res.status(200).json({
        success: true,
        docId,
        categories: validCategories,
        message: validCategories.length > 0
          ? `Document marked with: ${validCategories.join(', ')}`
          : 'All sensitive categories removed'
      });
    }

    return res.status(405).json({ error: 'Method not allowed. Use GET or PUT.' });

  } catch (error) {
    console.error('[Categories API Error]', error);

    if (error.message === 'Invalid or expired token') {
      return res.status(401).json({ error: 'Authentication failed' });
    }

    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
