// Search Engine - Use Gemini grounding with Google Search to find relevant news
const crypto = require('crypto');

/**
 * Search for news using Gemini's Google Search grounding
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

    // Execute searches and collect results
    const allArticles = [];
    const seenUrls = new Set(); // Deduplicate across queries

    for (const query of queries) {
      try {
        const articles = await searchWithGrounding(query);

        // Deduplicate and add to results
        for (const article of articles) {
          if (!seenUrls.has(article.url)) {
            seenUrls.add(article.url);
            allArticles.push(article);
          }
        }

      } catch (error) {
        console.error(`[SearchEngine] Error searching for "${query}":`, error.message);
        // Continue with other queries
      }
    }

    console.log(`[SearchEngine] Found ${allArticles.length} unique articles across ${queries.length} queries`);

    return allArticles;

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

  // Get current date for time-based queries
  const now = new Date();
  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const currentMonth = monthNames[now.getMonth()];
  const currentYear = now.getFullYear();

  // Strategy 1: Topic-based queries (limit to top 3 topics)
  const topTopics = profile.topics?.slice(0, 3) || [];
  for (const topic of topTopics) {
    // Add temporal context to get recent news
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

  // Limit total queries to 5 to avoid rate limits and timeouts
  const limitedQueries = queries.slice(0, 5);

  return limitedQueries;
}

/**
 * Execute a single search query using Gemini grounding
 */
async function searchWithGrounding(query) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    // Build prompt that encourages Gemini to use search grounding
    const prompt = `Find recent news articles about: ${query}

List the most relevant and recent articles you find. For each article, provide:
- Title
- URL
- Brief summary (1-2 sentences)
- Source/publisher name
- Publication date (if available)

Focus on authoritative sources like news sites, research publications, and reputable blogs.`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        tools: [{
          google_search: {} // Enable Google Search grounding
        }],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 2000
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Gemini API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();

    // Parse grounding metadata to extract search results
    const articles = parseGroundingMetadata(data, query);

    console.log(`[SearchEngine] Query "${query}" returned ${articles.length} articles`);

    return articles;

  } catch (error) {
    console.error(`[SearchEngine] Error in searchWithGrounding for "${query}":`, error);
    throw error;
  }
}

/**
 * Parse Gemini response to extract article information from grounding metadata
 */
function parseGroundingMetadata(data, originalQuery) {
  const articles = [];

  try {
    // Check if grounding metadata exists
    const groundingMetadata = data.candidates?.[0]?.groundingMetadata;

    if (!groundingMetadata) {
      console.log(`[SearchEngine] No grounding metadata found for query`);
      return articles;
    }

    // Extract search results from grounding chunks
    const searchChunks = groundingMetadata.searchEntryPoint?.renderedContent ||
                        groundingMetadata.groundingChunks ||
                        groundingMetadata.webSearchQueries ||
                        [];

    // If groundingChunks exist, parse them
    if (groundingMetadata.groundingChunks) {
      for (const chunk of groundingMetadata.groundingChunks) {
        if (chunk.web) {
          const article = {
            title: chunk.web.title || 'Untitled',
            url: chunk.web.uri || '',
            snippet: chunk.web.snippet || '',
            source: extractDomain(chunk.web.uri || ''),
            publishedDate: null, // Gemini doesn't provide this in chunks
            query: originalQuery
          };

          if (article.url) {
            articles.push(article);
          }
        }
      }
    }

    // Also parse the text response for URLs if no chunks found
    if (articles.length === 0) {
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const urlRegex = /https?:\/\/[^\s\)]+/g;
      const urls = responseText.match(urlRegex) || [];

      for (const url of urls) {
        // Extract title from surrounding text (heuristic)
        const urlIndex = responseText.indexOf(url);
        const beforeUrl = responseText.substring(Math.max(0, urlIndex - 100), urlIndex);
        const titleMatch = beforeUrl.match(/["']([^"']{10,80})["']|(?:^|\n)([^\n]{10,80})$/);
        const title = titleMatch?.[1] || titleMatch?.[2] || 'Article';

        articles.push({
          title: title.trim(),
          url: url,
          snippet: '',
          source: extractDomain(url),
          publishedDate: null,
          query: originalQuery
        });
      }
    }

    // Deduplicate by URL
    const uniqueArticles = [];
    const seenUrls = new Set();

    for (const article of articles) {
      if (!seenUrls.has(article.url)) {
        seenUrls.add(article.url);
        uniqueArticles.push(article);
      }
    }

    return uniqueArticles;

  } catch (error) {
    console.error(`[SearchEngine] Error parsing grounding metadata:`, error);
    return articles;
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
