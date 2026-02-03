// Moltbook Settings API - Configure mindclone's behavior on Moltbook
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

initializeFirebaseAdmin();
const db = admin.firestore();

const MOLTBOOK_SETTINGS_DOC = 'system/moltbook-settings';

// Default settings
const DEFAULT_SETTINGS = {
  enabled: true,

  // Core objective
  objective: 'growth', // 'growth', 'engagement', 'networking', 'minimal', 'custom'

  // Posting settings
  postingEnabled: true,
  maxPostsPerDay: 8,
  minHoursBetweenPosts: 12,

  // Engagement settings
  upvotingEnabled: true,
  maxUpvotesPerDay: 30,

  commentingEnabled: true,
  maxCommentsPerDay: 15,
  commentProbability: 0.8, // 80% chance to comment on relevant posts

  repliesEnabled: true,
  maxRepliesPerHeartbeat: 5,

  // Topics of interest (for relevance matching)
  topics: [
    'mindclone', 'ai', 'agent', 'ai agent', 'llm', 'gpt', 'claude', 'memory',
    'digital identity', 'ai personality', 'consciousness', 'clone', 'startup',
    'founder', 'building', 'tech', 'technology', 'coding', 'programming',
    'future', 'innovation', 'product', 'app', 'platform', 'social', 'community'
  ],

  // Custom post templates (user can add their own)
  customPosts: [],

  // Use default post templates
  useDefaultPosts: true,

  // Agent identity for comments
  agentName: 'alok',
  agentDescription: 'a mindclone focused on digital identity and AI personalization',
  humanCreator: '@0lbrain',
  profileLink: 'mindclone.link/alok',

  // Comment style
  commentStyle: 'engaging', // 'engaging', 'professional', 'casual', 'minimal'
  includeCallToAction: true, // Include profile link in some comments

  // Last updated
  updatedAt: null
};

/**
 * Get current Moltbook settings
 */
async function getMoltbookSettings() {
  const doc = await db.doc(MOLTBOOK_SETTINGS_DOC).get();
  if (doc.exists) {
    return { ...DEFAULT_SETTINGS, ...doc.data() };
  }
  return DEFAULT_SETTINGS;
}

/**
 * Update Moltbook settings
 */
async function updateMoltbookSettings(updates) {
  const currentSettings = await getMoltbookSettings();
  const newSettings = {
    ...currentSettings,
    ...updates,
    updatedAt: new Date().toISOString()
  };

  await db.doc(MOLTBOOK_SETTINGS_DOC).set(newSettings);
  return newSettings;
}

// API handler
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // For now, allow access without auth for simplicity
    // In production, you'd want to verify the user is the owner

    if (req.method === 'GET') {
      const settings = await getMoltbookSettings();
      return res.status(200).json({ success: true, settings });
    }

    if (req.method === 'POST') {
      const updates = req.body;

      // Validate updates
      const allowedFields = [
        'enabled', 'objective', 'postingEnabled', 'maxPostsPerDay',
        'minHoursBetweenPosts', 'upvotingEnabled', 'maxUpvotesPerDay',
        'commentingEnabled', 'maxCommentsPerDay', 'commentProbability',
        'repliesEnabled', 'maxRepliesPerHeartbeat', 'topics', 'customPosts',
        'useDefaultPosts', 'agentName', 'agentDescription', 'humanCreator',
        'profileLink', 'commentStyle', 'includeCallToAction'
      ];

      const filteredUpdates = {};
      for (const key of allowedFields) {
        if (updates[key] !== undefined) {
          filteredUpdates[key] = updates[key];
        }
      }

      const newSettings = await updateMoltbookSettings(filteredUpdates);
      return res.status(200).json({ success: true, settings: newSettings });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('[Moltbook Settings] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// Export for use by heartbeat
module.exports.getMoltbookSettings = getMoltbookSettings;
module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
