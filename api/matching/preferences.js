// Matching Preferences API
// Manage user's matching profile and settings

const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');
const {
  getMatchingProfile,
  upsertMatchingProfile,
  MATCH_TYPES
} = require('../_matching-helpers');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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

    // GET - Retrieve matching preferences
    if (req.method === 'GET') {
      const profile = await getMatchingProfile(userId);

      if (!profile) {
        // Return default empty profile
        return res.status(200).json({
          success: true,
          profile: {
            userId,
            displayName: '',
            bio: '',
            mindcloneName: '',
            photoURL: null,
            goals: {
              dating: false,
              investing: false,
              hiring: false,
              networking: false
            },
            profiles: {
              dating: { lookingFor: '', ageMin: null, ageMax: null, interests: '', values: '', about: '' },
              investing: { companyName: '', industry: '', stage: '', fundingAmount: '', description: '', traction: '' },
              hiring: { role: '', jobTitle: '', skills: '', experience: '', workPref: '', about: '' },
              networking: { expertise: '', lookingFor: '', interests: '', offer: '' }
            },
            matchingPreferences: {
              industries: [],
              interests: [],
              visibility: 'everyone'
            },
            isActive: false,
            hasProfile: false
          }
        });
      }

      return res.status(200).json({
        success: true,
        profile: {
          ...profile,
          hasProfile: true
        }
      });
    }

    // POST/PUT - Create or update matching preferences
    if (req.method === 'POST' || req.method === 'PUT') {
      const {
        displayName,
        bio,
        mindcloneName,
        photoURL,
        goals,
        profiles,  // Goal-specific profiles (dating, investing, hiring, networking)
        matchingPreferences,
        isActive
      } = req.body;

      // Validate goals
      if (goals) {
        for (const goal of Object.keys(goals)) {
          if (!MATCH_TYPES.includes(goal)) {
            return res.status(400).json({
              error: `Invalid goal type: ${goal}. Valid types: ${MATCH_TYPES.join(', ')}`
            });
          }
        }
      }

      // Validate visibility
      const validVisibilities = ['everyone', 'verified', 'private'];
      if (matchingPreferences?.visibility && !validVisibilities.includes(matchingPreferences.visibility)) {
        return res.status(400).json({
          error: `Invalid visibility: ${matchingPreferences.visibility}`
        });
      }

      // Get existing profile to preserve fields
      const existingProfile = await getMatchingProfile(userId);

      // Build update object
      const profileData = {
        displayName: displayName ?? existingProfile?.displayName ?? '',
        bio: bio ?? existingProfile?.bio ?? '',
        mindcloneName: mindcloneName ?? existingProfile?.mindcloneName ?? '',
        photoURL: photoURL ?? existingProfile?.photoURL ?? null,
        goals: goals ?? existingProfile?.goals ?? {
          dating: false,
          investing: false,
          hiring: false,
          networking: false
        },
        // Goal-specific profiles
        profiles: {
          dating: {
            lookingFor: profiles?.dating?.lookingFor ?? existingProfile?.profiles?.dating?.lookingFor ?? '',
            ageMin: profiles?.dating?.ageMin ?? existingProfile?.profiles?.dating?.ageMin ?? null,
            ageMax: profiles?.dating?.ageMax ?? existingProfile?.profiles?.dating?.ageMax ?? null,
            interests: profiles?.dating?.interests ?? existingProfile?.profiles?.dating?.interests ?? '',
            values: profiles?.dating?.values ?? existingProfile?.profiles?.dating?.values ?? '',
            about: profiles?.dating?.about ?? existingProfile?.profiles?.dating?.about ?? ''
          },
          investing: {
            companyName: profiles?.investing?.companyName ?? existingProfile?.profiles?.investing?.companyName ?? '',
            industry: profiles?.investing?.industry ?? existingProfile?.profiles?.investing?.industry ?? '',
            stage: profiles?.investing?.stage ?? existingProfile?.profiles?.investing?.stage ?? '',
            fundingAmount: profiles?.investing?.fundingAmount ?? existingProfile?.profiles?.investing?.fundingAmount ?? '',
            description: profiles?.investing?.description ?? existingProfile?.profiles?.investing?.description ?? '',
            traction: profiles?.investing?.traction ?? existingProfile?.profiles?.investing?.traction ?? ''
          },
          hiring: {
            role: profiles?.hiring?.role ?? existingProfile?.profiles?.hiring?.role ?? '',
            jobTitle: profiles?.hiring?.jobTitle ?? existingProfile?.profiles?.hiring?.jobTitle ?? '',
            skills: profiles?.hiring?.skills ?? existingProfile?.profiles?.hiring?.skills ?? '',
            experience: profiles?.hiring?.experience ?? existingProfile?.profiles?.hiring?.experience ?? '',
            workPref: profiles?.hiring?.workPref ?? existingProfile?.profiles?.hiring?.workPref ?? '',
            about: profiles?.hiring?.about ?? existingProfile?.profiles?.hiring?.about ?? ''
          },
          networking: {
            expertise: profiles?.networking?.expertise ?? existingProfile?.profiles?.networking?.expertise ?? '',
            lookingFor: profiles?.networking?.lookingFor ?? existingProfile?.profiles?.networking?.lookingFor ?? '',
            interests: profiles?.networking?.interests ?? existingProfile?.profiles?.networking?.interests ?? '',
            offer: profiles?.networking?.offer ?? existingProfile?.profiles?.networking?.offer ?? ''
          }
        },
        matchingPreferences: {
          industries: matchingPreferences?.industries ?? existingProfile?.matchingPreferences?.industries ?? [],
          interests: matchingPreferences?.interests ?? existingProfile?.matchingPreferences?.interests ?? [],
          visibility: matchingPreferences?.visibility ?? existingProfile?.matchingPreferences?.visibility ?? 'everyone'
        },
        isActive: isActive ?? existingProfile?.isActive ?? false
      };

      // Also try to fetch user's link settings to enrich profile
      try {
        const db = admin.firestore();
        const linkSettingsDoc = await db.collection('users').doc(userId)
          .collection('linkSettings').doc('config').get();

        if (linkSettingsDoc.exists) {
          const linkSettings = linkSettingsDoc.data();
          // Use link settings as fallback
          profileData.displayName = profileData.displayName || linkSettings.displayName || '';
          profileData.bio = profileData.bio || linkSettings.bio || '';
          profileData.mindcloneName = profileData.mindcloneName || linkSettings.mindcloneName || '';
          profileData.linkGoal = linkSettings.linkGoal || 'networking';
        }

        // Check if user has KB
        const kbDoc = await db.collection('users').doc(userId)
          .collection('linkKnowledgeBase').doc('config').get();
        profileData.hasKnowledgeBase = kbDoc.exists && Object.keys(kbDoc.data() || {}).length > 0;

      } catch (e) {
        console.warn('[Matching] Could not fetch link settings:', e.message);
      }

      const result = await upsertMatchingProfile(userId, profileData);

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      return res.status(200).json({
        success: true,
        message: 'Matching preferences updated',
        profile: profileData
      });
    }

    // DELETE - Disable/remove matching profile
    if (req.method === 'DELETE') {
      const result = await upsertMatchingProfile(userId, {
        isActive: false,
        goals: {
          dating: false,
          investing: false,
          hiring: false,
          networking: false
        }
      });

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      return res.status(200).json({
        success: true,
        message: 'Matching profile disabled'
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('[Matching Preferences] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
