// Moltbook Settings Module - Shared settings logic
// Used by both the API endpoint and the heartbeat cron
// Settings are now user-specific, stored under users/{userId}/settings/moltbook

const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

initializeFirebaseAdmin();
const db = admin.firestore();

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
 * Get Moltbook settings for a specific user
 * @param {string} userId - The user's Firebase UID
 */
async function getMoltbookSettingsByUserId(userId) {
  if (!userId) {
    console.warn('[Moltbook Settings] No userId provided, using defaults');
    return DEFAULT_SETTINGS;
  }

  const doc = await db.collection('users').doc(userId).collection('settings').doc('moltbook').get();
  if (doc.exists) {
    return { ...DEFAULT_SETTINGS, ...doc.data() };
  }
  return DEFAULT_SETTINGS;
}

/**
 * Get Moltbook settings for the deployment owner
 * Uses MINDCLONE_OWNER_UID environment variable to determine the owner
 * Falls back to defaults if not set
 */
async function getMoltbookSettings() {
  const ownerUid = process.env.MINDCLONE_OWNER_UID;

  if (!ownerUid) {
    console.warn('[Moltbook Settings] MINDCLONE_OWNER_UID not set, using default settings');
    return DEFAULT_SETTINGS;
  }

  return getMoltbookSettingsByUserId(ownerUid);
}

/**
 * Update Moltbook settings for a specific user
 * @param {string} userId - The user's Firebase UID
 * @param {object} updates - Settings to update
 */
async function updateMoltbookSettingsByUserId(userId, updates) {
  if (!userId) {
    throw new Error('userId is required to update settings');
  }

  const currentSettings = await getMoltbookSettingsByUserId(userId);
  const newSettings = {
    ...currentSettings,
    ...updates,
    updatedAt: new Date().toISOString()
  };

  await db.collection('users').doc(userId).collection('settings').doc('moltbook').set(newSettings);
  return newSettings;
}

/**
 * Update Moltbook settings (for backwards compatibility with cron)
 * Uses MINDCLONE_OWNER_UID environment variable
 */
async function updateMoltbookSettings(updates) {
  const ownerUid = process.env.MINDCLONE_OWNER_UID;

  if (!ownerUid) {
    console.warn('[Moltbook Settings] MINDCLONE_OWNER_UID not set, cannot update settings');
    throw new Error('MINDCLONE_OWNER_UID environment variable not configured');
  }

  return updateMoltbookSettingsByUserId(ownerUid, updates);
}

module.exports = {
  DEFAULT_SETTINGS,
  getMoltbookSettings,
  getMoltbookSettingsByUserId,
  updateMoltbookSettings,
  updateMoltbookSettingsByUserId
};
