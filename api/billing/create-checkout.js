// Create Checkout Session API - Start Stripe subscription checkout
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
      console.error('[Create Checkout] Token verification failed:', authError);
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userId = decodedToken.uid;
    const userEmail = decodedToken.email;

    // Get return URL from request body
    const { returnUrl } = req.body || {};
    const successUrl = returnUrl || 'https://mindclone.one';
    const cancelUrl = returnUrl || 'https://mindclone.one';

    // Check if user already has a Stripe customer ID
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    let customerId = userData.billing?.stripeCustomerId;

    // Create or retrieve Stripe customer
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: {
          firebaseUid: userId
        }
      });
      customerId = customer.id;

      // Save customer ID to Firestore
      await db.collection('users').doc(userId).set({
        billing: {
          stripeCustomerId: customerId
        }
      }, { merge: true });
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: userId, // Important: Used in webhook to link subscription
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1
        }
      ],
      subscription_data: {
        trial_period_days: 7, // 7-day free trial
        metadata: {
          firebaseUid: userId
        }
      },
      success_url: `${successUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${cancelUrl}?checkout=canceled`,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      tax_id_collection: {
        enabled: true
      }
    });

    console.log(`[Create Checkout] Session created for user ${userId}: ${session.id}`);

    return res.status(200).json({
      checkoutUrl: session.url,
      sessionId: session.id
    });

  } catch (error) {
    console.error('[Create Checkout] Error:', error);
    return res.status(500).json({
      error: 'Failed to create checkout session',
      message: error.message
    });
  }
};
