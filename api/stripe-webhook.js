// Stripe Webhook Handler - Process subscription events
const Stripe = require('stripe');
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  try {
    // Get raw body for signature verification
    const rawBody = await getRawBody(req);
    const signature = req.headers['stripe-signature'];

    // Verify webhook signature
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('[Stripe Webhook] Signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
    }

    const eventType = event.type;
    console.log(`[Stripe Webhook] Event received: ${eventType}`);

    // Handle events
    switch (eventType) {
      // Checkout completed - subscription started
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;

      // Subscription lifecycle events
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      case 'customer.subscription.trial_will_end':
        await handleTrialWillEnd(event.data.object);
        break;

      // Payment events
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object);
        break;

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${eventType}`);
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('[Stripe Webhook] Error:', error);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
};

// Find user by Stripe customer ID
async function findUserByCustomerId(customerId) {
  const usersSnapshot = await db.collection('users')
    .where('billing.stripeCustomerId', '==', customerId)
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

// Find user by Firebase UID in metadata
async function findUserByFirebaseUid(uid) {
  if (!uid) return null;

  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    return null;
  }

  return {
    ref: userRef,
    id: userDoc.id,
    data: userDoc.data()
  };
}

/**
 * Handle checkout.session.completed
 * User completed checkout, subscription is now active
 */
async function handleCheckoutCompleted(session) {
  const customerId = session.customer;
  const subscriptionId = session.subscription;
  const firebaseUid = session.metadata?.firebaseUid;

  // Try to find user by Firebase UID first, then by customer ID
  let user = await findUserByFirebaseUid(firebaseUid);
  if (!user) {
    user = await findUserByCustomerId(customerId);
  }

  if (!user) {
    console.error(`[Stripe Webhook] No user found for checkout session: ${session.id}`);
    return;
  }

  console.log(`[Stripe Webhook] Checkout completed for user ${user.id}`);

  // Get subscription details
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  await user.ref.update({
    'billing.stripeCustomerId': customerId,
    'billing.stripeSubscriptionId': subscriptionId,
    'billing.subscriptionStatus': subscription.status,
    'billing.currentPeriodStart': new Date(subscription.current_period_start * 1000),
    'billing.currentPeriodEnd': new Date(subscription.current_period_end * 1000),
    'billing.trialEnd': subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle customer.subscription.created
 */
async function handleSubscriptionCreated(subscription) {
  const customerId = subscription.customer;
  const firebaseUid = subscription.metadata?.firebaseUid;

  let user = await findUserByFirebaseUid(firebaseUid);
  if (!user) {
    user = await findUserByCustomerId(customerId);
  }

  if (!user) {
    console.error(`[Stripe Webhook] No user found for subscription: ${subscription.id}`);
    return;
  }

  console.log(`[Stripe Webhook] Subscription created for user ${user.id}: ${subscription.status}`);

  await user.ref.update({
    'billing.stripeSubscriptionId': subscription.id,
    'billing.subscriptionStatus': subscription.status,
    'billing.currentPeriodStart': new Date(subscription.current_period_start * 1000),
    'billing.currentPeriodEnd': new Date(subscription.current_period_end * 1000),
    'billing.trialEnd': subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
    'billing.cancelAtPeriodEnd': subscription.cancel_at_period_end,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle customer.subscription.updated
 */
async function handleSubscriptionUpdated(subscription) {
  const customerId = subscription.customer;
  const firebaseUid = subscription.metadata?.firebaseUid;

  let user = await findUserByFirebaseUid(firebaseUid);
  if (!user) {
    user = await findUserByCustomerId(customerId);
  }

  if (!user) {
    console.error(`[Stripe Webhook] No user found for subscription: ${subscription.id}`);
    return;
  }

  console.log(`[Stripe Webhook] Subscription updated for user ${user.id}: ${subscription.status}`);

  await user.ref.update({
    'billing.subscriptionStatus': subscription.status,
    'billing.currentPeriodStart': new Date(subscription.current_period_start * 1000),
    'billing.currentPeriodEnd': new Date(subscription.current_period_end * 1000),
    'billing.trialEnd': subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
    'billing.cancelAtPeriodEnd': subscription.cancel_at_period_end,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle customer.subscription.deleted
 */
async function handleSubscriptionDeleted(subscription) {
  const customerId = subscription.customer;
  const firebaseUid = subscription.metadata?.firebaseUid;

  let user = await findUserByFirebaseUid(firebaseUid);
  if (!user) {
    user = await findUserByCustomerId(customerId);
  }

  if (!user) {
    console.error(`[Stripe Webhook] No user found for subscription: ${subscription.id}`);
    return;
  }

  console.log(`[Stripe Webhook] Subscription deleted for user ${user.id}`);

  await user.ref.update({
    'billing.subscriptionStatus': 'cancelled',
    'billing.cancelAtPeriodEnd': false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle customer.subscription.trial_will_end
 * Sent 3 days before trial ends
 */
async function handleTrialWillEnd(subscription) {
  const customerId = subscription.customer;
  const firebaseUid = subscription.metadata?.firebaseUid;

  let user = await findUserByFirebaseUid(firebaseUid);
  if (!user) {
    user = await findUserByCustomerId(customerId);
  }

  if (!user) {
    console.error(`[Stripe Webhook] No user found for subscription: ${subscription.id}`);
    return;
  }

  console.log(`[Stripe Webhook] Trial ending soon for user ${user.id}`);

  // You could send an email notification here
  await user.ref.update({
    'billing.trialEndingSoon': true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle invoice.paid
 * Successful payment
 */
async function handleInvoicePaid(invoice) {
  const customerId = invoice.customer;
  const subscriptionId = invoice.subscription;

  const user = await findUserByCustomerId(customerId);
  if (!user) {
    console.error(`[Stripe Webhook] No user found for invoice: ${invoice.id}`);
    return;
  }

  console.log(`[Stripe Webhook] Invoice paid for user ${user.id}: $${invoice.amount_paid / 100}`);

  await user.ref.update({
    'billing.subscriptionStatus': 'active',
    'billing.lastPaymentDate': new Date(invoice.status_transitions?.paid_at * 1000 || Date.now()),
    'billing.lastPaymentAmount': invoice.amount_paid,
    'billing.lastPaymentFailed': false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle invoice.payment_failed
 * Failed payment
 */
async function handleInvoicePaymentFailed(invoice) {
  const customerId = invoice.customer;

  const user = await findUserByCustomerId(customerId);
  if (!user) {
    console.error(`[Stripe Webhook] No user found for invoice: ${invoice.id}`);
    return;
  }

  console.log(`[Stripe Webhook] Invoice payment failed for user ${user.id}`);

  await user.ref.update({
    'billing.lastPaymentFailed': true,
    'billing.lastPaymentError': invoice.last_finalization_error?.message || 'Payment failed',
    'billing.subscriptionStatus': 'past_due',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}
