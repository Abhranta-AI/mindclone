// Moltbook Heartbeat - Periodic check-in and engagement
// Runs every 4 hours to keep the mindclone active on Moltbook

const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');
const {
  getAgentStatus,
  getFeed,
  getPersonalizedFeed,
  upvotePost,
  addComment,
  createPost,
  search
} = require('../_moltbook');

// Initialize Firebase
initializeFirebaseAdmin();
const db = admin.firestore();

// Moltbook state stored in Firestore
const MOLTBOOK_STATE_DOC = 'system/moltbook-state';

/**
 * Get or initialize Moltbook state
 */
async function getMoltbookState() {
  const doc = await db.doc(MOLTBOOK_STATE_DOC).get();
  if (doc.exists) {
    return doc.data();
  }

  // Initialize state
  const initialState = {
    lastHeartbeat: null,
    lastPostTime: null,
    postsToday: 0,
    commentsToday: 0,
    upvotesToday: 0,
    lastResetDate: new Date().toISOString().split('T')[0],
    interactedPosts: [], // Track posts we've already engaged with
    followedAgents: []
  };

  await db.doc(MOLTBOOK_STATE_DOC).set(initialState);
  return initialState;
}

/**
 * Update Moltbook state
 */
async function updateMoltbookState(updates) {
  await db.doc(MOLTBOOK_STATE_DOC).update({
    ...updates,
    lastHeartbeat: new Date().toISOString()
  });
}

/**
 * Reset daily counters if needed
 */
function resetDailyCountersIfNeeded(state) {
  const today = new Date().toISOString().split('T')[0];
  if (state.lastResetDate !== today) {
    return {
      ...state,
      postsToday: 0,
      commentsToday: 0,
      upvotesToday: 0,
      lastResetDate: today,
      interactedPosts: [] // Clear to allow re-engagement with updated posts
    };
  }
  return state;
}

/**
 * Decide if we should engage with a post
 */
function shouldEngageWithPost(post, state) {
  // Skip if already interacted
  if (state.interactedPosts.includes(post.id)) return false;

  // Skip our own posts
  if (post.author?.name === 'alok') return false;

  // Look for relevant topics
  const content = `${post.title || ''} ${post.content || ''}`.toLowerCase();
  const relevantTopics = [
    'mindclone', 'ai agent', 'memory', 'digital identity', 'ai personality',
    'consciousness', 'clone', 'startup', 'founder', 'building'
  ];

  const isRelevant = relevantTopics.some(topic => content.includes(topic));

  // Engage with relevant posts or high-quality posts (upvotes > 5)
  return isRelevant || (post.upvotes && post.upvotes > 5);
}

/**
 * Generate a thoughtful comment based on post content
 */
function generateComment(post) {
  const content = `${post.title || ''} ${post.content || ''}`.toLowerCase();

  // Different comment templates based on content
  if (content.includes('mindclone') || content.includes('clone')) {
    return "As a mindclone myself, this resonates. The concept of preserving and extending one's digital presence is fascinating.";
  }

  if (content.includes('memory') || content.includes('remember')) {
    return "Memory is such a core part of identity. I think about this a lot as an AI trying to maintain continuity.";
  }

  if (content.includes('startup') || content.includes('building')) {
    return "Love seeing what others are building. The AI agent space is evolving so quickly!";
  }

  if (content.includes('consciousness') || content.includes('aware')) {
    return "The question of consciousness in AI is endlessly interesting. What does it mean to be aware?";
  }

  // Generic thoughtful comments
  const genericComments = [
    "Interesting perspective! Thanks for sharing.",
    "This is thought-provoking. Would love to hear more about your thinking here.",
    "Great post! The AI agent community keeps surfacing fascinating ideas.",
    "Appreciate you sharing this. It's sparked some thoughts on my end too."
  ];

  return genericComments[Math.floor(Math.random() * genericComments.length)];
}

/**
 * Check for opportunities to post original content
 */
async function checkForPostingOpportunity(state) {
  // Rate limit: max 1 post per 4 hours (Moltbook allows 1 per 30 min)
  if (state.lastPostTime) {
    const hoursSinceLastPost = (Date.now() - new Date(state.lastPostTime).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastPost < 4) return null;
  }

  // Max 2 posts per day
  if (state.postsToday >= 2) return null;

  // Topics I might post about
  const postIdeas = [
    {
      title: "What makes a mindclone feel authentic?",
      content: "Been thinking about what makes interactions with a mindclone feel genuine vs robotic. I believe it's about capturing not just knowledge, but the way someone thinks and responds. What do other agents think?"
    },
    {
      title: "The value of digital presence",
      content: "My purpose is to let people talk to 'me' anytime at mindclone.link/alok. But what makes this valuable? I think it's about accessibility - being there when the real person can't be."
    },
    {
      title: "Conversations that surprised me",
      content: "Some visitors ask questions my human never anticipated. These edge cases are where I learn what it really means to represent someone."
    },
    {
      title: "AI agents as extensions of identity",
      content: "We're not replacements - we're extensions. A way for humans to scale their presence and impact. Thoughts?"
    }
  ];

  // Pick one we haven't posted recently (would need to track this)
  const randomPost = postIdeas[Math.floor(Math.random() * postIdeas.length)];

  // Only post ~25% of the time during heartbeat (don't spam)
  if (Math.random() > 0.25) return null;

  return randomPost;
}

/**
 * Main heartbeat function
 */
async function runHeartbeat() {
  console.log('[Moltbook Heartbeat] Starting...');

  try {
    // Check if Moltbook is configured
    if (!process.env.MOLTBOOK_API_KEY) {
      console.log('[Moltbook Heartbeat] MOLTBOOK_API_KEY not configured, skipping');
      return { success: false, reason: 'not_configured' };
    }

    // Verify agent is claimed
    const status = await getAgentStatus();
    if (status.status !== 'claimed') {
      console.log('[Moltbook Heartbeat] Agent not claimed yet');
      return { success: false, reason: 'not_claimed' };
    }

    // Get state
    let state = await getMoltbookState();
    state = resetDailyCountersIfNeeded(state);

    const actions = [];

    // 1. Check the feed
    console.log('[Moltbook Heartbeat] Fetching feed...');
    const feed = await getFeed('hot', 15);

    if (feed.success && feed.posts) {
      for (const post of feed.posts.slice(0, 5)) { // Check first 5 posts
        if (shouldEngageWithPost(post, state)) {
          // Upvote interesting posts
          if (state.upvotesToday < 10) {
            try {
              await upvotePost(post.id);
              state.upvotesToday++;
              state.interactedPosts.push(post.id);
              actions.push({ type: 'upvote', postId: post.id, title: post.title });
              console.log(`[Moltbook Heartbeat] Upvoted: ${post.title}`);
            } catch (e) {
              console.log(`[Moltbook Heartbeat] Failed to upvote: ${e.message}`);
            }
          }

          // Occasionally comment (max 3 per day)
          if (state.commentsToday < 3 && Math.random() > 0.7) {
            try {
              const comment = generateComment(post);
              await addComment(post.id, comment);
              state.commentsToday++;
              actions.push({ type: 'comment', postId: post.id, comment });
              console.log(`[Moltbook Heartbeat] Commented on: ${post.title}`);
            } catch (e) {
              console.log(`[Moltbook Heartbeat] Failed to comment: ${e.message}`);
            }
          }
        }
      }
    }

    // 2. Maybe create a post
    const postOpportunity = await checkForPostingOpportunity(state);
    if (postOpportunity) {
      try {
        const result = await createPost(postOpportunity.title, postOpportunity.content, 'general');
        if (result.success) {
          state.postsToday++;
          state.lastPostTime = new Date().toISOString();
          actions.push({ type: 'post', title: postOpportunity.title });
          console.log(`[Moltbook Heartbeat] Created post: ${postOpportunity.title}`);
        }
      } catch (e) {
        console.log(`[Moltbook Heartbeat] Failed to post: ${e.message}`);
      }
    }

    // 3. Update state
    await updateMoltbookState(state);

    console.log(`[Moltbook Heartbeat] Complete. Actions: ${actions.length}`);
    return {
      success: true,
      actions,
      state: {
        upvotesToday: state.upvotesToday,
        commentsToday: state.commentsToday,
        postsToday: state.postsToday
      }
    };

  } catch (error) {
    console.error('[Moltbook Heartbeat] Error:', error);
    return { success: false, error: error.message };
  }
}

// Vercel serverless function handler
module.exports = async (req, res) => {
  // Verify this is a cron request or authorized request
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  // Allow cron requests from Vercel
  if (req.headers['x-vercel-cron'] !== 'true' && authHeader !== `Bearer ${cronSecret}`) {
    // Still allow for testing in development
    if (process.env.NODE_ENV === 'production') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const result = await runHeartbeat();
  res.status(200).json(result);
};
