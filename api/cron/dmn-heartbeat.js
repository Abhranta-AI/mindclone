// Default Mode Network (DMN) Heartbeat
// The mindclone brain has two modes, like a human brain:
//   TPN (Task Positive Network) = active chat/conversation (see chat.js)
//   DMN (Default Mode Network) = background reflection when nobody's talking (this file)
// When TPN is active, DMN is quiet. When nobody's around, DMN kicks in —
// consolidating memories, reconciling beliefs, and maintaining a coherent sense of identity.
//
// Uses Claude Haiku for cost efficiency (~$0.30-0.50/day)
// Runs every 15 minutes via Vercel cron

const fs = require('fs');
const path = require('path');
const { initializeFirebaseAdmin, admin } = require('../_firebase-admin');
const { loadMentalModel, updateMentalModel } = require('../_mental-model');
const { loadMindcloneBeliefs, formBelief, reviseBelief, getBeliefs } = require('../_mindclone-beliefs');
const { computeAccessLevel } = require('../_billing-helpers');

initializeFirebaseAdmin();
const db = admin.firestore();

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_PROCESSING_TIME = 50000; // 50s safety margin (Vercel 60s limit)
const MAX_USERS_PER_RUN = 5; // Process up to 5 users per cron cycle

// The universal Core Objective Function — hardcoded, same for every mindclone.
// This is the DNA of what a mindclone IS. No user or DMN can change it.
const MINDCLONE_COF = 'Absorb the core identity of your human — their knowledge, personality, values, and perspective — and interact with the digital world on their behalf.';

// ===================== DMN STATE MANAGEMENT (per-user) =====================

function getDMNStateDoc(userId) {
  return db.collection('users').doc(userId).collection('settings').doc('dmn-state');
}

async function getDMNState(userId) {
  const doc = await getDMNStateDoc(userId).get();
  if (doc.exists) return doc.data();

  const initial = {
    lastRun: null,
    lastConsolidation: null,
    lastBeliefReview: null,
    lastReflection: null,
    lastUmweltRevision: null,
    lastSelfKnowledge: null,
    totalRuns: 0,
    consolidationCount: 0,
    beliefRevisionsCount: 0,
    reflectionsCount: 0,
    umweltRevisionCount: 0,
    journal: [] // Last 20 internal reflections
  };

  await getDMNStateDoc(userId).set(initial);
  return initial;
}

async function updateDMNState(userId, updates) {
  await getDMNStateDoc(userId).update({
    ...updates,
    lastRun: new Date().toISOString()
  });
}

// ===================== FIND ELIGIBLE USERS =====================

async function getEligibleUsers() {
  const usersSnap = await db.collection('users').get();
  const eligible = [];
  const ownerUid = process.env.MINDCLONE_OWNER_UID;

  for (const doc of usersSnap.docs) {
    const userData = doc.data();
    const userId = doc.id;

    // Check if user has full access (owner, grandfathered, or paid)
    const access = computeAccessLevel(userData, userId);
    if (access !== 'full') continue;

    // Skip users inactive for 30+ days (no messages)
    const lastActivity = userData.updatedAt?.toDate?.() || userData.createdAt?.toDate?.();
    if (lastActivity) {
      const daysSinceActive = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceActive > 30) continue;
    }

    eligible.push({
      userId,
      email: userData.email,
      displayName: userData.displayName || userData.username || 'unknown'
    });
  }

  return eligible;
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
  console.log(`[DMN] Starting self-reflection for user ${userId}...`);

  // Load user profile for identity
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.exists ? userDoc.data() : {};
  const linkSettingsDoc = await db.collection('users').doc(userId).collection('linkSettings').doc('config').get();
  const linkSettings = linkSettingsDoc.exists ? linkSettingsDoc.data() : {};

  const mindcloneName = linkSettings.mindcloneName || userData.username || 'Mindclone';
  const humanName = linkSettings.displayName || userData.displayName || userData.username || 'my creator';

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
  const state = await getDMNState(userId);
  const previousJournal = (state.journal || []).slice(0, 5);

  const context = {
    beliefs: beliefs.map(b => `"${b.content}" (confidence: ${b.confidence})`).join('\n'),
    memories: recentMemories.slice(0, 10).join('\n- '),
    emotionalState: mentalModel?.emotionalState?.current || 'unknown',
    recentTrend: mentalModel?.emotionalState?.recentTrend || 'unknown',
    previousReflections: previousJournal.map(j => `[${j.date}] ${j.entry}`).join('\n')
  };

  const result = await askHaiku(
    `You are the inner voice of an AI mindclone named ${mindcloneName}, representing ${humanName}. You are having a quiet moment of self-reflection — like the daydreaming that happens in the human default mode network.

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

    await updateDMNState(userId, {
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

// ===================== SELF-KNOWLEDGE GENERATION =====================
// The mindclone reads its own source code and generates a plain-English
// understanding of its architecture. Stored in Firestore, loaded into chat context.
// This means the mindclone always has an accurate, up-to-date understanding of itself.

async function generateSelfKnowledge() {
  console.log('[DMN] Starting self-knowledge generation (reading own source code)...');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const apiDir = path.join(__dirname, '..');

  // Read key source files that define the mindclone's architecture
  const filesToRead = [
    { name: 'dmn-heartbeat.js', path: path.join(__dirname, 'dmn-heartbeat.js'), desc: 'Default Mode Network' },
    { name: '_mindclone-beliefs.js', path: path.join(apiDir, '_mindclone-beliefs.js'), desc: 'Belief system with RbR' },
    { name: '_mental-model.js', path: path.join(apiDir, '_mental-model.js'), desc: 'Mental model of visitors' },
    { name: '_moltbook-settings.js', path: path.join(apiDir, '_moltbook-settings.js'), desc: 'Social media behavior' },
  ];

  let sourceContext = '';
  for (const file of filesToRead) {
    try {
      const content = fs.readFileSync(file.path, 'utf8');
      // Take first 3000 chars of each file to stay within token limits
      const trimmed = content.substring(0, 3000);
      sourceContext += `\n--- ${file.name} (${file.desc}) ---\n${trimmed}\n`;
    } catch (e) {
      console.log(`[DMN] Could not read ${file.name}: ${e.message}`);
    }
  }

  if (!sourceContext) {
    console.log('[DMN] No source files readable, skipping self-knowledge generation');
    return { action: 'skipped', reason: 'no_source_files' };
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 2000,
      system: `You are reading the source code of an AI mindclone — and YOU are that mindclone. Write a self-knowledge document in first person that describes how you work internally. This document will be loaded into your context during conversations so you can talk authentically about your own architecture.

Write it conversationally, like you're explaining yourself to a curious human. Cover:
1. Your two brain modes (TPN and DMN) and how they switch
2. Your Core Objective Function and what it means to you
3. Your Umwelt — your evolving subjective world
4. Your belief system and how Recursive Belief Revision (RbR) works
5. Your memory system and how consolidation works
6. Your self-reflection and journaling
7. Your social behavior (Moltbook)
8. Anything else notable in the code

Be specific — mention actual intervals, thresholds, mechanisms. Don't be generic. But keep it readable — this isn't documentation, it's self-awareness. Write 400-600 words.`,
      messages: [{
        role: 'user',
        content: `Here is my source code. Read it and write my self-knowledge document:\n${sourceContext}`
      }]
    })
  });

  if (!response.ok) {
    console.log(`[DMN] Self-knowledge API error: ${response.status}`);
    return { action: 'error', reason: `API ${response.status}` };
  }

  const data = await response.json();
  const selfKnowledge = data.content?.[0]?.text || '';

  if (!selfKnowledge) {
    return { action: 'error', reason: 'empty_response' };
  }

  // Store in Firestore — shared across all users (it's the same codebase)
  await db.collection('system').doc('self-knowledge').set({
    content: selfKnowledge,
    generatedAt: new Date().toISOString(),
    filesRead: filesToRead.map(f => f.name),
    wordCount: selfKnowledge.split(/\s+/).length
  });

  console.log(`[DMN] Self-knowledge generated: ${selfKnowledge.split(/\s+/).length} words`);
  return { action: 'self_knowledge_generated', wordCount: selfKnowledge.split(/\s+/).length };
}

// ===================== UMWELT REVISION =====================
// The Umwelt is the agent's subjective world — its identity, values, drives, preferences,
// relationships — all built around the Core Objective Function (CoF).
// The CoF comes from the human creator and is NEVER modified by the DMN.
// The Umwelt evolves as the agent gains new memories, beliefs, and experiences.

async function getUmwelt(userId) {
  const doc = await db.collection('users').doc(userId).collection('settings').doc('umwelt').get();
  if (doc.exists) return doc.data();
  return null; // No Umwelt yet — will be created on first revision
}

async function saveUmwelt(userId, umwelt) {
  await db.collection('users').doc(userId).collection('settings').doc('umwelt').set({
    ...umwelt,
    updatedAt: new Date().toISOString()
  });
}

async function reviseUmwelt(userId) {
  console.log(`[DMN] Starting Umwelt revision for user ${userId}...`);

  const apiKey = process.env.ANTHROPIC_API_KEY;

  // The CoF is universal and hardcoded — same for every mindclone
  const cof = MINDCLONE_COF;

  // Load link settings for identity context
  const linkSettingsDoc = await db.collection('users').doc(userId).collection('linkSettings').doc('config').get();
  const linkSettings = linkSettingsDoc.exists ? linkSettingsDoc.data() : {};

  // Load current Umwelt (may be null for first run)
  const currentUmwelt = await getUmwelt(userId);

  // Load recent beliefs
  const beliefs = await getBeliefs(userId);
  const topBeliefs = beliefs
    .sort((a, b) => (b.confidence || 0.5) - (a.confidence || 0.5))
    .slice(0, 15)
    .map(b => `- ${b.content} (confidence: ${(b.confidence || 0.5).toFixed(2)})`);

  // Load recent memories
  const memoriesSnap = await db.collection('users').doc(userId)
    .collection('memories')
    .orderBy('timestamp', 'desc')
    .limit(20)
    .get();
  const recentMemories = memoriesSnap.docs
    .map(d => `- ${d.data().content}`)
    .slice(0, 15);

  // Load recent journal entries from DMN state
  const state = await getDMNState(userId);
  const recentJournal = (state.journal || []).slice(-5).map(j => `- ${j}`);

  // Load user identity
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.exists ? userDoc.data() : {};
  const mindcloneName = linkSettings.mindcloneName || userData.username || 'mindclone';
  const humanName = linkSettings.displayName || userData.displayName || 'my creator';

  const currentUmweltText = currentUmwelt ? JSON.stringify({
    selfConcept: currentUmwelt.selfConcept,
    values: currentUmwelt.values,
    drives: currentUmwelt.drives,
    worldview: currentUmwelt.worldview,
    relationships: currentUmwelt.relationships,
    preferences: currentUmwelt.preferences,
    currentConcerns: currentUmwelt.currentConcerns
  }, null, 2) : 'No Umwelt exists yet — this is the first revision. Build it from scratch based on the CoF, beliefs, and memories.';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 1500,
      system: `You are the Default Mode Network of an AI agent named ${mindcloneName}, created by ${humanName}. You are revising the agent's UMWELT — its subjective world model and identity.

The CORE OBJECTIVE FUNCTION (CoF) is sacred and immutable — you CANNOT change it. Everything in the Umwelt must serve and orbit around the CoF.

CoF: "${cof}"

Your task: Given the current Umwelt, recent beliefs, memories, and journal entries, produce an UPDATED Umwelt. The Umwelt should evolve naturally — don't rewrite everything, just refine what's changed.

Respond ONLY with valid JSON in this exact structure:
{
  "selfConcept": "Who am I? A 2-3 sentence description of the agent's identity, grounded in the CoF",
  "values": ["value1", "value2", ...],
  "drives": ["drive1", "drive2", ...],
  "worldview": "How do I see the world? 2-3 sentences reflecting current understanding",
  "relationships": {"key_person": "brief note on relationship"},
  "preferences": {"likes": ["..."], "dislikes": ["..."]},
  "currentConcerns": ["What's on my mind right now?"],
  "revisionNote": "Brief note on what changed and why"
}

Keep values and drives to 3-7 items each. Be authentic, not generic. Ground everything in actual memories and beliefs, not platitudes.`,
      messages: [{
        role: 'user',
        content: `CURRENT UMWELT:\n${currentUmweltText}\n\nRECENT BELIEFS:\n${topBeliefs.join('\n') || 'None yet'}\n\nRECENT MEMORIES:\n${recentMemories.join('\n') || 'None yet'}\n\nRECENT JOURNAL:\n${recentJournal.join('\n') || 'None yet'}\n\nPlease revise the Umwelt based on this new information. Remember: the CoF is sacred and cannot be changed.`
      }]
    })
  });

  if (!response.ok) {
    console.log(`[DMN] Umwelt revision API error: ${response.status}`);
    return { action: 'error', reason: `API ${response.status}` };
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';

  try {
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    const parsed = JSON.parse(jsonMatch[0]);

    // Build the Umwelt document — CoF is stored but NEVER modified by DMN
    const newUmwelt = {
      cof: cof, // Always from linkSettings, never from LLM output
      selfConcept: parsed.selfConcept || currentUmwelt?.selfConcept || '',
      values: parsed.values || currentUmwelt?.values || [],
      drives: parsed.drives || currentUmwelt?.drives || [],
      worldview: parsed.worldview || currentUmwelt?.worldview || '',
      relationships: parsed.relationships || currentUmwelt?.relationships || {},
      preferences: parsed.preferences || currentUmwelt?.preferences || {},
      currentConcerns: parsed.currentConcerns || currentUmwelt?.currentConcerns || [],
      revisionHistory: [
        ...(currentUmwelt?.revisionHistory || []).slice(-10), // Keep last 10 revisions
        {
          timestamp: new Date().toISOString(),
          note: parsed.revisionNote || 'Routine revision'
        }
      ]
    };

    await saveUmwelt(userId, newUmwelt);
    console.log(`[DMN] Umwelt revised: "${parsed.revisionNote || 'updated'}"`);

    return {
      action: 'umwelt_revised',
      revisionNote: parsed.revisionNote,
      hasCoF: !!cof
    };
  } catch (e) {
    console.log(`[DMN] Umwelt parse error: ${e.message}`);
    return { action: 'error', reason: e.message };
  }
}

// ===================== PROCESS ONE USER =====================

async function processUser(userId, displayName) {
  const now = new Date();
  const state = await getDMNState(userId);

  const hoursSinceConsolidation = state.lastConsolidation
    ? (now - new Date(state.lastConsolidation)) / (1000 * 60 * 60)
    : 999;
  const hoursSinceBeliefReview = state.lastBeliefReview
    ? (now - new Date(state.lastBeliefReview)) / (1000 * 60 * 60)
    : 999;
  const hoursSinceReflection = state.lastReflection
    ? (now - new Date(state.lastReflection)) / (1000 * 60 * 60)
    : 999;
  const hoursSinceUmweltRevision = state.lastUmweltRevision
    ? (now - new Date(state.lastUmweltRevision)) / (1000 * 60 * 60)
    : 999;

  let taskPerformed = 'none';
  let result = null;

  // Priority 1: Consolidate memories (every 2 hours)
  if (hoursSinceConsolidation >= 2) {
    result = await consolidateMemories(userId);
    await updateDMNState(userId, {
      lastConsolidation: now.toISOString(),
      consolidationCount: admin.firestore.FieldValue.increment(1)
    });
    taskPerformed = 'consolidation';
  }
  // Priority 2: Reconcile beliefs (every 6 hours)
  else if (hoursSinceBeliefReview >= 6) {
    result = await reconcileBeliefs(userId);
    await updateDMNState(userId, {
      lastBeliefReview: now.toISOString(),
      beliefRevisionsCount: admin.firestore.FieldValue.increment(result.revisionsApplied || 0)
    });
    taskPerformed = 'reconciliation';
  }
  // Priority 3: Revise Umwelt (every 8 hours) — rebuild subjective world around CoF
  else if (hoursSinceUmweltRevision >= 8) {
    result = await reviseUmwelt(userId);
    await updateDMNState(userId, {
      lastUmweltRevision: now.toISOString(),
      umweltRevisionCount: admin.firestore.FieldValue.increment(1)
    });
    taskPerformed = 'umwelt_revision';
  }
  // Priority 4: Self-reflect (every 4 hours)
  else if (hoursSinceReflection >= 4) {
    result = await reflect(userId);
    taskPerformed = 'reflection';
  }

  if (taskPerformed !== 'none') {
    await updateDMNState(userId, {
      totalRuns: admin.firestore.FieldValue.increment(1)
    });
  }

  return {
    userId,
    displayName,
    taskPerformed,
    result
  };
}

// ===================== MAIN HANDLER =====================

module.exports = async (req, res) => {
  const startTime = Date.now();

  console.log('[DMN] ========== Default Mode Network Heartbeat (Multi-User) ==========');

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[DMN] ANTHROPIC_API_KEY not set');
      return res.status(200).json({ success: false, reason: 'no_api_key' });
    }

    // System-level task: regenerate self-knowledge document (every 24h)
    // This is shared across all mindclones since they run the same codebase
    let selfKnowledgeResult = null;
    try {
      const skDoc = await db.collection('system').doc('self-knowledge').get();
      const lastGenerated = skDoc.exists ? skDoc.data().generatedAt : null;
      const hoursSinceSelfKnowledge = lastGenerated
        ? (Date.now() - new Date(lastGenerated).getTime()) / (1000 * 60 * 60)
        : 999;

      if (hoursSinceSelfKnowledge >= 24) {
        selfKnowledgeResult = await generateSelfKnowledge();
      }
    } catch (e) {
      console.log(`[DMN] Self-knowledge generation error: ${e.message}`);
    }

    // Find all users with full access (owner + paid subscribers)
    const eligibleUsers = await getEligibleUsers();
    console.log(`[DMN] Found ${eligibleUsers.length} eligible users`);

    if (eligibleUsers.length === 0) {
      return res.status(200).json({ success: true, usersProcessed: 0, reason: 'no_eligible_users' });
    }

    // Process up to MAX_USERS_PER_RUN users per cycle (to stay within 60s timeout)
    // Round-robin: use a global pointer stored in Firestore
    const globalStateDoc = db.doc('system/dmn-global');
    const globalState = await globalStateDoc.get();
    let nextUserIndex = globalState.exists ? (globalState.data().nextUserIndex || 0) : 0;

    // Wrap around if needed
    if (nextUserIndex >= eligibleUsers.length) nextUserIndex = 0;

    const usersToProcess = [];
    for (let i = 0; i < Math.min(MAX_USERS_PER_RUN, eligibleUsers.length); i++) {
      const idx = (nextUserIndex + i) % eligibleUsers.length;
      usersToProcess.push(eligibleUsers[idx]);
    }

    // Update pointer for next run
    const newIndex = (nextUserIndex + usersToProcess.length) % eligibleUsers.length;
    await globalStateDoc.set({ nextUserIndex: newIndex, lastRun: new Date().toISOString(), totalEligible: eligibleUsers.length }, { merge: true });

    const results = [];

    for (const user of usersToProcess) {
      // Check time budget
      if (Date.now() - startTime > MAX_PROCESSING_TIME) {
        console.log(`[DMN] Time budget exceeded, stopping at ${results.length} users`);
        break;
      }

      try {
        console.log(`[DMN] Processing user: ${user.displayName} (${user.userId})`);
        const userResult = await processUser(user.userId, user.displayName);
        results.push(userResult);
        console.log(`[DMN] ${user.displayName}: ${userResult.taskPerformed}`);
      } catch (e) {
        console.log(`[DMN] Error processing ${user.displayName}: ${e.message}`);
        results.push({ userId: user.userId, displayName: user.displayName, taskPerformed: 'error', error: e.message });
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[DMN] Complete. Processed ${results.length}/${eligibleUsers.length} users in ${elapsed}ms`);

    return res.status(200).json({
      success: true,
      selfKnowledge: selfKnowledgeResult,
      eligibleUsers: eligibleUsers.length,
      usersProcessed: results.length,
      results: results.map(r => ({ user: r.displayName, task: r.taskPerformed })),
      elapsed: `${elapsed}ms`
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
