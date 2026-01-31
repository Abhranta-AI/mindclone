// Shared billing helper functions (Stripe)
// Pricing: $100/month with 7-day free trial

/**
 * Pricing configuration - single source of truth
 */
const PRICING = {
  amount: 10000, // $100.00 in cents
  currency: 'usd',
  interval: 'month',
  trialDays: 7,
  productName: 'Mindclone Pro',
  formatted: '$100/month'
};

/**
 * Compute user's access level based on subscription status
 * Returns: "full" or "read_only"
 *
 * Stripe subscription statuses:
 * - trialing: In trial period
 * - active: Active subscription
 * - past_due: Payment failed, in grace period
 * - canceled: Subscription cancelled
 * - unpaid: Payment failed after retries
 * - incomplete: Initial payment failed
 * - incomplete_expired: Initial payment failed and expired
 */
function computeAccessLevel(userData) {
  if (!userData) return 'read_only';

  // Grandfathered users have full access forever
  if (userData.isGrandfathered) {
    return 'full';
  }

  const billing = userData.billing || {};
  const status = billing.subscriptionStatus;

  // Active or trialing subscriptions have full access
  if (['active', 'trialing'].includes(status)) {
    return 'full';
  }

  // Check if in trial period (fallback for users without subscription yet)
  const trialEnd = billing.trialEnd?.toDate?.() ||
                   (billing.trialEnd ? new Date(billing.trialEnd) : null);
  if (trialEnd && new Date() < trialEnd) {
    return 'full';
  }

  // Past due gets 7-day grace period
  if (status === 'past_due') {
    const periodEnd = billing.currentPeriodEnd?.toDate?.() ||
                      (billing.currentPeriodEnd ? new Date(billing.currentPeriodEnd) : null);
    if (periodEnd) {
      const gracePeriodEnd = new Date(periodEnd);
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 7);
      if (new Date() < gracePeriodEnd) {
        return 'full';
      }
    }
  }

  // Default to read-only
  return 'read_only';
}

/**
 * Get number of days remaining in trial
 * Returns: number (days) or null if not in trial
 */
function getTrialDaysRemaining(userData) {
  const billing = userData?.billing || {};
  const trialEnd = billing.trialEnd?.toDate?.() ||
                   (billing.trialEnd ? new Date(billing.trialEnd) : null);

  if (!trialEnd) return null;

  const now = new Date();
  const end = new Date(trialEnd);
  const diffMs = end - now;
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
}

/**
 * Get number of hours remaining in trial (for granular countdown)
 * Returns: number (hours) or null if not in trial
 */
function getTrialHoursRemaining(userData) {
  const billing = userData?.billing || {};
  const trialEnd = billing.trialEnd?.toDate?.() ||
                   (billing.trialEnd ? new Date(billing.trialEnd) : null);

  if (!trialEnd) return null;

  const now = new Date();
  const end = new Date(trialEnd);
  const diffMs = end - now;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  return Math.max(0, diffHours);
}

/**
 * Get subscription status summary for API response
 */
function getSubscriptionSummary(userData) {
  if (!userData) {
    return {
      status: 'none',
      isGrandfathered: false,
      trialDaysRemaining: null,
      trialHoursRemaining: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      accessLevel: 'read_only',
      pricing: PRICING
    };
  }

  const billing = userData.billing || {};
  const accessLevel = computeAccessLevel(userData);
  const trialDaysRemaining = getTrialDaysRemaining(userData);
  const trialHoursRemaining = getTrialHoursRemaining(userData);

  // Convert Firestore timestamp to ISO string
  const periodEnd = billing.currentPeriodEnd?.toDate?.() ||
                    (billing.currentPeriodEnd ? new Date(billing.currentPeriodEnd) : null);

  const trialEnd = billing.trialEnd?.toDate?.() ||
                   (billing.trialEnd ? new Date(billing.trialEnd) : null);

  return {
    status: billing.subscriptionStatus || 'none',
    isGrandfathered: userData.isGrandfathered || false,
    trialDaysRemaining,
    trialHoursRemaining,
    trialEnd: trialEnd ? trialEnd.toISOString() : null,
    currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
    cancelAtPeriodEnd: billing.cancelAtPeriodEnd || false,
    accessLevel,
    stripeSubscriptionId: billing.stripeSubscriptionId || null,
    stripeCustomerId: billing.stripeCustomerId || null,
    pricing: PRICING
  };
}

module.exports = {
  PRICING,
  computeAccessLevel,
  getTrialDaysRemaining,
  getTrialHoursRemaining,
  getSubscriptionSummary
};
