// Load .env.local first
require('dotenv').config({ path: '.env.local' });

const admin = require('firebase-admin');
const fs = require('fs');

// Initialize Firebase Admin
let serviceAccount;
try {
  // Try production env var name first, then fallback
  let envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT || '{}';

  // Check if it's base64 encoded (doesn't start with '{')
  if (envKey && !envKey.startsWith('{')) {
    envKey = Buffer.from(envKey, 'base64').toString('utf8');
  }

  serviceAccount = JSON.parse(envKey);
} catch (e) {
  console.error('Failed to parse Firebase service account:', e.message);
  serviceAccount = {};
}

if (!serviceAccount.project_id) {
  // Try to read from local file
  const path = './firebase-service-account.json';
  if (fs.existsSync(path)) {
    serviceAccount = JSON.parse(fs.readFileSync(path, 'utf8'));
  } else {
    console.error('No service account found in FIREBASE_SERVICE_ACCOUNT env or local file.');
    console.error('FIREBASE_SERVICE_ACCOUNT length:', (process.env.FIREBASE_SERVICE_ACCOUNT || '').length);
    process.exit(1);
  }
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function searchMemories(searchTerm) {
  console.log(`Searching for: "${searchTerm}"`);

  // Get all users
  const usersSnap = await db.collection('users').get();

  for (const userDoc of usersSnap.docs) {
    const userId = userDoc.id;

    // Search memories collection
    try {
      const memoriesSnap = await db.collection('users').doc(userId).collection('memories').get();

      for (const memDoc of memoriesSnap.docs) {
        const data = memDoc.data();
        if (data.content && data.content.toLowerCase().includes(searchTerm.toLowerCase())) {
          console.log('\n=== Found in MEMORIES ===');
          console.log('User ID:', userId);
          console.log('Content:', data.content);
          console.log('Category:', data.category);
          console.log('Created:', data.createdAt?.toDate?.()?.toISOString() || 'unknown');
        }
      }
    } catch (e) {
      // No memories collection
    }

    // Search messages collection
    try {
      const messagesSnap = await db.collection('users').doc(userId).collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(500)
        .get();

      for (const msgDoc of messagesSnap.docs) {
        const data = msgDoc.data();
        if (data.content && data.content.toLowerCase().includes(searchTerm.toLowerCase())) {
          console.log('\n=== Found in MESSAGES ===');
          console.log('User ID:', userId);
          console.log('Role:', data.role);
          console.log('Content:', data.content.substring(0, 500));
          console.log('Timestamp:', data.timestamp?.toDate?.()?.toISOString() || 'unknown');
        }
      }
    } catch (e) {
      // No messages or error
    }
  }
}

async function listAllMemories() {
  console.log('\n\n========== LISTING ALL SAVED MEMORIES ==========\n');

  const usersSnap = await db.collection('users').get();

  for (const userDoc of usersSnap.docs) {
    const userId = userDoc.id;

    try {
      const memoriesSnap = await db.collection('users').doc(userId).collection('memories').get();

      if (memoriesSnap.docs.length > 0) {
        console.log(`\n--- User: ${userId} (${memoriesSnap.docs.length} memories) ---`);
        for (const memDoc of memoriesSnap.docs) {
          const data = memDoc.data();
          console.log(`  [${data.category || 'other'}] ${data.content}`);
          console.log(`     Created: ${data.createdAt?.toDate?.()?.toISOString() || 'unknown'}`);
        }
      }
    } catch (e) {
      // No memories collection
    }
  }
}

async function main() {
  // Search for birthday mentions
  await searchMemories('birthday');

  // List all saved memories
  await listAllMemories();

  // Also search for specific date patterns
  console.log('\n\n========== SEARCHING FOR DATE MENTIONS ==========\n');
  await searchMemories('january');
  await searchMemories('february');
  await searchMemories('march');
  await searchMemories('april');
  await searchMemories('may');
  await searchMemories('june');
  await searchMemories('july');
  await searchMemories('august');
  await searchMemories('september');
  await searchMemories('october');
  await searchMemories('november');
  await searchMemories('december');

  console.log('\nSearch complete');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
