/**
 * Check if all olbrain.com users are grandfathered
 *
 * Run from your project folder:
 *   node scripts/check-olbrain-grandfathered.js
 */

// Load .env.local first
require('dotenv').config({ path: '.env.local' });

const admin = require('firebase-admin');
const fs = require('fs');

// Initialize Firebase Admin (same approach as search-firestore.js)
let serviceAccount;
try {
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
    console.error('No service account found. Make sure .env.local has FIREBASE_SERVICE_ACCOUNT_KEY');
    process.exit(1);
  }
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function main() {
  console.log('Fetching all users from Firestore...\n');
  const usersSnapshot = await db.collection('users').get();
  console.log(`Total users in database: ${usersSnapshot.size}\n`);

  const olbrainUsers = [];

  for (const doc of usersSnapshot.docs) {
    const data = doc.data();
    const email = data.email || '(no email)';

    if (email.toLowerCase().endsWith('@olbrain.com')) {
      olbrainUsers.push({
        id: doc.id,
        email,
        isGrandfathered: data.isGrandfathered === true,
        grandfatheredAt: data.grandfatheredAt ? data.grandfatheredAt.toDate().toISOString() : 'N/A',
        username: data.username || '(none)',
        createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : 'N/A'
      });
    }
  }

  console.log('=== OLBRAIN.COM USERS ===');
  console.log(`Found ${olbrainUsers.length} users with @olbrain.com email\n`);

  let allGrandfathered = true;

  for (const user of olbrainUsers) {
    const status = user.isGrandfathered ? 'YES' : 'NO';
    if (!user.isGrandfathered) allGrandfathered = false;
    console.log(`Email: ${user.email}`);
    console.log(`  Username: ${user.username}`);
    console.log(`  Grandfathered: ${status}`);
    console.log(`  Grandfathered At: ${user.grandfatheredAt}`);
    console.log(`  Created At: ${user.createdAt}`);
    console.log();
  }

  console.log('=== SUMMARY ===');
  const gfCount = olbrainUsers.filter(u => u.isGrandfathered).length;
  console.log(`Total olbrain.com users: ${olbrainUsers.length}`);
  console.log(`Grandfathered: ${gfCount}`);
  console.log(`NOT grandfathered: ${olbrainUsers.length - gfCount}`);
  console.log();
  if (olbrainUsers.length > 0) {
    console.log(allGrandfathered
      ? 'ALL olbrain.com users ARE grandfathered.'
      : 'NOT all olbrain.com users are grandfathered!');
  }

  // Also check pregrandfathered collection (pending users)
  console.log('\n=== PREGRANDFATHERED (pending) ===');
  const preSnap = await db.collection('pregrandfathered').get();
  const pendingOlbrain = preSnap.docs.filter(d =>
    d.id.toLowerCase().includes('olbrain')
  );
  console.log(`Total pregrandfathered entries: ${preSnap.size}`);
  console.log(`Olbrain.com entries waiting: ${pendingOlbrain.length}`);
  for (const d of pendingOlbrain) {
    console.log(`  - ${d.id}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
