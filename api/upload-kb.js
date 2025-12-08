// Knowledge Base Upload API - Uses Vercel Blob Storage
const { put, del } = require('@vercel/blob');
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
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

    // Handle DELETE request
    if (req.method === 'DELETE') {
      const { docId, blobUrl } = req.body;

      if (!docId) {
        return res.status(400).json({ error: 'docId required' });
      }

      // Delete from Vercel Blob if URL provided
      if (blobUrl) {
        try {
          await del(blobUrl);
          console.log('[KB] Deleted blob:', blobUrl);
        } catch (blobError) {
          console.error('[KB] Blob delete error:', blobError);
          // Continue even if blob delete fails
        }
      }

      // Delete metadata from Firestore
      await db.collection('users').doc(userId)
        .collection('knowledgeBase').doc(docId).delete();

      return res.status(200).json({ success: true, message: 'Document deleted' });
    }

    // Handle POST request (upload)
    if (req.method === 'POST') {
      const { fileName, fileType, fileData } = req.body;

      if (!fileName || !fileData) {
        return res.status(400).json({ error: 'fileName and fileData required' });
      }

      // Decode base64 file data
      const buffer = Buffer.from(fileData, 'base64');
      const fileSize = buffer.length;

      // Check file size (max 10MB)
      if (fileSize > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'File size must be less than 10MB' });
      }

      // Upload to Vercel Blob
      const timestamp = Date.now();
      const blobPath = `kb/${userId}/${timestamp}_${fileName}`;

      console.log('[KB] Uploading to Vercel Blob:', blobPath, 'size:', fileSize);

      const blob = await put(blobPath, buffer, {
        access: 'public',
        contentType: fileType || 'application/octet-stream'
      });

      console.log('[KB] Blob uploaded:', blob.url);

      // Save metadata to Firestore
      const docId = `${timestamp}`;
      const kbDocRef = db.collection('users').doc(userId)
        .collection('knowledgeBase').doc(docId);

      await kbDocRef.set({
        fileName: fileName,
        type: fileType || 'application/octet-stream',
        size: fileSize,
        url: blob.url,
        blobUrl: blob.url,
        uploadedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(200).json({
        success: true,
        message: 'File uploaded successfully',
        file: {
          docId,
          fileName,
          url: blob.url,
          size: fileSize
        }
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('[KB API] Error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
};
