// Billing Status API - Get user's subscription status
const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');
const { getSubscriptionSummary } = require('../_billing-helpers');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify Firebase ID token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    let decodedToken;

    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (authError) {
      console.error('[Billing Status] Token verification failed:', authError);
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userId = decodedToken.uid;
    const userEmail = decodedToken.email;

    // Get user document
    const userRef = db.collection('users').doc(userId);
    let userDoc = await userRef.get();
    let userData = userDoc.exists ? userDoc.data() : null;

    // AUTO-PROVISION TRIAL: If user doesn't exist yet (new signup), create with 7-day trial
    // This allows users to complete registration (claim username) before paywall
    if (!userDoc.exists && userEmail) {
      console.log(`[Billing Status] New user detected, auto-provisioning 7-day trial: ${userEmail}`);

      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 7);

      const newUserData = {
        email: userEmail,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        billing: {
          status: 'created',
          trialEnd: trialEnd,
          trialStarted: admin.firestore.FieldValue.serverTimestamp()
        }
      };

      await userRef.set(newUserData);
      console.log(`[Billing Status] Created user with trial ending: ${trialEnd.toISOString()}`);

      // Refresh user data
      userDoc = await userRef.get();
      userData = userDoc.data();
    }

    // Check if user should be auto-grandfathered
    if (userEmail && (!userData || !userData.isGrandfathered)) {
      const preGrandfatheredDoc = await db.collection('pregrandfathered').doc(userEmail).get();
      if (preGrandfatheredDoc.exists) {
        console.log(`[Billing Status] Auto-grandfathering user: ${userEmail}`);

        // Update or create user document with grandfather status
        const grandfatherData = {
          isGrandfathered: true,
          grandfatheredAt: admin.firestore.FieldValue.serverTimestamp(),
          email: userEmail
        };

        if (userDoc.exists) {
          await userRef.update(grandfatherData);
        } else {
          await userRef.set(grandfatherData);
        }

        // Remove from pregrandfathered list
        await db.collection('pregrandfathered').doc(userEmail).delete();

        // Refresh user data
        userDoc = await userRef.get();
        userData = userDoc.data();
      }
    }

    // Get subscription summary
    const summary = getSubscriptionSummary(userData);

    return res.status(200).json(summary);

  } catch (error) {
    console.error('[Billing Status] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};
