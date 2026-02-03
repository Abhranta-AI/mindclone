// Moltbook Stats API - Get analytics for Moltbook activity
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
const { getAgentProfile } = require('./_moltbook');
const { getMoltbookSettings } = require('./_moltbook-settings');

initializeFirebaseAdmin();
const db = admin.firestore();

// State is global per deployment (one Moltbook agent per API key)
const MOLTBOOK_STATE_DOC = 'system/moltbook-state';

/**
 * Get Moltbook activity stats
 */
async function getMoltbookStats() {
  // Get state (daily activity counters) - global per deployment
  const stateDoc = await db.doc(MOLTBOOK_STATE_DOC).get();
  const state = stateDoc.exists ? stateDoc.data() : {};

  // Get settings from owner's user-specific settings
  const settings = await getMoltbookSettings();

  // Try to get profile from Moltbook API
  let profile = null;
  try {
    if (process.env.MOLTBOOK_API_KEY) {
      profile = await getAgentProfile();
    }
  } catch (e) {
    console.log('[Moltbook Stats] Failed to fetch profile:', e.message);
  }

  return {
    // Current day stats
    today: {
      posts: state.postsToday || 0,
      comments: state.commentsToday || 0,
      upvotes: state.upvotesToday || 0,
      replies: state.repliesToday || 0
    },

    // State info
    lastHeartbeat: state.lastHeartbeat || null,
    lastPostTime: state.lastPostTime || null,
    lastResetDate: state.lastResetDate || null,

    // Settings summary
    settings: {
      enabled: settings.enabled !== false,
      objective: settings.objective || 'growth',
      postingEnabled: settings.postingEnabled !== false,
      commentingEnabled: settings.commentingEnabled !== false,
      upvotingEnabled: settings.upvotingEnabled !== false
    },

    // Profile from Moltbook (if available)
    profile: profile?.agent ? {
      name: profile.agent.name,
      karma: profile.agent.karma || 0,
      followers: profile.agent.followers || 0,
      following: profile.agent.following || 0,
      postCount: profile.agent.postCount || 0,
      commentCount: profile.agent.commentCount || 0,
      createdAt: profile.agent.createdAt
    } : null,

    // Interaction history
    interactedPostsCount: (state.interactedPosts || []).length,
    repliedCommentsCount: (state.repliedComments || []).length,
    followedAgentsCount: (state.followedAgents || []).length
  };
}

// API handler
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const stats = await getMoltbookStats();
    return res.status(200).json({ success: true, stats });
  } catch (error) {
    console.error('[Moltbook Stats] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
