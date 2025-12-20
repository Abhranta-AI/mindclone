// Export Chat API - download full conversation history
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// Format chat as JSON
function formatAsJSON(messages, metadata) {
  return JSON.stringify({
    ...metadata,
    messages: messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp?.toDate?.()?.toISOString() || null,
      displayAction: msg.displayAction || null
    }))
  }, null, 2);
}

// Format chat as Markdown
function formatAsMarkdown(messages, metadata) {
  let md = `# Chat with ${metadata.ownerName}\n\n`;
  md += `**Exported:** ${new Date().toISOString()}\n`;
  md += `**Total Messages:** ${messages.length}\n\n`;
  md += `---\n\n`;

  for (const msg of messages) {
    const timestamp = msg.timestamp?.toDate?.()?.toLocaleString() || 'Unknown time';
    const speaker = msg.role === 'user' ? 'You' : metadata.ownerName;

    md += `### ${speaker} (${timestamp})\n\n`;
    md += `${msg.content}\n\n`;

    if (msg.displayAction) {
      md += `*[Displayed: ${msg.displayAction.type}]*\n\n`;
    }

    md += `---\n\n`;
  }

  return md;
}

// Format chat as plain text
function formatAsText(messages, metadata) {
  let text = `Chat with ${metadata.ownerName}\n`;
  text += `Exported: ${new Date().toISOString()}\n`;
  text += `Total Messages: ${messages.length}\n`;
  text += `${'='.repeat(60)}\n\n`;

  for (const msg of messages) {
    const timestamp = msg.timestamp?.toDate?.()?.toLocaleString() || 'Unknown time';
    const speaker = msg.role === 'user' ? 'You' : metadata.ownerName;

    text += `[${timestamp}] ${speaker}:\n`;
    text += `${msg.content}\n\n`;

    if (msg.displayAction) {
      text += `(Displayed: ${msg.displayAction.type})\n\n`;
    }
  }

  return text;
}

// Main handler
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username, visitorId, format = 'json' } = req.query;

    // Validate input
    if (!username || !visitorId) {
      return res.status(400).json({
        error: 'Missing required parameters: username and visitorId'
      });
    }

    // Validate format
    const validFormats = ['json', 'markdown', 'text'];
    if (!validFormats.includes(format)) {
      return res.status(400).json({
        error: `Invalid format. Must be one of: ${validFormats.join(', ')}`
      });
    }

    // Normalize username
    const normalizedUsername = username.trim().toLowerCase();

    // Look up username
    const usernameDoc = await db.collection('usernames').doc(normalizedUsername).get();
    if (!usernameDoc.exists) {
      return res.status(404).json({ error: 'Username not found' });
    }

    const userId = usernameDoc.data().userId;

    // Get user info for metadata
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const ownerName = userData.displayName || userData.name || username;

    // Load ALL messages (no limit)
    console.log('[ExportChat] Loading all messages for visitor:', visitorId);
    const messagesSnapshot = await db.collection('users').doc(userId)
      .collection('visitors').doc(visitorId)
      .collection('messages')
      .orderBy('timestamp', 'asc')
      .get();

    if (messagesSnapshot.empty) {
      return res.status(404).json({
        error: 'No conversation found for this visitor'
      });
    }

    const messages = messagesSnapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id
    }));

    console.log('[ExportChat] Exporting', messages.length, 'messages as', format);

    // Get visitor metadata
    const visitorDoc = await db.collection('users').doc(userId)
      .collection('visitors').doc(visitorId)
      .get();

    const visitorData = visitorDoc.exists ? visitorDoc.data() : {};

    const metadata = {
      username: username,
      ownerName: ownerName,
      visitorId: visitorId,
      exportDate: new Date().toISOString(),
      totalMessages: messages.length,
      firstMessage: messages[0]?.timestamp?.toDate?.()?.toISOString() || null,
      lastMessage: messages[messages.length - 1]?.timestamp?.toDate?.()?.toISOString() || null,
      firstVisit: visitorData.firstVisit?.toDate?.()?.toISOString() || null,
      lastVisit: visitorData.lastVisit?.toDate?.()?.toISOString() || null
    };

    // Format based on requested format
    let content, contentType, filename;

    switch (format) {
      case 'json':
        content = formatAsJSON(messages, metadata);
        contentType = 'application/json';
        filename = `chat-${username}-${visitorId}.json`;
        break;

      case 'markdown':
        content = formatAsMarkdown(messages, metadata);
        contentType = 'text/markdown';
        filename = `chat-${username}-${visitorId}.md`;
        break;

      case 'text':
        content = formatAsText(messages, metadata);
        contentType = 'text/plain';
        filename = `chat-${username}-${visitorId}.txt`;
        break;
    }

    // Set download headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return res.status(200).send(content);

  } catch (error) {
    console.error('Export chat API error:', error);
    return res.status(500).json({
      error: error?.message || 'Internal server error'
    });
  }
};
