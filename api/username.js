// Username management API - check availability, claim, and release usernames
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

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

// Claim a username
async function claimUsername(username, userId) {
  const validation = validateUsername(username);
  if (!validation.valid) {
    throw new Error(validation.reason);
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
        // Release existing username
        const oldUsernameRef = db.collection('usernames').doc(existingUsername);
        transaction.delete(oldUsernameRef);
      }

      // Claim new username
      transaction.set(usernameRef, {
        userId: userId,
        claimedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Update user document
      transaction.set(userRef, {
        username: validation.username,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

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

    if (action === 'claim') {
      // Claim username (requires auth)
      if (!idToken) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (!username) {
        return res.status(400).json({ error: 'Username is required' });
      }

      const userId = await verifyToken(idToken);
      const claimedUsername = await claimUsername(username, userId);

      return res.status(200).json({
        success: true,
        username: claimedUsername,
        message: 'Username claimed successfully'
      });
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
