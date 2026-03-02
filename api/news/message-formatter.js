// Message Formatter - Format articles into natural language and inject to Firestore
const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');
const { queueWhatsApp } = require('../_whatsapp');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

/**
 * Format articles into a natural language digest
 * Returns formatted message string
 */
function formatNewsDigest(articles, userProfile) {
  if (!articles || articles.length === 0) {
    return null;
  }

  // Build greeting based on number of articles
  let greeting = '';
  if (articles.length === 1) {
    greeting = "Hey! I found an interesting article for you:";
  } else if (articles.length === 2) {
    greeting = "Hey! I found a couple of interesting articles for you:";
  } else {
    greeting = `Hey! I found ${articles.length} interesting articles for you:`;
  }

  // Format each article
  const formattedArticles = articles.map((article, index) => {
    const number = index + 1;
    const title = article.title || 'Untitled';
    const url = article.url || '#';
    const source = article.source || 'Unknown Source';
    const snippet = article.snippet || '';

    // Format timestamp if available
    let timeStr = '';
    if (article.publishedDate) {
      const published = new Date(article.publishedDate);
      const now = new Date();
      const diffMs = now - published;
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHours / 24);

      if (diffHours < 1) {
        timeStr = 'Just published';
      } else if (diffHours < 24) {
        timeStr = `Published ${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
      } else if (diffDays < 7) {
        timeStr = `Published ${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
      } else {
        timeStr = `Published ${published.toLocaleDateString()}`;
      }
    }

    // Build article block
    let articleBlock = `\n${number}. **${title}**`;

    if (timeStr || source) {
      const metadata = [timeStr, source].filter(Boolean).join(' by ');
      articleBlock += `\n   ${metadata}`;
    }

    articleBlock += `\n   [Read more →](${url})`;

    // Add contextual connection to user interests
    const context = getArticleContext(article, userProfile);
    if (context) {
      articleBlock += `\n\n   ${context}`;
    }

    return articleBlock;
  }).join('\n');

  // Build closing
  const closing = "\n\nLet me know if you want me to dive deeper into any of these!";

  return `${greeting}\n${formattedArticles}${closing}`;
}

/**
 * Get contextual explanation of why article is relevant to user
 */
function getArticleContext(article, userProfile) {
  const articleText = [
    article.title || '',
    article.snippet || '',
    article.query || ''
  ].join(' ').toLowerCase();

  // Check for topic matches
  const matchedTopics = (userProfile.topics || []).filter(topic =>
    articleText.includes(topic.toLowerCase())
  ).slice(0, 2);

  // Check for entity matches
  const matchedEntities = (userProfile.entities || []).filter(entity =>
    articleText.includes(entity.toLowerCase())
  ).slice(0, 2);

  // Check for curiosity matches
  const matchedCuriosities = (userProfile.curiosities || []).filter(curiosity => {
    const curiosityWords = curiosity.toLowerCase().split(' ').filter(w => w.length > 3);
    const matchedWords = curiosityWords.filter(word => articleText.includes(word));
    return matchedWords.length >= Math.min(3, curiosityWords.length);
  }).slice(0, 1);

  // Build context string
  const contexts = [];

  if (matchedTopics.length > 0) {
    contexts.push(`This relates to your interest in ${matchedTopics.join(' and ')}`);
  }

  if (matchedEntities.length > 0) {
    contexts.push(`covers ${matchedEntities.join(' and ')}`);
  }

  if (matchedCuriosities.length > 0) {
    contexts.push(`might help with "${matchedCuriosities[0]}"`);
  }

  if (contexts.length === 0) {
    return null;
  }

  // Combine contexts into natural sentence
  if (contexts.length === 1) {
    return contexts[0] + '.';
  } else if (contexts.length === 2) {
    return contexts[0] + ' and ' + contexts[1] + '.';
  } else {
    return contexts[0] + ', ' + contexts[1] + ', and ' + contexts[2] + '.';
  }
}

/**
 * Inject message into user's Firestore messages collection
 */
async function injectMessage(userId, content, articles = []) {
  try {
    if (!content) {
      throw new Error('Content is required');
    }

    console.log(`[MessageFormatter] Injecting news digest for ${userId}`);

    // Build message data
    const messageData = {
      role: 'assistant',
      content: content,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      isPublic: false,
      messageType: 'proactive_news', // Mark as proactive news message
      metadata: {
        articles: articles.map(a => ({
          title: a.title,
          url: a.url,
          source: a.source,
          score: a.score
        })),
        generatedAt: new Date(),
        articleCount: articles.length
      }
    };

    // Save to Firestore
    const messageRef = await db.collection('users').doc(userId)
      .collection('messages').add(messageData);

    console.log(`[MessageFormatter] Message injected successfully: ${messageRef.id}`);

    // Queue WhatsApp notification with article summary
    try {
      const titles = articles.map(a => a.title).filter(Boolean).slice(0, 3);
      const whatsappMsg = `Hey! Samantha found ${articles.length} article${articles.length > 1 ? 's' : ''} for you:\n\n${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nCheck your Mindclone chat for the full digest!`;
      await queueWhatsApp(userId, whatsappMsg, 'news');
    } catch (waErr) {
      // Don't fail the whole operation if WhatsApp queuing fails
      console.log(`[MessageFormatter] WhatsApp queue failed (non-fatal): ${waErr.message}`);
    }

    return messageRef.id;

  } catch (error) {
    console.error(`[MessageFormatter] Error injecting message:`, error);
    throw error;
  }
}

/**
 * Format a single article as a short notification
 * Used for high-priority individual articles
 */
function formatSingleArticle(article, userProfile) {
  const title = article.title || 'Untitled';
  const url = article.url || '#';
  const source = article.source || 'Unknown Source';

  let message = `Hey! Just found this:\n\n**${title}**\nby ${source}\n[Read more →](${url})`;

  // Add context
  const context = getArticleContext(article, userProfile);
  if (context) {
    message += `\n\n${context}`;
  }

  message += "\n\nThought you'd find this interesting!";

  return message;
}

/**
 * Format multiple articles as a bundled digest
 * Used for medium-priority articles
 */
function formatBundledDigest(articles, userProfile) {
  if (!articles || articles.length === 0) {
    return null;
  }

  // If only 1 article, use single format
  if (articles.length === 1) {
    return formatSingleArticle(articles[0], userProfile);
  }

  // Otherwise use multi-article format
  return formatNewsDigest(articles, userProfile);
}

/**
 * Create a summary message for a batch of news
 */
function formatBatchSummary(articleCount, topicsCount) {
  return `📰 I've been keeping an eye out for news you might like. Found ${articleCount} article${articleCount > 1 ? 's' : ''} covering ${topicsCount} topic${topicsCount > 1 ? 's' : ''} you're interested in. Check them out above!`;
}

module.exports = {
  formatNewsDigest,
  formatSingleArticle,
  formatBundledDigest,
  formatBatchSummary,
  injectMessage,
  getArticleContext
};
