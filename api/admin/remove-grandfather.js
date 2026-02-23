// Remove grandfathered status from all users EXCEPT the platform owner
// This ends the free access period — users must now subscribe or remain read-only
const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');

initializeFirebaseAdmin();
const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify admin secret
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.RAZORPAY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const ownerUid = process.env.MINDCLONE_OWNER_UID;
    if (!ownerUid) {
      return res.status(400).json({ error: 'MINDCLONE_OWNER_UID not set — cannot determine who to keep' });
    }

    console.log(`[Un-Grandfather] Starting... Owner UID (keeping): ${ownerUid}`);

    const usersSnapshot = await db.collection('users').get();

    if (usersSnapshot.empty) {
      return res.status(200).json({ message: 'No users found', count: 0 });
    }

    const batchSize = 500;
    let removed = 0;
    let ownerKept = false;
    let alreadyNotGrandfathered = 0;
    let batches = [];
    let currentBatch = db.batch();
    let batchCount = 0;

    for (const doc of usersSnapshot.docs) {
      const userData = doc.data();

      // Skip the owner — keep them grandfathered
      if (doc.id === ownerUid) {
        ownerKept = true;
        console.log(`[Un-Grandfather] Keeping owner: ${userData.email || doc.id}`);
        continue;
      }

      // Skip if not grandfathered
      if (!userData.isGrandfathered) {
        alreadyNotGrandfathered++;
        continue;
      }

      // Remove grandfathered status
      currentBatch.update(doc.ref, {
        isGrandfathered: false,
        grandfatherRemovedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      removed++;
      batchCount++;

      if (batchCount === batchSize) {
        batches.push(currentBatch);
        currentBatch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      batches.push(currentBatch);
    }

    for (let i = 0; i < batches.length; i++) {
      await batches[i].commit();
      console.log(`[Un-Grandfather] Batch ${i + 1}/${batches.length} committed`);
    }

    console.log(`[Un-Grandfather] Done: ${removed} users un-grandfathered, owner kept: ${ownerKept}`);

    return res.status(200).json({
      success: true,
      removed,
      ownerKept,
      alreadyNotGrandfathered,
      total: usersSnapshot.size
    });

  } catch (error) {
    console.error('[Un-Grandfather] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
