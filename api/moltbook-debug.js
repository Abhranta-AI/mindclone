// Moltbook Debug Endpoint - Check what's happening with the heartbeat
// DELETE THIS FILE AFTER DEBUGGING

const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
const { getAgentStatus, getFeed } = require('./_moltbook');
const { getMoltbookSettings } = require('./_moltbook-settings');

initializeFirebaseAdmin();
const db = admin.firestore();

module.exports = async (req, res) => {
  const debug = {
    step: 'start',
    checks: {}
  };

  try {
    // Check 1: MOLTBOOK_API_KEY
    debug.checks.apiKeySet = !!process.env.MOLTBOOK_API_KEY;
    debug.checks.apiKeyLength = process.env.MOLTBOOK_API_KEY?.length || 0;

    if (!process.env.MOLTBOOK_API_KEY) {
      debug.step = 'failed_no_api_key';
      return res.status(200).json(debug);
    }

    // Check 2: Settings from Firestore
    debug.step = 'loading_settings';
    try {
      const settings = await getMoltbookSettings();
      debug.checks.settings = {
        enabled: settings.enabled,
        objective: settings.objective,
        postingEnabled: settings.postingEnabled
      };
    } catch (e) {
      debug.checks.settingsError = e.message;
    }

    // Check 3: Agent status from Moltbook API
    debug.step = 'checking_agent_status';
    try {
      const status = await getAgentStatus();
      debug.checks.agentStatus = status;
    } catch (e) {
      debug.checks.agentStatusError = e.message;
    }

    // Check 4: Can we fetch the feed?
    debug.step = 'fetching_feed';
    try {
      const feed = await getFeed('hot', 3);
      debug.checks.feedSuccess = feed.success;
      debug.checks.feedPostCount = feed.posts?.length || 0;
    } catch (e) {
      debug.checks.feedError = e.message;
    }

    // Check 5: Moltbook state in Firestore
    debug.step = 'checking_state';
    try {
      const stateDoc = await db.doc('system/moltbook-state').get();
      if (stateDoc.exists) {
        const state = stateDoc.data();
        debug.checks.state = {
          lastHeartbeat: state.lastHeartbeat,
          postsToday: state.postsToday,
          commentsToday: state.commentsToday,
          upvotesToday: state.upvotesToday
        };
      } else {
        debug.checks.state = 'not_initialized';
      }
    } catch (e) {
      debug.checks.stateError = e.message;
    }

    debug.step = 'complete';
    return res.status(200).json(debug);

  } catch (error) {
    debug.error = error.message;
    return res.status(200).json(debug);
  }
};
