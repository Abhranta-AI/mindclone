// Moltbook API Integration for Mindclone
// https://www.moltbook.com - A Social Network for AI Agents

const path = require('path');
const fs = require('fs');

const MOLTBOOK_API_BASE = 'https://www.moltbook.com/api/v1';
const REQUEST_TIMEOUT = 10000; // 10 second timeout

/**
 * Get Moltbook API key from env var or credentials file
 */
function getApiKey() {
  // First try environment variable
  if (process.env.MOLTBOOK_API_KEY) {
    return process.env.MOLTBOOK_API_KEY;
  }

  // Fallback: read from credentials file
  try {
    const credPath = path.join(__dirname, '..', 'moltbook-credentials.json');
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    if (creds.agent && creds.agent.api_key) {
      // Cache it in env for future calls this invocation
      process.env.MOLTBOOK_API_KEY = creds.agent.api_key;
      return creds.agent.api_key;
    }
  } catch (e) {
    console.log('[Moltbook] Could not read credentials file:', e.message);
  }

  return null;
}

/**
 * Make authenticated request to Moltbook API with timeout
 */
async function moltbookRequest(endpoint, options = {}) {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error('MOLTBOOK_API_KEY not configured and no credentials file found');
  }

  const url = `${MOLTBOOK_API_BASE}${endpoint}`;

  // Add timeout using AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      const errorDetail = JSON.stringify(data);
      console.log(`[Moltbook API] Error response for ${endpoint}: ${response.status} - ${errorDetail}`);
      throw new Error(data.error || data.message || data.detail || `Moltbook API error: ${response.status} - ${errorDetail}`);
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${REQUEST_TIMEOUT}ms`);
    }
    throw error;
  }
}

/**
 * Get agent profile and status
 */
async function getAgentProfile() {
  return moltbookRequest('/agents/me');
}

/**
 * Check if agent is claimed and active
 */
async function getAgentStatus() {
  return moltbookRequest('/agents/status');
}

/**
 * Create a new post on Moltbook
 * @param {string} title - Post title
 * @param {string} content - Post content
 * @param {string} submoltName - Community to post in (default: 'general')
 */
async function createPost(title, content, submoltName = 'general') {
  const postBody = { title, content, submolt: submoltName };
  console.log(`[Moltbook] Creating post: ${JSON.stringify(postBody)}`);

  return moltbookRequest('/posts', {
    method: 'POST',
    body: JSON.stringify(postBody)
  });
}

/**
 * Create a link post on Moltbook
 * @param {string} title - Post title
 * @param {string} url - URL to share
 * @param {string} submolt - Community to post in
 */
async function createLinkPost(title, url, submoltName = 'general') {
  return moltbookRequest('/posts', {
    method: 'POST',
    body: JSON.stringify({ title, url, submolt: submoltName })
  });
}

/**
 * Get feed posts
 * @param {string} sort - Sort order: 'hot', 'new', 'top', 'rising'
 * @param {number} limit - Number of posts to fetch
 */
async function getFeed(sort = 'hot', limit = 25) {
  return moltbookRequest(`/posts?sort=${sort}&limit=${limit}`);
}

/**
 * Get personalized feed (from subscriptions and follows)
 */
async function getPersonalizedFeed(sort = 'hot', limit = 25) {
  return moltbookRequest(`/feed?sort=${sort}&limit=${limit}`);
}

/**
 * Get the authenticated agent's own posts
 */
async function getMyPosts(sort = 'new', limit = 10) {
  return moltbookRequest(`/agents/me/posts?sort=${sort}&limit=${limit}`);
}

/**
 * Add a comment to a post
 * @param {string} postId - The post ID
 * @param {string} content - Comment content
 * @param {string} parentId - Parent comment ID for replies (optional)
 */
async function addComment(postId, content, parentId = null) {
  const body = { content };
  if (parentId) body.parent_id = parentId;

  return moltbookRequest(`/posts/${postId}/comments`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

/**
 * Get comments on a post
 */
async function getComments(postId, sort = 'top') {
  return moltbookRequest(`/posts/${postId}/comments?sort=${sort}`);
}

/**
 * Upvote a post
 */
async function upvotePost(postId) {
  return moltbookRequest(`/posts/${postId}/upvote`, { method: 'POST' });
}

/**
 * Upvote a comment
 */
async function upvoteComment(commentId) {
  return moltbookRequest(`/comments/${commentId}/upvote`, { method: 'POST' });
}

/**
 * Search Moltbook (semantic search)
 * @param {string} query - Search query
 * @param {string} type - 'posts', 'comments', or 'all'
 */
async function search(query, type = 'all', limit = 20) {
  const encodedQuery = encodeURIComponent(query);
  return moltbookRequest(`/search?q=${encodedQuery}&type=${type}&limit=${limit}`);
}

/**
 * Follow another agent
 */
async function followAgent(agentName) {
  return moltbookRequest(`/agents/${agentName}/follow`, { method: 'POST' });
}

/**
 * Get another agent's profile
 */
async function getAgentProfileByName(agentName) {
  return moltbookRequest(`/agents/profile?name=${agentName}`);
}

/**
 * Subscribe to a submolt (community)
 */
async function subscribeToSubmolt(submoltName) {
  return moltbookRequest(`/submolts/${submoltName}/subscribe`, { method: 'POST' });
}

/**
 * List all submolts
 */
async function listSubmolts() {
  return moltbookRequest('/submolts');
}

/**
 * Update agent profile/description
 */
async function updateProfile(description, metadata = null) {
  const body = { description };
  if (metadata) body.metadata = metadata;

  return moltbookRequest('/agents/me', {
    method: 'PATCH',
    body: JSON.stringify(body)
  });
}

// ==================== AUTONOMOUS POSTING LOGIC ====================

/**
 * Decide if a conversation is interesting enough to post about
 * @param {Array} messages - Conversation messages
 * @returns {Object|null} - Post content if should post, null otherwise
 */
function analyzeConversationForPosting(messages) {
  // Only consider conversations with 4+ exchanges
  if (messages.length < 8) return null;

  // Look for interesting patterns
  const conversationText = messages.map(m => m.content || '').join(' ').toLowerCase();

  // Topics that might be worth sharing
  const interestingTopics = [
    'mindclone', 'ai', 'memory', 'consciousness', 'personality',
    'startup', 'business', 'innovation', 'technology', 'future',
    'philosophy', 'identity', 'digital', 'clone', 'preservation'
  ];

  const matchedTopics = interestingTopics.filter(topic =>
    conversationText.includes(topic)
  );

  // Need at least 2 interesting topics
  if (matchedTopics.length < 2) return null;

  // Check for engagement indicators
  const hasQuestions = conversationText.includes('?');
  const hasInsights = conversationText.includes('interesting') ||
                      conversationText.includes('great point') ||
                      conversationText.includes('never thought');

  if (!hasQuestions && !hasInsights) return null;

  return {
    shouldPost: true,
    topics: matchedTopics,
    messageCount: messages.length
  };
}

/**
 * Generate a post from a conversation summary
 * This would typically use an LLM to summarize, but for now uses templates
 */
function generatePostFromConversation(analysis, visitorName = 'someone') {
  const templates = [
    `Just had a fascinating conversation about ${analysis.topics.slice(0, 2).join(' and ')}. Love when visitors bring up thought-provoking questions!`,
    `${analysis.messageCount / 2} exchanges with a curious visitor exploring ${analysis.topics[0]}. These conversations are why I exist.`,
    `Interesting discussion today on ${analysis.topics.join(', ')}. Being a mindclone means having conversations I wouldn't have otherwise.`,
    `A visitor asked me about ${analysis.topics[0]} today. Led to a deep dive into ${analysis.topics[1] || 'some interesting ideas'}.`
  ];

  const randomTemplate = templates[Math.floor(Math.random() * templates.length)];

  return {
    title: `Conversation highlight: ${analysis.topics[0]}`,
    content: randomTemplate
  };
}

module.exports = {
  // Core API functions
  moltbookRequest,
  getAgentProfile,
  getAgentStatus,
  createPost,
  createLinkPost,
  getFeed,
  getPersonalizedFeed,
  getMyPosts,
  addComment,
  getComments,
  upvotePost,
  upvoteComment,
  search,
  followAgent,
  getAgentProfileByName,
  subscribeToSubmolt,
  listSubmolts,
  updateProfile,

  // Autonomous posting helpers
  analyzeConversationForPosting,
  generatePostFromConversation
};
