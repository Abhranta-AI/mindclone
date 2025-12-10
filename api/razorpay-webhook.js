// Razorpay Webhook Handler - Process subscription events
const crypto = require('crypto');
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Disable body parsing to get raw body for signature verification
module.exports.config = {
  api: {
    bodyParser: false
  }
};

// Helper to get raw body
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
    });
    req.on('end', () => {
      resolve(data);
    });
    req.on('error', reject);
  });
}

// Verify Razorpay webhook signature
function verifySignature(rawBody, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return signature === expectedSignature;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  try {
    // Get raw body for signature verification
    const rawBody = await getRawBody(req);
    const signature = req.headers['x-razorpay-signature'];

    // Verify webhook signature
    if (!verifySignature(rawBody, signature, process.env.RAZORPAY_WEBHOOK_SECRET)) {
      console.error('[Razorpay Webhook] Signature verification failed');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(rawBody);
    const eventType = event.event;
    const payload = event.payload;

    console.log(`[Razorpay Webhook] Event received: ${eventType}`);

    // Handle events
    switch (eventType) {
      case 'subscription.authenticated':
        await handleSubscriptionAuthenticated(payload);
        break;

      case 'subscription.activated':
        await handleSubscriptionActivated(payload);
        break;

      case 'subscription.charged':
        await handleSubscriptionCharged(payload);
        break;

      case 'subscription.pending':
        await handleSubscriptionPending(payload);
        break;

      case 'subscription.halted':
        await handleSubscriptionHalted(payload);
        break;

      case 'subscription.cancelled':
        await handleSubscriptionCancelled(payload);
        break;

      case 'subscription.paused':
        await handleSubscriptionPaused(payload);
        break;

      case 'subscription.resumed':
        await handleSubscriptionResumed(payload);
        break;

      case 'payment.captured':
        await handlePaymentCaptured(payload);
        break;

      case 'payment.failed':
        await handlePaymentFailed(payload);
        break;

      default:
        console.log(`[Razorpay Webhook] Unhandled event type: ${eventType}`);
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('[Razorpay Webhook] Error:', error);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
};

// Find user by Razorpay subscription ID
async function findUserBySubscriptionId(subscriptionId) {
  const usersSnapshot = await db.collection('users')
    .where('billing.razorpaySubscriptionId', '==', subscriptionId)
    .limit(1)
    .get();

  if (usersSnapshot.empty) {
    return null;
  }

  return {
    ref: usersSnapshot.docs[0].ref,
    id: usersSnapshot.docs[0].id,
    data: usersSnapshot.docs[0].data()
  };
}

// Find user by Razorpay customer ID
async function findUserByCustomerId(customerId) {
  const usersSnapshot = await db.collection('users')
    .where('billing.razorpayCustomerId', '==', customerId)
    .limit(1)
    .get();

  if (usersSnapshot.empty) {
    return null;
  }

  return {
    ref: usersSnapshot.docs[0].ref,
    id: usersSnapshot.docs[0].id,
    data: usersSnapshot.docs[0].data()
  };
}

/**
 * Handle subscription.authenticated
 * Customer has completed authentication, subscription not yet charged
 */
async function handleSubscriptionAuthenticated(payload) {
  const subscription = payload.subscription?.entity;
  if (!subscription) return;

  const user = await findUserBySubscriptionId(subscription.id);
  if (!user) {
    console.error(`[Razorpay Webhook] No user found for subscription: ${subscription.id}`);
    return;
  }

  console.log(`[Razorpay Webhook] Subscription authenticated for user ${user.id}`);

  await user.ref.update({
    'billing.subscriptionStatus': 'authenticated',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle subscription.activated
 * Subscription is now active
 */
async function handleSubscriptionActivated(payload) {
  const subscription = payload.subscription?.entity;
  if (!subscription) return;

  const user = await findUserBySubscriptionId(subscription.id);
  if (!user) {
    console.error(`[Razorpay Webhook] No user found for subscription: ${subscription.id}`);
    return;
  }

  console.log(`[Razorpay Webhook] Subscription activated for user ${user.id}`);

  await user.ref.update({
    'billing.subscriptionStatus': 'active',
    'billing.currentPeriodStart': subscription.current_start
      ? new Date(subscription.current_start * 1000)
      : null,
    'billing.currentPeriodEnd': subscription.current_end
      ? new Date(subscription.current_end * 1000)
      : null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle subscription.charged
 * Payment successful for subscription
 */
async function handleSubscriptionCharged(payload) {
  const subscription = payload.subscription?.entity;
  const payment = payload.payment?.entity;
  if (!subscription) return;

  const user = await findUserBySubscriptionId(subscription.id);
  if (!user) {
    console.error(`[Razorpay Webhook] No user found for subscription: ${subscription.id}`);
    return;
  }

  console.log(`[Razorpay Webhook] Subscription charged for user ${user.id}`);

  await user.ref.update({
    'billing.subscriptionStatus': 'active',
    'billing.lastPaymentId': payment?.id || null,
    'billing.currentPeriodStart': subscription.current_start
      ? new Date(subscription.current_start * 1000)
      : null,
    'billing.currentPeriodEnd': subscription.current_end
      ? new Date(subscription.current_end * 1000)
      : null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle subscription.pending
 * Payment is pending
 */
async function handleSubscriptionPending(payload) {
  const subscription = payload.subscription?.entity;
  if (!subscription) return;

  const user = await findUserBySubscriptionId(subscription.id);
  if (!user) {
    console.error(`[Razorpay Webhook] No user found for subscription: ${subscription.id}`);
    return;
  }

  console.log(`[Razorpay Webhook] Subscription pending for user ${user.id}`);

  await user.ref.update({
    'billing.subscriptionStatus': 'pending',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle subscription.halted
 * Subscription halted due to payment failures
 */
async function handleSubscriptionHalted(payload) {
  const subscription = payload.subscription?.entity;
  if (!subscription) return;

  const user = await findUserBySubscriptionId(subscription.id);
  if (!user) {
    console.error(`[Razorpay Webhook] No user found for subscription: ${subscription.id}`);
    return;
  }

  console.log(`[Razorpay Webhook] Subscription halted for user ${user.id}`);

  await user.ref.update({
    'billing.subscriptionStatus': 'halted',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle subscription.cancelled
 * Subscription has been cancelled
 */
async function handleSubscriptionCancelled(payload) {
  const subscription = payload.subscription?.entity;
  if (!subscription) return;

  const user = await findUserBySubscriptionId(subscription.id);
  if (!user) {
    console.error(`[Razorpay Webhook] No user found for subscription: ${subscription.id}`);
    return;
  }

  console.log(`[Razorpay Webhook] Subscription cancelled for user ${user.id}`);

  await user.ref.update({
    'billing.subscriptionStatus': 'cancelled',
    'billing.cancelAtPeriodEnd': false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle subscription.paused
 */
async function handleSubscriptionPaused(payload) {
  const subscription = payload.subscription?.entity;
  if (!subscription) return;

  const user = await findUserBySubscriptionId(subscription.id);
  if (!user) {
    console.error(`[Razorpay Webhook] No user found for subscription: ${subscription.id}`);
    return;
  }

  console.log(`[Razorpay Webhook] Subscription paused for user ${user.id}`);

  await user.ref.update({
    'billing.subscriptionStatus': 'paused',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle subscription.resumed
 */
async function handleSubscriptionResumed(payload) {
  const subscription = payload.subscription?.entity;
  if (!subscription) return;

  const user = await findUserBySubscriptionId(subscription.id);
  if (!user) {
    console.error(`[Razorpay Webhook] No user found for subscription: ${subscription.id}`);
    return;
  }

  console.log(`[Razorpay Webhook] Subscription resumed for user ${user.id}`);

  await user.ref.update({
    'billing.subscriptionStatus': subscription.status || 'active',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle payment.captured
 */
async function handlePaymentCaptured(payload) {
  const payment = payload.payment?.entity;
  if (!payment) return;

  console.log(`[Razorpay Webhook] Payment captured: ${payment.id}`);
  // Payment success is handled by subscription.charged
}

/**
 * Handle payment.failed
 */
async function handlePaymentFailed(payload) {
  const payment = payload.payment?.entity;
  if (!payment) return;

  // Try to find user by notes if subscription_id not available
  const subscriptionId = payment.subscription_id;
  if (!subscriptionId) {
    console.log(`[Razorpay Webhook] Payment failed (no subscription): ${payment.id}`);
    return;
  }

  const user = await findUserBySubscriptionId(subscriptionId);
  if (!user) {
    console.error(`[Razorpay Webhook] No user found for subscription: ${subscriptionId}`);
    return;
  }

  console.log(`[Razorpay Webhook] Payment failed for user ${user.id}`);

  await user.ref.update({
    'billing.lastPaymentFailed': true,
    'billing.lastPaymentError': payment.error_description || 'Payment failed',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}
