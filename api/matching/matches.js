// Matches API
// Get, approve, reject matches

const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');
const {
  getMatchesForUser,
  getMatch,
  handleMatchApproval,
  getMatchingProfile,
  getConversation
} = require('../_matching-helpers');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Verify Firebase ID token
async function verifyToken(idToken) {
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken.uid;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

// Enrich match with profile data
async function enrichMatchWithProfiles(match) {
  try {
    const [profileA, profileB] = await Promise.all([
      getMatchingProfile(match.userA_id),
      getMatchingProfile(match.userB_id)
    ]);

    return {
      ...match,
      userA_profile: profileA ? {
        displayName: profileA.displayName,
        bio: profileA.bio,
        mindcloneName: profileA.mindcloneName,
        photoURL: profileA.photoURL
      } : null,
      userB_profile: profileB ? {
        displayName: profileB.displayName,
        bio: profileB.bio,
        mindcloneName: profileB.mindcloneName,
        photoURL: profileB.photoURL
      } : null
    };
  } catch (error) {
    console.warn('[Matches] Could not enrich with profiles:', error.message);
    return match;
  }
}

// Get contact info for approved match
async function getContactInfoForApprovedMatch(match, requestingUserId) {
  if (match.status !== 'approved') {
    return null;
  }

  try {
    const otherUserId = match.userA_id === requestingUserId ? match.userB_id : match.userA_id;

    // Get link settings for contact info
    const linkSettingsDoc = await db.collection('users').doc(otherUserId)
      .collection('linkSettings').doc('config').get();

    if (!linkSettingsDoc.exists) {
      return null;
    }

    const settings = linkSettingsDoc.data();
    return {
      email: settings.contactEmail || null,
      whatsapp: settings.contactWhatsApp || null
    };
  } catch (error) {
    console.warn('[Matches] Could not get contact info:', error.message);
    return null;
  }
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    const idToken = authHeader ? authHeader.replace('Bearer ', '') : null;

    if (!idToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = await verifyToken(idToken);

    // GET - List matches or get specific match
    if (req.method === 'GET') {
      const { matchId, status, limit = '20' } = req.query;

      // Get specific match
      if (matchId) {
        const match = await getMatch(matchId);

        if (!match) {
          return res.status(404).json({ error: 'Match not found' });
        }

        // Verify user is part of this match
        if (match.userA_id !== userId && match.userB_id !== userId) {
          return res.status(403).json({ error: 'Access denied' });
        }

        // Enrich with profiles
        const enrichedMatch = await enrichMatchWithProfiles(match);

        // Get conversation
        const conversation = match.conversationId
          ? await getConversation(match.conversationId)
          : null;

        // Get contact info if approved
        const contactInfo = await getContactInfoForApprovedMatch(match, userId);

        // Determine user's role in match
        const isUserA = match.userA_id === userId;
        const myApproval = isUserA ? match.human_approval.userA_approved : match.human_approval.userB_approved;
        const otherApproval = isUserA ? match.human_approval.userB_approved : match.human_approval.userA_approved;

        return res.status(200).json({
          success: true,
          match: {
            ...enrichedMatch,
            conversation: conversation ? {
              messages: conversation.messages,
              currentRound: conversation.currentRound,
              state: conversation.state,
              completedAt: conversation.completedAt
            } : null,
            contactInfo,
            myRole: isUserA ? 'userA' : 'userB',
            myApproval,
            otherApproval
          }
        });
      }

      // List all matches
      const matches = await getMatchesForUser(userId, status || null, parseInt(limit));

      // Enrich each match with basic profile info
      const enrichedMatches = await Promise.all(
        matches.map(async (match) => {
          const enriched = await enrichMatchWithProfiles(match);

          // Add user role and approval status
          const isUserA = match.userA_id === userId;
          return {
            ...enriched,
            myRole: isUserA ? 'userA' : 'userB',
            myApproval: isUserA ? match.human_approval.userA_approved : match.human_approval.userB_approved,
            otherApproval: isUserA ? match.human_approval.userB_approved : match.human_approval.userA_approved,
            // For list view, include other user's profile prominently
            otherUser: isUserA ? enriched.userB_profile : enriched.userA_profile
          };
        })
      );

      // Categorize matches
      const categorized = {
        active: enrichedMatches.filter(m => m.status === 'active'),
        pendingApproval: enrichedMatches.filter(m => m.status === 'pending_approval' || m.status === 'completed'),
        approved: enrichedMatches.filter(m => m.status === 'approved'),
        rejected: enrichedMatches.filter(m => m.status === 'rejected')
      };

      return res.status(200).json({
        success: true,
        matches: enrichedMatches,
        categorized,
        total: enrichedMatches.length
      });
    }

    // POST - Approve or reject a match
    if (req.method === 'POST') {
      const { matchId, action, comment } = req.body;

      if (!matchId) {
        return res.status(400).json({ error: 'matchId is required' });
      }

      if (!action || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'action must be "approve" or "reject"' });
      }

      // Verify match exists and user is part of it
      const match = await getMatch(matchId);

      if (!match) {
        return res.status(404).json({ error: 'Match not found' });
      }

      if (match.userA_id !== userId && match.userB_id !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Check match status allows approval
      if (!['active', 'completed', 'pending_approval'].includes(match.status)) {
        return res.status(400).json({
          error: `Cannot ${action} match with status: ${match.status}`
        });
      }

      // Handle approval
      const result = await handleMatchApproval(
        matchId,
        userId,
        action === 'approve',
        comment || ''
      );

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      // If mutual approval, get contact info
      let contactInfo = null;
      if (result.mutualApproval) {
        contactInfo = await getContactInfoForApprovedMatch(
          { ...match, status: 'approved' },
          userId
        );
      }

      return res.status(200).json({
        success: true,
        action,
        newStatus: result.newStatus,
        mutualApproval: result.mutualApproval,
        contactInfo,
        message: result.mutualApproval
          ? 'Match approved by both parties! Contact info is now available.'
          : action === 'approve'
            ? 'Your approval recorded. Waiting for the other person.'
            : 'Match rejected.'
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('[Matches API] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
