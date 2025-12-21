// Knowledge Base Upload API - Uses Vercel Blob Storage with Text Extraction
const { put, del } = require('@vercel/blob');
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

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

// Extract text from different file types
async function extractText(buffer, fileName, fileType) {
  const lowerName = fileName.toLowerCase();

  try {
    // PDF files
    if (fileType === 'application/pdf' || lowerName.endsWith('.pdf')) {
      console.log('[KB] Extracting text from PDF...');
      const pdfData = await pdfParse(buffer);
      return {
        text: pdfData.text,
        pageCount: pdfData.numpages,
        type: 'pdf'
      };
    }

    // Word documents (.docx)
    if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        lowerName.endsWith('.docx')) {
      console.log('[KB] Extracting text from Word document...');
      const result = await mammoth.extractRawText({ buffer: buffer });
      return {
        text: result.value,
        type: 'docx'
      };
    }

    // Legacy Word documents (.doc)
    if (fileType === 'application/msword' || lowerName.endsWith('.doc')) {
      console.log('[KB] Legacy .doc format - limited extraction');
      // mammoth doesn't support .doc, return null
      return {
        text: null,
        type: 'doc',
        error: 'Legacy .doc format not supported. Please convert to .docx'
      };
    }

    // Plain text files
    if (fileType === 'text/plain' ||
        lowerName.endsWith('.txt') ||
        lowerName.endsWith('.md') ||
        lowerName.endsWith('.markdown')) {
      console.log('[KB] Reading text file...');
      return {
        text: buffer.toString('utf-8'),
        type: 'text'
      };
    }

    // JSON files
    if (fileType === 'application/json' || lowerName.endsWith('.json')) {
      console.log('[KB] Reading JSON file...');
      const jsonContent = buffer.toString('utf-8');
      return {
        text: jsonContent,
        type: 'json'
      };
    }

    // No text extraction available for this type
    console.log('[KB] No text extraction for file type:', fileType);
    return {
      text: null,
      type: 'binary'
    };

  } catch (error) {
    console.error('[KB] Text extraction error:', error);
    return {
      text: null,
      type: 'error',
      error: error.message
    };
  }
}

// Generate a document key from filename (for storage in linkKnowledgeBase)
function generateDocKey(fileName) {
  // Remove extension and convert to lowercase snake_case
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');
  const key = nameWithoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return key || 'document';
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
      const { docId, blobUrl, docKey } = req.body;

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

      // Delete metadata from Firestore knowledgeBase collection
      await db.collection('users').doc(userId)
        .collection('knowledgeBase').doc(docId).delete();

      // Also remove from linkKnowledgeBase/documents if docKey provided
      if (docKey) {
        try {
          const linkKbRef = db.collection('users').doc(userId)
            .collection('linkKnowledgeBase').doc('documents');
          await linkKbRef.update({
            [`documents.${docKey}`]: admin.firestore.FieldValue.delete()
          });
          console.log('[KB] Removed from linkKnowledgeBase:', docKey);
        } catch (error) {
          console.log('[KB] Could not remove from linkKnowledgeBase:', error.message);
        }
      }

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

      // Extract text from the document
      const extraction = await extractText(buffer, fileName, fileType);
      console.log('[KB] Text extraction result:', {
        type: extraction.type,
        hasText: !!extraction.text,
        textLength: extraction.text?.length || 0,
        error: extraction.error
      });

      // Generate document key for linkKnowledgeBase
      const docKey = generateDocKey(fileName);

      // Save metadata to Firestore knowledgeBase (for settings UI)
      const docId = `${timestamp}`;
      const kbDocRef = db.collection('users').doc(userId)
        .collection('knowledgeBase').doc(docId);

      const docData = {
        fileName: fileName,
        type: fileType || 'application/octet-stream',
        size: fileSize,
        url: blob.url,
        blobUrl: blob.url,
        docKey: docKey,
        visibility: 'public', // Default to public visibility
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Text extraction results
        extractedText: extraction.text ? extraction.text.substring(0, 50000) : null, // Limit stored text
        textExtractionType: extraction.type,
        textExtractionError: extraction.error || null,
        pageCount: extraction.pageCount || null
      };

      await kbDocRef.set(docData);

      // Also save to linkKnowledgeBase/documents for the mindclone to use
      if (extraction.text) {
        const linkKbRef = db.collection('users').doc(userId)
          .collection('linkKnowledgeBase').doc('documents');

        const linkDocData = {
          fileName: fileName,
          type: fileType || 'application/octet-stream',
          url: blob.url,
          fileUrl: blob.url,
          text: extraction.text.substring(0, 50000), // Limit for context window
          pageCount: extraction.pageCount || null,
          visibility: 'public', // Default to public visibility
          uploadedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Use merge to add/update this document without overwriting others
        await linkKbRef.set({
          documents: {
            [docKey]: linkDocData
          }
        }, { merge: true });

        console.log('[KB] Saved to linkKnowledgeBase with key:', docKey);
      }

      return res.status(200).json({
        success: true,
        message: extraction.text
          ? `File uploaded and text extracted (${extraction.text.length} chars)`
          : 'File uploaded (no text extraction available)',
        file: {
          docId,
          docKey,
          fileName,
          url: blob.url,
          size: fileSize,
          textExtracted: !!extraction.text,
          textLength: extraction.text?.length || 0,
          extractionType: extraction.type,
          extractionError: extraction.error
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
