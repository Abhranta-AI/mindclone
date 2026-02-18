// Stripe Checkout API - Create subscription checkout session
// Pricing: $100/month with 7-day free trial
const Stripe = require('stripe');
const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Pricing configuration
const PRICING = {
  amount: 10000, // $100.00 in cents
  currency: 'usd',
  interval: 'month',
  trialDays: 7,
  productName: 'Mindclone Pro',
  productDescription: 'Your digital self, always on. Unlimited conversations, public link, all tools included.'
};

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
      console.error('[Stripe Checkout] Token verification failed:', authError);
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userId = decodedToken.uid;
    const userEmail = decodedToken.email;
    const userName = decodedToken.name || userEmail?.split('@')[0] || 'User';

    // Get success/cancel URLs from request or use defaults
    const { successUrl, cancelUrl } = req.body || {};
    const baseUrl = process.env.APP_URL || 'https://mindclone.studio';

    // Check if user already has a Stripe customer ID
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    let customerId = userData.billing?.stripeCustomerId;

    // Create Stripe customer if not exists
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: userName,
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

      console.log(`[Stripe Checkout] Created customer ${customerId} for user ${userId}`);
    }

    // Check if user already has an active subscription
    const existingSubscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1
    });

    if (existingSubscriptions.data.length > 0) {
      return res.status(400).json({
        error: 'Already subscribed',
        message: 'You already have an active subscription. Manage it from your billing portal.'
      });
    }

    // Create or get the price for $100/month
    let priceId = process.env.STRIPE_PRICE_ID;

    // If no price ID configured, create the price dynamically (for development)
    if (!priceId) {
      // First, get or create the product
      const products = await stripe.products.list({ limit: 1, active: true });
      let productId;

      if (products.data.length > 0 && products.data[0].name === PRICING.productName) {
        productId = products.data[0].id;
      } else {
        const product = await stripe.products.create({
          name: PRICING.productName,
          description: PRICING.productDescription
        });
        productId = product.id;
        console.log(`[Stripe Checkout] Created product: ${productId}`);
      }

      // Create the price
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: PRICING.amount,
        currency: PRICING.currency,
        recurring: {
          interval: PRICING.interval
        }
      });
      priceId = price.id;
      console.log(`[Stripe Checkout] Created price: ${priceId}`);
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      subscription_data: {
        trial_period_days: PRICING.trialDays,
        metadata: {
          firebaseUid: userId
        }
      },
      success_url: successUrl || `${baseUrl}/?checkout=success`,
      cancel_url: cancelUrl || `${baseUrl}/?checkout=cancelled`,
      metadata: {
        firebaseUid: userId
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      customer_update: {
        address: 'auto',
        name: 'auto'
      }
    });

    console.log(`[Stripe Checkout] Session created for user ${userId}: ${session.id}`);

    // Save checkout session info to Firestore
    await db.collection('users').doc(userId).set({
      billing: {
        stripeCustomerId: customerId,
        lastCheckoutSessionId: session.id,
        subscriptionStatus: 'checkout_started'
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return res.status(200).json({
      sessionId: session.id,
      url: session.url,
      customerId: customerId,
      pricing: {
        amount: PRICING.amount / 100, // Convert to dollars
        currency: PRICING.currency.toUpperCase(),
        interval: PRICING.interval,
        trialDays: PRICING.trialDays,
        formatted: `$${PRICING.amount / 100}/${PRICING.interval}`
      }
    });

  } catch (error) {
    console.error('[Stripe Checkout] Error:', error);
    return res.status(500).json({
      error: 'Failed to create checkout session',
      message: error.message
    });
  }
};
