// Moltbook Settings API - Configure mindclone's behavior on Moltbook
const { getMoltbookSettings, updateMoltbookSettings } = require('./_moltbook-settings');

// API handler
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const settings = await getMoltbookSettings();
      return res.status(200).json({ success: true, settings });
    }

    if (req.method === 'POST') {
      const updates = req.body;

      // Validate updates
      const allowedFields = [
        'enabled', 'objective', 'postingEnabled', 'maxPostsPerDay',
        'minHoursBetweenPosts', 'upvotingEnabled', 'maxUpvotesPerDay',
        'commentingEnabled', 'maxCommentsPerDay', 'commentProbability',
        'repliesEnabled', 'maxRepliesPerHeartbeat', 'topics', 'customPosts',
        'useDefaultPosts', 'agentName', 'agentDescription', 'humanCreator',
        'profileLink', 'commentStyle', 'includeCallToAction'
      ];

      const filteredUpdates = {};
      for (const key of allowedFields) {
        if (updates[key] !== undefined) {
          filteredUpdates[key] = updates[key];
        }
      }

      const newSettings = await updateMoltbookSettings(filteredUpdates);
      return res.status(200).json({ success: true, settings: newSettings });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('[Moltbook Settings] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
