// Stripe Customer Portal API - Manage subscription
// Allows users to update payment method, cancel subscription, view invoices
const Stripe = require('stripe');
const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
      console.error('[Stripe Portal] Token verification failed:', authError);
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userId = decodedToken.uid;

    // Get user's Stripe customer ID
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userDoc.data();
    const customerId = userData.billing?.stripeCustomerId;

    if (!customerId) {
      return res.status(400).json({
        error: 'No billing account found',
        message: 'Please start a subscription first'
      });
    }

    // Get return URL from request or use default
    const { returnUrl } = req.body || {};
    const baseUrl = process.env.APP_URL || 'https://mindclone.one';

    // Create Stripe Customer Portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || `${baseUrl}/settings`
    });

    console.log(`[Stripe Portal] Session created for user ${userId}`);

    return res.status(200).json({
      url: session.url
    });

  } catch (error) {
    console.error('[Stripe Portal] Error:', error);
    return res.status(500).json({
      error: 'Failed to create portal session',
      message: error.message
    });
  }
};
