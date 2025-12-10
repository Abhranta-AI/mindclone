// Grandfather Migration Script
// Run this ONCE before enabling billing for new users
// This marks all existing users as grandfathered (free forever)

const { initializeFirebaseAdmin, admin } = require('../api/_firebase-admin');

async function grandfatherExistingUsers() {
  console.log('Initializing Firebase Admin...');
  initializeFirebaseAdmin();
  const db = admin.firestore();

  console.log('Fetching all users...');
  const usersSnapshot = await db.collection('users').get();

  if (usersSnapshot.empty) {
    console.log('No users found.');
    return;
  }

  console.log(`Found ${usersSnapshot.size} users to grandfather.`);

  // Process in batches of 500 (Firestore limit)
  const batchSize = 500;
  let processed = 0;
  let batches = [];
  let currentBatch = db.batch();
  let batchCount = 0;

  for (const doc of usersSnapshot.docs) {
    const userData = doc.data();

    // Skip if already grandfathered
    if (userData.isGrandfathered === true) {
      console.log(`  Skipping ${doc.id} (already grandfathered)`);
      continue;
    }

    currentBatch.update(doc.ref, {
      isGrandfathered: true,
      grandfatheredAt: admin.firestore.FieldValue.serverTimestamp()
    });

    batchCount++;
    processed++;

    if (batchCount === batchSize) {
      batches.push(currentBatch);
      currentBatch = db.batch();
      batchCount = 0;
    }
  }

  // Don't forget the last batch
  if (batchCount > 0) {
    batches.push(currentBatch);
  }

  console.log(`\nCommitting ${batches.length} batch(es)...`);

  for (let i = 0; i < batches.length; i++) {
    await batches[i].commit();
    console.log(`  Batch ${i + 1}/${batches.length} committed.`);
  }

  console.log(`\n✅ Successfully grandfathered ${processed} users!`);
  console.log('These users will have free access forever.');

  process.exit(0);
}

grandfatherExistingUsers().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
