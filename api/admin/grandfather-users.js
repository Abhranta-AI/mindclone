// One-time migration: Grandfather existing users
// Call this endpoint once to mark all existing users as grandfathered
const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

module.exports = async (req, res) => {
  // Only allow POST with secret key
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify admin secret (using Razorpay webhook secret as auth)
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.RAZORPAY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('[Grandfather] Starting migration...');

    const usersSnapshot = await db.collection('users').get();

    if (usersSnapshot.empty) {
      return res.status(200).json({ message: 'No users found', count: 0 });
    }

    // Process in batches of 500 (Firestore limit)
    const batchSize = 500;
    let processed = 0;
    let skipped = 0;
    let batches = [];
    let currentBatch = db.batch();
    let batchCount = 0;

    for (const doc of usersSnapshot.docs) {
      const userData = doc.data();

      // Skip if already grandfathered
      if (userData.isGrandfathered === true) {
        skipped++;
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

    // Commit all batches
    for (let i = 0; i < batches.length; i++) {
      await batches[i].commit();
      console.log(`[Grandfather] Batch ${i + 1}/${batches.length} committed`);
    }

    console.log(`[Grandfather] Migration complete: ${processed} users grandfathered, ${skipped} skipped`);

    return res.status(200).json({
      success: true,
      message: `Grandfathered ${processed} users`,
      processed,
      skipped,
      total: usersSnapshot.size
    });

  } catch (error) {
    console.error('[Grandfather] Error:', error);
    return res.status(500).json({
      error: 'Migration failed',
      message: error.message
    });
  }
};
