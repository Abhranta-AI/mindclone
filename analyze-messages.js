// Analyze last 100 messages for bugs
require('dotenv').config({ path: '.env.production' });

const admin = require('firebase-admin');

// Initialize Firebase Admin
let serviceAccount;
try {
  let envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (envKey && !envKey.startsWith('{')) {
    envKey = Buffer.from(envKey, 'base64').toString('utf8');
  }
  serviceAccount = JSON.parse(envKey);
} catch (e) {
  console.error('Failed to parse Firebase service account:', e.message);
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function analyzeMessages() {
  console.log('Fetching last 100 messages from all users...\n');

  const bugs = [];
  const usersSnap = await db.collection('users').get();
  let totalMessages = 0;

  for (const userDoc of usersSnap.docs) {
    const userId = userDoc.id;

    try {
      const messagesSnap = await db.collection('users').doc(userId).collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(100)
        .get();

      for (const msgDoc of messagesSnap.docs) {
        totalMessages++;
        const data = msgDoc.data();
        const content = data.content || '';
        const role = data.role;

        // Check for errors and bugs

        // 1. Error messages from assistant
        if (role === 'model' && (
          content.toLowerCase().includes('error') ||
          content.toLowerCase().includes('failed') ||
          content.toLowerCase().includes('something went wrong') ||
          content.toLowerCase().includes('cannot') ||
          content.toLowerCase().includes('unable to')
        )) {
          bugs.push({
            type: 'ERROR_RESPONSE',
            userId,
            timestamp: data.timestamp?.toDate?.()?.toISOString(),
            content: content.substring(0, 200)
          });
        }

        // 2. Empty or undefined responses
        if (role === 'model' && (!content || content.trim() === '')) {
          bugs.push({
            type: 'EMPTY_RESPONSE',
            userId,
            timestamp: data.timestamp?.toDate?.()?.toISOString(),
            content: 'Empty response'
          });
        }

        // 3. Check for tool call failures
        if (data.toolCalls && data.toolCalls.length > 0) {
          for (const tool of data.toolCalls) {
            if (tool.error || tool.status === 'failed') {
              bugs.push({
                type: 'TOOL_CALL_FAILURE',
                userId,
                timestamp: data.timestamp?.toDate?.()?.toISOString(),
                toolName: tool.name,
                error: tool.error || 'Unknown error'
              });
            }
          }
        }

        // 4. Check for malformed JSON
        if (content.includes('{') && content.includes('}')) {
          try {
            // Try to extract and parse JSON
            const jsonMatch = content.match(/\{[^{}]*\}/);
            if (jsonMatch) {
              JSON.parse(jsonMatch[0]);
            }
          } catch (e) {
            bugs.push({
              type: 'MALFORMED_JSON',
              userId,
              timestamp: data.timestamp?.toDate?.()?.toISOString(),
              content: content.substring(0, 200)
            });
          }
        }

        // 5. Check for API key exposure (security bug)
        if (content.includes('sk-') || content.includes('api_key') || content.includes('secret')) {
          bugs.push({
            type: 'POTENTIAL_SECRET_EXPOSURE',
            userId,
            timestamp: data.timestamp?.toDate?.()?.toISOString(),
            content: 'Contains potential secret key'
          });
        }

        // 6. Check for timeout messages
        if (content.toLowerCase().includes('timeout') || content.toLowerCase().includes('timed out')) {
          bugs.push({
            type: 'TIMEOUT',
            userId,
            timestamp: data.timestamp?.toDate?.()?.toISOString(),
            content: content.substring(0, 200)
          });
        }

        // 7. Check for rate limit errors
        if (content.toLowerCase().includes('rate limit') || content.toLowerCase().includes('too many requests')) {
          bugs.push({
            type: 'RATE_LIMIT',
            userId,
            timestamp: data.timestamp?.toDate?.()?.toISOString(),
            content: content.substring(0, 200)
          });
        }

        // 8. Check for authentication errors
        if (content.toLowerCase().includes('unauthorized') || content.toLowerCase().includes('authentication')) {
          bugs.push({
            type: 'AUTH_ERROR',
            userId,
            timestamp: data.timestamp?.toDate?.()?.toISOString(),
            content: content.substring(0, 200)
          });
        }
      }
    } catch (e) {
      console.error(`Error analyzing user ${userId}:`, e.message);
    }
  }

  // Print results
  console.log(`\n=== ANALYSIS COMPLETE ===`);
  console.log(`Total messages analyzed: ${totalMessages}`);
  console.log(`Total bugs found: ${bugs.length}\n`);

  // Group bugs by type
  const bugsByType = {};
  for (const bug of bugs) {
    if (!bugsByType[bug.type]) {
      bugsByType[bug.type] = [];
    }
    bugsByType[bug.type].push(bug);
  }

  // Print summary
  console.log('=== BUG SUMMARY ===\n');
  for (const [type, bugList] of Object.entries(bugsByType)) {
    console.log(`${type}: ${bugList.length} occurrences`);
  }

  // Print detailed bugs
  console.log('\n\n=== DETAILED BUG LIST ===\n');
  for (const bug of bugs) {
    console.log(`\n[${bug.type}]`);
    console.log(`User: ${bug.userId}`);
    console.log(`Time: ${bug.timestamp}`);
    if (bug.toolName) console.log(`Tool: ${bug.toolName}`);
    if (bug.error) console.log(`Error: ${bug.error}`);
    console.log(`Content: ${bug.content}`);
    console.log('---');
  }

  process.exit(0);
}

analyzeMessages().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
