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
      console.log('[Firebase Init] Using FIREBASE_SERVICE_ACCOUNT_KEY environment variable');

      // Decode base64 and parse JSON
      let serviceAccount;
      try {
        const decoded = Buffer.from(serviceAccountKey, 'base64').toString('utf-8');
        serviceAccount = JSON.parse(decoded);
        console.log('[Firebase Init] Successfully decoded and parsed service account');
        console.log('[Firebase Init] Project ID:', serviceAccount.project_id);
      } catch (decodeError) {
        console.error('[Firebase Init] Error decoding/parsing service account:', decodeError.message);
        throw decodeError;
      }

      return admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else {
      console.log('[Firebase Init] No FIREBASE_SERVICE_ACCOUNT_KEY found, using application default');
      // Fallback to application default credentials (local development)
      return admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    }
  } catch (error) {
    console.error('[Firebase Init] Error initializing Firebase Admin:', error.message);
    console.error('[Firebase Init] Stack:', error.stack);
    throw new Error(`Failed to initialize Firebase Admin SDK: ${error.message}`);
  }
}

module.exports = { initializeFirebaseAdmin, admin };
