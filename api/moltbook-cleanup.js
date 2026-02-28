// One-time cleanup script to delete duplicate Moltbook posts
// Hit: /api/moltbook-cleanup?test=true to preview
// Hit: /api/moltbook-cleanup?delete=true to actually delete

const { getMyPosts, deletePost, search, moltbookRequest } = require('./_moltbook');

module.exports = async (req, res) => {
  try {
    // Load API key from credentials if needed
    if (!process.env.MOLTBOOK_API_KEY) {
      try {
        const path = require('path');
        const fs = require('fs');
        const credPath = path.join(__dirname, '..', 'moltbook-credentials.json');
        const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        if (creds.agent && creds.agent.api_key) {
          process.env.MOLTBOOK_API_KEY = creds.agent.api_key;
        }
      } catch (e) {
        return res.status(500).json({ error: 'Could not load Moltbook credentials', detail: e.message });
      }
    }

    // Try multiple methods to get our posts
    let posts = [];
    let method = 'unknown';

    // Method 1: getMyPosts
    try {
      const result = await getMyPosts('new', 50);
      if (result.posts && result.posts.length > 0) {
        posts = result.posts;
        method = 'getMyPosts';
      } else if (Array.isArray(result) && result.length > 0) {
        posts = result;
        method = 'getMyPosts (array)';
      }
    } catch (e) {
      console.log(`[Cleanup] getMyPosts failed: ${e.message}`);
    }

    // Method 2: search fallback
    if (posts.length === 0) {
      try {
        const searchResult = await search('author:alok', 'posts', 50);
        if (searchResult.posts && searchResult.posts.length > 0) {
          posts = searchResult.posts;
          method = 'search';
        } else if (searchResult.results && searchResult.results.length > 0) {
          posts = searchResult.results;
          method = 'search (results)';
        }
      } catch (e) {
        console.log(`[Cleanup] search fallback failed: ${e.message}`);
      }
    }

    // Method 3: direct API call to user's posts
    if (posts.length === 0) {
      try {
        const result = await moltbookRequest('/agents/me/posts?sort=new&limit=50');
        if (result.posts) posts = result.posts;
        else if (Array.isArray(result)) posts = result;
        method = 'direct API';
      } catch (e) {
        console.log(`[Cleanup] direct API failed: ${e.message}`);
      }
    }

    if (posts.length === 0) {
      return res.status(200).json({
        message: 'Could not fetch posts from Moltbook. All methods failed.',
        hint: 'The Moltbook API may not support fetching own posts, or the API key may be invalid.'
      });
    }

    // Find duplicates: group by title, keep the oldest of each title
    const titleGroups = {};
    for (const post of posts) {
      const title = (post.title || '').trim();
      if (!titleGroups[title]) titleGroups[title] = [];
      titleGroups[title].push(post);
    }

    const toDelete = [];
    const toKeep = [];

    for (const [title, group] of Object.entries(titleGroups)) {
      if (group.length > 1) {
        // Sort by creation time ascending, keep the first one
        group.sort((a, b) => new Date(a.created_at || a.createdAt || 0) - new Date(b.created_at || b.createdAt || 0));
        toKeep.push({ id: group[0].id, title, created: group[0].created_at || group[0].createdAt });
        for (let i = 1; i < group.length; i++) {
          toDelete.push({ id: group[i].id, title, created: group[i].created_at || group[i].createdAt });
        }
      } else {
        toKeep.push({ id: group[0].id, title, created: group[0].created_at || group[0].createdAt });
      }
    }

    // Preview mode (default)
    if (req.query.delete !== 'true') {
      return res.status(200).json({
        mode: 'PREVIEW — add ?delete=true to actually delete',
        fetchMethod: method,
        totalPosts: posts.length,
        duplicatesToDelete: toDelete.length,
        postsToKeep: toKeep.length,
        willDelete: toDelete,
        willKeep: toKeep
      });
    }

    // Delete mode
    const results = [];
    for (const post of toDelete) {
      try {
        await deletePost(post.id);
        results.push({ id: post.id, title: post.title, status: 'deleted' });
      } catch (e) {
        results.push({ id: post.id, title: post.title, status: 'error', error: e.message });
      }
    }

    return res.status(200).json({
      mode: 'DELETE',
      deleted: results.filter(r => r.status === 'deleted').length,
      errors: results.filter(r => r.status === 'error').length,
      results
    });

  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack?.split('\n').slice(0, 3) });
  }
};
