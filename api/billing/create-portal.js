// Billing Portal API - Manage Razorpay subscription
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
      console.error('[Billing Portal] Token verification failed:', authError);
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userId = decodedToken.uid;
    const { action } = req.body || {};

    // Get user's subscription info
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userDoc.data();
    const subscriptionId = userData.billing?.razorpaySubscriptionId;

    if (!subscriptionId) {
      return res.status(400).json({
        error: 'No subscription found',
        message: 'Please start a subscription first'
      });
    }

    // Handle different actions
    if (action === 'cancel') {
      // Cancel subscription at end of current period
      const subscription = await razorpay.subscriptions.cancel(subscriptionId, {
        cancel_at_cycle_end: 1
      });

      await db.collection('users').doc(userId).update({
        'billing.subscriptionStatus': subscription.status,
        'billing.cancelAtPeriodEnd': true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`[Billing Portal] Subscription cancelled for user ${userId}`);

      return res.status(200).json({
        success: true,
        message: 'Subscription will be cancelled at the end of the current billing period',
        status: subscription.status
      });
    }

    if (action === 'pause') {
      // Pause subscription
      const subscription = await razorpay.subscriptions.pause(subscriptionId, {
        pause_initiated_by: 'customer'
      });

      await db.collection('users').doc(userId).update({
        'billing.subscriptionStatus': 'paused',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`[Billing Portal] Subscription paused for user ${userId}`);

      return res.status(200).json({
        success: true,
        message: 'Subscription paused',
        status: subscription.status
      });
    }

    if (action === 'resume') {
      // Resume paused subscription
      const subscription = await razorpay.subscriptions.resume(subscriptionId);

      await db.collection('users').doc(userId).update({
        'billing.subscriptionStatus': subscription.status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`[Billing Portal] Subscription resumed for user ${userId}`);

      return res.status(200).json({
        success: true,
        message: 'Subscription resumed',
        status: subscription.status
      });
    }

    // Default: Get subscription details
    const subscription = await razorpay.subscriptions.fetch(subscriptionId);

    // Get invoices for this subscription
    let invoices = [];
    try {
      const invoiceList = await razorpay.invoices.all({
        subscription_id: subscriptionId
      });
      invoices = invoiceList.items || [];
    } catch (e) {
      // Invoices might not exist yet
    }

    return res.status(200).json({
      subscription: {
        id: subscription.id,
        status: subscription.status,
        currentStart: subscription.current_start ? new Date(subscription.current_start * 1000).toISOString() : null,
        currentEnd: subscription.current_end ? new Date(subscription.current_end * 1000).toISOString() : null,
        endedAt: subscription.ended_at ? new Date(subscription.ended_at * 1000).toISOString() : null,
        shortUrl: subscription.short_url
      },
      invoices: invoices.map(inv => ({
        id: inv.id,
        amount: inv.amount / 100, // Convert paise to rupees
        status: inv.status,
        date: inv.date ? new Date(inv.date * 1000).toISOString() : null
      }))
    });

  } catch (error) {
    console.error('[Billing Portal] Error:', error);
    return res.status(500).json({
      error: 'Failed to process request',
      message: error.message
    });
  }
};
