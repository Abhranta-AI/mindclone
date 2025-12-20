// Discovery API - search and list public mindclone links
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Cache for discoverable links
let cachedLinks = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Rate limit check (100 requests per hour per IP)
async function checkRateLimit(ipAddress) {
  try {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);

    // Check IP's rate limit
    const rateLimitDoc = await db.collection('rateLimits').doc(`discover_${ipAddress}`).get();

    if (rateLimitDoc.exists) {
      const requests = rateLimitDoc.data().requests || [];
      const recentRequests = requests.filter(timestamp => timestamp > hourAgo);

      if (recentRequests.length >= 100) {
        throw new Error('Rate limit exceeded: Maximum 100 requests per hour');
      }

      // Update with new request
      await db.collection('rateLimits').doc(`discover_${ipAddress}`).set({
        requests: [...recentRequests, now],
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // First request
      await db.collection('rateLimits').doc(`discover_${ipAddress}`).set({
        requests: [now],
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return true;
  } catch (error) {
    throw error;
  }
}

// Get all discoverable links (with caching)
async function getDiscoverableLinks() {
  const now = Date.now();

  // Return cache if valid
  if (cachedLinks && (now - cacheTimestamp) < CACHE_TTL) {
    console.log('[Discover] Returning cached links');
    return cachedLinks;
  }

  console.log('[Discover] Fetching fresh links from Firestore');

  // Fetch all usernames
  const usernamesSnapshot = await db.collection('usernames').get();

  const links = [];

  for (const usernameDoc of usernamesSnapshot.docs) {
    const username = usernameDoc.id;
    const userId = usernameDoc.data().userId;

    // Fetch user data
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    // Skip if link not enabled or user doesn't exist
    if (!userData || !userData.linkEnabled) {
      continue;
    }

    // Fetch link settings (for display name/bio overrides)
    const settingsDoc = await db.collection('users').doc(userId)
      .collection('linkSettings').doc('config').get();
    const settingsData = settingsDoc.exists ? settingsDoc.data() : {};

    // Build link object
    links.push({
      username: username,
      displayName: settingsData.displayName || userData.displayName || username,
      bio: settingsData.bio || userData.bio || '',
      photoURL: userData.photoURL || null
    });
  }

  // Cache results
  cachedLinks = links;
  cacheTimestamp = now;

  console.log(`[Discover] Cached ${links.length} discoverable links`);

  return links;
}

// Search links by query
function searchLinks(query, links) {
  if (!query || query.trim() === '') {
    return links;
  }

  const lowerQuery = query.toLowerCase().trim();

  return links.filter(link => {
    return (
      link.username.toLowerCase().includes(lowerQuery) ||
      link.displayName.toLowerCase().includes(lowerQuery) ||
      link.bio.toLowerCase().includes(lowerQuery)
    );
  });
}

// Sanitize search query
function sanitizeQuery(query) {
  if (!query || typeof query !== 'string') {
    return '';
  }

  // Trim and limit length
  let sanitized = query.trim();
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100);
  }

  return sanitized;
}

// Main handler
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Cache headers (5 min cache, serve stale while revalidating)
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get IP address for rate limiting
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0] ||
                     req.headers['x-real-ip'] ||
                     req.connection?.remoteAddress ||
                     'unknown';

    // Check rate limit
    try {
      await checkRateLimit(ipAddress);
    } catch (error) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: error.message
      });
    }

    // Get query parameters
    const { q, limit = 20, offset = 0 } = req.query;

    // Sanitize query
    const sanitizedQuery = sanitizeQuery(q);

    // Get all discoverable links (cached)
    const allLinks = await getDiscoverableLinks();

    // Apply search filter
    const filteredLinks = searchLinks(sanitizedQuery, allLinks);

    // Sort alphabetically by display name
    filteredLinks.sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
    );

    // Paginate
    const parsedLimit = Math.min(parseInt(limit, 10) || 20, 50); // Max 50 per page
    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const start = parsedOffset;
    const end = start + parsedLimit;
    const paginatedLinks = filteredLinks.slice(start, end);
    const hasMore = end < filteredLinks.length;

    return res.status(200).json({
      results: paginatedLinks,
      total: filteredLinks.length,
      hasMore: hasMore,
      offset: start,
      limit: parsedLimit
    });

  } catch (error) {
    console.error('[Discover] API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};
