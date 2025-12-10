// Shared billing helper functions (Razorpay)

/**
 * Compute user's access level based on subscription status
 * Returns: "full" or "read_only"
 *
 * Razorpay subscription statuses:
 * - created: Subscription created but not charged
 * - authenticated: Customer authenticated but not charged
 * - active: Active subscription
 * - pending: Payment pending
 * - halted: Subscription halted due to payment failure
 * - cancelled: Subscription cancelled
 * - completed: Subscription completed
 * - expired: Subscription expired
 */
function computeAccessLevel(userData) {
  if (!userData) return 'read_only';

  // Grandfathered users have full access forever
  if (userData.isGrandfathered) {
    return 'full';
  }

  const billing = userData.billing || {};
  const status = billing.subscriptionStatus;

  // Active subscriptions have full access
  if (['active', 'authenticated'].includes(status)) {
    return 'full';
  }

  // Check if in trial period
  const trialEnd = billing.trialEnd?.toDate?.() ||
                   (billing.trialEnd ? new Date(billing.trialEnd) : null);
  if (trialEnd && new Date() < trialEnd) {
    return 'full';
  }

  // Pending/halted gets 3-day grace period
  if (['pending', 'halted'].includes(status)) {
    const periodEnd = billing.currentPeriodEnd?.toDate?.() ||
                      (billing.currentPeriodEnd ? new Date(billing.currentPeriodEnd) : null);
    if (periodEnd) {
      const gracePeriodEnd = new Date(periodEnd);
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 3);
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
 * Get subscription status summary for API response
 */
function getSubscriptionSummary(userData) {
  if (!userData) {
    return {
      status: 'none',
      isGrandfathered: false,
      trialDaysRemaining: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      accessLevel: 'read_only'
    };
  }

  const billing = userData.billing || {};
  const accessLevel = computeAccessLevel(userData);
  const trialDaysRemaining = getTrialDaysRemaining(userData);

  // Convert Firestore timestamp to ISO string
  const periodEnd = billing.currentPeriodEnd?.toDate?.() ||
                    (billing.currentPeriodEnd ? new Date(billing.currentPeriodEnd) : null);

  return {
    status: billing.subscriptionStatus || 'none',
    isGrandfathered: userData.isGrandfathered || false,
    trialDaysRemaining,
    currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
    cancelAtPeriodEnd: billing.cancelAtPeriodEnd || false,
    accessLevel,
    razorpaySubscriptionId: billing.razorpaySubscriptionId || null
  };
}

module.exports = {
  computeAccessLevel,
  getTrialDaysRemaining,
  getSubscriptionSummary
};
