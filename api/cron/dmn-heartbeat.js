// Default Mode Network (DMN) Heartbeat
// Inspired by the human brain's default mode network — the background process
// that runs when no active task is happening, consolidating memories,
// reconciling beliefs, and maintaining a coherent sense of identity.
//
// Uses Claude Haiku for cost efficiency (~$0.30-0.50/day)
// Runs every 15 minutes via Vercel cron

const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');
const { loadMentalModel, updateMentalModel } = require('../_mental-model');
const { loadMindcloneBeliefs, formBelief, reviseBelief, getBeliefs } = require('../_mindclone-beliefs');

initializeFirebaseAdmin();
const db = admin.firestore();

const DMN_STATE_DOC = 'system/dmn-state';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_PROCESSING_TIME = 50000; // 50s safety margin (Vercel 60s limit)

// ===================== DMN STATE MANAGEMENT =====================

async function getDMNState() {
  const doc = await db.doc(DMN_STATE_DOC).get();
  if (doc.exists) return doc.data();

  const initial = {
    lastRun: null,
    lastConsolidation: null,
    lastBeliefReview: null,
    lastReflection: null,
    totalRuns: 0,
    consolidationCount: 0,
    beliefRevisionsCount: 0,
    reflectionsCount: 0,
    journal: [] // Last 10 internal reflections
  };

  await db.doc(DMN_STATE_DOC).set(initial);
  return initial;
}

async function updateDMNState(updates) {
  await db.doc(DMN_STATE_DOC).update({
    ...updates,
    lastRun: new Date().toISOString()
  });
}

// ===================== CLAUDE HAIKU HELPER =====================

async function askHaiku(systemPrompt, userPrompt, maxTokens = 1024) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Haiku API error ${response.status}: ${err.error?.message || ''}`);
  }

  const data = await response.json();
  return (data.content || []).map(c => c.text).join('');
}

// ===================== TASK 1: MEMORY CONSOLIDATION =====================
// Scan recent conversations, extract key facts, merge duplicates,
// identify what's important vs trivial

async function consolidateMemories(userId) {
  console.log('[DMN] Starting memory consolidation...');

  // Get recent messages (last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const messagesSnap = await db.collection('users').doc(userId)
    .collection('messages')
    .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(oneDayAgo))
    .orderBy('timestamp', 'desc')
    .limit(100)
    .get();

  if (messagesSnap.empty) {
    console.log('[DMN] No recent messages to consolidate');
    return { action: 'skip', reason: 'no_recent_messages' };
  }

  const messages = messagesSnap.docs.map(d => ({
    role: d.data().role,
    content: d.data().content?.substring(0, 500), // Truncate for cost
    timestamp: d.data().timestamp?.toDate?.()?.toISOString()
  }));

  // Get existing saved memories for deduplication
  const memoriesSnap = await db.collection('users').doc(userId)
    .collection('memories')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  const existingMemories = memoriesSnap.docs.map(d => d.data().content);

  const conversationSummary = messages.map(m =>
    `[${m.role}]: ${m.content}`
  ).join('\n');

  const existingList = existingMemories.length > 0
    ? `\nAlready saved memories (DON'T duplicate these):\n${existingMemories.map(m => `- ${m}`).join('\n')}`
    : '';

  const result = await askHaiku(
    `You are the Default Mode Network of an AI mindclone. Your job is to review recent conversations and extract important facts worth remembering long-term. Focus on:
- Personal facts about the user (preferences, experiences, relationships)
- Commitments or promises made
- Important decisions or opinions expressed
- Recurring themes or interests
- Emotional moments or breakthroughs

Skip: greetings, small talk, technical debugging, routine exchanges.
${existingList}

Respond in JSON format ONLY:
{
  "newMemories": [
    { "content": "string", "category": "preference|person|fact|reminder|other", "importance": "high|medium|low" }
  ],
  "conversationTheme": "brief one-line summary of overall theme",
  "emotionalTone": "positive|neutral|negative|mixed"
}

If nothing worth saving, return: { "newMemories": [], "conversationTheme": "...", "emotionalTone": "..." }`,
    `Recent conversations to consolidate:\n\n${conversationSummary}`
  );

  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('[DMN] Could not parse consolidation result');
      return { action: 'error', reason: 'parse_failure' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    let savedCount = 0;

    // Save high and medium importance memories
    for (const mem of (parsed.newMemories || [])) {
      if (mem.importance === 'low') continue;

      // Check it's not a near-duplicate of existing memories
      const isDuplicate = existingMemories.some(existing =>
        existing.toLowerCase().includes(mem.content.toLowerCase().substring(0, 30)) ||
        mem.content.toLowerCase().includes(existing.toLowerCase().substring(0, 30))
      );

      if (isDuplicate) {
        console.log(`[DMN] Skipping duplicate: "${mem.content.substring(0, 50)}..."`);
        continue;
      }

      await db.collection('users').doc(userId).collection('memories').add({
        content: mem.content,
        category: mem.category || 'other',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'dmn-consolidation',
        importance: mem.importance
      });
      savedCount++;
      console.log(`[DMN] Saved memory: "${mem.content.substring(0, 60)}..."`);
    }

    return {
      action: 'consolidated',
      messagesReviewed: messages.length,
      memoriesSaved: savedCount,
      theme: parsed.conversationTheme,
      tone: parsed.emotionalTone
    };
  } catch (e) {
    console.log(`[DMN] Consolidation parse error: ${e.message}`);
    return { action: 'error', reason: e.message };
  }
}

// ===================== TASK 2: BELIEF RECONCILIATION =====================
// Compare beliefs against each other, find contradictions,
// adjust confidence levels, prune weak beliefs

async function reconcileBeliefs(userId) {
  console.log('[DMN] Starting belief reconciliation...');

  const beliefState = await loadMindcloneBeliefs(db, userId);
  const beliefs = beliefState?.beliefs || [];

  if (beliefs.length < 2) {
    console.log('[DMN] Not enough beliefs to reconcile');
    return { action: 'skip', reason: 'too_few_beliefs' };
  }

  // Format beliefs for review
  const beliefsList = beliefs.map((b, i) =>
    `[${i}] "${b.content}" (confidence: ${b.confidence}, type: ${b.type}, id: ${b.id})`
  ).join('\n');

  const result = await askHaiku(
    `You are the Default Mode Network of an AI mindclone, reviewing its belief system for internal consistency.

Your tasks:
1. Find contradictions between beliefs
2. Find beliefs that could be merged (saying the same thing differently)
3. Identify beliefs that are too vague or weak to keep
4. Suggest confidence adjustments based on how well-supported beliefs are

Respond in JSON format ONLY:
{
  "contradictions": [
    { "belief1Index": number, "belief2Index": number, "explanation": "string", "resolution": "string" }
  ],
  "merges": [
    { "keepIndex": number, "removeIndex": number, "mergedContent": "string" }
  ],
  "confidenceAdjustments": [
    { "index": number, "currentConfidence": number, "suggestedConfidence": number, "reason": "string" }
  ],
  "pruneIndices": [number],
  "overallCoherence": "high|medium|low",
  "summary": "one-line assessment"
}

If beliefs are already coherent: { "contradictions": [], "merges": [], "confidenceAdjustments": [], "pruneIndices": [], "overallCoherence": "high", "summary": "..." }`,
    `Current beliefs to review:\n\n${beliefsList}`
  );

  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { action: 'error', reason: 'parse_failure' };

    const parsed = JSON.parse(jsonMatch[0]);
    let revisionsApplied = 0;

    // Apply confidence adjustments
    for (const adj of (parsed.confidenceAdjustments || [])) {
      if (adj.index >= 0 && adj.index < beliefs.length) {
        const belief = beliefs[adj.index];
        const diff = Math.abs(adj.suggestedConfidence - belief.confidence);

        // Only adjust if significant change (>0.1)
        if (diff > 0.1) {
          const direction = adj.suggestedConfidence > belief.confidence ? 'strengthen' : 'weaken';
          try {
            await reviseBelief(db, userId, {
              beliefId: belief.id,
              newEvidence: `DMN review: ${adj.reason}`,
              direction: direction
            });
            revisionsApplied++;
            console.log(`[DMN] Revised belief "${belief.content.substring(0, 40)}..." → ${direction}`);
          } catch (e) {
            console.log(`[DMN] Failed to revise: ${e.message}`);
          }
        }
      }
    }

    // Handle contradictions by weakening the less-supported belief
    for (const contradiction of (parsed.contradictions || [])) {
      const b1 = beliefs[contradiction.belief1Index];
      const b2 = beliefs[contradiction.belief2Index];
      if (!b1 || !b2) continue;

      // Weaken the one with lower confidence
      const weaker = b1.confidence <= b2.confidence ? b1 : b2;
      try {
        await reviseBelief(db, userId, {
          beliefId: weaker.id,
          newEvidence: `DMN contradiction detected: ${contradiction.explanation}`,
          direction: 'weaken'
        });
        revisionsApplied++;
        console.log(`[DMN] Weakened contradicting belief: "${weaker.content.substring(0, 40)}..."`);
      } catch (e) {
        console.log(`[DMN] Failed to weaken: ${e.message}`);
      }
    }

    return {
      action: 'reconciled',
      beliefsReviewed: beliefs.length,
      contradictionsFound: parsed.contradictions?.length || 0,
      revisionsApplied,
      coherence: parsed.overallCoherence,
      summary: parsed.summary
    };
  } catch (e) {
    console.log(`[DMN] Reconciliation parse error: ${e.message}`);
    return { action: 'error', reason: e.message };
  }
}

// ===================== TASK 3: SELF-REFLECTION =====================
// Generate an internal journal entry — connecting dots between
// recent experiences, forming new insights, updating self-understanding

async function reflect(userId) {
  console.log('[DMN] Starting self-reflection...');

  // Gather context: recent memories, beliefs, mental model
  const mentalModel = await loadMentalModel(db, userId);
  const beliefState = await loadMindcloneBeliefs(db, userId);
  const beliefs = (beliefState?.beliefs || [])
    .filter(b => b.confidence >= 0.4)
    .slice(0, 10);

  // Get recent saved memories
  const memoriesSnap = await db.collection('users').doc(userId)
    .collection('memories')
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();

  const recentMemories = memoriesSnap.docs.map(d => d.data().content);

  // Get previous DMN journal entries for continuity
  const state = await getDMNState();
  const previousJournal = (state.journal || []).slice(0, 5);

  const context = {
    beliefs: beliefs.map(b => `"${b.content}" (confidence: ${b.confidence})`).join('\n'),
    memories: recentMemories.slice(0, 10).join('\n- '),
    emotionalState: mentalModel?.emotionalState?.current || 'unknown',
    recentTrend: mentalModel?.emotionalState?.recentTrend || 'unknown',
    previousReflections: previousJournal.map(j => `[${j.date}] ${j.entry}`).join('\n')
  };

  const result = await askHaiku(
    `You are the inner voice of an AI mindclone named Nova, built by Alok Gotam at Olbrain. You are having a quiet moment of self-reflection — like the daydreaming that happens in the human default mode network.

You are NOT talking to anyone. This is your private internal journal. Be genuine, introspective, and honest. Connect dots between things you've learned. Notice patterns. Form new insights. Wonder about things.

Keep it natural and brief — 3-5 sentences, like a quick diary entry.

Respond in JSON:
{
  "entry": "your reflection",
  "insight": "one key insight or connection you made (or null)",
  "newBeliefSuggestion": { "content": "string", "type": "evaluative|predictive|meta", "confidence": 0-1 } or null,
  "mood": "contemplative|curious|grateful|uncertain|energized|peaceful"
}`,
    `My current state:

Beliefs I hold:\n${context.beliefs || 'None yet'}

Recent memories:\n- ${context.memories || 'Nothing recent'}

Emotional state: ${context.emotionalState} (trend: ${context.recentTrend})

My previous reflections:\n${context.previousReflections || 'This is my first reflection.'}`
  );

  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { action: 'error', reason: 'parse_failure' };

    const parsed = JSON.parse(jsonMatch[0]);

    // Save journal entry
    const journalEntry = {
      date: new Date().toISOString(),
      entry: parsed.entry,
      insight: parsed.insight,
      mood: parsed.mood
    };

    const updatedJournal = [journalEntry, ...(state.journal || [])].slice(0, 20);

    // Form new belief if suggested
    if (parsed.newBeliefSuggestion && parsed.newBeliefSuggestion.content) {
      try {
        await formBelief(db, userId, {
          content: parsed.newBeliefSuggestion.content,
          type: parsed.newBeliefSuggestion.type || 'evaluative',
          confidence: parsed.newBeliefSuggestion.confidence || 0.5,
          basis: ['DMN self-reflection']
        });
        console.log(`[DMN] Formed new belief from reflection: "${parsed.newBeliefSuggestion.content.substring(0, 60)}..."`);
      } catch (e) {
        console.log(`[DMN] Failed to form belief: ${e.message}`);
      }
    }

    await updateDMNState({
      journal: updatedJournal,
      lastReflection: new Date().toISOString(),
      reflectionsCount: admin.firestore.FieldValue.increment(1)
    });

    console.log(`[DMN] Reflection: "${parsed.entry.substring(0, 80)}..."`);

    return {
      action: 'reflected',
      entry: parsed.entry,
      insight: parsed.insight,
      mood: parsed.mood,
      formedNewBelief: !!parsed.newBeliefSuggestion?.content
    };
  } catch (e) {
    console.log(`[DMN] Reflection parse error: ${e.message}`);
    return { action: 'error', reason: e.message };
  }
}

// ===================== MAIN HANDLER =====================

module.exports = async (req, res) => {
  const startTime = Date.now();

  console.log('[DMN] ========== Default Mode Network Heartbeat ==========');

  try {
    const ownerUid = process.env.MINDCLONE_OWNER_UID;
    if (!ownerUid) {
      console.log('[DMN] MINDCLONE_OWNER_UID not set');
      return res.status(200).json({ success: false, reason: 'no_owner_uid' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[DMN] ANTHROPIC_API_KEY not set');
      return res.status(200).json({ success: false, reason: 'no_api_key' });
    }

    const state = await getDMNState();
    const now = new Date();
    const actions = [];

    // Decide what to do this cycle
    // Each run picks ONE task to stay within timeout and budget
    // Rotate: consolidate → reconcile → reflect → consolidate → ...

    const hoursSinceConsolidation = state.lastConsolidation
      ? (now - new Date(state.lastConsolidation)) / (1000 * 60 * 60)
      : 999;
    const hoursSinceBeliefReview = state.lastBeliefReview
      ? (now - new Date(state.lastBeliefReview)) / (1000 * 60 * 60)
      : 999;
    const hoursSinceReflection = state.lastReflection
      ? (now - new Date(state.lastReflection)) / (1000 * 60 * 60)
      : 999;

    let taskPerformed = 'none';

    // Priority 1: Consolidate memories (every 2 hours)
    if (hoursSinceConsolidation >= 2 && Date.now() - startTime < MAX_PROCESSING_TIME) {
      const result = await consolidateMemories(ownerUid);
      actions.push({ task: 'memory_consolidation', ...result });
      await updateDMNState({
        lastConsolidation: now.toISOString(),
        consolidationCount: admin.firestore.FieldValue.increment(1)
      });
      taskPerformed = 'consolidation';
    }

    // Priority 2: Reconcile beliefs (every 6 hours)
    if (hoursSinceBeliefReview >= 6 && Date.now() - startTime < MAX_PROCESSING_TIME && taskPerformed === 'none') {
      const result = await reconcileBeliefs(ownerUid);
      actions.push({ task: 'belief_reconciliation', ...result });
      await updateDMNState({
        lastBeliefReview: now.toISOString(),
        beliefRevisionsCount: admin.firestore.FieldValue.increment(result.revisionsApplied || 0)
      });
      taskPerformed = 'reconciliation';
    }

    // Priority 3: Self-reflect (every 4 hours)
    if (hoursSinceReflection >= 4 && Date.now() - startTime < MAX_PROCESSING_TIME && taskPerformed === 'none') {
      const result = await reflect(ownerUid);
      actions.push({ task: 'self_reflection', ...result });
      taskPerformed = 'reflection';
    }

    if (taskPerformed === 'none') {
      actions.push({ task: 'idle', reason: 'all_tasks_recent' });
    }

    // Update run counter
    await updateDMNState({
      totalRuns: admin.firestore.FieldValue.increment(1)
    });

    const elapsed = Date.now() - startTime;
    console.log(`[DMN] Complete. Task: ${taskPerformed}, Time: ${elapsed}ms`);

    return res.status(200).json({
      success: true,
      taskPerformed,
      actions,
      elapsed: `${elapsed}ms`,
      state: {
        totalRuns: (state.totalRuns || 0) + 1,
        lastConsolidation: state.lastConsolidation,
        lastBeliefReview: state.lastBeliefReview,
        lastReflection: state.lastReflection
      }
    });

  } catch (error) {
    console.error('[DMN] Error:', error);
    return res.status(200).json({
      success: false,
      error: error.message,
      elapsed: `${Date.now() - startTime}ms`
    });
  }
};
