// Shared Firebase Admin SDK initialization
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK with base64-encoded service account
function initializeFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  try {
    // Check if service account key is provided
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    if (serviceAccountKey) {
      // Decode base64 and parse JSON
      const serviceAccount = JSON.parse(
        Buffer.from(serviceAccountKey, 'base64').toString('utf-8')
      );

      return admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else {
      // Fallback to application default credentials (local development)
      return admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    }
  } catch (error) {
    console.error('Error initializing Firebase Admin:', error);
    throw new Error('Failed to initialize Firebase Admin SDK');
  }
}

module.exports = { initializeFirebaseAdmin, admin };
