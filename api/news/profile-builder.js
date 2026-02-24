// Profile Builder - Extract user interests from Firestore memories
// Uses Claude Haiku to parse memories into structured interest profiles
const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Profile cache TTL: 24 hours
const PROFILE_CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * Build user interest profile from Firestore memories
 * Returns structured profile with topics, entities, industries, curiosities
 */
async function buildUserInterestProfile(userId) {
  try {
    console.log(`[ProfileBuilder] Building profile for ${userId}`);

    // Check cache first
    const cachedProfile = await getCachedProfile(userId);
    if (cachedProfile) {
      console.log(`[ProfileBuilder] Using cached profile for ${userId}`);
      return cachedProfile;
    }

    // Fetch memories from Firestore (consolidated by DMN + saved by chat)
    const memoriesSnap = await db.collection('users').doc(userId)
      .collection('memories')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    if (memoriesSnap.empty) {
      console.log(`[ProfileBuilder] No memories found for ${userId}`);
      return null;
    }

    const memories = memoriesSnap.docs.map(d => d.data().content).filter(Boolean);
    console.log(`[ProfileBuilder] Found ${memories.length} memories for ${userId}`);

    if (memories.length === 0) {
      return null;
    }

    // Use Claude to parse memories into structured profile
    const profile = await parseMemoriesWithClaude(memories, userId);

    if (!profile) {
      console.warn(`[ProfileBuilder] Failed to parse memories for ${userId}`);
      return null;
    }

    // Cache profile for 24 hours
    await cacheProfile(userId, profile);

    console.log(`[ProfileBuilder] Built profile for ${userId}: ${profile.topics?.length || 0} topics, ${profile.entities?.length || 0} entities`);

    return profile;

  } catch (error) {
    console.error(`[ProfileBuilder] Error building profile for ${userId}:`, error);
    return null;
  }
}

/**
 * Parse memories using Claude Haiku to extract structured interests
 */
async function parseMemoriesWithClaude(memories, userId) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const systemPrompt = `You are an AI assistant that analyzes a user's memories to extract their interests and preferences.

Given a list of memories about a user, extract:
1. Topics of interest: Specific subjects they care about (e.g., "artificial intelligence", "climate tech", "indie hacking")
2. Entities: Companies, people, products, or brands they follow or mention (e.g., "OpenAI", "Elon Musk", "iPhone")
3. Industries: Broader industry categories they're interested in (e.g., "technology", "healthcare", "finance")
4. Curiosities: Recent questions, problems, or things they're trying to learn (e.g., "how to scale databases", "best practices for team management")

Be specific and extract only concrete interests that are clearly expressed in the memories. Avoid vague or generic terms.

Return ONLY a valid JSON object with this exact structure, no other text:
{
  "topics": ["topic1", "topic2"],
  "entities": ["entity1", "entity2"],
  "industries": ["industry1", "industry2"],
  "curiosities": ["curiosity1", "curiosity2"]
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `Analyze these memories and extract the user's interests:\n\n${memories.join('\n\n')}`
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text;

    if (!text) {
      throw new Error('No response from Claude');
    }

    // Parse JSON response
    let profile;
    try {
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      profile = JSON.parse(jsonMatch ? jsonMatch[0] : cleanText);
    } catch (parseError) {
      console.error(`[ProfileBuilder] Failed to parse Claude response:`, text);
      throw new Error('Invalid JSON response from Claude');
    }

    // Validate structure
    if (!profile.topics || !Array.isArray(profile.topics)) profile.topics = [];
    if (!profile.entities || !Array.isArray(profile.entities)) profile.entities = [];
    if (!profile.industries || !Array.isArray(profile.industries)) profile.industries = [];
    if (!profile.curiosities || !Array.isArray(profile.curiosities)) profile.curiosities = [];

    // Limit array sizes
    profile.topics = profile.topics.slice(0, 15);
    profile.entities = profile.entities.slice(0, 15);
    profile.industries = profile.industries.slice(0, 10);
    profile.curiosities = profile.curiosities.slice(0, 10);

    return profile;

  } catch (error) {
    console.error(`[ProfileBuilder] Error parsing memories with Claude:`, error);
    return null;
  }
}

/**
 * Get cached profile from Firestore
 */
async function getCachedProfile(userId) {
  try {
    const cacheDoc = await db.collection('users').doc(userId)
      .collection('newsCuration').doc('profileCache').get();

    if (!cacheDoc.exists) {
      return null;
    }

    const cache = cacheDoc.data();
    const cacheAge = Date.now() - cache.cachedAt.toMillis();

    if (cacheAge > PROFILE_CACHE_TTL) {
      console.log(`[ProfileBuilder] Cache expired for ${userId} (age: ${Math.round(cacheAge / 1000 / 60)} minutes)`);
      return null;
    }

    return cache.profile;

  } catch (error) {
    console.error(`[ProfileBuilder] Error getting cached profile:`, error);
    return null;
  }
}

/**
 * Cache profile to Firestore
 */
async function cacheProfile(userId, profile) {
  try {
    await db.collection('users').doc(userId)
      .collection('newsCuration').doc('profileCache')
      .set({
        profile,
        cachedAt: admin.firestore.FieldValue.serverTimestamp(),
        userId
      });

    console.log(`[ProfileBuilder] Cached profile for ${userId}`);
  } catch (error) {
    console.error(`[ProfileBuilder] Error caching profile:`, error);
  }
}

module.exports = {
  buildUserInterestProfile
};
