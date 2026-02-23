// Search Engine - Use Claude API with web search tool to find relevant news
// Switched from Gemini grounding to Claude web search (uses Brave Search under the hood)
const crypto = require('crypto');

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Search for news using Claude's web search tool
 * Returns array of articles with title, url, snippet, publishedDate, source
 */
async function searchNewsWithGrounding(profile) {
  try {
    console.log(`[SearchEngine] Searching news for profile with ${profile.topics?.length || 0} topics`);

    // Generate search queries from profile
    const queries = generateSearchQueries(profile);

    if (queries.length === 0) {
      console.log(`[SearchEngine] No queries generated from profile`);
      return [];
    }

    console.log(`[SearchEngine] Generated ${queries.length} queries:`, queries);

    // Use Claude with web search to find articles for all queries at once
    const articles = await searchWithClaude(queries, profile);

    console.log(`[SearchEngine] Found ${articles.length} unique articles`);

    return articles;

  } catch (error) {
    console.error(`[SearchEngine] Error in searchNewsWithGrounding:`, error);
    return [];
  }
}

/**
 * Generate 3-5 targeted search queries from user profile
 */
function generateSearchQueries(profile) {
  const queries = [];

  const now = new Date();
  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const currentMonth = monthNames[now.getMonth()];
  const currentYear = now.getFullYear();

  // Strategy 1: Topic-based queries (limit to top 3 topics)
  const topTopics = profile.topics?.slice(0, 3) || [];
  for (const topic of topTopics) {
    queries.push(`${topic} news ${currentMonth} ${currentYear}`);
  }

  // Strategy 2: Entity-based queries (limit to top 2 entities)
  const topEntities = profile.entities?.slice(0, 2) || [];
  for (const entity of topEntities) {
    queries.push(`${entity} latest updates ${currentYear}`);
  }

  // Strategy 3: Industry trends (limit to top 2 industries)
  const topIndustries = profile.industries?.slice(0, 2) || [];
  for (const industry of topIndustries) {
    queries.push(`${industry} trends ${currentMonth} ${currentYear}`);
  }

  // Strategy 4: Curiosity-based queries (limit to top 1)
  const topCuriosity = profile.curiosities?.[0];
  if (topCuriosity) {
    queries.push(`${topCuriosity} recent research ${currentYear}`);
  }

  // Limit total queries to 5
  return queries.slice(0, 5);
}

/**
 * Use Claude with web search tool to find news articles
 */
async function searchWithClaude(queries, profile) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const queriesList = queries.map((q, i) => `${i + 1}. ${q}`).join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 3000,
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 5
        }],
        system: `You are a news research assistant. Search the web for recent, relevant news articles based on the given queries.

For each article you find, provide the information in a JSON array. Each article should have:
- title: The article headline
- url: The full URL
- snippet: A 1-2 sentence summary
- source: The publisher/website name
- publishedDate: The publication date if available (ISO format), or null

Focus on:
- Recent articles (last 7 days preferred, last 30 days acceptable)
- Authoritative sources (major news sites, tech publications, industry blogs)
- Articles that are genuinely relevant to the topics

Return ONLY a valid JSON array of articles. No other text. Example:
[{"title": "...", "url": "...", "snippet": "...", "source": "...", "publishedDate": "..."}]

If you find no relevant articles, return: []`,
        messages: [{
          role: 'user',
          content: `Search for recent news articles matching these queries:\n${queriesList}\n\nUser interests for context: ${profile.topics?.join(', ') || 'general'}`
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Extract the final text response (after web search tool use)
    let responseText = '';
    for (const block of (data.content || [])) {
      if (block.type === 'text') {
        responseText += block.text;
      }
    }

    if (!responseText) {
      console.log('[SearchEngine] No text response from Claude');
      return [];
    }

    // Parse JSON from response
    const articles = parseArticlesFromResponse(responseText, queries);

    return articles;

  } catch (error) {
    console.error(`[SearchEngine] Error in searchWithClaude:`, error);
    return [];
  }
}

/**
 * Parse article JSON from Claude's response
 */
function parseArticlesFromResponse(responseText, queries) {
  try {
    // Try to extract JSON array from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log('[SearchEngine] No JSON array found in response');
      return [];
    }

    const articles = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(articles)) {
      console.log('[SearchEngine] Parsed result is not an array');
      return [];
    }

    // Validate and clean articles
    const validArticles = [];
    const seenUrls = new Set();

    for (const article of articles) {
      if (!article.url || !article.title) continue;
      if (seenUrls.has(article.url)) continue;

      seenUrls.add(article.url);
      validArticles.push({
        title: article.title || 'Untitled',
        url: article.url,
        snippet: article.snippet || '',
        source: article.source || extractDomain(article.url),
        publishedDate: article.publishedDate || null,
        query: queries[0] || ''
      });
    }

    return validArticles;

  } catch (error) {
    console.error(`[SearchEngine] Error parsing articles:`, error.message);
    return [];
  }
}

/**
 * Extract domain name from URL for source attribution
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return 'Unknown';
  }
}

/**
 * Hash URL for deduplication tracking
 */
function hashUrl(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

module.exports = {
  searchNewsWithGrounding,
  generateSearchQueries,
  hashUrl
};
