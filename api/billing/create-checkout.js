// Create Subscription API - Start Razorpay subscription checkout
const Razorpay = require('razorpay');
const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify Firebase ID token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    let decodedToken;

    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (authError) {
      console.error('[Create Checkout] Token verification failed:', authError);
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userId = decodedToken.uid;
    const userEmail = decodedToken.email;
    const userName = decodedToken.name || userEmail.split('@')[0];

    // Check if user already has a Razorpay customer ID
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    let customerId = userData.billing?.razorpayCustomerId;

    // Create Razorpay customer if not exists
    if (!customerId) {
      const customer = await razorpay.customers.create({
        name: userName,
        email: userEmail,
        notes: {
          firebaseUid: userId
        }
      });
      customerId = customer.id;

      // Save customer ID to Firestore
      await db.collection('users').doc(userId).set({
        billing: {
          razorpayCustomerId: customerId
        }
      }, { merge: true });
    }

    // Calculate trial end date (7 days from now)
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 7);

    // Create subscription with 7-day trial
    const subscription = await razorpay.subscriptions.create({
      plan_id: process.env.RAZORPAY_PLAN_ID,
      customer_id: customerId,
      quantity: 1,
      total_count: 120, // 10 years worth of monthly billing
      start_at: Math.floor(trialEndDate.getTime() / 1000), // Start charging after trial
      notes: {
        firebaseUid: userId,
        userEmail: userEmail
      },
      customer_notify: 1
    });

    // Save subscription info to Firestore
    await db.collection('users').doc(userId).set({
      billing: {
        razorpayCustomerId: customerId,
        razorpaySubscriptionId: subscription.id,
        subscriptionStatus: 'created',
        trialEnd: trialEndDate
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`[Create Checkout] Subscription created for user ${userId}: ${subscription.id}`);

    return res.status(200).json({
      subscriptionId: subscription.id,
      customerId: customerId,
      keyId: process.env.RAZORPAY_KEY_ID,
      amount: subscription.plan_id ? undefined : 10000, // Amount in paise (₹100 = 10000 paise)
      currency: 'INR',
      name: 'Mindclone Pro',
      description: 'Monthly subscription with 7-day free trial',
      prefill: {
        name: userName,
        email: userEmail
      },
      notes: {
        firebaseUid: userId
      },
      // Short URL for hosted checkout (alternative to embedded)
      shortUrl: subscription.short_url
    });

  } catch (error) {
    console.error('[Create Checkout] Error:', error);
    return res.status(500).json({
      error: 'Failed to create subscription',
      message: error.message
    });
  }
};
