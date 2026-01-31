// Username management API - check availability, claim, and release usernames
// PAID FEATURE: Permanent usernames require active subscription
// Trial users get randomly assigned temporary usernames
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
const { computeAccessLevel } = require('./_billing-helpers');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Reserved usernames that cannot be claimed
const RESERVED_USERNAMES = [
  'admin', 'api', 'www', 'app', 'settings', 'system', 'support', 'help',
  'about', 'contact', 'terms', 'privacy', 'legal', 'login', 'signup', 'signin',
  'signout', 'logout', 'register', 'auth', 'callback', 'oauth', 'profile',
  'user', 'users', 'account', 'dashboard', 'home', 'index', 'public', 'private',
  'static', 'assets', 'images', 'css', 'js', 'javascript', 'styles', 'fonts',
  'mindclone', 'link', 'links', 'chat', 'message', 'messages', 'analytics',
  'visitor', 'visitors', 'config', 'configuration', 'test', 'demo', 'example'
];

// Word lists for random username generation
const ADJECTIVES = [
  'curious', 'bright', 'clever', 'swift', 'bold', 'calm', 'eager', 'gentle',
  'happy', 'keen', 'lively', 'merry', 'noble', 'proud', 'quick', 'sharp',
  'smart', 'vivid', 'warm', 'wise', 'witty', 'zesty', 'agile', 'brave',
  'cosmic', 'daring', 'epic', 'fierce', 'golden', 'humble', 'ionic', 'jolly',
  'kindly', 'lunar', 'mighty', 'nimble', 'optimal', 'prime', 'quantum', 'rapid'
];

const NOUNS = [
  'panda', 'falcon', 'dolphin', 'phoenix', 'tiger', 'wolf', 'hawk', 'lion',
  'eagle', 'fox', 'owl', 'bear', 'dragon', 'unicorn', 'raven', 'shark',
  'cobra', 'jaguar', 'lynx', 'otter', 'panther', 'viper', 'badger', 'cipher',
  'comet', 'dynamo', 'echo', 'forge', 'galaxy', 'horizon', 'impulse', 'jet',
  'kernel', 'laser', 'matrix', 'nova', 'orbit', 'pixel', 'quasar', 'radar'
];

// Generate a random temporary username like "curious_panda_42"
function generateTempUsername() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}_${noun}_${num}`;
}

// Check if a username is a temporary (auto-generated) format
function isTempUsername(username) {
  if (!username) return false;
  // Temp usernames match pattern: word_word_number
  const pattern = /^[a-z]+_[a-z]+_\d+$/;
  return pattern.test(username);
}

// Validate username format
function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, reason: 'Username is required' };
  }

  const trimmed = username.trim().toLowerCase();

  // Length check
  if (trimmed.length < 3) {
    return { valid: false, reason: 'Username must be at least 3 characters' };
  }
  if (trimmed.length > 20) {
    return { valid: false, reason: 'Username must be 20 characters or less' };
  }

  // Format check: lowercase alphanumeric + underscore only
  if (!/^[a-z][a-z0-9_]*$/.test(trimmed)) {
    return { valid: false, reason: 'Username must start with a letter and contain only lowercase letters, numbers, and underscores' };
  }

  // No consecutive underscores
  if (/__/.test(trimmed)) {
    return { valid: false, reason: 'Username cannot contain consecutive underscores' };
  }

  // Reserved words check
  if (RESERVED_USERNAMES.includes(trimmed)) {
    return { valid: false, reason: 'This username is reserved' };
  }

  return { valid: true, username: trimmed };
}

// Verify Firebase ID token
async function verifyToken(idToken) {
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken.uid;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

// Check if user has paid (active subscription)
async function checkUserHasPaid(userId) {
  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) return false;

  const userData = userDoc.data();
  const accessLevel = computeAccessLevel(userData);
  const status = userData.billing?.subscriptionStatus;

  // User has paid if they have active subscription (not just trialing)
  // Grandfathered users also count as paid
  if (userData.isGrandfathered) return true;
  if (status === 'active') return true;

  return false;
}

// Check username availability
async function checkUsername(username) {
  const validation = validateUsername(username);
  if (!validation.valid) {
    return {
      available: false,
      username: username,
      reason: 'invalid',
      message: validation.reason
    };
  }

  try {
    const usernameDoc = await db.collection('usernames').doc(validation.username).get();

    if (usernameDoc.exists) {
      return {
        available: false,
        username: validation.username,
        reason: 'taken',
        message: 'This username is already taken'
      };
    }

    return {
      available: true,
      username: validation.username,
      reason: null,
      message: 'Username is available'
    };
  } catch (error) {
    console.error('Error checking username:', error);
    throw new Error('Failed to check username availability');
  }
}

// Assign a random temporary username to a new user
async function assignTempUsername(userId) {
  try {
    // Try up to 10 times to find an available random username
    for (let i = 0; i < 10; i++) {
      const tempUsername = generateTempUsername();
      const usernameDoc = await db.collection('usernames').doc(tempUsername).get();

      if (!usernameDoc.exists) {
        // Username is available, claim it
        await db.runTransaction(async (transaction) => {
          const usernameRef = db.collection('usernames').doc(tempUsername);
          const userRef = db.collection('users').doc(userId);

          transaction.set(usernameRef, {
            userId: userId,
            claimedAt: admin.firestore.FieldValue.serverTimestamp(),
            isTemporary: true
          });

          transaction.set(userRef, {
            username: tempUsername,
            hasTemporaryUsername: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        });

        console.log(`[Username] Assigned temp username "${tempUsername}" to user ${userId}`);
        return tempUsername;
      }
    }

    // Fallback: use userId-based username
    const fallbackUsername = `user_${userId.substring(0, 8)}`;
    console.log(`[Username] Using fallback username "${fallbackUsername}" for user ${userId}`);
    return fallbackUsername;

  } catch (error) {
    console.error('Error assigning temp username:', error);
    throw error;
  }
}

// Claim a permanent username (REQUIRES PAYMENT)
async function claimUsername(username, userId) {
  const validation = validateUsername(username);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  // Check if user has paid
  const hasPaid = await checkUserHasPaid(userId);
  if (!hasPaid) {
    throw new Error('PAYMENT_REQUIRED: Subscribe to claim a permanent username');
  }

  try {
    // Use transaction to ensure atomicity
    return await db.runTransaction(async (transaction) => {
      const usernameRef = db.collection('usernames').doc(validation.username);
      const userRef = db.collection('users').doc(userId);

      // Check if username is already taken
      const usernameDoc = await transaction.get(usernameRef);
      if (usernameDoc.exists) {
        throw new Error('Username is already taken');
      }

      // Check if user already has a username
      const userDoc = await transaction.get(userRef);
      const existingUsername = userDoc.data()?.username;

      if (existingUsername) {
        // Release existing username (whether temp or permanent)
        const oldUsernameRef = db.collection('usernames').doc(existingUsername);
        transaction.delete(oldUsernameRef);
      }

      // Claim new permanent username
      transaction.set(usernameRef, {
        userId: userId,
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
        isTemporary: false
      });

      // Update user document
      transaction.set(userRef, {
        username: validation.username,
        hasTemporaryUsername: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      console.log(`[Username] User ${userId} claimed permanent username "${validation.username}"`);
      return validation.username;
    });
  } catch (error) {
    console.error('Error claiming username:', error);
    throw error;
  }
}

// Release a username
async function releaseUsername(userId) {
  try {
    return await db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await transaction.get(userRef);

      const username = userDoc.data()?.username;
      if (!username) {
        throw new Error('No username to release');
      }

      // Remove username claim
      const usernameRef = db.collection('usernames').doc(username);
      transaction.delete(usernameRef);

      // Update user document
      transaction.update(userRef, {
        username: null,
        hasTemporaryUsername: null,
        linkEnabled: false, // Also disable link when releasing username
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return username;
    });
  } catch (error) {
    console.error('Error releasing username:', error);
    throw error;
  }
}

// Main handler
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action } = req.query;
    const { username, idToken } = req.body;

    if (action === 'check') {
      // Check username availability (no auth required)
      if (!username) {
        return res.status(400).json({ error: 'Username is required' });
      }

      const result = await checkUsername(username);
      return res.status(200).json(result);
    }

    if (action === 'assign-temp') {
      // Assign temporary username (requires auth)
      if (!idToken) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const userId = await verifyToken(idToken);
      const tempUsername = await assignTempUsername(userId);

      return res.status(200).json({
        success: true,
        username: tempUsername,
        isTemporary: true,
        message: 'Temporary username assigned. Subscribe to claim a permanent username!'
      });
    }

    if (action === 'claim') {
      // Claim permanent username (requires auth + PAYMENT)
      if (!idToken) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (!username) {
        return res.status(400).json({ error: 'Username is required' });
      }

      const userId = await verifyToken(idToken);

      try {
        const claimedUsername = await claimUsername(username, userId);
        return res.status(200).json({
          success: true,
          username: claimedUsername,
          isTemporary: false,
          message: 'Permanent username claimed successfully!'
        });
      } catch (error) {
        if (error.message.startsWith('PAYMENT_REQUIRED')) {
          return res.status(402).json({
            error: 'Payment required',
            code: 'PAYMENT_REQUIRED',
            message: 'Subscribe to claim a permanent username. Your temporary username will remain active.'
          });
        }
        throw error;
      }
    }

    if (action === 'release') {
      // Release username (requires auth)
      if (!idToken) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const userId = await verifyToken(idToken);
      const releasedUsername = await releaseUsername(userId);

      return res.status(200).json({
        success: true,
        previousUsername: releasedUsername,
        message: 'Username released successfully'
      });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    console.error('Username API error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
};

// Export helpers for use in other files
module.exports.assignTempUsername = assignTempUsername;
module.exports.isTempUsername = isTempUsername;
module.exports.generateTempUsername = generateTempUsername;
