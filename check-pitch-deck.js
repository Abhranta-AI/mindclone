// Quick script to check if pitch deck data is stored correctly
const { initializeFirebaseAdmin, admin } = require('./api/_firebase-admin');

initializeFirebaseAdmin();
const db = admin.firestore();

async function checkPitchDeck() {
  try {
    // Get your user ID from Firebase Auth or use the one you know
    const usersSnapshot = await db.collection('users').limit(5).get();

    console.log('\n=== Checking Pitch Deck Data ===\n');

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      console.log(`User: ${userData.email || userId}`);
      console.log(`Username: ${userData.username || 'none'}`);

      // Check linkKnowledgeBase
      const kbDoc = await db.collection('users').doc(userId)
        .collection('linkKnowledgeBase').doc('documents').get();

      if (kbDoc.exists) {
        const kbData = kbDoc.data();
        if (kbData.documents?.pitch_deck) {
          const pd = kbData.documents.pitch_deck;
          console.log('✅ Pitch deck found:');
          console.log('  - URL:', pd.url || pd.fileUrl);
          console.log('  - Page Count:', pd.pageCount);
          console.log('  - Type:', pd.type);
        } else {
          console.log('❌ No pitch deck in knowledge base');
        }
      } else {
        console.log('❌ No linkKnowledgeBase documents found');
      }
      console.log('---\n');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkPitchDeck();
