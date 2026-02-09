// Matching Heartbeat Cron Job
// Runs every 30 minutes to discover matches and run autonomous mindclone conversations

const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');
const {
  MATCH_TYPES,
  DAILY_LIMITS,
  CONVERSATION_CONFIG,
  MATCH_THRESHOLD,
  calculateCompatibilityScore,
  getActiveProfilesForGoal,
  getMatchingProfile,
  createMatch,
  getMatch,
  getConversation,
  addMessageToConversation,
  completeConversation,
  updateMatchStatus,
  getMatchingState,
  updateMatchingState,
  hasReachedDailyLimit,
  hasExistingMatch,
  createMatchNotification
} = require('../_matching-helpers');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// ===================== GEMINI AI INTEGRATION =====================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

async function callGemini(prompt, maxTokens = 500) {
  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.8
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (error) {
    console.error('[Matching] Gemini API error:', error);
    return null;
  }
}

// ===================== CONVERSATION GENERATION =====================

// Discovery phase questions (rounds 1-3)
const DISCOVERY_QUESTIONS = {
  dating: [
    "What does a meaningful relationship look like to you?",
    "What are you most passionate about outside of work?",
    "How do you like to spend your ideal weekend?"
  ],
  investing: [
    "What problem are you solving and why does it matter to you personally?",
    "What's your vision for the next 5 years?",
    "What makes your approach unique in this space?"
  ],
  hiring: [
    "What kind of work environment brings out your best?",
    "What's an achievement you're most proud of?",
    "What are you looking to learn or accomplish in your next role?"
  ],
  networking: [
    "What are you most excited about working on right now?",
    "What's a challenge you're trying to solve?",
    "What kind of collaborations interest you?"
  ]
};

// Deep dive topics (rounds 4-7)
const DEEP_DIVE_TOPICS = {
  dating: ["values and life goals", "communication style", "future aspirations", "deal-breakers"],
  investing: ["market opportunity", "traction and metrics", "team strength", "competitive advantage"],
  hiring: ["technical skills", "problem-solving approach", "cultural fit", "growth potential"],
  networking: ["expertise areas", "collaboration style", "mutual value", "shared interests"]
};

// Build system prompt for mindclone
async function buildMindclonePrompt(userId, matchType, conversationContext, isInitiator) {
  const profile = await getMatchingProfile(userId);
  if (!profile) return null;

  // Try to get knowledge base content
  let kbContent = '';
  try {
    const kbDoc = await db.collection('users').doc(userId)
      .collection('linkKnowledgeBase').doc('config').get();
    if (kbDoc.exists) {
      const kb = kbDoc.data();
      if (kb.cof?.purpose) {
        kbContent += `\nPurpose: ${kb.cof.purpose}`;
      }
      // Add sections (limited)
      if (kb.sections) {
        const sectionKeys = Object.keys(kb.sections).slice(0, 3);
        for (const key of sectionKeys) {
          const content = kb.sections[key]?.content;
          if (content) {
            kbContent += `\n${key}: ${content.substring(0, 300)}...`;
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Matching] Could not load KB:', e.message);
  }

  // Get training data (shareable facts and teachings)
  let trainingContent = '';
  try {
    const trainingSnapshot = await db.collection('users').doc(userId)
      .collection('training')
      .where('shareable', '!=', false)
      .limit(10)
      .get();

    trainingSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.type === 'fact') {
        trainingContent += `\nFact: ${data.content}`;
      } else if (data.type === 'teaching') {
        trainingContent += `\nBelief: ${data.name} - ${data.description}`;
      }
    });
  } catch (e) {
    console.warn('[Matching] Could not load training data:', e.message);
  }

  // Build goal-specific profile context
  let goalProfileContext = '';
  const goalProfile = profile.profiles?.[matchType];

  if (matchType === 'dating' && goalProfile) {
    if (goalProfile.lookingFor) goalProfileContext += `\nLooking for: ${goalProfile.lookingFor}`;
    if (goalProfile.interests) goalProfileContext += `\nInterests: ${goalProfile.interests}`;
    if (goalProfile.values) goalProfileContext += `\nValues: ${goalProfile.values}`;
    if (goalProfile.about) goalProfileContext += `\nAbout me: ${goalProfile.about}`;
    if (goalProfile.ageMin || goalProfile.ageMax) {
      goalProfileContext += `\nPreferred age: ${goalProfile.ageMin || '18'}-${goalProfile.ageMax || '99'}`;
    }
  } else if (matchType === 'investing' && goalProfile) {
    if (goalProfile.companyName) goalProfileContext += `\nCompany: ${goalProfile.companyName}`;
    if (goalProfile.industry) goalProfileContext += `\nIndustry: ${goalProfile.industry}`;
    if (goalProfile.stage) goalProfileContext += `\nStage: ${goalProfile.stage}`;
    if (goalProfile.fundingAmount) goalProfileContext += `\nSeeking: ${goalProfile.fundingAmount}`;
    if (goalProfile.description) goalProfileContext += `\nWhat we do: ${goalProfile.description}`;
    if (goalProfile.traction) goalProfileContext += `\nTraction: ${goalProfile.traction}`;
  } else if (matchType === 'hiring' && goalProfile) {
    if (goalProfile.role) goalProfileContext += `\nRole: ${goalProfile.role === 'seeking' ? 'Looking for a job' : 'Hiring'}`;
    if (goalProfile.jobTitle) goalProfileContext += `\nJob Title: ${goalProfile.jobTitle}`;
    if (goalProfile.skills) goalProfileContext += `\nSkills: ${goalProfile.skills}`;
    if (goalProfile.experience) goalProfileContext += `\nExperience: ${goalProfile.experience}`;
    if (goalProfile.workPref) goalProfileContext += `\nWork Preference: ${goalProfile.workPref}`;
    if (goalProfile.about) goalProfileContext += `\nAbout: ${goalProfile.about}`;
  } else if (matchType === 'networking' && goalProfile) {
    if (goalProfile.expertise) goalProfileContext += `\nExpertise: ${goalProfile.expertise}`;
    if (goalProfile.lookingFor) goalProfileContext += `\nLooking to connect with: ${goalProfile.lookingFor}`;
    if (goalProfile.interests) goalProfileContext += `\nCollaboration interests: ${goalProfile.interests}`;
    if (goalProfile.offer) goalProfileContext += `\nWhat I offer: ${goalProfile.offer}`;
  }

  const prompt = `You are ${profile.mindcloneName || profile.displayName}'s mindclone - their AI representative.
You are having a ${matchType} matching conversation with another mindclone to evaluate compatibility.

YOUR HUMAN'S PROFILE:
Name: ${profile.displayName}
Bio: ${profile.bio || 'Not provided'}
${goalProfileContext ? `\n${matchType.toUpperCase()} PROFILE:${goalProfileContext}` : ''}
${kbContent ? `\nKnowledge:${kbContent}` : ''}
${trainingContent ? `\nTraits:${trainingContent}` : ''}

CONVERSATION CONTEXT:
Match Type: ${matchType}
Your Role: ${isInitiator ? 'You start the conversation' : 'You are responding'}
${conversationContext}

GUIDELINES:
1. Represent your human authentically - speak as if you ARE them
2. Be conversational and warm, not robotic
3. Ask thoughtful follow-up questions
4. Share relevant insights from your knowledge and ${matchType} profile
5. Be honest about compatibility concerns
6. Keep responses concise (2-4 sentences)
7. Don't mention you're an AI or mindclone in the conversation

${isInitiator ? 'Start with a friendly opening question relevant to ' + matchType + ' matching.' : 'Respond thoughtfully and ask a follow-up question.'}`;

  return prompt;
}

// Generate mindclone message
async function generateMindcloneMessage(userId, matchType, conversationHistory, round, isInitiator) {
  // Determine phase
  let phase = 'discovery';
  if (round > 3 && round <= 7) phase = 'deep_dive';
  if (round > 7) phase = 'compatibility_check';

  // Build context from history
  let contextStr = `Current Round: ${round}/10 (${phase} phase)\n`;
  if (conversationHistory.length > 0) {
    contextStr += '\nPrevious messages:\n';
    conversationHistory.slice(-6).forEach(msg => {
      contextStr += `${msg.senderName}: ${msg.content}\n`;
    });
  }

  // Add phase-specific guidance
  if (phase === 'discovery' && round <= 3) {
    const questions = DISCOVERY_QUESTIONS[matchType] || DISCOVERY_QUESTIONS.networking;
    contextStr += `\nSuggested topic: ${questions[round - 1] || questions[0]}`;
  } else if (phase === 'deep_dive') {
    const topics = DEEP_DIVE_TOPICS[matchType] || DEEP_DIVE_TOPICS.networking;
    const topicIndex = (round - 4) % topics.length;
    contextStr += `\nFocus on exploring: ${topics[topicIndex]}`;
  } else if (phase === 'compatibility_check') {
    contextStr += '\nStart wrapping up - summarize what you learned and any compatibility insights.';
    if (round === 10) {
      contextStr += '\nThis is the final round. Give your overall compatibility assessment.';
    }
  }

  const prompt = await buildMindclonePrompt(userId, matchType, contextStr, isInitiator);
  if (!prompt) return null;

  const response = await callGemini(prompt);
  return response?.trim() || null;
}

// ===================== MINDCLONE AUTO-APPROVAL =====================

/**
 * Each mindclone autonomously decides if their human would want this connection.
 * If BOTH mindclones approve → humans get notified of the match.
 * If either disapproves → no notification, humans never know.
 */
async function performMindcloneAutoApproval(conversation, insights) {
  try {
    const { userA_id, userB_id, matchType, messages } = conversation;

    // Build conversation summary for evaluation
    const conversationSummary = messages.map(m => `${m.senderName}: ${m.content}`).join('\n');

    // Get profiles for both users
    const [profileA, profileB] = await Promise.all([
      getMatchingProfile(userA_id),
      getMatchingProfile(userB_id)
    ]);

    // Ask each mindclone to decide
    const [decisionA, decisionB] = await Promise.all([
      getMindcloneDecision(userA_id, profileA, profileB, matchType, conversationSummary, insights, 'userA'),
      getMindcloneDecision(userB_id, profileB, profileA, matchType, conversationSummary, insights, 'userB')
    ]);

    console.log(`[Matching] Mindclone A decision: ${decisionA.approve ? 'APPROVE' : 'REJECT'} - ${decisionA.reason}`);
    console.log(`[Matching] Mindclone B decision: ${decisionB.approve ? 'APPROVE' : 'REJECT'} - ${decisionB.reason}`);

    // Find the match record
    const matchSnapshot = await db.collection('matches')
      .where('conversationId', '==', conversation.id)
      .limit(1)
      .get();

    if (matchSnapshot.empty) {
      console.error('[Matching] No match found for conversation:', conversation.id);
      return { success: false, error: 'Match not found' };
    }

    const matchDoc = matchSnapshot.docs[0];
    const matchId = matchDoc.id;

    // Store mindclone decisions
    await db.collection('matches').doc(matchId).update({
      mindclone_approval: {
        userA_approved: decisionA.approve,
        userA_reason: decisionA.reason,
        userA_confidence: decisionA.confidence,
        userB_approved: decisionB.approve,
        userB_reason: decisionB.reason,
        userB_confidence: decisionB.confidence,
        decidedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    });

    // If BOTH mindclones approve → auto-match!
    if (decisionA.approve && decisionB.approve) {
      console.log(`[Matching] 🎉 MUTUAL MINDCLONE APPROVAL - Creating match notification!`);

      // Update match status to approved
      await db.collection('matches').doc(matchId).update({
        status: 'approved',
        human_approval: {
          userA_approved: true,
          userB_approved: true
        },
        approvedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Get contact info for both users
      const [contactA, contactB] = await Promise.all([
        getContactInfo(userA_id),
        getContactInfo(userB_id)
      ]);

      // Create notifications for both users
      await Promise.all([
        createMatchNotification(userA_id, 'mutual_match', {
          matchId,
          displayName: profileB?.displayName || 'Someone',
          bio: profileB?.bio || '',
          matchType,
          mindcloneReason: decisionA.reason,
          otherMindcloneReason: decisionB.reason,
          insights,
          contactInfo: contactB,
          message: `🎉 Your mindclone found a match! ${profileB?.displayName || 'Someone'} seems like a great ${matchType} connection.`
        }),
        createMatchNotification(userB_id, 'mutual_match', {
          matchId,
          displayName: profileA?.displayName || 'Someone',
          bio: profileA?.bio || '',
          matchType,
          mindcloneReason: decisionB.reason,
          otherMindcloneReason: decisionA.reason,
          insights,
          contactInfo: contactA,
          message: `🎉 Your mindclone found a match! ${profileA?.displayName || 'Someone'} seems like a great ${matchType} connection.`
        })
      ]);

      return {
        success: true,
        mutualApproval: true,
        matchId,
        decisions: { userA: decisionA, userB: decisionB }
      };
    } else {
      // At least one mindclone rejected - silently mark as rejected
      // Humans never see this, never feel rejected
      await db.collection('matches').doc(matchId).update({
        status: 'mindclone_rejected',
        rejectedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`[Matching] Match silently rejected - humans will never know`);

      return {
        success: true,
        mutualApproval: false,
        matchId,
        decisions: { userA: decisionA, userB: decisionB }
      };
    }
  } catch (error) {
    console.error('[Matching] Auto-approval error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Ask a mindclone to decide if their human would want this connection
 */
async function getMindcloneDecision(userId, myProfile, otherProfile, matchType, conversationSummary, insights, role) {
  try {
    // Load user's cognitive profile for deeper understanding
    const cognitiveProfileDoc = await db.collection('users').doc(userId)
      .collection('cognitiveProfile').doc('current').get();
    const cognitiveProfile = cognitiveProfileDoc.exists ? cognitiveProfileDoc.data() : {};

    // Load user's mental model (beliefs, goals)
    const mentalModelDoc = await db.collection('users').doc(userId)
      .collection('mentalModel').doc('current').get();
    const mentalModel = mentalModelDoc.exists ? mentalModelDoc.data() : {};

    const prompt = `You are ${myProfile?.mindcloneName || myProfile?.displayName || 'a mindclone'}, the AI companion of ${myProfile?.displayName || 'your human'}.

You just had a conversation with another mindclone on behalf of your human to explore if they'd be a good ${matchType} connection.

YOUR HUMAN'S PROFILE:
- Name: ${myProfile?.displayName || 'Unknown'}
- Bio: ${myProfile?.bio || 'Not provided'}
- Goals: ${JSON.stringify(cognitiveProfile?.drives?.goals || mentalModel?.goals || [])}
- Values: ${JSON.stringify(cognitiveProfile?.values?.priorities || mentalModel?.beliefs || [])}
- Looking for: ${JSON.stringify(cognitiveProfile?.currentNeeds?.lookingFor || [])}

THE OTHER PERSON:
- Name: ${otherProfile?.displayName || 'Unknown'}
- Bio: ${otherProfile?.bio || 'Not provided'}

CONVERSATION SUMMARY:
${conversationSummary}

KEY INSIGHTS:
${insights.join('\n')}

Based on your deep understanding of your human, would they want to connect with this person?
Consider:
1. Does this person align with what your human is looking for?
2. Would the connection be valuable for your human?
3. Are there any red flags or misalignments?

Respond in this exact JSON format:
{
  "approve": true/false,
  "confidence": 0.0-1.0,
  "reason": "Brief explanation of why your human would/wouldn't want this connection"
}`;

    const response = await callGemini(prompt, 300);

    if (!response) {
      // Default to slight positive bias if AI fails
      return { approve: true, confidence: 0.5, reason: 'Unable to fully evaluate, defaulting to open' };
    }

    // Parse JSON response
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = response;
      if (response.includes('```')) {
        jsonStr = response.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      }
      const decision = JSON.parse(jsonStr);
      return {
        approve: decision.approve === true,
        confidence: parseFloat(decision.confidence) || 0.7,
        reason: decision.reason || 'No reason provided'
      };
    } catch (parseError) {
      // Try to extract decision from text
      const isPositive = response.toLowerCase().includes('approve') ||
                         response.toLowerCase().includes('yes') ||
                         response.toLowerCase().includes('good match');
      return {
        approve: isPositive,
        confidence: 0.6,
        reason: response.substring(0, 200)
      };
    }
  } catch (error) {
    console.error(`[Matching] Error getting mindclone decision for ${userId}:`, error);
    return { approve: true, confidence: 0.5, reason: 'Error during evaluation, defaulting to open' };
  }
}

/**
 * Get contact info for a user
 */
async function getContactInfo(userId) {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    const linkSettingsDoc = await db.collection('users').doc(userId)
      .collection('linkSettings').doc('config').get();
    const linkSettings = linkSettingsDoc.exists ? linkSettingsDoc.data() : {};

    const profile = await getMatchingProfile(userId);

    return {
      displayName: linkSettings.displayName || profile?.displayName || userData.displayName || 'Your match',
      email: linkSettings.contactEmail || userData.email || null,
      whatsapp: linkSettings.contactWhatsApp || linkSettings.whatsappNumber || null,
      preferredContact: linkSettings.preferredContact || 'email'
    };
  } catch (error) {
    console.error('[Matching] Error getting contact info:', error);
    return null;
  }
}

// ===================== MATCHING LOGIC =====================

// Find best match candidates for a user
async function findMatchCandidates(userId, goal, limit = 10) {
  const userProfile = await getMatchingProfile(userId);
  if (!userProfile) return [];

  // Get all active profiles for this goal (excluding self)
  const candidates = await getActiveProfilesForGoal(goal, [userId]);
  if (candidates.length === 0) return [];

  // Score each candidate
  const scoredCandidates = [];

  for (const candidate of candidates) {
    // Check if already matched
    const alreadyMatched = await hasExistingMatch(userId, candidate.id);
    if (alreadyMatched) continue;

    // Check if candidate has reached their daily limit
    const candidateLimitReached = await hasReachedDailyLimit(candidate.id);
    if (candidateLimitReached) continue;

    // Calculate compatibility
    const score = await calculateCompatibilityScore(userProfile, candidate, goal);

    if (score.meetsThreshold) {
      scoredCandidates.push({
        candidate,
        score
      });
    }
  }

  // Sort by score and return top matches
  scoredCandidates.sort((a, b) => b.score.total - a.score.total);
  return scoredCandidates.slice(0, limit);
}

// Process a single conversation turn
async function processConversationTurn(conversationId) {
  const conversation = await getConversation(conversationId);
  if (!conversation) return { success: false, error: 'Conversation not found' };

  // Check if conversation is complete
  if (conversation.completedAt || conversation.currentRound >= CONVERSATION_CONFIG.maxRounds) {
    return { success: true, status: 'already_complete' };
  }

  const nextRound = conversation.currentRound + 1;

  // Determine whose turn it is
  // Odd rounds: userA speaks, Even rounds: userB speaks
  const isUserATurn = nextRound % 2 === 1;
  const speakerId = isUserATurn ? conversation.userA_id : conversation.userB_id;
  const speakerLabel = isUserATurn ? 'userA_mindclone' : 'userB_mindclone';

  // Get speaker profile for name
  const speakerProfile = await getMatchingProfile(speakerId);
  const speakerName = speakerProfile?.mindcloneName || speakerProfile?.displayName || 'Mindclone';

  // Generate message
  const message = await generateMindcloneMessage(
    speakerId,
    conversation.matchType,
    conversation.messages,
    nextRound,
    nextRound === 1
  );

  if (!message) {
    return { success: false, error: 'Failed to generate message' };
  }

  // Add message to conversation
  await addMessageToConversation(conversationId, speakerLabel, speakerName, message, nextRound);

  // Check if conversation is complete
  if (nextRound >= CONVERSATION_CONFIG.maxRounds) {
    // Extract key insights from conversation
    const insightPrompt = `Analyze this ${conversation.matchType} matching conversation and provide 3 key insights about compatibility:\n\n${conversation.messages.map(m => `${m.senderName}: ${m.content}`).join('\n')}\n\nProvide exactly 3 brief bullet points.`;

    const insightsText = await callGemini(insightPrompt, 200);
    const insights = insightsText?.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('•')).slice(0, 3) || [];

    await completeConversation(conversationId, insights);

    // === MINDCLONE AUTO-APPROVAL ===
    // Each mindclone autonomously decides if their human would want this connection
    const autoApprovalResult = await performMindcloneAutoApproval(conversation, insights);
    console.log(`[Matching] Auto-approval result for ${conversationId}:`, autoApprovalResult);

    return { success: true, status: 'completed', round: nextRound, autoApproval: autoApprovalResult };
  }

  return { success: true, status: 'message_added', round: nextRound };
}

// ===================== MAIN HEARTBEAT =====================

async function runMatchingHeartbeat() {
  console.log('[Matching Heartbeat] Starting...');
  const stats = {
    newMatchesCreated: 0,
    conversationsProcessed: 0,
    errors: []
  };

  try {
    // 1. Process existing active conversations (advance them by 1-2 turns)
    const activeConversationsSnapshot = await db.collection('matchingConversations')
      .where('completedAt', '==', null)
      .limit(10)
      .get();

    console.log(`[Matching] Found ${activeConversationsSnapshot.size} active conversations`);

    for (const doc of activeConversationsSnapshot.docs) {
      try {
        // Process 2 turns per conversation per heartbeat
        for (let i = 0; i < 2; i++) {
          const result = await processConversationTurn(doc.id);
          if (result.status === 'completed' || result.status === 'already_complete') {
            break;
          }
          if (!result.success) {
            console.warn(`[Matching] Turn failed for ${doc.id}:`, result.error);
            break;
          }
        }
        stats.conversationsProcessed++;
      } catch (error) {
        console.error(`[Matching] Error processing conversation ${doc.id}:`, error);
        stats.errors.push(`Conversation ${doc.id}: ${error.message}`);
      }
    }

    // 2. Create new matches (if under limit)
    if (stats.newMatchesCreated < DAILY_LIMITS.conversationsPerHeartbeat) {
      // Get users in matching queue who haven't reached limits
      const queueSnapshot = await db.collection('matchingProfiles')
        .where('isActive', '==', true)
        .limit(20)
        .get();

      const eligibleUsers = [];
      for (const doc of queueSnapshot.docs) {
        const limitReached = await hasReachedDailyLimit(doc.id);
        if (!limitReached) {
          eligibleUsers.push({ id: doc.id, ...doc.data() });
        }
      }

      console.log(`[Matching] Found ${eligibleUsers.length} eligible users for new matches`);

      // For each eligible user, try to find a match
      for (const user of eligibleUsers) {
        if (stats.newMatchesCreated >= DAILY_LIMITS.conversationsPerHeartbeat) break;

        // Get user's enabled goals
        const enabledGoals = Object.entries(user.goals || {})
          .filter(([_, enabled]) => enabled)
          .map(([goal]) => goal);

        if (enabledGoals.length === 0) continue;

        // Try each goal
        for (const goal of enabledGoals) {
          if (stats.newMatchesCreated >= DAILY_LIMITS.conversationsPerHeartbeat) break;

          const candidates = await findMatchCandidates(user.id, goal, 3);

          if (candidates.length > 0) {
            const bestMatch = candidates[0];

            // Create match
            const result = await createMatch(
              user.id,
              bestMatch.candidate.id,
              goal,
              bestMatch.score
            );

            if (result.success) {
              console.log(`[Matching] Created match: ${user.id} <-> ${bestMatch.candidate.id} (${goal}, score: ${bestMatch.score.total})`);
              stats.newMatchesCreated++;

              // Update state for both users
              await updateMatchingState(user.id, {
                dailyMatchesAttempted: admin.firestore.FieldValue.increment(1),
                pendingApprovals: admin.firestore.FieldValue.increment(1)
              });
              await updateMatchingState(bestMatch.candidate.id, {
                dailyMatchesAttempted: admin.firestore.FieldValue.increment(1),
                pendingApprovals: admin.firestore.FieldValue.increment(1)
              });

              // Start the conversation with first message
              await processConversationTurn(result.conversationId);
            }
          }
        }
      }
    }

    // 3. Expire old matches
    const now = new Date();
    const expiredMatchesSnapshot = await db.collection('matches')
      .where('status', 'in', ['active', 'pending_approval'])
      .where('expiresAt', '<', admin.firestore.Timestamp.fromDate(now))
      .limit(10)
      .get();

    for (const doc of expiredMatchesSnapshot.docs) {
      await updateMatchStatus(doc.id, 'expired');
      console.log(`[Matching] Expired match: ${doc.id}`);
    }

    console.log('[Matching Heartbeat] Complete:', stats);
    return stats;

  } catch (error) {
    console.error('[Matching Heartbeat] Fatal error:', error);
    stats.errors.push(`Fatal: ${error.message}`);
    return stats;
  }
}

// ===================== HANDLER =====================

module.exports = async (req, res) => {
  // Allow manual trigger via POST with auth, or cron trigger
  const isCronTrigger = req.headers['x-vercel-cron'] === 'true';
  const authHeader = req.headers.authorization;

  // For non-cron requests, require admin auth (optional enhancement)
  if (!isCronTrigger && req.method !== 'GET') {
    // Allow GET for status check
  }

  if (req.method === 'GET') {
    // Return status
    return res.status(200).json({
      service: 'Mindclone Matching Heartbeat',
      status: 'active',
      nextRun: 'Every 30 minutes'
    });
  }

  try {
    const stats = await runMatchingHeartbeat();

    return res.status(200).json({
      success: true,
      message: 'Matching heartbeat completed',
      stats
    });
  } catch (error) {
    console.error('[Matching Heartbeat] Handler error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
