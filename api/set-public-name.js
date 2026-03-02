// One-time admin endpoint to set publicName for the owner
// DELETE THIS FILE AFTER USE
const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');

initializeFirebaseAdmin();
const db = admin.firestore();

module.exports = async (req, res) => {
  const ownerUid = process.env.MINDCLONE_OWNER_UID;
  if (!ownerUid) return res.status(500).json({ error: 'MINDCLONE_OWNER_UID not set' });

  try {
    await db.collection('users').doc(ownerUid)
      .collection('linkSettings').doc('config')
      .set({ publicName: 'Nova', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    return res.status(200).json({ success: true, message: 'publicName set to Nova' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
