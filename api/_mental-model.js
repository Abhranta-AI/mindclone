// Mental Model helper module for Artificial Theory of Mind (AToM)
// Enables Mindclone to model user's mental states: beliefs, goals, emotions, knowledge gaps

const { admin } = require('./_firebase-admin');

/**
 * Load mental model for a user from Firestore
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} - Mental model or default model
 */
async function loadMentalModel(db, userId) {
  try {
    const doc = await db.collection('users').doc(userId)
      .collection('mentalModel').doc('current').get();

    if (doc.exists) {
      console.log(`[MentalModel] Loaded model for user ${userId}`);
      return doc.data();
    }

    console.log(`[MentalModel] No model found for user ${userId}, using default`);
    return getDefaultMentalModel();
  } catch (error) {
    console.error(`[MentalModel] Error loading model for user ${userId}:`, error.message);
    return getDefaultMentalModel();
  }
}

/**
 * Update mental model with new inference
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {string} userId - The user ID
 * @param {Object} update - The update to apply
 * @param {string} update.type - Type: 'belief', 'goal', 'emotion', 'knowledge_gap'
 * @param {string} update.content - The content of the inference
 * @param {number} update.confidence - Confidence level (0-1)
 * @param {string} update.source - What led to this inference
 * @returns {Promise<Object>} - Result of the update
 */
async function updateMentalModel(db, userId, update) {
  try {
    const ref = db.collection('users').doc(userId)
      .collection('mentalModel').doc('current');

    // Get current model
    const doc = await ref.get();
    const currentModel = doc.exists ? doc.data() : getDefaultMentalModel();

    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const now = new Date().toISOString();

    // Apply update based on type
    let updatedModel = { ...currentModel };

    switch (update.type) {
      case 'belief':
        updatedModel.beliefs = addOrUpdateItem(currentModel.beliefs || [], {
          content: update.content,
          confidence: update.confidence || 0.7,
          source: update.source,
          inferredAt: now,
          category: update.category || 'general'
        });
        break;

      case 'goal':
        updatedModel.goals = addOrUpdateItem(currentModel.goals || [], {
          content: update.content,
          priority: update.priority || 'medium',
          status: 'active',
          blockers: update.blockers || [],
          inferredAt: now
        });
        break;

      case 'emotion':
        // Update emotional state
        updatedModel.emotionalState = {
          current: update.content,
          valence: update.valence !== undefined ? update.valence : 0,
          arousal: update.arousal !== undefined ? update.arousal : 0.5,
          recentTrend: calculateTrend(currentModel.emotionalState, update.valence),
          triggers: update.triggers || currentModel.emotionalState?.triggers || [],
          updatedAt: now
        };
        break;

      case 'knowledge_gap':
        updatedModel.knowledgeGaps = addOrUpdateItem(currentModel.knowledgeGaps || [], {
          topic: update.content,
          relevance: update.relevance || 'medium',
          suggestedAt: null,
          inferredAt: now
        });
        break;

      default:
        console.warn(`[MentalModel] Unknown update type: ${update.type}`);
        return { success: false, error: 'Unknown update type' };
    }

    // Update confidence based on recent updates
    updatedModel.confidence = calculateModelConfidence(updatedModel);
    updatedModel.updatedAt = timestamp;

    // Save to current
    await ref.set(updatedModel);

    // Also save snapshot to history for trajectory analysis
    await db.collection('users').doc(userId)
      .collection('mentalModel').doc('history')
      .collection('snapshots').add({
        ...update,
        timestamp: timestamp
      });

    console.log(`[MentalModel] Updated ${update.type} for user ${userId}: ${update.content}`);

    return {
      success: true,
      updated: update.type,
      content: update.content
    };
  } catch (error) {
    console.error(`[MentalModel] Error updating model for user ${userId}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Format mental model for inclusion in system prompt
 * @param {Object} model - The mental model
 * @returns {string} - Formatted string for prompt injection
 */
function formatMentalModelForPrompt(model) {
  if (!model) return '';

  let output = '';

  // Active goals
  if (model.goals?.length > 0) {
    output += `**Active Goals:**\n`;
    model.goals.slice(0, 5).forEach(g => {
      output += `- ${g.content}`;
      if (g.priority) output += ` (${g.priority} priority)`;
      if (g.blockers?.length > 0) output += ` [blockers: ${g.blockers.join(', ')}]`;
      output += '\n';
    });
    output += '\n';
  }

  // Emotional state
  if (model.emotionalState && model.emotionalState.current !== 'neutral') {
    const e = model.emotionalState;
    output += `**Emotional State:** ${e.current}`;
    if (e.recentTrend && e.recentTrend !== 'stable') {
      output += ` (trend: ${e.recentTrend})`;
    }
    if (e.triggers?.length > 0) {
      output += `\n  Triggers: ${e.triggers.join(', ')}`;
    }
    output += '\n\n';
  }

  // Key beliefs (limit to most confident/recent)
  if (model.beliefs?.length > 0) {
    output += `**Key Beliefs:**\n`;
    model.beliefs
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, 5)
      .forEach(b => {
        output += `- ${b.content}`;
        if (b.confidence >= 0.8) output += ' (high confidence)';
        output += '\n';
      });
    output += '\n';
  }

  // Knowledge gaps (high relevance only)
  const highRelevanceGaps = (model.knowledgeGaps || [])
    .filter(k => k.relevance === 'high' && !k.suggestedAt);

  if (highRelevanceGaps.length > 0) {
    output += `**Knowledge Gaps to Address:**\n`;
    highRelevanceGaps.slice(0, 3).forEach(k => {
      output += `- ${k.topic}\n`;
    });
    output += '\n';
  }

  // Communication preferences (if non-default)
  if (model.communicationPreferences) {
    const prefs = model.communicationPreferences;
    const nonDefault = [];

    if (prefs.detailLevel && prefs.detailLevel !== 'medium') {
      nonDefault.push(`detail: ${prefs.detailLevel}`);
    }
    if (prefs.responseLength && prefs.responseLength !== 'medium') {
      nonDefault.push(`length: ${prefs.responseLength}`);
    }
    if (prefs.directnessPreference > 0.7) {
      nonDefault.push('prefers directness');
    }
    if (prefs.humorAppreciation > 0.7) {
      nonDefault.push('appreciates humor');
    }

    if (nonDefault.length > 0) {
      output += `**Communication Preferences:** ${nonDefault.join(', ')}\n`;
    }
  }

  return output.trim();
}

/**
 * Get default mental model for new users
 * @returns {Object} - Default mental model
 */
function getDefaultMentalModel() {
  return {
    beliefs: [],
    goals: [],
    emotionalState: {
      current: 'neutral',
      valence: 0,        // -1 to 1 (negative to positive)
      arousal: 0.5,      // 0 to 1 (calm to excited)
      recentTrend: 'stable', // improving, stable, declining
      triggers: []
    },
    knowledgeGaps: [],
    communicationPreferences: {
      detailLevel: 'medium',     // low, medium, high
      responseLength: 'medium',  // short, medium, long
      humorAppreciation: 0.5,    // 0 to 1
      directnessPreference: 0.5  // 0 to 1
    },
    confidence: 0,
    updatedAt: null
  };
}

/**
 * Mark a knowledge gap as suggested (so we don't repeat)
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {string} userId - The user ID
 * @param {string} topic - The knowledge gap topic
 */
async function markKnowledgeGapSuggested(db, userId, topic) {
  try {
    const ref = db.collection('users').doc(userId)
      .collection('mentalModel').doc('current');

    const doc = await ref.get();
    if (!doc.exists) return;

    const model = doc.data();
    const gaps = model.knowledgeGaps || [];

    const updatedGaps = gaps.map(g => {
      if (g.topic === topic) {
        return { ...g, suggestedAt: new Date().toISOString() };
      }
      return g;
    });

    await ref.update({ knowledgeGaps: updatedGaps });
    console.log(`[MentalModel] Marked knowledge gap as suggested: ${topic}`);
  } catch (error) {
    console.error(`[MentalModel] Error marking knowledge gap:`, error.message);
  }
}

// Helper: Add or update item in array (avoid duplicates)
function addOrUpdateItem(array, newItem) {
  // Check for similar content (simple similarity check)
  const existingIndex = array.findIndex(item => {
    const existingContent = (item.content || item.topic || '').toLowerCase();
    const newContent = (newItem.content || newItem.topic || '').toLowerCase();
    return existingContent === newContent ||
           existingContent.includes(newContent) ||
           newContent.includes(existingContent);
  });

  if (existingIndex >= 0) {
    // Update existing item
    array[existingIndex] = { ...array[existingIndex], ...newItem };
    return array;
  }

  // Add new item, keep array at reasonable size
  const maxItems = 10;
  const updated = [newItem, ...array];
  return updated.slice(0, maxItems);
}

// Helper: Calculate emotional trend
function calculateTrend(previousState, newValence) {
  if (!previousState || newValence === undefined) return 'stable';

  const previousValence = previousState.valence || 0;
  const diff = newValence - previousValence;

  if (diff > 0.2) return 'improving';
  if (diff < -0.2) return 'declining';
  return 'stable';
}

// Helper: Calculate overall model confidence
function calculateModelConfidence(model) {
  let score = 0;
  let factors = 0;

  if (model.beliefs?.length > 0) {
    score += Math.min(model.beliefs.length / 5, 1) * 0.25;
    factors++;
  }
  if (model.goals?.length > 0) {
    score += Math.min(model.goals.length / 3, 1) * 0.25;
    factors++;
  }
  if (model.emotionalState?.current !== 'neutral') {
    score += 0.25;
    factors++;
  }
  if (model.knowledgeGaps?.length > 0) {
    score += Math.min(model.knowledgeGaps.length / 3, 1) * 0.25;
    factors++;
  }

  return factors > 0 ? score : 0;
}

module.exports = {
  loadMentalModel,
  updateMentalModel,
  formatMentalModelForPrompt,
  getDefaultMentalModel,
  markKnowledgeGapSuggested
};
