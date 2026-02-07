// Mindclone-to-Mindclone Matching Helpers
// Scoring algorithms, utilities, and shared functions

const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// ===================== CONSTANTS =====================

const MATCH_TYPES = ['dating', 'investing', 'hiring', 'networking'];

const SCORE_WEIGHTS = {
  goalAlignment: 0.25,
  valuesAlignment: 0.25,
  expertiseRelevance: 0.30,
  communicationFit: 0.20
};

const MATCH_THRESHOLD = 65; // Minimum score to create a match

const DAILY_LIMITS = {
  matchesPerUser: 2,
  conversationsPerHeartbeat: 5,
  pendingApprovalsMax: 3
};

const CONVERSATION_CONFIG = {
  maxRounds: 10,
  phases: {
    discovery: [1, 2, 3],
    deepDive: [4, 5, 6, 7],
    compatibilityCheck: [8, 9, 10]
  }
};

// Goal compatibility matrix (complementary goals score higher)
const GOAL_COMPATIBILITY = {
  investing: {
    investing: 60,  // Both looking to invest - moderate
    hiring: 70,     // Investor might hire
    networking: 80, // Good networking match
    dating: 30      // Not very compatible goals
  },
  hiring: {
    investing: 70,
    hiring: 50,     // Both hiring - low compatibility
    networking: 75,
    dating: 30
  },
  networking: {
    investing: 80,
    hiring: 75,
    networking: 85, // Both networking - good!
    dating: 40
  },
  dating: {
    investing: 30,
    hiring: 30,
    networking: 40,
    dating: 100     // Both looking for dating - perfect
  }
};

// ===================== SCORING FUNCTIONS =====================

/**
 * Calculate overall compatibility score between two users
 */
async function calculateCompatibilityScore(userA, userB, matchType) {
  try {
    const scores = {
      goalAlignment: calculateGoalAlignment(userA, userB, matchType),
      valuesAlignment: await calculateValuesAlignment(userA, userB),
      expertiseRelevance: calculateExpertiseRelevance(userA, userB, matchType),
      communicationFit: calculateCommunicationFit(userA, userB)
    };

    // Calculate weighted total
    const totalScore =
      scores.goalAlignment * SCORE_WEIGHTS.goalAlignment +
      scores.valuesAlignment * SCORE_WEIGHTS.valuesAlignment +
      scores.expertiseRelevance * SCORE_WEIGHTS.expertiseRelevance +
      scores.communicationFit * SCORE_WEIGHTS.communicationFit;

    return {
      total: Math.round(totalScore),
      breakdown: scores,
      meetsThreshold: totalScore >= MATCH_THRESHOLD
    };
  } catch (error) {
    console.error('[Matching] Score calculation error:', error);
    return {
      total: 0,
      breakdown: { goalAlignment: 0, valuesAlignment: 0, expertiseRelevance: 0, communicationFit: 0 },
      meetsThreshold: false
    };
  }
}

/**
 * Calculate goal alignment score
 */
function calculateGoalAlignment(userA, userB, matchType) {
  // Check if both users have the matching goal enabled
  const userAGoals = userA.goals || {};
  const userBGoals = userB.goals || {};

  if (!userAGoals[matchType] || !userBGoals[matchType]) {
    return 0; // One user doesn't have this goal
  }

  // For same goal type, check complementary nature
  // e.g., investor looking for founders, employer looking for job seekers

  // Check linkGoal from user settings for complementary matching
  const userALinkGoal = userA.linkGoal || 'networking';
  const userBLinkGoal = userB.linkGoal || 'networking';

  // Complementary pairs score higher
  const complementaryPairs = {
    'raise_funds': ['find_clients', 'networking'], // Founder seeking investor
    'find_clients': ['raise_funds', 'networking'], // Service provider seeking clients
    'get_hired': ['networking'],                    // Job seeker
    'build_audience': ['networking'],               // Content creator
    'networking': ['raise_funds', 'find_clients', 'get_hired', 'build_audience', 'networking']
  };

  let score = GOAL_COMPATIBILITY[matchType]?.[matchType] || 70;

  // Boost for complementary linkGoals
  if (complementaryPairs[userALinkGoal]?.includes(userBLinkGoal)) {
    score = Math.min(100, score + 20);
  }

  return score;
}

/**
 * Calculate values alignment based on shared interests and KB
 */
async function calculateValuesAlignment(userA, userB) {
  let score = 50; // Base score

  // Compare interests
  const userAInterests = userA.matchingPreferences?.interests || [];
  const userBInterests = userB.matchingPreferences?.interests || [];

  if (userAInterests.length > 0 && userBInterests.length > 0) {
    const commonInterests = userAInterests.filter(i =>
      userBInterests.some(j => j.toLowerCase() === i.toLowerCase())
    );
    const interestScore = (commonInterests.length / Math.max(userAInterests.length, userBInterests.length)) * 100;
    score = Math.max(score, interestScore);
  }

  // Compare industries
  const userAIndustries = userA.matchingPreferences?.industries || [];
  const userBIndustries = userB.matchingPreferences?.industries || [];

  if (userAIndustries.length > 0 && userBIndustries.length > 0) {
    const commonIndustries = userAIndustries.filter(i =>
      userBIndustries.some(j => j.toLowerCase() === i.toLowerCase())
    );
    if (commonIndustries.length > 0) {
      score = Math.min(100, score + 20);
    }
  }

  return Math.round(score);
}

/**
 * Calculate expertise relevance
 */
function calculateExpertiseRelevance(userA, userB, matchType) {
  let score = 50; // Base score

  // Bio length indicates profile effort
  const userABioLength = (userA.bio || '').length;
  const userBBioLength = (userB.bio || '').length;

  if (userABioLength > 100 && userBBioLength > 100) {
    score += 15;
  }

  // Check for KB content availability
  if (userA.hasKnowledgeBase && userB.hasKnowledgeBase) {
    score += 20;
  }

  // Industry match boosts expertise relevance
  const userAIndustries = userA.matchingPreferences?.industries || [];
  const userBIndustries = userB.matchingPreferences?.industries || [];

  const hasIndustryOverlap = userAIndustries.some(i =>
    userBIndustries.some(j => j.toLowerCase() === i.toLowerCase())
  );

  if (hasIndustryOverlap) {
    score += 15;
  }

  return Math.min(100, Math.round(score));
}

/**
 * Calculate communication fit
 */
function calculateCommunicationFit(userA, userB) {
  let score = 60; // Base score

  // Profile completeness
  const userAComplete = Boolean(userA.displayName && userA.bio && userA.mindcloneName);
  const userBComplete = Boolean(userB.displayName && userB.bio && userB.mindcloneName);

  if (userAComplete && userBComplete) {
    score += 20;
  } else if (userAComplete || userBComplete) {
    score += 10;
  }

  // Bio quality (length as proxy)
  const avgBioLength = ((userA.bio || '').length + (userB.bio || '').length) / 2;
  if (avgBioLength > 150) {
    score += 20;
  } else if (avgBioLength > 50) {
    score += 10;
  }

  return Math.min(100, Math.round(score));
}

// ===================== PROFILE FUNCTIONS =====================

/**
 * Get matching profile for a user
 */
async function getMatchingProfile(userId) {
  try {
    const profileDoc = await db.collection('matchingProfiles').doc(userId).get();
    if (!profileDoc.exists) {
      return null;
    }
    return { id: profileDoc.id, ...profileDoc.data() };
  } catch (error) {
    console.error('[Matching] Error getting profile:', error);
    return null;
  }
}

/**
 * Create or update matching profile
 */
async function upsertMatchingProfile(userId, profileData) {
  try {
    const profileRef = db.collection('matchingProfiles').doc(userId);
    const now = admin.firestore.FieldValue.serverTimestamp();

    await profileRef.set({
      ...profileData,
      userId,
      updatedAt: now,
      createdAt: profileData.createdAt || now
    }, { merge: true });

    return { success: true };
  } catch (error) {
    console.error('[Matching] Error upserting profile:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all active profiles for a specific goal
 */
async function getActiveProfilesForGoal(goal, excludeUserIds = []) {
  try {
    const snapshot = await db.collection('matchingProfiles')
      .where('isActive', '==', true)
      .where(`goals.${goal}`, '==', true)
      .limit(100)
      .get();

    const profiles = [];
    snapshot.forEach(doc => {
      if (!excludeUserIds.includes(doc.id)) {
        profiles.push({ id: doc.id, ...doc.data() });
      }
    });

    return profiles;
  } catch (error) {
    console.error('[Matching] Error getting profiles for goal:', error);
    return [];
  }
}

// ===================== MATCH FUNCTIONS =====================

/**
 * Create a new match between two users
 */
async function createMatch(userAId, userBId, matchType, compatibilityScore) {
  try {
    const matchRef = db.collection('matches').doc();
    const conversationRef = db.collection('matchingConversations').doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Create conversation first
    await conversationRef.set({
      matchId: matchRef.id,
      userA_id: userAId,
      userB_id: userBId,
      matchType,
      messages: [],
      currentRound: 0,
      state: {
        phase: 'discovery',
        topicsExplored: [],
        questionsAsked: []
      },
      createdAt: now,
      completedAt: null
    });

    // Create match
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    await matchRef.set({
      userA_id: userAId,
      userB_id: userBId,
      matchType,
      status: 'active',
      conversationId: conversationRef.id,
      compatibilityScore: compatibilityScore.total,
      compatibilityBreakdown: compatibilityScore.breakdown,
      conversationMetadata: {
        totalMessages: 0,
        topicsDiscussed: [],
        keyInsights: []
      },
      human_approval: {
        userA_approved: null,
        userB_approved: null,
        userA_approvedAt: null,
        userB_approvedAt: null,
        userA_comment: '',
        userB_comment: ''
      },
      createdAt: now,
      lastMessageAt: now,
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt)
    });

    return {
      success: true,
      matchId: matchRef.id,
      conversationId: conversationRef.id
    };
  } catch (error) {
    console.error('[Matching] Error creating match:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get matches for a user
 */
async function getMatchesForUser(userId, status = null, limit = 20) {
  try {
    let query = db.collection('matches')
      .where('userA_id', '==', userId);

    if (status) {
      query = query.where('status', '==', status);
    }

    const snapshotA = await query.orderBy('createdAt', 'desc').limit(limit).get();

    // Also get matches where user is userB
    let queryB = db.collection('matches')
      .where('userB_id', '==', userId);

    if (status) {
      queryB = queryB.where('status', '==', status);
    }

    const snapshotB = await queryB.orderBy('createdAt', 'desc').limit(limit).get();

    const matches = [];
    snapshotA.forEach(doc => matches.push({ id: doc.id, ...doc.data() }));
    snapshotB.forEach(doc => matches.push({ id: doc.id, ...doc.data() }));

    // Sort by createdAt and dedupe
    matches.sort((a, b) => {
      const timeA = a.createdAt?.toMillis?.() || 0;
      const timeB = b.createdAt?.toMillis?.() || 0;
      return timeB - timeA;
    });

    return matches.slice(0, limit);
  } catch (error) {
    console.error('[Matching] Error getting matches:', error);
    return [];
  }
}

/**
 * Get a specific match
 */
async function getMatch(matchId) {
  try {
    const matchDoc = await db.collection('matches').doc(matchId).get();
    if (!matchDoc.exists) {
      return null;
    }
    return { id: matchDoc.id, ...matchDoc.data() };
  } catch (error) {
    console.error('[Matching] Error getting match:', error);
    return null;
  }
}

/**
 * Update match status
 */
async function updateMatchStatus(matchId, status, additionalData = {}) {
  try {
    await db.collection('matches').doc(matchId).update({
      status,
      ...additionalData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    console.error('[Matching] Error updating match status:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Approve or reject a match
 */
async function handleMatchApproval(matchId, userId, approved, comment = '') {
  try {
    const match = await getMatch(matchId);
    if (!match) {
      return { success: false, error: 'Match not found' };
    }

    // Determine if user is A or B
    const isUserA = match.userA_id === userId;
    const isUserB = match.userB_id === userId;

    if (!isUserA && !isUserB) {
      return { success: false, error: 'User not part of this match' };
    }

    const updateField = isUserA ? 'userA' : 'userB';
    const now = admin.firestore.FieldValue.serverTimestamp();

    const updateData = {
      [`human_approval.${updateField}_approved`]: approved,
      [`human_approval.${updateField}_approvedAt`]: now,
      [`human_approval.${updateField}_comment`]: comment
    };

    // Check if both users have now responded
    const otherApproved = isUserA ? match.human_approval.userB_approved : match.human_approval.userA_approved;

    if (otherApproved !== null) {
      // Both have responded - determine final status
      if (approved && otherApproved) {
        updateData.status = 'approved';
      } else {
        updateData.status = 'rejected';
      }
    } else if (!approved) {
      // One rejection is enough to reject
      updateData.status = 'rejected';
    } else {
      updateData.status = 'pending_approval';
    }

    await db.collection('matches').doc(matchId).update(updateData);

    return {
      success: true,
      newStatus: updateData.status,
      mutualApproval: updateData.status === 'approved'
    };
  } catch (error) {
    console.error('[Matching] Error handling approval:', error);
    return { success: false, error: error.message };
  }
}

// ===================== CONVERSATION FUNCTIONS =====================

/**
 * Get conversation by ID
 */
async function getConversation(conversationId) {
  try {
    const convDoc = await db.collection('matchingConversations').doc(conversationId).get();
    if (!convDoc.exists) {
      return null;
    }
    return { id: convDoc.id, ...convDoc.data() };
  } catch (error) {
    console.error('[Matching] Error getting conversation:', error);
    return null;
  }
}

/**
 * Add message to conversation
 */
async function addMessageToConversation(conversationId, sender, senderName, content, round) {
  try {
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.collection('matchingConversations').doc(conversationId).update({
      messages: admin.firestore.FieldValue.arrayUnion({
        sender,
        senderName,
        content,
        timestamp: new Date().toISOString(),
        round
      }),
      currentRound: round,
      updatedAt: now
    });

    // Also update the match's lastMessageAt
    const conversation = await getConversation(conversationId);
    if (conversation?.matchId) {
      await db.collection('matches').doc(conversation.matchId).update({
        lastMessageAt: now,
        'conversationMetadata.totalMessages': admin.firestore.FieldValue.increment(1)
      });
    }

    return { success: true };
  } catch (error) {
    console.error('[Matching] Error adding message:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Complete a conversation
 */
async function completeConversation(conversationId, keyInsights = []) {
  try {
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.collection('matchingConversations').doc(conversationId).update({
      completedAt: now,
      'state.phase': 'completed'
    });

    // Update match status
    const conversation = await getConversation(conversationId);
    if (conversation?.matchId) {
      await db.collection('matches').doc(conversation.matchId).update({
        status: 'pending_approval',
        'conversationMetadata.keyInsights': keyInsights
      });
    }

    return { success: true };
  } catch (error) {
    console.error('[Matching] Error completing conversation:', error);
    return { success: false, error: error.message };
  }
}

// ===================== STATE MANAGEMENT =====================

/**
 * Get matching state for a user
 */
async function getMatchingState(userId) {
  try {
    const stateDoc = await db.collection('matchingState').doc(userId).get();
    const today = new Date().toISOString().split('T')[0];

    if (!stateDoc.exists) {
      return {
        dailyMatchesAttempted: 0,
        dailySuccessfulMatches: 0,
        pendingApprovals: 0,
        conversationsActive: 0,
        lastResetDate: today
      };
    }

    const state = stateDoc.data();

    // Reset daily counters if new day
    if (state.lastResetDate !== today) {
      return {
        dailyMatchesAttempted: 0,
        dailySuccessfulMatches: 0,
        pendingApprovals: state.pendingApprovals || 0,
        conversationsActive: state.conversationsActive || 0,
        lastResetDate: today
      };
    }

    return state;
  } catch (error) {
    console.error('[Matching] Error getting state:', error);
    return null;
  }
}

/**
 * Update matching state
 */
async function updateMatchingState(userId, updates) {
  try {
    const today = new Date().toISOString().split('T')[0];

    await db.collection('matchingState').doc(userId).set({
      ...updates,
      lastResetDate: today,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return { success: true };
  } catch (error) {
    console.error('[Matching] Error updating state:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if user has reached daily limit
 */
async function hasReachedDailyLimit(userId) {
  const state = await getMatchingState(userId);
  if (!state) return true; // Fail safe

  return state.dailyMatchesAttempted >= DAILY_LIMITS.matchesPerUser ||
         state.pendingApprovals >= DAILY_LIMITS.pendingApprovalsMax;
}

/**
 * Check if pair has already been matched
 */
async function hasExistingMatch(userAId, userBId) {
  try {
    // Check both directions
    const snapshot1 = await db.collection('matches')
      .where('userA_id', '==', userAId)
      .where('userB_id', '==', userBId)
      .limit(1)
      .get();

    if (!snapshot1.empty) return true;

    const snapshot2 = await db.collection('matches')
      .where('userA_id', '==', userBId)
      .where('userB_id', '==', userAId)
      .limit(1)
      .get();

    return !snapshot2.empty;
  } catch (error) {
    console.error('[Matching] Error checking existing match:', error);
    return true; // Fail safe
  }
}

// ===================== EXPORTS =====================

module.exports = {
  // Constants
  MATCH_TYPES,
  SCORE_WEIGHTS,
  MATCH_THRESHOLD,
  DAILY_LIMITS,
  CONVERSATION_CONFIG,

  // Scoring
  calculateCompatibilityScore,
  calculateGoalAlignment,
  calculateValuesAlignment,
  calculateExpertiseRelevance,
  calculateCommunicationFit,

  // Profiles
  getMatchingProfile,
  upsertMatchingProfile,
  getActiveProfilesForGoal,

  // Matches
  createMatch,
  getMatchesForUser,
  getMatch,
  updateMatchStatus,
  handleMatchApproval,

  // Conversations
  getConversation,
  addMessageToConversation,
  completeConversation,

  // State
  getMatchingState,
  updateMatchingState,
  hasReachedDailyLimit,
  hasExistingMatch
};
