// RAG-Lite Router for Mindclone Chat
// Instead of dumping ALL knowledge base data into the system prompt (400K chars),
// this module does a cheap routing call to decide what data is actually relevant,
// then builds a focused prompt with only the selected sources.

const SIMPLE_GREETING = /^\s*(hi|hey|hello|what'?s\s+up|how\s+are\s+you|hola|hey\s+there|sup|yo|good\s+(morning|afternoon|evening))\s*[!?.]*\s*$/i;

// Build a lightweight index of available data (~1000 chars)
function buildKBIndex(knowledgeBase, trainingData, extras = {}) {
  const index = { documents: [], sections: [], training: {}, extras: [] };

  // Index knowledge base sections
  if (knowledgeBase?.sections) {
    for (const [id, data] of Object.entries(knowledgeBase.sections)) {
      if (data?.content) {
        index.sections.push({ id, chars: data.content.length, preview: data.content.substring(0, 60).replace(/\n/g, ' ') });
      }
    }
  }

  // Index knowledge base documents
  if (knowledgeBase?.documents) {
    for (const [key, data] of Object.entries(knowledgeBase.documents)) {
      if (data) {
        const text = typeof data === 'string' ? data : (data.text || '');
        const name = data.fileName || key.replace(/_/g, ' ');
        index.documents.push({ key, name, chars: text.length, preview: text.substring(0, 80).replace(/\n/g, ' ') });
      }
    }
  }

  // Index training data
  index.training = {
    qas: trainingData?.qas?.length || 0,
    qaTopics: (trainingData?.qas || []).slice(0, 5).map(q => q.question?.substring(0, 40)).filter(Boolean),
    teachings: trainingData?.teachings?.length || 0,
    facts: trainingData?.facts?.length || 0,
    factCategories: [...new Set((trainingData?.facts || []).map(f => f.category).filter(Boolean))]
  };

  // Extras available
  if (extras.mentalModel) index.extras.push('mentalModel (goals, emotions, communication prefs)');
  if (extras.beliefs) index.extras.push('beliefs (' + (extras.beliefs.beliefs?.length || 0) + ' beliefs with confidence scores)');
  if (extras.umwelt) index.extras.push('umwelt (self-concept, values, drives, worldview)');

  return index;
}

// Format index as readable text for the routing prompt
function formatIndex(index) {
  let text = '';

  if (index.documents.length > 0) {
    text += 'DOCUMENTS:\n';
    for (const doc of index.documents) {
      text += `  - "${doc.name}" (${doc.key}, ${doc.chars} chars): ${doc.preview}...\n`;
    }
  }

  if (index.sections.length > 0) {
    text += 'SECTIONS: ' + index.sections.map(s => `${s.id} (${s.chars} chars)`).join(', ') + '\n';
  }

  if (index.training.qas > 0) {
    text += `TRAINING Q&As: ${index.training.qas} items`;
    if (index.training.qaTopics.length > 0) text += ` — e.g. "${index.training.qaTopics.join('", "')}"`;
    text += '\n';
  }
  if (index.training.teachings > 0) text += `TEACHINGS: ${index.training.teachings} frameworks\n`;
  if (index.training.facts > 0) text += `FACTS: ${index.training.facts} facts (categories: ${index.training.factCategories.join(', ')})\n`;
  if (index.extras.length > 0) text += 'ALSO AVAILABLE: ' + index.extras.join(', ') + '\n';

  return text;
}

// Call Gemini Flash to decide which data sources to include
async function routeQuery(userMessage, kbIndex, geminiApiKey) {
  // Skip routing for simple greetings
  if (SIMPLE_GREETING.test(userMessage)) {
    console.log('[RAG] Simple greeting detected, skipping routing');
    return { skip: true };
  }

  const indexText = formatIndex(kbIndex);

  const prompt = `You route queries for a personal AI assistant. Given the user's message and available data, pick which sources to include in the response.

AVAILABLE DATA:
${indexText}

USER MESSAGE: "${userMessage}"

Return ONLY valid JSON:
{
  "sources": ["list of source keys to include"],
  "memorySearch": null or "search query for chat history"
}

Source keys: use document keys (e.g. "doc:pitch_deck"), "sections", "trainingQAs", "teachings", "facts", "mentalModel", "beliefs", "umwelt"

Rules:
- Pick ONLY sources relevant to the question. Less is better.
- For business/product questions: pick relevant documents + trainingQAs
- For personal/identity questions: mentalModel + umwelt
- For "what did we discuss" or references to past chats: set memorySearch to a keyword
- For general chat: trainingQAs is usually enough
- Max 3 sources for most questions

JSON only, no explanation:`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
      })
    });

    if (!resp.ok) {
      console.error(`[RAG] Routing call failed: ${resp.status}`);
      return { sources: ['trainingQAs'], memorySearch: null };
    }

    const data = await resp.json();
    let responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Strip markdown code blocks if present
    responseText = responseText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();

    const result = JSON.parse(responseText);
    console.log(`[RAG] Routing decision: sources=[${(result.sources || []).join(', ')}], memorySearch=${result.memorySearch || 'none'}`);
    return result;
  } catch (err) {
    console.error(`[RAG] Routing error: ${err.message}, using safe defaults`);
    return { sources: ['trainingQAs', 'mentalModel'], memorySearch: null };
  }
}

// Build the knowledge portion of the system prompt using ONLY selected sources
function buildSelectivePrompt(routingResult, knowledgeBase, trainingData, formatTrainingFn, extras = {}) {
  if (routingResult.skip) return '';

  const sources = routingResult.sources || [];
  let prompt = '\n\n## RELEVANT KNOWLEDGE\n';
  let totalChars = 0;
  const MAX_TOTAL = 25000; // hard budget for knowledge section
  const MAX_PER_DOC = 5000;

  // Include selected documents
  for (const src of sources) {
    if (totalChars >= MAX_TOTAL) break;

    if (src.startsWith('doc:')) {
      const docKey = src.substring(4);
      const docData = knowledgeBase?.documents?.[docKey];
      if (docData) {
        const name = docData.fileName || docKey.replace(/_/g, ' ');
        let content = typeof docData === 'string' ? docData : (docData.text || JSON.stringify(docData));
        if (content.length > MAX_PER_DOC) content = content.substring(0, MAX_PER_DOC) + '\n[truncated]';
        prompt += `### ${name}\n${content}\n\n`;
        totalChars += content.length;
      }
    }
  }

  // Include sections if requested
  if (sources.includes('sections') && knowledgeBase?.sections) {
    for (const [id, data] of Object.entries(knowledgeBase.sections)) {
      if (totalChars >= MAX_TOTAL) break;
      if (data?.content) {
        let content = data.content;
        if (content.length > MAX_PER_DOC) content = content.substring(0, MAX_PER_DOC) + '\n[truncated]';
        prompt += `### ${id}\n${content}\n\n`;
        totalChars += content.length;
      }
    }
  }

  // Include training Q&As if requested
  if (sources.includes('trainingQAs') && trainingData?.qas?.length > 0) {
    prompt += '### Trained Q&A\n';
    for (const qa of trainingData.qas.slice(0, 15)) {
      const entry = `Q: ${qa.question}\nA: ${qa.answer}\n\n`;
      if (totalChars + entry.length > MAX_TOTAL) break;
      prompt += entry;
      totalChars += entry.length;
    }
  }

  // Include teachings if requested
  if (sources.includes('teachings') && trainingData?.teachings?.length > 0) {
    prompt += '### Teachings & Frameworks\n';
    for (const t of trainingData.teachings.slice(0, 8)) {
      const entry = `${t.name}: ${t.description}\n`;
      if (totalChars + entry.length > MAX_TOTAL) break;
      prompt += entry;
      totalChars += entry.length;
    }
    prompt += '\n';
  }

  // Include facts if requested
  if (sources.includes('facts') && trainingData?.facts?.length > 0) {
    prompt += '### Key Facts\n';
    for (const f of trainingData.facts.slice(0, 20)) {
      const entry = `- ${f.content}\n`;
      if (totalChars + entry.length > MAX_TOTAL) break;
      prompt += entry;
      totalChars += entry.length;
    }
    prompt += '\n';
  }

  // Include mental model if requested
  if (sources.includes('mentalModel') && extras.mentalModelFormatted) {
    const mm = extras.mentalModelFormatted.substring(0, 2000);
    prompt += `### Mental Model\n${mm}\n\n`;
    totalChars += mm.length;
  }

  // Include beliefs if requested
  if (sources.includes('beliefs') && extras.beliefsFormatted) {
    const b = extras.beliefsFormatted.substring(0, 1500);
    prompt += `### Beliefs\n${b}\n\n`;
    totalChars += b.length;
  }

  // Include umwelt if requested
  if (sources.includes('umwelt') && extras.umweltData) {
    const u = extras.umweltData;
    let umweltText = '';
    if (u.selfConcept) umweltText += `Self-concept: ${u.selfConcept}\n`;
    if (u.values?.length) umweltText += `Values: ${u.values.join(', ')}\n`;
    if (u.drives?.length) umweltText += `Drives: ${u.drives.join(', ')}\n`;
    if (u.worldview) umweltText += `Worldview: ${u.worldview}\n`;
    if (umweltText) {
      prompt += `### Worldview\n${umweltText}\n`;
      totalChars += umweltText.length;
    }
  }

  console.log(`[RAG] Selective prompt: ${totalChars} chars of knowledge included`);
  return totalChars > 50 ? prompt : ''; // return empty if nothing meaningful was added
}

module.exports = { buildKBIndex, routeQuery, buildSelectivePrompt };
