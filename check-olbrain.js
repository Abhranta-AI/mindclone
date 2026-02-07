require('dotenv').config({ path: '/sessions/focused-brave-galileo/mnt/mindclone/.env.local' });
const admin = require('firebase-admin');

let serviceAccount;
let envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT || '{}';
if (envKey && !envKey.startsWith('{')) {
  envKey = Buffer.from(envKey, 'base64').toString('utf8');
}
serviceAccount = JSON.parse(envKey);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkOlbrainUsers() {
  console.log('Fetching all users from Firestore...');
  const usersSnapshot = await db.collection('users').get();
  console.log('Total users in database:', usersSnapshot.size);
  console.log('');

  const olbrainUsers = [];

  for (const doc of usersSnapshot.docs) {
    const data = doc.data();
    const email = data.email || '(no email)';

    if (email.toLowerCase().endsWith('@olbrain.com')) {
      olbrainUsers.push({
        id: doc.id,
        email: email,
        isGrandfathered: data.isGrandfathered === true,
        grandfatheredAt: data.grandfatheredAt ? data.grandfatheredAt.toDate().toISOString() : 'N/A',
        username: data.username || '(none)',
        createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : 'N/A'
      });
    }
  }

  console.log('=== OLBRAIN.COM USERS ===');
  console.log('Found ' + olbrainUsers.length + ' users with @olbrain.com email');
  console.log('');

  if (olbrainUsers.length === 0) {
    console.log('No olbrain.com users found.');
  } else {
    let allGrandfathered = true;
    for (const user of olbrainUsers) {
      const status = user.isGrandfathered ? 'YES' : 'NO';
      if (!user.isGrandfathered) allGrandfathered = false;
      console.log('Email:', user.email);
      console.log('  Username:', user.username);
      console.log('  Grandfathered:', status);
      console.log('  Grandfathered At:', user.grandfatheredAt);
      console.log('  Created At:', user.createdAt);
      console.log('');
    }

    console.log('=== SUMMARY ===');
    console.log('Total olbrain.com users:', olbrainUsers.length);
    console.log('Grandfathered:', olbrainUsers.filter(u => u.isGrandfathered).length);
    console.log('NOT grandfathered:', olbrainUsers.filter(u => !u.isGrandfathered).length);
    console.log('');
    console.log(allGrandfathered ? 'ALL olbrain.com users ARE grandfathered.' : 'NOT all olbrain.com users are grandfathered!');
  }

  // Also check pregrandfathered collection for any pending olbrain.com emails
  console.log('');
  console.log('=== CHECKING PREGRANDFATHERED COLLECTION ===');
  const preGrandfatheredSnap = await db.collection('pregrandfathered').get();
  const pendingOlbrain = [];
  for (const doc of preGrandfatheredSnap.docs) {
    if (doc.id.toLowerCase().endsWith('@olbrain.com') || doc.id.toLowerCase().includes('olbrain')) {
      pendingOlbrain.push(doc.id);
    }
  }
  console.log('Total pregrandfathered entries:', preGrandfatheredSnap.size);
  console.log('Olbrain.com entries in pregrandfathered:', pendingOlbrain.length);
  if (pendingOlbrain.length > 0) {
    console.log('Pending olbrain.com emails:', pendingOlbrain.join(', '));
  }

  process.exit(0);
}

checkOlbrainUsers().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
