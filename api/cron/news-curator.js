// News Curator Cron Job - Runs hourly to find relevant news for users
const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Import news curation modules
const { buildUserInterestProfile } = require('../news/profile-builder');
const { searchNewsWithGrounding } = require('../news/search-engine');
const { calculateRelevanceScore } = require('../news/relevance-scorer');
const { hasSeenArticle, markArticleAsSeen } = require('../news/deduplicator');
const { formatNewsDigest, injectMessage } = require('../news/message-formatter');

// Constants
const BATCH_SIZE = 10; // Process 10 users per hour to stay under 60s timeout
const MAX_RETRIES = 2;
const MAX_ARTICLES_PER_DAY = 10;
const MIN_RELEVANCE_SCORE = 60;
const INACTIVITY_THRESHOLD_DAYS = 7;

/**
 * Get batch of users to process this hour
 * Rotates through all active users, skipping inactive/disabled ones
 */
async function getUserBatch(batchSize = BATCH_SIZE) {
  try {
    const now = Date.now();
    const inactivityThreshold = now - (INACTIVITY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    // Get all users
    const usersSnapshot = await db.collection('users').get();
    const eligibleUsers = [];

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();

      // Skip if user has no lastActive timestamp or is too old
      if (!userData.lastActive || userData.lastActive.toMillis() < inactivityThreshold) {
        continue;
      }

      // Check news curation config
      const configDoc = await db.collection('users').doc(userId)
        .collection('newsCuration').doc('config').get();

      const config = configDoc.exists ? configDoc.data() : { enabled: true };

      // Skip if disabled
      if (config.enabled === false) {
        continue;
      }

      // Skip if reached daily limit
      const articlesSentToday = config.articlesSentToday || 0;
      const lastResetDate = config.lastResetDate?.toDate() || new Date(0);
      const needsReset = lastResetDate < dayStart;

      if (!needsReset && articlesSentToday >= MAX_ARTICLES_PER_DAY) {
        continue;
      }

      // Add to eligible list
      eligibleUsers.push({
        userId,
        lastCheck: config.lastCheckTimestamp?.toMillis() || 0,
        consecutiveFailures: config.consecutiveFailures || 0
      });
    }

    // Sort by lastCheck (oldest first) to rotate fairly
    eligibleUsers.sort((a, b) => a.lastCheck - b.lastCheck);

    // Take batch
    const batch = eligibleUsers.slice(0, batchSize).map(u => u.userId);

    console.log(`[NewsCurator] Found ${eligibleUsers.length} eligible users, processing batch of ${batch.length}`);

    return batch;
  } catch (error) {
    console.error('[NewsCurator] Error getting user batch:', error);
    throw error;
  }
}

/**
 * Curate news for a single user
 */
async function curateNewsForUser(userId) {
  const startTime = Date.now();
  console.log(`[NewsCurator] Processing user ${userId}`);

  try {
    // Step 1: Build interest profile from Mem0 memories
    console.log(`[NewsCurator] Building profile for ${userId}`);
    const profile = await buildUserInterestProfile(userId);

    if (!profile || (!profile.topics?.length && !profile.entities?.length)) {
      console.log(`[NewsCurator] No interests found for ${userId}, skipping`);
      await updateUserConfig(userId, { lastCheckTimestamp: admin.firestore.FieldValue.serverTimestamp() });
      return { userId, status: 'skipped', reason: 'no_interests' };
    }

    // Step 2: Search for news using Gemini grounding
    console.log(`[NewsCurator] Searching news for ${userId}`);
    const articles = await searchNewsWithGrounding(profile);

    if (!articles || articles.length === 0) {
      console.log(`[NewsCurator] No articles found for ${userId}`);
      await updateUserConfig(userId, { lastCheckTimestamp: admin.firestore.FieldValue.serverTimestamp() });
      return { userId, status: 'skipped', reason: 'no_articles' };
    }

    console.log(`[NewsCurator] Found ${articles.length} candidate articles for ${userId}`);

    // Step 3: Score and filter articles
    const scoredArticles = [];
    for (const article of articles) {
      // Check if already seen
      const seen = await hasSeenArticle(userId, article.url);
      if (seen) {
        continue;
      }

      // Calculate relevance score
      const score = calculateRelevanceScore(article, profile);

      if (score >= MIN_RELEVANCE_SCORE) {
        scoredArticles.push({ ...article, score });
      }
    }

    // Sort by score (highest first)
    scoredArticles.sort((a, b) => b.score - a.score);

    console.log(`[NewsCurator] ${scoredArticles.length} articles passed relevance threshold for ${userId}`);

    if (scoredArticles.length === 0) {
      await updateUserConfig(userId, { lastCheckTimestamp: admin.firestore.FieldValue.serverTimestamp() });
      return { userId, status: 'skipped', reason: 'low_relevance' };
    }

    // Step 4: Check daily limit
    const configDoc = await db.collection('users').doc(userId)
      .collection('newsCuration').doc('config').get();
    const config = configDoc.exists ? configDoc.data() : {};

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const lastResetDate = config.lastResetDate?.toDate() || new Date(0);
    const needsReset = lastResetDate < dayStart;

    let articlesSentToday = needsReset ? 0 : (config.articlesSentToday || 0);
    const remainingQuota = MAX_ARTICLES_PER_DAY - articlesSentToday;

    if (remainingQuota <= 0) {
      console.log(`[NewsCurator] Daily limit reached for ${userId}`);
      return { userId, status: 'skipped', reason: 'daily_limit' };
    }

    // Limit articles to remaining quota
    const articlesToSend = scoredArticles.slice(0, Math.min(remainingQuota, 5)); // Max 5 per check

    // Step 5: Format and inject message
    console.log(`[NewsCurator] Sending ${articlesToSend.length} articles to ${userId}`);
    const digest = formatNewsDigest(articlesToSend, profile);
    await injectMessage(userId, digest, articlesToSend);

    // Step 6: Mark articles as seen
    for (const article of articlesToSend) {
      await markArticleAsSeen(userId, article);
    }

    // Step 7: Update user config
    await updateUserConfig(userId, {
      lastCheckTimestamp: admin.firestore.FieldValue.serverTimestamp(),
      lastSuccessfulCheck: admin.firestore.FieldValue.serverTimestamp(),
      consecutiveFailures: 0,
      articlesSentToday: articlesSentToday + articlesToSend.length,
      lastResetDate: needsReset ? admin.firestore.FieldValue.serverTimestamp() : config.lastResetDate
    });

    const processingTime = Date.now() - startTime;
    console.log(`[NewsCurator] Successfully processed ${userId} in ${processingTime}ms`);

    return {
      userId,
      status: 'success',
      articlesSent: articlesToSend.length,
      avgScore: articlesToSend.reduce((sum, a) => sum + a.score, 0) / articlesToSend.length,
      processingTime
    };

  } catch (error) {
    console.error(`[NewsCurator] Error processing user ${userId}:`, error);

    // Update failure count
    const configDoc = await db.collection('users').doc(userId)
      .collection('newsCuration').doc('config').get();
    const config = configDoc.exists ? configDoc.data() : {};

    await updateUserConfig(userId, {
      lastCheckTimestamp: admin.firestore.FieldValue.serverTimestamp(),
      consecutiveFailures: (config.consecutiveFailures || 0) + 1
    });

    return {
      userId,
      status: 'error',
      error: error.message
    };
  }
}

/**
 * Process user with retry logic
 */
async function processUserWithRetry(userId, maxRetries = MAX_RETRIES) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await curateNewsForUser(userId);
    } catch (error) {
      lastError = error;
      console.error(`[NewsCurator] Attempt ${attempt + 1}/${maxRetries + 1} failed for ${userId}:`, error.message);

      if (attempt < maxRetries) {
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  return {
    userId,
    status: 'error',
    error: lastError?.message || 'Unknown error',
    retriesExhausted: true
  };
}

/**
 * Update user news curation config
 */
async function updateUserConfig(userId, updates) {
  await db.collection('users').doc(userId)
    .collection('newsCuration').doc('config')
    .set(updates, { merge: true });
}

/**
 * Update global cron job stats
 */
async function updateCronStats(stats) {
  await db.collection('cronJobs').doc('newsCuration').set({
    ...stats,
    lastRunTimestamp: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

/**
 * Main cron handler
 */
module.exports = async (req, res) => {
  const startTime = Date.now();

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate cron request
  // Vercel cron jobs are triggered internally and are secure by default
  // We check for either:
  // 1. Vercel's internal cron header (x-vercel-cron)
  // 2. Manual trigger with CRON_SECRET
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = req.headers.authorization;
  const providedToken = authHeader?.replace('Bearer ', '').trim();
  const isManualAuth = cronSecret && providedToken === cronSecret;

  console.log(`[NewsCurator] Auth debug: isVercelCron=${isVercelCron}, hasAuthHeader=${!!authHeader}, secretMatch=${isManualAuth}`);

  if (!isVercelCron && !isManualAuth) {
    console.error('[NewsCurator] Unauthorized cron request - missing x-vercel-cron header or valid auth');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log(`[NewsCurator] Auth passed: isVercelCron=${isVercelCron}, isManualAuth=${isManualAuth}`);

  console.log('[NewsCurator] Starting hourly curation run');

  try {
    // Get batch of users to process
    const userBatch = await getUserBatch(BATCH_SIZE);

    if (userBatch.length === 0) {
      console.log('[NewsCurator] No users to process');
      await updateCronStats({
        lastRunStatus: 'success',
        usersProcessed: 0,
        articlesSent: 0,
        processingTimeMs: Date.now() - startTime
      });
      return res.status(200).json({ status: 'success', message: 'No users to process' });
    }

    // Process each user
    const results = [];
    for (const userId of userBatch) {
      const result = await processUserWithRetry(userId);
      results.push(result);
    }

    // Calculate stats
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const skippedCount = results.filter(r => r.status === 'skipped').length;
    const totalArticles = results.reduce((sum, r) => sum + (r.articlesSent || 0), 0);
    const avgScore = results
      .filter(r => r.avgScore)
      .reduce((sum, r, _, arr) => sum + r.avgScore / arr.length, 0);

    const processingTime = Date.now() - startTime;

    console.log(`[NewsCurator] Completed: ${successCount} success, ${errorCount} errors, ${skippedCount} skipped, ${totalArticles} articles sent`);

    // Update global stats
    await updateCronStats({
      lastRunStatus: errorCount === 0 ? 'success' : (successCount > 0 ? 'partial' : 'failed'),
      usersProcessed: userBatch.length,
      articlesSent: totalArticles,
      processingTimeMs: processingTime,
      errors: results.filter(r => r.status === 'error').map(r => ({
        userId: r.userId,
        error: r.error,
        timestamp: new Date()
      }))
    });

    return res.status(200).json({
      status: 'success',
      summary: {
        usersProcessed: userBatch.length,
        successCount,
        errorCount,
        skippedCount,
        articlesSent: totalArticles,
        avgScore: avgScore || 0,
        processingTimeMs: processingTime
      },
      results: results.map(r => ({
        userId: r.userId,
        status: r.status,
        articlesSent: r.articlesSent,
        reason: r.reason
      }))
    });

  } catch (error) {
    console.error('[NewsCurator] Fatal error in cron job:', error);

    const processingTime = Date.now() - startTime;

    await updateCronStats({
      lastRunStatus: 'failed',
      usersProcessed: 0,
      articlesSent: 0,
      processingTimeMs: processingTime,
      errors: [{
        error: error.message,
        timestamp: new Date()
      }]
    });

    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};
