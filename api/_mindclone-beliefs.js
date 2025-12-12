// Mindclone Belief System with Recursive Belief Revision
// Enables Mindclone to form its own beliefs, opinions, and perspectives
// Supports recursive revision when contradictions are detected

const { admin } = require('./_firebase-admin');

/**
 * Load beliefs for a user's Mindclone from Firestore
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} - Belief state or default state
 */
async function loadMindcloneBeliefs(db, userId) {
  try {
    const doc = await db.collection('users').doc(userId)
      .collection('mindcloneBeliefs').doc('current').get();

    if (doc.exists) {
      console.log(`[MindcloneBeliefs] Loaded beliefs for user ${userId}`);
      return doc.data();
    }

    console.log(`[MindcloneBeliefs] No beliefs found for user ${userId}, using default`);
    return getDefaultBeliefState();
  } catch (error) {
    console.error(`[MindcloneBeliefs] Error loading beliefs for user ${userId}:`, error.message);
    return getDefaultBeliefState();
  }
}

/**
 * Get default (empty) belief state for new users
 * @returns {Object} - Default belief state
 */
function getDefaultBeliefState() {
  return {
    beliefs: [],
    pendingRevisions: [],
    modelConfidence: 0,
    updatedAt: null
  };
}

/**
 * Generate unique belief ID
 * @returns {string} - Unique belief ID
 */
function generateBeliefId() {
  return `belief_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Form a new belief or update existing similar belief
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {string} userId - The user ID
 * @param {Object} beliefData - The belief to form
 * @param {string} beliefData.content - The belief statement
 * @param {string} beliefData.type - Type: 'factual', 'evaluative', 'predictive', 'meta'
 * @param {number} beliefData.confidence - Confidence level (0-1)
 * @param {string[]} beliefData.basis - Reasons for this belief
 * @param {string[]} beliefData.relatedTo - IDs of related beliefs (optional)
 * @returns {Promise<Object>} - Result of the operation
 */
async function formBelief(db, userId, beliefData) {
  try {
    const ref = db.collection('users').doc(userId)
      .collection('mindcloneBeliefs').doc('current');

    const doc = await ref.get();
    const currentState = doc.exists ? doc.data() : getDefaultBeliefState();

    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const now = new Date().toISOString();

    // Check for existing similar belief
    const existingIndex = findSimilarBelief(currentState.beliefs, beliefData.content);

    let updatedBeliefs = [...currentState.beliefs];
    let beliefId;

    if (existingIndex >= 0) {
      // Update existing belief
      beliefId = updatedBeliefs[existingIndex].id;
      const existingBelief = updatedBeliefs[existingIndex];

      // Add to revision history
      const revisionHistory = existingBelief.revisionHistory || [];
      revisionHistory.push({
        previousConfidence: existingBelief.confidence,
        reason: 'reinforced or refined',
        at: now
      });

      updatedBeliefs[existingIndex] = {
        ...existingBelief,
        content: beliefData.content,
        confidence: Math.min((existingBelief.confidence + beliefData.confidence) / 2 + 0.1, 1), // Boost when reinforced
        basis: [...new Set([...existingBelief.basis, ...beliefData.basis])],
        revisionHistory,
        lastRevisedAt: now,
        revisionsCount: (existingBelief.revisionsCount || 0) + 1
      };

      console.log(`[MindcloneBeliefs] Updated existing belief: ${beliefId}`);
    } else {
      // Form new belief
      beliefId = generateBeliefId();
      const newBelief = {
        id: beliefId,
        content: beliefData.content,
        type: beliefData.type || 'evaluative',
        confidence: beliefData.confidence || 0.6,
        basis: beliefData.basis || [],
        dependencies: beliefData.relatedTo || [],
        contradictions: [],
        revisionHistory: [],
        formedAt: now,
        lastRevisedAt: now,
        revisionsCount: 0
      };

      // Keep beliefs at reasonable size (max 20)
      updatedBeliefs = [newBelief, ...updatedBeliefs].slice(0, 20);
      console.log(`[MindcloneBeliefs] Formed new belief: ${beliefId}`);
    }

    // Calculate model confidence
    const modelConfidence = calculateModelConfidence(updatedBeliefs);

    // Save updated state
    await ref.set({
      beliefs: updatedBeliefs,
      pendingRevisions: currentState.pendingRevisions || [],
      modelConfidence,
      updatedAt: timestamp
    });

    // Save to history
    await db.collection('users').doc(userId)
      .collection('mindcloneBeliefs').doc('history')
      .collection('snapshots').add({
        action: 'form_belief',
        beliefId,
        content: beliefData.content,
        confidence: beliefData.confidence,
        timestamp
      });

    return {
      success: true,
      action: existingIndex >= 0 ? 'updated' : 'formed',
      beliefId,
      content: beliefData.content
    };
  } catch (error) {
    console.error(`[MindcloneBeliefs] Error forming belief:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Revise a belief based on new evidence
 * Triggers recursive revision of dependent beliefs
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {string} userId - The user ID
 * @param {Object} revisionData - The revision data
 * @param {string} revisionData.beliefId - ID of belief to revise (optional if using content)
 * @param {string} revisionData.beliefContent - Content of belief to revise (optional if using ID)
 * @param {string} revisionData.newEvidence - What changed the view
 * @param {string} revisionData.direction - 'strengthen', 'weaken', or 'reverse'
 * @param {number} revisionData.magnitude - How much to change (0-1)
 * @returns {Promise<Object>} - Result including cascade effects
 */
async function reviseBelief(db, userId, revisionData) {
  try {
    const ref = db.collection('users').doc(userId)
      .collection('mindcloneBeliefs').doc('current');

    const doc = await ref.get();
    if (!doc.exists) {
      return { success: false, error: 'No beliefs found' };
    }

    const currentState = doc.data();
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const now = new Date().toISOString();

    // Find the belief to revise
    let beliefIndex = -1;
    if (revisionData.beliefId) {
      beliefIndex = currentState.beliefs.findIndex(b => b.id === revisionData.beliefId);
    } else if (revisionData.beliefContent) {
      beliefIndex = findSimilarBelief(currentState.beliefs, revisionData.beliefContent);
    }

    if (beliefIndex < 0) {
      return { success: false, error: 'Belief not found' };
    }

    // Perform recursive revision
    const revisionResult = await performRecursiveRevision(
      currentState.beliefs,
      beliefIndex,
      revisionData,
      now
    );

    // Calculate new model confidence
    const modelConfidence = calculateModelConfidence(revisionResult.beliefs);

    // Save updated state
    await ref.set({
      beliefs: revisionResult.beliefs,
      pendingRevisions: currentState.pendingRevisions || [],
      modelConfidence,
      updatedAt: timestamp
    });

    // Save to history
    await db.collection('users').doc(userId)
      .collection('mindcloneBeliefs').doc('history')
      .collection('snapshots').add({
        action: 'revise_belief',
        primaryBeliefId: revisionResult.revisedBeliefs[0],
        cascadeCount: revisionResult.revisedBeliefs.length - 1,
        direction: revisionData.direction,
        evidence: revisionData.newEvidence,
        timestamp
      });

    console.log(`[MindcloneBeliefs] Revised ${revisionResult.revisedBeliefs.length} beliefs`);

    return {
      success: true,
      revisedBeliefs: revisionResult.revisedBeliefs,
      cascadeCount: revisionResult.revisedBeliefs.length - 1,
      removedBeliefs: revisionResult.removedBeliefs || []
    };
  } catch (error) {
    console.error(`[MindcloneBeliefs] Error revising belief:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Perform recursive belief revision with dampening
 * @param {Array} beliefs - Current beliefs array
 * @param {number} primaryIndex - Index of primary belief to revise
 * @param {Object} revisionData - Revision parameters
 * @param {string} now - Current timestamp
 * @param {Set} visited - Set of already-visited belief IDs (for cycle prevention)
 * @param {number} depth - Current recursion depth
 * @returns {Object} - Updated beliefs and list of revised belief IDs
 */
function performRecursiveRevision(beliefs, primaryIndex, revisionData, now, visited = new Set(), depth = 0) {
  const MAX_DEPTH = 3; // Prevent infinite recursion
  const DAMPENING_FACTOR = 0.5; // Each level reduces impact by half

  const updatedBeliefs = [...beliefs];
  const revisedBeliefs = [];
  const removedBeliefs = [];

  const belief = updatedBeliefs[primaryIndex];

  // Prevent cycles
  if (visited.has(belief.id)) {
    return { beliefs: updatedBeliefs, revisedBeliefs, removedBeliefs };
  }
  visited.add(belief.id);

  // Calculate confidence change based on direction and magnitude
  const magnitude = (revisionData.magnitude || 0.3) * Math.pow(DAMPENING_FACTOR, depth);
  let newConfidence = belief.confidence;

  switch (revisionData.direction) {
    case 'strengthen':
      newConfidence = Math.min(belief.confidence + magnitude, 1);
      break;
    case 'weaken':
      newConfidence = Math.max(belief.confidence - magnitude, 0);
      break;
    case 'reverse':
      newConfidence = Math.max(belief.confidence - magnitude * 2, 0);
      break;
  }

  // Update revision history
  const revisionHistory = belief.revisionHistory || [];
  revisionHistory.push({
    previousConfidence: belief.confidence,
    newConfidence,
    reason: revisionData.newEvidence,
    direction: revisionData.direction,
    depth,
    at: now
  });

  // Update contradictions list
  const contradictions = belief.contradictions || [];
  if (revisionData.direction === 'weaken' || revisionData.direction === 'reverse') {
    contradictions.push({
      evidence: revisionData.newEvidence,
      at: now
    });
  }

  // Update the belief
  updatedBeliefs[primaryIndex] = {
    ...belief,
    confidence: newConfidence,
    contradictions,
    revisionHistory,
    lastRevisedAt: now,
    revisionsCount: (belief.revisionsCount || 0) + 1
  };

  revisedBeliefs.push(belief.id);

  // Check if belief should be marked as uncertain or removed
  if (newConfidence < 0.15) {
    // Very low confidence - remove the belief
    removedBeliefs.push(belief.id);
    updatedBeliefs.splice(primaryIndex, 1);
    console.log(`[MindcloneBeliefs] Removed low-confidence belief: ${belief.id}`);
  }

  // Recursive revision of dependent beliefs (if not at max depth)
  if (depth < MAX_DEPTH && (revisionData.direction === 'weaken' || revisionData.direction === 'reverse')) {
    // Find beliefs that depend on this one
    for (let i = 0; i < updatedBeliefs.length; i++) {
      const dependentBelief = updatedBeliefs[i];
      if (dependentBelief.dependencies && dependentBelief.dependencies.includes(belief.id)) {
        // Recursively revise dependent belief with dampened magnitude
        const cascadeResult = performRecursiveRevision(
          updatedBeliefs,
          i,
          {
            ...revisionData,
            newEvidence: `Dependency "${belief.content}" was revised`,
            magnitude: magnitude * DAMPENING_FACTOR
          },
          now,
          visited,
          depth + 1
        );

        // Merge results
        revisedBeliefs.push(...cascadeResult.revisedBeliefs);
        removedBeliefs.push(...cascadeResult.removedBeliefs);
      }
    }
  }

  return {
    beliefs: updatedBeliefs,
    revisedBeliefs,
    removedBeliefs
  };
}

/**
 * Get beliefs, optionally filtered by topic
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {string} userId - The user ID
 * @param {Object} options - Filter options
 * @param {string} options.topic - Topic to filter by (optional)
 * @param {boolean} options.includeUncertain - Include low-confidence beliefs
 * @returns {Promise<Object>} - Matching beliefs
 */
async function getBeliefs(db, userId, options = {}) {
  try {
    const state = await loadMindcloneBeliefs(db, userId);

    let filteredBeliefs = state.beliefs || [];

    // Filter by confidence if not including uncertain
    if (!options.includeUncertain) {
      filteredBeliefs = filteredBeliefs.filter(b => b.confidence >= 0.3);
    }

    // Filter by topic if provided
    if (options.topic) {
      const topicLower = options.topic.toLowerCase();
      filteredBeliefs = filteredBeliefs.filter(b =>
        b.content.toLowerCase().includes(topicLower) ||
        (b.basis && b.basis.some(basis => basis.toLowerCase().includes(topicLower)))
      );
    }

    return {
      success: true,
      beliefs: filteredBeliefs,
      totalCount: state.beliefs?.length || 0,
      modelConfidence: state.modelConfidence || 0
    };
  } catch (error) {
    console.error(`[MindcloneBeliefs] Error getting beliefs:`, error.message);
    return { success: false, error: error.message, beliefs: [] };
  }
}

/**
 * Detect contradictions between new evidence and existing beliefs
 * @param {string} newEvidence - New information or statement
 * @param {Array} existingBeliefs - Array of existing beliefs
 * @returns {Array} - Array of contradiction objects
 */
function detectContradictions(newEvidence, existingBeliefs) {
  const contradictions = [];
  const evidenceLower = newEvidence.toLowerCase();

  // Simple keyword-based contradiction detection
  // In production, this could use embeddings or LLM-based analysis

  const negationPatterns = [
    { pattern: /\bnot\b/, type: 'direct_negation' },
    { pattern: /\bnever\b/, type: 'direct_negation' },
    { pattern: /\bwrong\b/, type: 'direct_negation' },
    { pattern: /\bfalse\b/, type: 'direct_negation' },
    { pattern: /\bactually\b/, type: 'correction' },
    { pattern: /\bstopped\b/, type: 'change' },
    { pattern: /\bquit\b/, type: 'change' },
    { pattern: /\bchanged\b/, type: 'change' },
    { pattern: /\bno longer\b/, type: 'change' },
    { pattern: /\bused to\b/, type: 'past_state' }
  ];

  for (const belief of existingBeliefs) {
    const beliefLower = belief.content.toLowerCase();

    // Check for topic overlap
    const beliefWords = beliefLower.split(/\s+/).filter(w => w.length > 3);
    const evidenceWords = evidenceLower.split(/\s+/).filter(w => w.length > 3);
    const overlap = beliefWords.filter(w => evidenceWords.includes(w));

    if (overlap.length >= 2) {
      // Topic overlap found - check for contradictory patterns
      for (const { pattern, type } of negationPatterns) {
        if (pattern.test(evidenceLower)) {
          contradictions.push({
            beliefId: belief.id,
            beliefContent: belief.content,
            contradictionType: type,
            strength: overlap.length / Math.max(beliefWords.length, evidenceWords.length),
            suggestedAction: type === 'change' ? 'weaken' : 'weaken'
          });
          break;
        }
      }
    }
  }

  return contradictions;
}

/**
 * Format beliefs for inclusion in system prompt
 * @param {Object} beliefState - The belief state object
 * @returns {string} - Formatted string for prompt injection
 */
function formatBeliefsForPrompt(beliefState) {
  if (!beliefState || !beliefState.beliefs || beliefState.beliefs.length === 0) {
    return '';
  }

  // Only include beliefs with decent confidence
  const significantBeliefs = beliefState.beliefs
    .filter(b => b.confidence >= 0.4)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8); // Limit to top 8 beliefs

  if (significantBeliefs.length === 0) {
    return '';
  }

  let output = '';

  for (const belief of significantBeliefs) {
    const confidenceLabel = getConfidenceLabel(belief.confidence);
    output += `- ${belief.content} [${confidenceLabel}]\n`;
  }

  return output.trim();
}

/**
 * Get human-readable confidence label
 * @param {number} confidence - Confidence value 0-1
 * @returns {string} - Label
 */
function getConfidenceLabel(confidence) {
  if (confidence >= 0.8) return 'high confidence';
  if (confidence >= 0.6) return 'moderate confidence';
  if (confidence >= 0.4) return 'tentative';
  return 'uncertain';
}

/**
 * Find similar belief in array
 * @param {Array} beliefs - Array of beliefs
 * @param {string} content - Content to match
 * @returns {number} - Index of similar belief or -1
 */
function findSimilarBelief(beliefs, content) {
  const contentLower = content.toLowerCase();
  const contentWords = new Set(contentLower.split(/\s+/).filter(w => w.length > 3));

  for (let i = 0; i < beliefs.length; i++) {
    const beliefLower = beliefs[i].content.toLowerCase();
    const beliefWords = new Set(beliefLower.split(/\s+/).filter(w => w.length > 3));

    // Calculate Jaccard similarity
    const intersection = [...contentWords].filter(w => beliefWords.has(w)).length;
    const union = new Set([...contentWords, ...beliefWords]).size;
    const similarity = intersection / union;

    if (similarity > 0.5) {
      return i;
    }
  }

  return -1;
}

/**
 * Calculate overall model confidence
 * @param {Array} beliefs - Array of beliefs
 * @returns {number} - Model confidence 0-1
 */
function calculateModelConfidence(beliefs) {
  if (!beliefs || beliefs.length === 0) return 0;

  // Average confidence weighted by number of beliefs
  const avgConfidence = beliefs.reduce((sum, b) => sum + b.confidence, 0) / beliefs.length;

  // Factor in belief count (more beliefs = more developed model)
  const countFactor = Math.min(beliefs.length / 10, 1);

  // Factor in coherence (fewer contradictions = more coherent)
  const totalContradictions = beliefs.reduce((sum, b) => sum + (b.contradictions?.length || 0), 0);
  const coherenceFactor = Math.max(1 - (totalContradictions / (beliefs.length * 2)), 0);

  return (avgConfidence * 0.5 + countFactor * 0.25 + coherenceFactor * 0.25);
}

module.exports = {
  loadMindcloneBeliefs,
  getDefaultBeliefState,
  formBelief,
  reviseBelief,
  getBeliefs,
  detectContradictions,
  formatBeliefsForPrompt
};
