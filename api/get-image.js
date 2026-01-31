// API endpoint to fetch generated images from Firestore
const admin = require('firebase-admin');

// Initialize Firebase Admin if not already done
if (!admin.apps.length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    : null;

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } else {
    admin.initializeApp();
  }
}

const db = admin.firestore();

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id || !id.startsWith('img_')) {
    return res.status(400).json({ error: 'Invalid image ID' });
  }

  try {
    const doc = await db.collection('generated_images').doc(id).get();

    if (!doc.exists) {
      console.log(`[Get Image] Image not found: ${id}`);
      return res.status(404).json({ error: 'Image not found' });
    }

    const data = doc.data();

    if (!data.base64) {
      console.log(`[Get Image] Image has no base64 data: ${id}`);
      return res.status(404).json({ error: 'Image data not found' });
    }

    console.log(`[Get Image] Returning image: ${id}, size: ${data.base64.length}`);

    return res.status(200).json({
      success: true,
      base64: data.base64,
      prompt: data.prompt,
      style: data.style
    });

  } catch (error) {
    console.error(`[Get Image] Error fetching image ${id}:`, error);
    return res.status(500).json({ error: 'Failed to fetch image' });
  }
};
