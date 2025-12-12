// File upload endpoint for documents and media
const { put, head } = require('@vercel/blob');
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

// Initialize Firebase
initializeFirebaseAdmin();
const db = admin.firestore();

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[Upload] Starting file upload process');

    // Check for BLOB_READ_WRITE_TOKEN
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error('[Upload] BLOB_READ_WRITE_TOKEN is not configured');
      return res.status(500).json({ error: 'Blob storage not configured' });
    }

    // Get user ID from request (assuming it's passed in headers or body)
    const userId = req.headers['x-user-id'] || req.body?.userId;

    if (!userId) {
      console.error('[Upload] No user ID provided');
      return res.status(401).json({ error: 'Unauthorized - User ID required' });
    }

    // Verify user exists
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      console.error('[Upload] User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    // Parse the request body to get file data
    // Note: Vercel expects base64 encoded file data in body.file
    const { file, filename, contentType, section, type } = req.body;

    if (!file || !filename) {
      console.error('[Upload] Missing required fields');
      return res.status(400).json({ error: 'Missing required fields: file and filename' });
    }

    // Convert base64 to Buffer
    let fileBuffer;
    try {
      fileBuffer = Buffer.from(file, 'base64');
    } catch (base64Error) {
      console.error('[Upload] Invalid base64 data:', base64Error.message);
      return res.status(400).json({ error: 'Invalid file data - base64 decode failed' });
    }

    const fileSizeBytes = fileBuffer.length;

    if (fileSizeBytes === 0) {
      console.error('[Upload] Empty file buffer');
      return res.status(400).json({ error: 'File is empty' });
    }

    // Generate unique filename with timestamp
    const timestamp = Date.now();
    const uniqueFilename = `${userId}/${timestamp}-${filename}`;

    console.log('[Upload] Uploading file:', {
      filename,
      uniqueFilename,
      contentType: contentType || 'application/octet-stream',
      size: fileSizeBytes,
      section,
      type
    });

    // Upload to Vercel Blob
    let blob;
    try {
      blob = await put(uniqueFilename, fileBuffer, {
        access: 'public',
        contentType: contentType || 'application/octet-stream',
        token: process.env.BLOB_READ_WRITE_TOKEN
      });
    } catch (blobError) {
      console.error('[Upload] Vercel Blob put() failed:', blobError.message, blobError);
      return res.status(500).json({
        error: 'Blob upload failed',
        details: blobError.message
      });
    }

    // Verify the blob was created
    if (!blob || !blob.url) {
      console.error('[Upload] Blob returned without URL:', blob);
      return res.status(500).json({ error: 'Blob upload failed - no URL returned' });
    }

    console.log('[Upload] Blob created:', {
      url: blob.url,
      pathname: blob.pathname,
      downloadUrl: blob.downloadUrl
    });

    // Verify the blob exists by checking it with head()
    try {
      const blobInfo = await head(blob.url, {
        token: process.env.BLOB_READ_WRITE_TOKEN
      });
      console.log('[Upload] Blob verified:', {
        size: blobInfo.size,
        uploadedAt: blobInfo.uploadedAt,
        contentType: blobInfo.contentType
      });
    } catch (headError) {
      console.error('[Upload] Blob verification failed - blob may not exist:', headError.message);
      // Don't fail the request, but log this as a warning
      console.warn('[Upload] Warning: Could not verify blob existence');
    }

    console.log('[Upload] File uploaded successfully:', blob.url);

    // Return success response
    const response = {
      success: true,
      url: blob.url,
      metadata: {
        filename,
        uniqueFilename,
        size: fileSizeBytes,
        contentType: contentType || 'application/octet-stream',
        uploadedAt: new Date().toISOString(),
        section: section || null,
        type: type || 'document'
      }
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('[Upload] Unexpected error:', error.message, error.stack);
    return res.status(500).json({
      error: error.message || 'Failed to upload file',
      details: error.toString()
    });
  }
};
