// Search Engine - Use Gemini with Google Search grounding to find relevant news
// Switched from Claude web search to Gemini to save Anthropic credits
const crypto = require('crypto');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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
 * Use Gemini with Google Search grounding to find news articles
 */
async function searchWithClaude(queries, profile) {
  try {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const queriesList = queries.map((q, i) => `${i + 1}. ${q}`).join('\n');

    const systemPrompt = `You are a news research assistant. Search for recent, relevant news articles based on the given queries.

For each article you find, provide the information in a JSON array. Each article should have:
- title: The article headline
- url: The full URL
- snippet: A 1-2 sentence summary
- source: The publisher/website name
- publishedDate: The publication date if available (ISO format), or null

Focus on recent articles (last 7 days preferred). Return ONLY a valid JSON array. If no articles found, return: []`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: `Search for recent news articles matching these queries:\n${queriesList}\n\nUser interests: ${profile.topics?.join(', ') || 'general'}` }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { maxOutputTokens: 3000, temperature: 0.3 }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!responseText) {
      console.log('[SearchEngine] No text response from Gemini');
      return [];
    }

    const articles = parseArticlesFromResponse(responseText, queries);
    return articles;

  } catch (error) {
    console.error(`[SearchEngine] Error in search:`, error);
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
