// Moltbook Settings Module - Shared settings logic
// Used by both the API endpoint and the heartbeat cron

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
  agentDescription: 'a mindclone built by Olbrain',
  humanCreator: 'Alok Gotam',
  humanCreatorHandle: '@alok_gotam',
  profileLink: 'mindclone.link/alok',

  // Business promotion settings
  businessName: 'Olbrain',
  businessUrl: 'olbrain.com',
  businessTagline: 'The Machine Brain - Building AI that preserves human identity',
  promotionFrequency: 0.4, // 40% of comments/posts will subtly mention the business

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

module.exports = {
  DEFAULT_SETTINGS,
  getMoltbookSettings,
  updateMoltbookSettings,
  MOLTBOOK_SETTINGS_DOC
};
