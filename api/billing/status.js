// Billing Status API - Get user's subscription status
// Returns current subscription state, trial info, and pricing
// Also auto-assigns temporary username to new users
const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');
const { getSubscriptionSummary, PRICING } = require('../_billing-helpers');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Word lists for random username generation (same as username.js)
const ADJECTIVES = [
  'curious', 'bright', 'clever', 'swift', 'bold', 'calm', 'eager', 'gentle',
  'happy', 'keen', 'lively', 'merry', 'noble', 'proud', 'quick', 'sharp',
  'smart', 'vivid', 'warm', 'wise', 'witty', 'zesty', 'agile', 'brave',
  'cosmic', 'daring', 'epic', 'fierce', 'golden', 'humble', 'ionic', 'jolly'
];

const NOUNS = [
  'panda', 'falcon', 'dolphin', 'phoenix', 'tiger', 'wolf', 'hawk', 'lion',
  'eagle', 'fox', 'owl', 'bear', 'dragon', 'unicorn', 'raven', 'shark',
  'cobra', 'jaguar', 'lynx', 'otter', 'panther', 'viper', 'badger', 'cipher'
];

// Generate a random temporary username
function generateTempUsername() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}_${noun}_${num}`;
}

// Assign temp username to new user
async function assignTempUsernameToUser(userId) {
  for (let i = 0; i < 10; i++) {
    const tempUsername = generateTempUsername();
    const usernameDoc = await db.collection('usernames').doc(tempUsername).get();

    if (!usernameDoc.exists) {
      await db.collection('usernames').doc(tempUsername).set({
        userId: userId,
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
        isTemporary: true
      });
      return tempUsername;
    }
  }
  // Fallback
  return `user_${userId.substring(0, 8)}`;
}

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
    // Also auto-assign a temporary username
    if (!userDoc.exists && userEmail) {
      console.log(`[Billing Status] New user detected, auto-provisioning ${PRICING.trialDays}-day trial: ${userEmail}`);

      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + PRICING.trialDays);

      // Generate and assign temporary username
      const tempUsername = await assignTempUsernameToUser(userId);
      console.log(`[Billing Status] Assigned temp username: ${tempUsername}`);

      const newUserData = {
        email: userEmail,
        username: tempUsername,
        hasTemporaryUsername: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        billing: {
          subscriptionStatus: 'trialing',
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
