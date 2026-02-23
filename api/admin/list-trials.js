// Temporary endpoint to list all trial users - DELETE AFTER USE
const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');

initializeFirebaseAdmin();
const db = admin.firestore();

module.exports = async (req, res) => {
  try {
    const usersSnap = await db.collection('users').get();
    const trials = [];
    const now = new Date();

    for (const doc of usersSnap.docs) {
      const data = doc.data();
      const billing = data.billing || {};
      const status = billing.subscriptionStatus;

      // Get trial end date
      const trialEnd = billing.trialEnd?.toDate?.() ||
                       (billing.trialEnd ? new Date(billing.trialEnd) : null);

      const isTrialing = status === 'trialing' || (trialEnd && now < trialEnd);
      const isExpired = trialEnd && now >= trialEnd && !data.isGrandfathered && status !== 'active';

      if (trialEnd || status === 'trialing') {
        const daysRemaining = trialEnd ? Math.round((trialEnd - now) / (1000 * 60 * 60 * 24) * 10) / 10 : 'unknown';

        trials.push({
          email: data.email || 'no email',
          username: data.username || 'no username',
          status: status || 'none',
          isGrandfathered: !!data.isGrandfathered,
          trialEnd: trialEnd?.toISOString() || 'not set',
          daysRemaining,
          state: data.isGrandfathered ? 'GRANDFATHERED' :
                 status === 'active' ? 'PAID' :
                 isTrialing ? 'TRIAL ACTIVE' :
                 isExpired ? 'EXPIRED' : status?.toUpperCase() || 'UNKNOWN'
        });
      }
    }

    // Sort: active trials first, then expired
    trials.sort((a, b) => {
      if (a.state === 'TRIAL ACTIVE' && b.state !== 'TRIAL ACTIVE') return -1;
      if (b.state === 'TRIAL ACTIVE' && a.state !== 'TRIAL ACTIVE') return 1;
      return (b.daysRemaining || 0) - (a.daysRemaining || 0);
    });

    return res.status(200).json({
      total_users: usersSnap.size,
      trial_count: trials.length,
      active_trials: trials.filter(t => t.state === 'TRIAL ACTIVE').length,
      expired: trials.filter(t => t.state === 'EXPIRED').length,
      users: trials
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
