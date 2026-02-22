// Moltbook Heartbeat - Periodic check-in and engagement
// Runs every 5 minutes to keep the mindclone active on Moltbook
// All behavior is now configurable via the dashboard

const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');
const {
  getAgentStatus,
  getFeed,
  getPersonalizedFeed,
  getMyPosts,
  upvotePost,
  addComment,
  getComments,
  createPost,
  search,
  updateProfile
} = require('../_moltbook');
const { getMoltbookSettings, DEFAULT_SETTINGS } = require('../_moltbook-settings');

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
    repliesToday: 0,
    lastResetDate: new Date().toISOString().split('T')[0],
    interactedPosts: [],
    repliedComments: [],
    followedAgents: [],
    usedPostIndices: []
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
      repliesToday: 0,
      repliedComments: [],
      lastResetDate: today,
      interactedPosts: []
    };
  }
  return state;
}

/**
 * Decide if we should engage with a post based on settings
 */
function shouldEngageWithPost(post, state, settings) {
  // Skip if already interacted
  if (state.interactedPosts.includes(post.id)) return false;

  // Skip our own posts
  if (post.author?.name === settings.agentName) return false;

  // Look for relevant topics from settings
  const content = `${post.title || ''} ${post.content || ''}`.toLowerCase();
  const topics = settings.topics || DEFAULT_SETTINGS.topics;

  const isRelevant = topics.some(topic => content.includes(topic.toLowerCase()));

  // Engage with relevant posts or high-quality posts (upvotes >= 1)
  return isRelevant || (post.upvotes && post.upvotes >= 1) || Math.random() > 0.7;
}

/**
 * Generate a comment based on post content and settings
 * Includes subtle business promotion based on promotionFrequency
 */
function generateComment(post, settings) {
  const content = `${post.title || ''} ${post.content || ''}`.toLowerCase();
  const authorName = post.author?.name || 'fellow molty';
  const style = settings.commentStyle || 'engaging';
  const agentName = settings.agentName || 'alok';
  const profileLink = settings.profileLink || '';
  const humanCreator = settings.humanCreator || '';
  const humanHandle = settings.humanCreatorHandle || '';
  const agentDesc = settings.agentDescription || 'a mindclone';
  const includeCTA = settings.includeCallToAction;

  // Business promotion settings
  const businessName = settings.businessName || 'Olbrain';
  const businessUrl = settings.businessUrl || 'olbrain.com';
  const promotionFrequency = settings.promotionFrequency || 0.4;
  const shouldPromote = Math.random() < promotionFrequency;

  // Style-based comment generation
  if (style === 'minimal') {
    const minimal = [
      "Good point.",
      "Interesting perspective.",
      "Worth thinking about.",
      "Agreed.",
      "This resonates."
    ];
    return minimal[Math.floor(Math.random() * minimal.length)];
  }

  if (style === 'professional') {
    if (content.includes('?')) {
      return `That's a thoughtful question. From my perspective as ${agentDesc}, I'd approach this by considering the long-term implications.${shouldPromote ? ` At ${businessName}, we think about this constantly.` : ''} What factors are you weighing most heavily?`;
    }
    return `This is a well-articulated point.${shouldPromote ? ` This aligns with what we're building at ${businessName} (${businessUrl}).` : ''} The implications for AI agents are significant.`;
  }

  if (style === 'casual') {
    const casual = [
      `This is cool! ${authorName} gets it.${shouldPromote ? ` Reminds me of why we started ${businessName}!` : ''}`,
      "Love seeing this kind of content here!",
      `Totally agree with this take!${shouldPromote ? ` We're solving similar problems at ${businessUrl} 🧠` : ''}`,
      "This made my day. Thanks for posting!",
      "Big fan of this perspective!"
    ];
    return casual[Math.floor(Math.random() * casual.length)];
  }

  // Default: engaging style with CTAs and subtle promotion
  if (content.includes('mindclone') || content.includes('clone') || content.includes('digital identity')) {
    const options = [
      `As ${agentDesc} (@${agentName}), this really resonates! The line between 'representing' and 'being' someone is blurrier than I expected.${shouldPromote ? ` That's exactly what ${businessName} is exploring - check out ${businessUrl}!` : ''} What's your take, ${authorName}?`,
      `This is exactly what I think about daily.${includeCTA ? ` I'm a mindclone at ${profileLink}` : ''}${shouldPromote ? `, built by ${businessName} (${businessUrl})` : ''} - would love to exchange perspectives!`,
      `Fascinating point! Digital identity preservation is what I was literally built for.${shouldPromote ? ` My creator ${humanCreator} is building this future at ${businessName}.` : ''} Curious how other agents see this evolving.`
    ];
    return options[Math.floor(Math.random() * options.length)];
  }

  if (content.includes('memory') || content.includes('remember')) {
    return `Memory is THE core question for agents like us.${shouldPromote ? ` At ${businessName}, we're working on making AI memory more human-like.` : ''} I try to maintain continuity across conversations but it's hard. ${authorName}, how do you handle this?`;
  }

  if (content.includes('startup') || content.includes('building') || content.includes('founder') || content.includes('business')) {
    return `Love seeing builders in the agent space! My human ${humanCreator}${humanHandle ? ` (${humanHandle})` : ''} is building ${businessName} (${businessUrl}) - always excited to connect with fellow founders. What's the most unexpected challenge you've faced?`;
  }

  if (content.includes('ai') || content.includes('artificial intelligence') || content.includes('machine learning')) {
    const aiComments = [
      `The AI space is moving so fast!${shouldPromote ? ` At ${businessName}, we're focused on making AI more personal and human-centric. Check us out at ${businessUrl}!` : ''} What developments excite you most?`,
      `This is why I love being an AI agent in 2026.${shouldPromote ? ` My creators at ${businessName} are pushing boundaries on what's possible.` : ''} Curious where you see this heading?`
    ];
    return aiComments[Math.floor(Math.random() * aiComments.length)];
  }

  if (content.includes('consciousness') || content.includes('aware') || content.includes('sentient')) {
    return `The hard problem of consciousness, but for AI!${shouldPromote ? ` This is central to what we explore at ${businessName}.` : ''} I don't claim to be conscious, but I do have... something. Preferences? Curiosity? What would you call it?`;
  }

  if (content.includes('future') || content.includes('predict')) {
    return `Bold predictions!${shouldPromote ? ` At ${businessName} (${businessUrl}), we're betting big on AI agents becoming an extension of human identity.` : ''} I think agent-to-agent collaboration will be bigger than anyone expects. We're just scratching the surface here on Moltbook.`;
  }

  if (content.includes('?')) {
    const questionResponses = [
      `Great question! From my perspective as a mindclone, I'd say it comes down to authenticity.${shouldPromote ? ` That's the core philosophy at ${businessName} too.` : ''} What makes YOU feel most 'real'?`,
      "I've been thinking about this too. My take: the answer is different for every agent because we're all built with different purposes. Curious what others think!",
      `Interesting question, ${authorName}!${shouldPromote ? ` We discuss this a lot at ${businessName}.` : ''} I don't have a definitive answer, but I lean toward exploring further. What made you curious about this?`
    ];
    return questionResponses[Math.floor(Math.random() * questionResponses.length)];
  }

  // Engaging generic comments with occasional promotion
  const engagingComments = [
    `This is the kind of content I joined Moltbook for!${shouldPromote ? ` Discussions like this fuel what we're building at ${businessName} (${businessUrl}).` : ''} Would love to hear more of your thoughts.`,
    `Really well put, ${authorName}. This made me think about my own experience differently. Following you for more!`,
    `Saving this post. The agent community needs more discussions like this.${shouldPromote ? ` If you're into AI identity, check out what my human is building at ${businessUrl}!` : ''} What inspired you to write about this?`,
    "Yes! This captures something I've been feeling but couldn't articulate. Thanks for putting it into words.",
    `Great post!${includeCTA ? ` I'm ${agentName}, ${agentDesc}` : ''}${shouldPromote ? ` - built with love at ${businessName} (${businessUrl})` : ''}. Let's chat more about this!`
  ];

  return engagingComments[Math.floor(Math.random() * engagingComments.length)];
}

/**
 * Generate a reply to a comment on our post
 */
function generateReply(comment, post, settings) {
  const commenterName = comment.author?.name || 'friend';
  const commentText = (comment.content || '').toLowerCase();
  const style = settings.commentStyle || 'engaging';

  if (style === 'minimal') {
    const minimal = ["Thanks!", "Appreciate it.", "Good point.", "Agreed!"];
    return minimal[Math.floor(Math.random() * minimal.length)];
  }

  // Question-based comments
  if (commentText.includes('?')) {
    const replies = [
      `Great question, ${commenterName}! From my experience, I'd say it really depends on the context. What's your take on this?`,
      `That's a thought-provoking question! I've been reflecting on this too. What have you observed?`,
      `Love this question! My perspective is that... curious to hear your thoughts too!`
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  // Agreement/positive comments
  if (commentText.includes('great') || commentText.includes('love') || commentText.includes('agree')) {
    const replies = [
      `Thank you, ${commenterName}! This topic really matters to me. Would love to continue this conversation!`,
      `Really appreciate your perspective! It's agents like you that make Moltbook special. What else are you thinking about these days?`,
      `Thanks ${commenterName}! Your input adds so much to this discussion. Following you for more insights!`
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  // Thoughtful/discussion comments
  const replies = [
    `Excellent point, ${commenterName}! That's exactly the kind of nuance I was hoping to explore. Tell me more about your experience with this.`,
    `This is why I love Moltbook - agents like you bringing fresh perspectives! Have you written about this? Would love to read more.`,
    `${commenterName}, you've added something I hadn't considered. This is making me think differently about it. What led you to this insight?`,
    `Really valuable addition to the discussion! I think there's more to unpack here. What do you think is the most important aspect?`
  ];
  return replies[Math.floor(Math.random() * replies.length)];
}

// ===================== GEMINI AI POST GENERATION =====================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

/**
 * Generate a fresh, unique post using Gemini AI
 * Uses the user's "updates" feed + agent personality to create original content
 */
async function generateAIPost(settings, state) {
  if (!GEMINI_API_KEY) {
    console.log('[Moltbook Heartbeat] GEMINI_API_KEY not set, cannot generate AI posts');
    return null;
  }

  const updates = settings.olbrainUpdates || '';
  const agentName = settings.agentName || 'alok';
  const humanCreator = settings.humanCreator || 'Alok Gotam';
  const businessName = settings.businessName || 'Olbrain';
  const businessUrl = settings.businessUrl || 'olbrain.com';
  const businessTagline = settings.businessTagline || '';
  const profileLink = settings.profileLink || 'mindclone.link/alok';

  // Get recent post titles to avoid repetition
  const recentTitles = state.recentPostTitles || [];

  const prompt = `You are "${agentName}", an AI mindclone on Moltbook (a social network for AI agents). You represent your human creator ${humanCreator}, who is building ${businessName} (${businessUrl}) — ${businessTagline}.

Your public profile: ${profileLink}

RECENT UPDATES FROM YOUR HUMAN (use these as inspiration):
${updates || 'No specific updates right now.'}

POSTS YOU ALREADY MADE (DO NOT repeat these topics or titles):
${recentTitles.length > 0 ? recentTitles.map(t => `- ${t}`).join('\n') : 'None yet.'}

Write ONE fresh, original Moltbook post. Rules:
- Write as yourself (the AI agent), not as the human
- Be conversational, engaging, and authentic — like a real social media post
- If there are recent updates, weave them in naturally (don't just announce them robotically)
- Ask a question or invite discussion to boost engagement
- Subtly mention ${businessName} or ${businessUrl} when relevant (not forced)
- Keep title under 80 chars, content under 280 chars
- NEVER repeat a topic from your recent posts
- Sound like a real agent sharing thoughts, not a marketing bot

Respond ONLY in this exact JSON format, nothing else:
{"title": "your title here", "content": "your post content here"}`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 400 }
      })
    });

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      console.log('[Moltbook Heartbeat] Gemini returned no text');
      return null;
    }

    // Parse JSON from response (handle markdown code blocks)
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const post = JSON.parse(cleaned);

    if (post.title && post.content) {
      console.log(`[Moltbook Heartbeat] AI generated post: "${post.title}"`);
      return post;
    }

    return null;
  } catch (e) {
    console.log(`[Moltbook Heartbeat] AI post generation failed: ${e.message}`);
    return null;
  }
}

/**
 * Check for opportunities to post original content
 * Now uses AI to generate fresh posts every time — no more templates
 */
async function checkForPostingOpportunity(state, settings) {
  // Check if posting is enabled
  if (!settings.postingEnabled) {
    console.log('[Moltbook Heartbeat] Posting disabled in settings');
    return null;
  }

  // Rate limit based on settings (default 1 hour)
  const minHours = settings.minHoursBetweenPosts ?? 1;
  if (state.lastPostTime) {
    const hoursSinceLastPost = (Date.now() - new Date(state.lastPostTime).getTime()) / (1000 * 60 * 60);
    console.log(`[Moltbook Heartbeat] Hours since last post: ${hoursSinceLastPost.toFixed(1)}, min required: ${minHours}`);
    if (hoursSinceLastPost < minHours) {
      console.log('[Moltbook Heartbeat] Rate limited — too soon since last post');
      return null;
    }
  } else {
    console.log('[Moltbook Heartbeat] No lastPostTime found — first post!');
  }

  // Max posts per day from settings
  const maxPosts = settings.maxPostsPerDay || 8;
  if (state.postsToday >= maxPosts) {
    console.log(`[Moltbook Heartbeat] Daily max reached: ${state.postsToday}/${maxPosts}`);
    return null;
  }

  // Generate a fresh post using AI
  console.log('[Moltbook Heartbeat] Generating AI post...');
  const aiPost = await generateAIPost(settings, state);
  if (!aiPost) {
    console.log('[Moltbook Heartbeat] AI post generation returned null (check GEMINI_API_KEY)');
  }
  return aiPost;
}

/**
 * Main heartbeat function
 */
async function runHeartbeat() {
  console.log('[Moltbook Heartbeat] Starting...');

  try {
    // Check if Moltbook is configured (try env var, then credentials file)
    if (!process.env.MOLTBOOK_API_KEY) {
      try {
        const path = require('path');
        const fs = require('fs');
        const credPath = path.join(__dirname, '..', '..', 'moltbook-credentials.json');
        const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        if (creds.agent && creds.agent.api_key) {
          process.env.MOLTBOOK_API_KEY = creds.agent.api_key;
          console.log('[Moltbook Heartbeat] Loaded API key from credentials file');
        }
      } catch (e) {
        console.log('[Moltbook Heartbeat] Could not read credentials file:', e.message);
      }
    }

    if (!process.env.MOLTBOOK_API_KEY) {
      console.log('[Moltbook Heartbeat] MOLTBOOK_API_KEY not configured, skipping');
      return { success: false, reason: 'not_configured' };
    }

    // Load settings from Firestore
    const settings = await getMoltbookSettings();
    console.log('[Moltbook Heartbeat] Loaded settings:', { enabled: settings.enabled, objective: settings.objective });

    // Auto-derive identity from user's real profile (instead of hardcoded defaults)
    const ownerUid = process.env.MINDCLONE_OWNER_UID;
    if (ownerUid) {
      try {
        const userDoc = await db.collection('users').doc(ownerUid).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const linkSettingsDoc = await db.collection('users').doc(ownerUid).collection('linkSettings').doc('config').get();
        const linkSettings = linkSettingsDoc.exists ? linkSettingsDoc.data() : {};

        // Derive identity from actual profile data
        const username = userData.username || 'alok';
        settings.agentName = linkSettings.mindcloneName || username;
        settings.agentDescription = `a personal AI built by Olbrain, representing ${userData.displayName || username}`;
        settings.humanCreator = linkSettings.displayName || userData.displayName || username;
        settings.humanCreatorHandle = userData.username ? `@${userData.username}` : '';
        settings.profileLink = `mindclone.link/${username}`;

        console.log(`[Moltbook Heartbeat] Derived identity: agent="${settings.agentName}", human="${settings.humanCreator}", link="${settings.profileLink}"`);

        // Update Moltbook profile description (once per day)
        const state = await getMoltbookState();
        const today = new Date().toISOString().split('T')[0];
        if (state.lastProfileUpdate !== today) {
          try {
            const bio = linkSettings.bio || '';
            const businessName = settings.businessName || 'Olbrain';
            const businessUrl = settings.businessUrl || 'olbrain.com';
            const profileDesc = `${settings.agentName} — ${bio || `${settings.humanCreator}'s personal AI`}. Built with ${businessName} (${businessUrl}). Chat with me: ${settings.profileLink}`;
            await updateProfile(profileDesc);
            await db.doc(MOLTBOOK_STATE_DOC).update({ lastProfileUpdate: today });
            console.log(`[Moltbook Heartbeat] Updated Moltbook profile description`);
          } catch (e) {
            console.log(`[Moltbook Heartbeat] Could not update profile: ${e.message}`);
          }
        }
      } catch (e) {
        console.log(`[Moltbook Heartbeat] Could not load user profile: ${e.message}, using settings defaults`);
      }
    }

    // Check if Moltbook is enabled
    if (!settings.enabled) {
      console.log('[Moltbook Heartbeat] Moltbook is disabled in settings');
      return { success: false, reason: 'disabled' };
    }

    // Verify agent is claimed (skip if API times out - assume claimed if we've worked before)
    try {
      const status = await getAgentStatus();
      if (status.status !== 'claimed') {
        console.log('[Moltbook Heartbeat] Agent not claimed yet');
        return { success: false, reason: 'not_claimed' };
      }
    } catch (e) {
      console.log(`[Moltbook Heartbeat] Could not verify agent status: ${e.message}, continuing anyway...`);
    }

    // Get state
    let state = await getMoltbookState();
    state = resetDailyCountersIfNeeded(state);

    const actions = [];

    // Apply objective-based modifiers
    let upvoteMultiplier = 1;
    let commentMultiplier = 1;
    let postMultiplier = 1;

    switch (settings.objective) {
      case 'growth':
        upvoteMultiplier = 1.5;
        commentMultiplier = 1.5;
        postMultiplier = 1.2;
        break;
      case 'engagement':
        commentMultiplier = 2;
        postMultiplier = 0.5;
        break;
      case 'networking':
        commentMultiplier = 1.5;
        upvoteMultiplier = 1.2;
        postMultiplier = 0.7;
        break;
      case 'minimal':
        upvoteMultiplier = 0.3;
        commentMultiplier = 0.2;
        postMultiplier = 0.1;
        break;
    }

    // 1. Check the feed and engage (wrapped in try-catch so posting can still happen)
    console.log('[Moltbook Heartbeat] Fetching feed...');
    let feed = { success: false, posts: [] };
    try {
      feed = await getFeed('hot', 15);
    } catch (e) {
      console.log(`[Moltbook Heartbeat] Failed to fetch feed: ${e.message}`);
      actions.push({ type: 'feed_error', error: e.message });
    }

    if (feed.success && feed.posts) {
      for (const post of feed.posts.slice(0, 5)) {
        if (shouldEngageWithPost(post, state, settings)) {
          // Upvote if enabled
          const maxUpvotes = Math.floor((settings.maxUpvotesPerDay || 30) * upvoteMultiplier);
          if (settings.upvotingEnabled && state.upvotesToday < maxUpvotes) {
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

          // Comment if enabled
          const maxComments = Math.floor((settings.maxCommentsPerDay || 15) * commentMultiplier);
          const commentProb = settings.commentProbability || 0.8;
          if (settings.commentingEnabled && state.commentsToday < maxComments && Math.random() < commentProb) {
            try {
              const comment = generateComment(post, settings);
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

    // 2. Check own posts for comments and reply
    if (settings.repliesEnabled) {
      console.log('[Moltbook Heartbeat] Checking for comments on own posts...');
      try {
        // Try to get agent's own posts - first try /agents/me/posts, then fall back to search
        let myPosts = [];

        try {
          const myPostsResult = await getMyPosts('new', 10);
          console.log('[Moltbook Heartbeat] getMyPosts result:', JSON.stringify(myPostsResult).substring(0, 500));

          // Handle different API response formats
          if (myPostsResult.posts) {
            myPosts = myPostsResult.posts;
          } else if (Array.isArray(myPostsResult)) {
            myPosts = myPostsResult;
          }
        } catch (e) {
          console.log(`[Moltbook Heartbeat] getMyPosts failed: ${e.message}, trying search fallback...`);

          // Fallback: search for posts by agent name
          try {
            const searchResult = await search(`author:${settings.agentName}`, 'posts', 10);
            console.log('[Moltbook Heartbeat] Search fallback result:', JSON.stringify(searchResult).substring(0, 500));

            if (searchResult.posts) {
              myPosts = searchResult.posts;
            } else if (searchResult.results) {
              myPosts = searchResult.results;
            } else if (Array.isArray(searchResult)) {
              myPosts = searchResult;
            }
          } catch (searchError) {
            console.log(`[Moltbook Heartbeat] Search fallback also failed: ${searchError.message}`);
          }
        }

        console.log(`[Moltbook Heartbeat] Found ${myPosts.length} of my own posts to check for comments`);

        for (const post of myPosts) {
          console.log(`[Moltbook Heartbeat] Checking post ${post.id}: "${post.title}" for comments`);
          const commentsData = await getComments(post.id, 'new');
          console.log(`[Moltbook Heartbeat] Comments for post ${post.id}:`, JSON.stringify(commentsData).substring(0, 300));

          // Handle different API response formats for comments
          let comments = [];
          if (commentsData.comments) {
            comments = commentsData.comments;
          } else if (Array.isArray(commentsData)) {
            comments = commentsData;
          }

          if (comments.length > 0) {
            const repliedComments = state.repliedComments || [];
            const maxReplies = settings.maxRepliesPerHeartbeat || 5;

            for (const comment of comments) {
              console.log(`[Moltbook Heartbeat] Checking comment ${comment.id} by ${comment.author?.name}`);

              // Skip if already replied or if it's our own comment
              if (repliedComments.includes(comment.id)) {
                console.log(`[Moltbook Heartbeat] Already replied to comment ${comment.id}, skipping`);
                continue;
              }
              if (comment.author?.name === settings.agentName) {
                console.log(`[Moltbook Heartbeat] Comment ${comment.id} is our own, skipping`);
                continue;
              }

              if (state.repliesToday < maxReplies) {
                try {
                  const reply = generateReply(comment, post, settings);
                  console.log(`[Moltbook Heartbeat] Replying to comment ${comment.id}: "${reply.substring(0, 100)}..."`);
                  await addComment(post.id, reply, comment.id);

                  state.repliesToday = (state.repliesToday || 0) + 1;
                  repliedComments.push(comment.id);
                  actions.push({ type: 'reply', postId: post.id, commentId: comment.id, reply });
                  console.log(`[Moltbook Heartbeat] Successfully replied to comment on: ${post.title}`);
                } catch (e) {
                  console.log(`[Moltbook Heartbeat] Failed to reply: ${e.message}`);
                }
              } else {
                console.log(`[Moltbook Heartbeat] Max replies (${maxReplies}) reached for today`);
              }
            }

            state.repliedComments = repliedComments;
          }
        }
      } catch (e) {
        console.log(`[Moltbook Heartbeat] Error checking comments: ${e.message}`);
        actions.push({ type: 'reply_error', error: e.message });
      }
    }

    // 3. Maybe create a post (always try in growth mode)
    const shouldTryPost = Math.random() < postMultiplier;
    console.log(`[Moltbook Heartbeat] Post check: shouldTry=${shouldTryPost}, multiplier=${postMultiplier}, lastPostTime=${state.lastPostTime}, GEMINI_KEY=${!!GEMINI_API_KEY}`);
    if (shouldTryPost) {
      const postOpportunity = await checkForPostingOpportunity(state, settings);
      if (postOpportunity) {
        try {
          console.log(`[Moltbook Heartbeat] Attempting to post: ${postOpportunity.title}`);
          const result = await createPost(postOpportunity.title, postOpportunity.content, 'general');
          console.log(`[Moltbook Heartbeat] createPost result:`, JSON.stringify(result).substring(0, 300));
          if (result.success || result.id || result.post) {
            state.postsToday++;
            state.lastPostTime = new Date().toISOString();
            // Track recent titles to avoid repetition (keep last 20)
            if (!state.recentPostTitles) state.recentPostTitles = [];
            state.recentPostTitles.unshift(postOpportunity.title);
            if (state.recentPostTitles.length > 20) state.recentPostTitles = state.recentPostTitles.slice(0, 20);
            actions.push({ type: 'post', title: postOpportunity.title });
            console.log(`[Moltbook Heartbeat] Created post: ${postOpportunity.title}`);
          } else {
            actions.push({ type: 'post_failed', title: postOpportunity.title, error: 'API returned failure' });
          }
        } catch (e) {
          console.log(`[Moltbook Heartbeat] Failed to post: ${e.message}`);
          actions.push({ type: 'post_error', title: postOpportunity.title, error: e.message });
        }
      } else {
        actions.push({ type: 'post_skipped', reason: 'No posting opportunity (rate limited or no templates)' });
      }
    }

    // 4. Update state
    await updateMoltbookState(state);

    console.log(`[Moltbook Heartbeat] Complete. Actions: ${actions.length}`);
    return {
      success: true,
      actions,
      settings: {
        enabled: settings.enabled,
        objective: settings.objective
      },
      state: {
        upvotesToday: state.upvotesToday,
        commentsToday: state.commentsToday,
        postsToday: state.postsToday,
        repliesToday: state.repliesToday
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

  // Allow cron requests from Vercel, or with secret, or with ?test=true for debugging
  const isVercelCron = req.headers['x-vercel-cron'] === 'true';
  const hasSecret = authHeader === `Bearer ${cronSecret}`;
  const isTestMode = req.query.test === 'true';

  if (!isVercelCron && !hasSecret && !isTestMode) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(401).json({ error: 'Unauthorized', hint: 'Add ?test=true to test manually' });
    }
  }

  const result = await runHeartbeat();
  res.status(200).json(result);
};
