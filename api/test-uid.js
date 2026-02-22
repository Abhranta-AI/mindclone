// Quick endpoint to find Firebase UID from email - DELETE AFTER USE
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
initializeFirebaseAdmin();

module.exports = async (req, res) => {
  try {
    const email = 'alok@olbrain.com';
    const userRecord = await admin.auth().getUserByEmail(email);
    return res.status(200).json({
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
