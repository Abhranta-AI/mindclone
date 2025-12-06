// Message privacy API - toggle isPublic field on messages
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

// Toggle message privacy
async function toggleMessagePrivacy(userId, messageId, isPublic) {
  try {
    const messageRef = db.collection('users').doc(userId)
      .collection('messages').doc(messageId);

    // Verify message exists
    const messageDoc = await messageRef.get();
    if (!messageDoc.exists) {
      throw new Error('Message not found');
    }

    // Update isPublic field
    await messageRef.update({
      isPublic: isPublic,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return true;
  } catch (error) {
    console.error('Error toggling message privacy:', error);
    throw error;
  }
}

// Batch update message privacy
async function batchTogglePrivacy(userId, messageIds, isPublic) {
  try {
    const batch = db.batch();

    for (const messageId of messageIds) {
      const messageRef = db.collection('users').doc(userId)
        .collection('messages').doc(messageId);

      batch.update(messageRef, {
        isPublic: isPublic,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    await batch.commit();
    return messageIds.length;
  } catch (error) {
    console.error('Error batch toggling privacy:', error);
    throw error;
  }
}

// Get message privacy status
async function getMessagePrivacy(userId, messageId) {
  try {
    const messageDoc = await db.collection('users').doc(userId)
      .collection('messages').doc(messageId).get();

    if (!messageDoc.exists) {
      throw new Error('Message not found');
    }

    const data = messageDoc.data();
    return {
      messageId: messageId,
      isPublic: data.isPublic || false,
      role: data.role,
      content: data.content.substring(0, 100) + (data.content.length > 100 ? '...' : ''),
      timestamp: data.timestamp
    };
  } catch (error) {
    console.error('Error getting message privacy:', error);
    throw error;
  }
}

// List all messages with privacy status
async function listMessagesWithPrivacy(userId, limit = 100) {
  try {
    const messagesSnapshot = await db.collection('users').doc(userId)
      .collection('messages')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return messagesSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        messageId: doc.id,
        isPublic: data.isPublic || false,
        role: data.role,
        content: data.content.substring(0, 100) + (data.content.length > 100 ? '...' : ''),
        timestamp: data.timestamp
      };
    });
  } catch (error) {
    console.error('Error listing messages:', error);
    throw error;
  }
}

// Main handler
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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

    // GET - List messages with privacy status
    if (req.method === 'GET') {
      const { messageId } = req.query;

      if (messageId) {
        // Get single message privacy status
        const message = await getMessagePrivacy(userId, messageId);
        return res.status(200).json(message);
      } else {
        // List all messages
        const messages = await listMessagesWithPrivacy(userId);
        return res.status(200).json({
          messages: messages,
          total: messages.length
        });
      }
    }

    // POST - Toggle single message privacy
    if (req.method === 'POST') {
      const { messageId, isPublic } = req.body;

      if (!messageId || typeof isPublic !== 'boolean') {
        return res.status(400).json({ error: 'messageId and isPublic (boolean) are required' });
      }

      await toggleMessagePrivacy(userId, messageId, isPublic);

      return res.status(200).json({
        success: true,
        message: 'Message privacy updated',
        messageId: messageId,
        isPublic: isPublic
      });
    }

    // PUT - Batch update message privacy
    if (req.method === 'PUT') {
      const { messageIds, isPublic } = req.body;

      if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
        return res.status(400).json({ error: 'messageIds array is required' });
      }

      if (typeof isPublic !== 'boolean') {
        return res.status(400).json({ error: 'isPublic (boolean) is required' });
      }

      const count = await batchTogglePrivacy(userId, messageIds, isPublic);

      return res.status(200).json({
        success: true,
        message: `Updated ${count} messages`,
        count: count,
        isPublic: isPublic
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Message privacy API error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
};
