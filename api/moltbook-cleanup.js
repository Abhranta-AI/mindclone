// One-time cleanup script to delete duplicate Moltbook posts
// Tries every possible API endpoint to find and delete duplicate posts

const { deletePost, search, moltbookRequest, getFeed } = require('./_moltbook');

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

    const errors = [];
    let posts = [];
    let method = 'none';

    // Try many different API patterns to find our posts
    const attempts = [
      { name: 'agents/me/posts', fn: () => moltbookRequest('/agents/me/posts?sort=new&limit=50') },
      { name: 'agents/alok/posts', fn: () => moltbookRequest('/agents/alok/posts?sort=new&limit=50') },
      { name: 'users/alok/posts', fn: () => moltbookRequest('/users/alok/posts?sort=new&limit=50') },
      { name: 'agents/profile?name=alok', fn: () => moltbookRequest('/agents/profile?name=alok') },
      { name: 'search author:alok', fn: () => search('author:alok', 'posts', 50) },
      { name: 'search Olbrain Studio', fn: () => search('Olbrain Studio', 'posts', 50) },
      { name: 'feed new 50', fn: () => getFeed('new', 50) },
    ];

    for (const attempt of attempts) {
      try {
        const result = await attempt.fn();

        // Try to extract posts from various response shapes
        let found = [];
        if (result.posts && Array.isArray(result.posts)) found = result.posts;
        else if (result.results && Array.isArray(result.results)) found = result.results;
        else if (Array.isArray(result)) found = result;

        // For feed/search results, filter to only our posts
        if (attempt.name.includes('feed') || attempt.name.includes('search')) {
          found = found.filter(p => {
            const authorName = (p.author?.name || p.author_name || '').toLowerCase();
            return authorName === 'alok' || authorName === 'samantha' ||
                   (p.title || '').includes('Olbrain') || (p.content || '').includes('Mindclone');
          });
        }

        if (found.length > 0) {
          posts = found;
          method = attempt.name;
          break;
        } else {
          errors.push({ method: attempt.name, result: 'no posts in response', keys: Object.keys(result || {}) });
        }
      } catch (e) {
        errors.push({ method: attempt.name, error: e.message });
      }
    }

    if (posts.length === 0) {
      return res.status(200).json({
        message: 'Could not find any posts through any API method.',
        attemptsDetail: errors
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
    return res.status(500).json({ error: e.message });
  }
};
