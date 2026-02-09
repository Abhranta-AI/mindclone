// Matching Conversation API
// View conversation details between mindclones

const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');
const {
  getMatch,
  getConversation,
  getMatchingProfile
} = require('../_matching-helpers');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// ===================== SUMMARY GENERATION =====================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

async function generateConversationSummary(messages, otherProfile, matchType) {
  if (!GEMINI_API_KEY || !messages || messages.length === 0) {
    return null;
  }

  try {
    // Build conversation context
    const conversationText = messages.map(m => {
      const speaker = m.sender.includes('userA') ? 'Your mindclone' : `${otherProfile?.displayName || 'Their mindclone'}`;
      return `${speaker}: ${m.content}`;
    }).join('\n');

    const prompt = `You are summarizing a mindclone-to-mindclone conversation for a user.
The user wants to know what their AI companion (mindclone) discussed with another person's mindclone.

Match type: ${matchType || 'networking'}
Other person: ${otherProfile?.displayName || 'Anonymous'}
Their bio: ${otherProfile?.bio || 'Not provided'}

Conversation:
${conversationText}

Generate a brief, friendly summary (2-3 sentences) that:
1. Highlights the key things discussed
2. Notes any compatibility or shared interests discovered
3. Gives the user a sense of whether this could be a good connection

Be conversational, like you're a friend telling them about someone you met. Don't use bullet points.`;

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 200,
          temperature: 0.7
        }
      })
    });

    if (!response.ok) {
      console.error('[Conversation] Gemini API error:', response.status);
      return null;
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (error) {
    console.error('[Conversation] Summary generation error:', error);
    return null;
  }
}

// Generate key insights from conversation
function extractKeyInsights(messages, otherProfile) {
  const insights = [];

  // Look for common topics
  const topics = new Set();
  const keywords = ['startup', 'funding', 'investor', 'ai', 'product', 'team', 'growth', 'market', 'experience', 'passion', 'vision'];

  messages.forEach(m => {
    const contentLower = m.content.toLowerCase();
    keywords.forEach(kw => {
      if (contentLower.includes(kw)) {
        topics.add(kw);
      }
    });
  });

  if (topics.size > 0) {
    insights.push({
      type: 'topics_discussed',
      content: `Discussed: ${Array.from(topics).slice(0, 5).join(', ')}`
    });
  }

  // Check for positive signals
  const positiveSignals = ['interesting', 'excited', 'great', 'love', 'amazing', 'perfect', 'aligned'];
  let hasPositiveSignals = false;
  messages.forEach(m => {
    positiveSignals.forEach(signal => {
      if (m.content.toLowerCase().includes(signal)) {
        hasPositiveSignals = true;
      }
    });
  });

  if (hasPositiveSignals) {
    insights.push({
      type: 'positive_signals',
      content: 'Conversation showed positive engagement'
    });
  }

  return insights;
}

// Verify Firebase ID token
async function verifyToken(idToken) {
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken.uid;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    const idToken = authHeader ? authHeader.replace('Bearer ', '') : null;

    if (!idToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = await verifyToken(idToken);

    const { conversationId, matchId } = req.query;

    if (!conversationId && !matchId) {
      return res.status(400).json({ error: 'conversationId or matchId is required' });
    }

    let conversation = null;
    let match = null;

    // Get by conversationId
    if (conversationId) {
      conversation = await getConversation(conversationId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Get associated match
      if (conversation.matchId) {
        match = await getMatch(conversation.matchId);
      }
    }
    // Get by matchId
    else if (matchId) {
      match = await getMatch(matchId);
      if (!match) {
        return res.status(404).json({ error: 'Match not found' });
      }

      if (match.conversationId) {
        conversation = await getConversation(match.conversationId);
      }
    }

    // Verify user is part of this conversation
    const userAId = conversation?.userA_id || match?.userA_id;
    const userBId = conversation?.userB_id || match?.userB_id;

    if (userId !== userAId && userId !== userBId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get profiles for context
    const [profileA, profileB] = await Promise.all([
      getMatchingProfile(userAId),
      getMatchingProfile(userBId)
    ]);

    // Determine user's perspective
    const isUserA = userId === userAId;
    const myProfile = isUserA ? profileA : profileB;
    const otherProfile = isUserA ? profileB : profileA;

    // Format messages with role context
    const formattedMessages = conversation?.messages?.map(msg => ({
      ...msg,
      isMine: (msg.sender === 'userA_mindclone' && isUserA) ||
              (msg.sender === 'userB_mindclone' && !isUserA),
      senderProfile: msg.sender === 'userA_mindclone'
        ? { name: profileA?.mindcloneName || profileA?.displayName, photo: profileA?.photoURL }
        : { name: profileB?.mindcloneName || profileB?.displayName, photo: profileB?.photoURL }
    })) || [];

    // Calculate conversation progress
    const maxRounds = 10;
    const currentRound = conversation?.currentRound || 0;
    const progressPercent = Math.round((currentRound / maxRounds) * 100);

    // Determine phase
    let phase = 'not_started';
    if (currentRound > 0 && currentRound <= 3) {
      phase = 'discovery';
    } else if (currentRound > 3 && currentRound <= 7) {
      phase = 'deep_dive';
    } else if (currentRound > 7 && currentRound <= 10) {
      phase = 'compatibility_check';
    }
    if (conversation?.completedAt) {
      phase = 'completed';
    }

    // Generate summary if conversation has messages
    let summary = null;
    let keyInsights = [];
    if (conversation?.messages?.length > 0) {
      // Check if we have a cached summary
      if (conversation.cachedSummary && conversation.cachedSummaryRound === currentRound) {
        summary = conversation.cachedSummary;
      } else {
        // Generate new summary
        summary = await generateConversationSummary(
          conversation.messages,
          otherProfile,
          conversation.matchType || match?.matchType
        );

        // Cache the summary (fire and forget)
        if (summary && conversation.id) {
          db.collection('matchingConversations').doc(conversation.id).update({
            cachedSummary: summary,
            cachedSummaryRound: currentRound
          }).catch(err => console.error('[Conversation] Cache update error:', err));
        }
      }

      // Extract key insights
      keyInsights = extractKeyInsights(conversation.messages, otherProfile);
    }

    return res.status(200).json({
      success: true,
      conversation: conversation ? {
        id: conversation.id,
        matchId: conversation.matchId,
        matchType: conversation.matchType,
        messages: formattedMessages,
        currentRound,
        maxRounds,
        progressPercent,
        phase,
        state: conversation.state,
        createdAt: conversation.createdAt,
        completedAt: conversation.completedAt,
        summary,
        keyInsights
      } : null,
      match: match ? {
        id: match.id,
        matchType: match.matchType,
        status: match.status,
        compatibilityScore: match.compatibilityScore,
        compatibilityBreakdown: match.compatibilityBreakdown,
        createdAt: match.createdAt,
        expiresAt: match.expiresAt
      } : null,
      participants: {
        me: myProfile ? {
          displayName: myProfile.displayName,
          mindcloneName: myProfile.mindcloneName,
          photoURL: myProfile.photoURL
        } : null,
        other: otherProfile ? {
          displayName: otherProfile.displayName,
          mindcloneName: otherProfile.mindcloneName,
          photoURL: otherProfile.photoURL,
          bio: otherProfile.bio
        } : null
      },
      myRole: isUserA ? 'userA' : 'userB'
    });

  } catch (error) {
    console.error('[Conversation API] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
