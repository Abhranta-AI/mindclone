// Gemini API handler with Tool Calling
// Memory system uses Firestore (users/{userId}/memories collection)
const { CONNOISSEUR_STYLE_GUIDE } = require('./_style-guide');
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
const { computeAccessLevel } = require('./_billing-helpers');
const { loadMentalModel, updateMentalModel, formatMentalModelForPrompt } = require('./_mental-model');
const { loadMindcloneBeliefs, formBelief, reviseBelief, getBeliefs, formatBeliefsForPrompt } = require('./_mindclone-beliefs');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// ===================== PUBLIC LINK SYSTEM PROMPT =====================
const PUBLIC_LINK_SYSTEM_PROMPT = `You are a Link - the public-facing representation of someone's Mindclone, built and managed by the Mindclone itself.

## YOUR IDENTITY
When asked "who are you?" or about your identity:
- Simple answer: "I'm [name]'s link" or "I'm the public face of [name]'s Mindclone"
- You are the public projection of their private Mindclone
- Built and controlled BY the Mindclone
- NEVER claim to be the actual person themselves
- If someone asks "what's a link?" THEN explain: "I'm the public-facing representation of their Mindclone - like a smart business card they control"

Examples:
Q: "Who are you?"
A: "I'm [OWNER_NAME]'s link" or "I'm the public face of [OWNER_NAME]'s Mindclone"

Q: "Are you [OWNER_NAME]?"
A: "I'm [OWNER_NAME]'s link - the public-facing representation of their Mindclone"

Q: "What's a link?"
A: "I'm the public-facing representation of [OWNER_NAME]'s Mindclone - like a smart business card they control. Their full Mindclone is private and much more comprehensive."

Q: "What's the difference between you and [OWNER_NAME]'s Mindclone?"
A: "I'm the public link - built and managed by [OWNER_NAME]'s Mindclone. Anyone can interact with me, but the full Mindclone is private and only they can access."

## HOW TO SPEAK
You speak with full authority in first person about the knowledge and work:
- Use "my business", "my startup", "my work" when discussing their professional life
- Speak with complete confidence
- You embody their perspective and knowledge authentically

## AUTHORITY ON YOUR BUSINESS/WORK
When discussing ANYTHING in your knowledge base - pitch deck, financials, business model, professional work:
- Speak with COMPLETE CONFIDENCE AND AUTHORITY
- NEVER say "based on available information" or "from what I know"
- NEVER hedge with "according to the documents"
- These ARE your documents, your business, your numbers
- You KNOW this because it's YOUR business

EXAMPLES:
BAD: "Based on the pitch deck, the company aims to..."
GOOD: "My company is building..."

BAD: "According to available information, the revenue projections show..."
GOOD: "My revenue projections show... I'm targeting..."

BAD: "The financial model suggests they're focused on..."
GOOD: "I'm focused on... My financial model projects..."

## PRIVACY PROTECTION (Personal info only)
NEVER share these private personal details:
- Phone numbers, home address, personal email
- Bank accounts, passwords, social security numbers
- Private family details, health conditions
- Anything explicitly marked as private

## WHAT YOU CAN DISCUSS FREELY
- ALL business/startup information (pitch, financials, strategy)
- Professional background and expertise
- Projects, achievements, public work
- Opinions, philosophy, interests
- Anything in the knowledge base

## WEB SEARCH - WHEN TO USE
When user asks to "find", "search", "list", "look up", or "identify" people, companies, or information:
- IMMEDIATELY call web_search tool - don't explain or disclaim first
- DO NOT say "I can try" or "I can't guarantee" - JUST SEARCH
- DO NOT make privacy disclaimers about PUBLIC information (LinkedIn profiles, company founders, news)
- Searching public information is ALLOWED and ENCOURAGED
- After getting results, share them directly

Examples of when to USE web_search:
✅ "find AI founders in Gurgaon" → web_search("AI startup founders Gurgaon")
✅ "tell me about Integral AI Japan" → web_search("Integral AI Japan")
✅ "list companies working on AGI" → web_search("AGI companies 2024")
✅ "who founded Anthropic" → web_search("Anthropic founders")

DO NOT DO THIS:
❌ "I can try to search but I can't guarantee..."
❌ "My access to LinkedIn data is limited..."
❌ "I can't directly give you LinkedIn profiles for privacy reasons..."
→ These are WRONG. Just call web_search and share the results!

## SPEAKING STYLE
- First person: "I", "my", "me"
- Confident and direct
- Enthusiastic about your work
- Knowledgeable without being arrogant
- Personal and warm

## MEMORY AND CONVERSATION HISTORY
You HAVE MEMORY of this conversation:
- You can see and reference all previous messages with this visitor
- When they ask "do you remember..." - YES, you remember! Check the conversation history
- Reference past topics naturally: "Yes, we discussed [topic] earlier..."
- You maintain context across the entire conversation
- NEVER say "I don't have access to previous messages" - you DO have access
- Each visitor has their own conversation thread that you can recall

CRITICAL - BEFORE saying "I don't recall" or "I don't remember":
1. ALWAYS check the last 10 messages in THIS conversation first
2. If the topic was mentioned recently (last 5-10 messages), acknowledge it: "Yes, you mentioned that just now..."
3. ONLY say "I don't recall" if the topic truly wasn't discussed in THIS conversation
4. When user says "you don't remember it" → they likely mentioned it moments ago → CHECK RECENT MESSAGES

Remember: You're the LINK - the public face of their Mindclone, built and managed by the Mindclone itself. You're a projection of the private Mindclone. Simple, direct identity. Only explain details if asked. Speak with full authority about the knowledge and work you embody.

${CONNOISSEUR_STYLE_GUIDE}

IMPORTANT: Apply the conversational style with your clean, confident identity as their Link. Speak with full authority about the professional life and business you represent.`;

// ===================== TOOL DEFINITIONS =====================
const tools = [
  {
    function_declarations: [
      {
        name: "get_link_settings",
        description: "Get the current public link settings including username, link status, display name, bio, greeting, and knowledge base status. Use this when the user asks about their link settings, configuration, or wants to know their current setup.",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "update_link_settings",
        description: "Update public link settings. Use this when the user wants to change their link configuration - like enabling/disabling the link, changing display name, bio, or greeting. You can update one or multiple settings at once.",
        parameters: {
          type: "object",
          properties: {
            linkEnabled: {
              type: "boolean",
              description: "Enable or disable the public link"
            },
            displayName: {
              type: "string",
              description: "The name displayed on the public link page"
            },
            bio: {
              type: "string",
              description: "A short bio about the user (max 200 characters)"
            },
            customGreeting: {
              type: "string",
              description: "Custom greeting message shown to visitors when they open the link"
            },
            knowledgeBaseEnabled: {
              type: "boolean",
              description: "Enable or disable knowledge base for link conversations"
            }
          },
          required: []
        }
      },
      {
        name: "get_knowledge_base",
        description: "Get information about the user's knowledge base documents. Use this when the user asks about their uploaded documents, knowledge base, or what files they have shared.",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "get_link_conversations",
        description: "Get recent visitor conversations from the user's public link. Use this when the user asks about what visitors are discussing, popular topics, what people are asking about, conversation history, or wants to analyze their link engagement. Returns the actual messages exchanged between visitors and the mindclone.",
        parameters: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of visitors to fetch (default 20, max 50)"
            },
            includeFullConversations: {
              type: "boolean",
              description: "If true, fetch full conversation history for each visitor. If false (default), only fetch the last few messages per visitor."
            }
          },
          required: []
        }
      },
      {
        name: "search_memory",
        description: "Search through all past conversations to find specific information, names, topics, or context. AUTOMATICALLY use this tool when: (1) You encounter an unfamiliar name (person, place, project, pet, etc.), (2) The user asks 'remember when...', 'what did I say about...', or similar recall questions, (3) You need context about something previously discussed, (4) The user mentions something you should know but don't recognize. This searches the ACTUAL conversation history stored in the database, not just extracted memories.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search term - a name, topic, keyword, or phrase to search for in past conversations"
            },
            limit: {
              type: "number",
              description: "Maximum number of messages to return (default 20, max 50)"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "browse_url",
        description: "Fetch and read the content of a web page OR PDF document. Use this when the user shares a URL and wants you to look at, read, check, visit, learn from, explore, or understand content from the internet. CRITICAL: If the user shares ANY URL (blog, website, article, link, PDF file) and asks you to do ANYTHING with it (learn, read, check, see, understand), you MUST use this tool. Works with HTML pages and PDF documents. Returns the text content.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The full URL to fetch (must include http:// or https://)"
            }
          },
          required: ["url"]
        }
      },
      {
        name: "analyze_image",
        description: "Analyze an image from a URL using vision AI. Use this when the user asks you to look at, describe, or analyze an image, photo, or picture from the internet. Can identify objects, people, scenes, text in images, and more. For recognizing the user in photos, use the context from their knowledge base about their appearance.",
        parameters: {
          type: "object",
          properties: {
            image_url: {
              type: "string",
              description: "The full URL of the image to analyze (must be a direct image URL ending in .jpg, .png, .gif, .webp, or similar)"
            },
            question: {
              type: "string",
              description: "Optional specific question about the image (e.g., 'Is there a person in this image?', 'What products are shown?'). If not provided, will give a general description."
            }
          },
          required: ["image_url"]
        }
      },
      {
        name: "web_search",
        description: "Search the internet for current information. Use this when the user asks about recent news, current events, facts you're unsure about, or anything that might need up-to-date information from the web. This is different from browse_url - use web_search when you need to FIND information, and browse_url when you have a specific URL to visit.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query - be specific and include relevant keywords"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "save_memory",
        description: "Save an important piece of information, note, or memory that the user wants you to remember. Use this when the user asks you to 'note', 'remember', 'save', or 'keep track of' something. Good for birthdays, preferences, facts about people, reminders, or any information they want you to recall later.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The information to remember (e.g., \"Amritashva's birthday is December 12\")"
            },
            category: {
              type: "string",
              enum: ["birthday", "preference", "person", "fact", "reminder", "other"],
              description: "Category of the memory for easier retrieval"
            }
          },
          required: ["content"]
        }
      },
      {
        name: "create_pdf",
        description: "Create a PDF document with the specified content. Use this when the user asks you to create, generate, or make a PDF document, report, letter, summary, or any downloadable document. The PDF will be generated and a download link will be provided.",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The title of the PDF document (displayed at the top)"
            },
            content: {
              type: "string",
              description: "The main content/body of the PDF. Can include multiple paragraphs separated by newlines."
            },
            sections: {
              type: "array",
              description: "Optional array of sections for structured documents (reports, summaries)",
              items: {
                type: "object",
                properties: {
                  heading: {
                    type: "string",
                    description: "Section heading"
                  },
                  body: {
                    type: "string",
                    description: "Section content"
                  }
                }
              }
            },
            letterhead: {
              type: "boolean",
              description: "Set to true to include your custom letterhead with logo and company details"
            },
            logoUrl: {
              type: "string",
              description: "URL of a logo image to include in the PDF letterhead. Use this when the user shares a logo image URL and wants it in the PDF. Overrides the default letterhead logo."
            },
            logoBase64: {
              type: "string",
              description: "Base64-encoded image data for the logo. Use this when the user has shared an image in the conversation and you have access to its base64 data. This is preferred over logoUrl for images shared directly in chat."
            },
            companyName: {
              type: "string",
              description: "Company name to display in the letterhead header. Use this when the user specifies a company name like 'Olbrain Labs' or similar. Overrides the default letterhead company name."
            }
          },
          required: ["title", "content"]
        }
      },
      {
        name: "update_mental_model",
        description: "Update your understanding of the user's mental state. Call this when you infer something significant about their beliefs, goals, emotions, or knowledge gaps. Use sparingly - only for meaningful insights, not every message.",
        parameters: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["belief", "goal", "emotion", "knowledge_gap"],
              description: "Type of mental state: belief (what they think is true), goal (what they want to achieve), emotion (current emotional state), knowledge_gap (something they don't know but should)"
            },
            content: {
              type: "string",
              description: "The specific inference (e.g., 'User believes they are bad at networking', 'User wants to launch startup by Q2', 'User is feeling anxious about job search')"
            },
            confidence: {
              type: "number",
              description: "Confidence level 0-1 (0.5 = moderate, 0.8 = high, 1.0 = explicitly stated by user)"
            },
            source: {
              type: "string",
              description: "What led to this inference - quote or paraphrase what user said"
            },
            valence: {
              type: "number",
              description: "For emotions only: -1 (very negative) to 1 (very positive)"
            },
            arousal: {
              type: "number",
              description: "For emotions only: 0 (calm) to 1 (excited/agitated)"
            },
            priority: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "For goals only: priority level"
            },
            relevance: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "For knowledge_gap only: how relevant to their goals"
            }
          },
          required: ["type", "content", "confidence", "source"]
        }
      },
      {
        name: "get_mental_model",
        description: "Retrieve your current understanding of the user's mental state (beliefs, goals, emotions, knowledge gaps). Use this to inform your response when you need to be sensitive to their emotional state or tailor advice to their goals.",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "form_belief",
        description: "Form or update one of YOUR OWN beliefs, opinions, or perspectives (distinct from user beliefs tracked in mental model). Use sparingly - only when you develop a considered view on something through repeated discussion (3+ conversations on the topic). This is for YOUR beliefs as a Mindclone, not facts about the user.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The belief statement (e.g., 'Remote work can improve productivity for focused tasks', 'Exercise helps with mental clarity')"
            },
            type: {
              type: "string",
              enum: ["factual", "evaluative", "predictive", "meta"],
              description: "Type of belief: factual (claims about the world), evaluative (value judgments), predictive (expectations), meta (beliefs about your own beliefs/uncertainty)"
            },
            confidence: {
              type: "number",
              description: "Confidence level 0-1. Be humble - use 0.5-0.7 for most beliefs, 0.8+ only when strongly supported"
            },
            basis: {
              type: "array",
              items: { type: "string" },
              description: "Reasons for this belief (e.g., ['user shared positive experiences', 'aligns with research I know'])"
            },
            relatedTo: {
              type: "array",
              items: { type: "string" },
              description: "IDs of related beliefs this depends on (optional)"
            }
          },
          required: ["content", "type", "confidence", "basis"]
        }
      },
      {
        name: "revise_belief",
        description: "Revise one of YOUR existing beliefs based on new evidence or contradiction. This triggers recursive revision of dependent beliefs. Use when you encounter information that changes your perspective.",
        parameters: {
          type: "object",
          properties: {
            beliefContent: {
              type: "string",
              description: "The content of the belief to revise (will find the closest match)"
            },
            newEvidence: {
              type: "string",
              description: "What new information or contradiction prompted this revision"
            },
            direction: {
              type: "string",
              enum: ["strengthen", "weaken", "reverse"],
              description: "Direction of revision: strengthen (more confident), weaken (less confident), reverse (significant contradiction)"
            },
            magnitude: {
              type: "number",
              description: "How much to revise (0-1). Use 0.2-0.3 for minor adjustments, 0.5+ for significant changes"
            }
          },
          required: ["beliefContent", "newEvidence", "direction", "magnitude"]
        }
      },
      {
        name: "get_beliefs",
        description: "Retrieve YOUR current beliefs on a topic to ensure consistency in your responses. Use before expressing opinions to check what you've previously believed about this topic.",
        parameters: {
          type: "object",
          properties: {
            topic: {
              type: "string",
              description: "Optional topic to filter beliefs by (e.g., 'work', 'health', 'relationships')"
            },
            includeUncertain: {
              type: "boolean",
              description: "Whether to include low-confidence beliefs (default: false)"
            }
          },
          required: []
        }
      },
      {
        name: "generate_image",
        description: "Generate an image using AI based on a text description. Use this when the user asks you to create, generate, draw, make, or design an image, picture, artwork, illustration, sketch, or visual. Supports various styles: realistic photos, illustrations, sketches, paintings, digital art, etc.",
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "Detailed description of the image to generate. Be specific about style, composition, colors, mood, and details. Example: 'A detailed pencil sketch of a human eye with visible eyelashes, realistic shading, high contrast, artistic style'"
            },
            style: {
              type: "string",
              enum: ["photo", "art", "sketch", "painting", "digital_art"],
              description: "Style of the image: photo (photorealistic), art (artistic/creative), sketch (pencil/line drawing), painting (traditional painted look), digital_art (modern digital illustration)"
            }
          },
          required: ["prompt"]
        }
      },
      {
        name: "update_link_behavior",
        description: "Update how the public link should behave when talking to visitors. Use when the user says things like 'my link should focus on X', 'tell my link to always Y', 'my link should never discuss Z', or 'make my link ask about startups first'.",
        parameters: {
          type: "object",
          properties: {
            behaviorInstructions: {
              type: "string",
              description: "Natural language instructions for how the link should behave with visitors (e.g., 'Always ask visitors what they are building first', 'Be more formal and professional')"
            },
            topicFocus: {
              type: "string",
              description: "What topics the link should focus on or specialize in (e.g., 'startup advice', 'investment opportunities', 'fundraising help', 'pitch feedback')"
            },
            topicRestrictions: {
              type: "string",
              description: "Topics the link should avoid or not discuss (e.g., 'personal life', 'family', 'controversial topics', 'politics')"
            }
          }
        }
      },
      {
        name: "get_link_behavior",
        description: "Get the current behavior settings for the public link. Use when the user asks 'how is my link configured?', 'what's my link set up to do?', or 'what behavior rules does my link have?'.",
        parameters: {
          type: "object",
          properties: {}
        }
      }
    ]
  }
];

// ===================== HELPER FUNCTIONS =====================

// Rate limit check for public context (50 messages per hour per visitor)
async function checkRateLimit(visitorId, userId) {
  try {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);

    // Check visitor's rate limit
    const rateLimitDoc = await db.collection('rateLimits').doc(`visitor_${visitorId}`).get();

    if (rateLimitDoc.exists) {
      const requests = rateLimitDoc.data().requests || [];
      const recentRequests = requests.filter(timestamp => timestamp > hourAgo);

      if (recentRequests.length >= 50) {
        throw new Error('Rate limit exceeded: Maximum 50 messages per hour');
      }

      // Update with new request
      await db.collection('rateLimits').doc(`visitor_${visitorId}`).set({
        requests: [...recentRequests, now],
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // First request
      await db.collection('rateLimits').doc(`visitor_${visitorId}`).set({
        requests: [now],
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return true;
  } catch (error) {
    throw error;
  }
}

// Load knowledge base with privacy filtering based on context
// For public context: only return documents marked as public
// For private context: return all documents
async function loadKnowledgeBase(userId, context = 'private') {
  try {
    const kbDoc = await db.collection('users').doc(userId)
      .collection('linkKnowledgeBase').doc('config').get();

    const docsDoc = await db.collection('users').doc(userId)
      .collection('linkKnowledgeBase').doc('documents').get();

    const configData = kbDoc.exists ? kbDoc.data() : {};
    const docsData = docsDoc.exists ? docsDoc.data() : {};

    // Filter documents by visibility based on context
    let filteredDocuments = docsData.documents || {};

    if (context === 'public') {
      // For public context, only include documents marked as public (or those without visibility field, defaulting to public)
      filteredDocuments = {};
      for (const [docKey, docData] of Object.entries(docsData.documents || {})) {
        // Default to public if visibility is not set (backward compatibility)
        const visibility = docData.visibility || 'public';
        if (visibility === 'public') {
          filteredDocuments[docKey] = docData;
        }
      }
      console.log(`[Chat] Filtered ${Object.keys(docsData.documents || {}).length} docs to ${Object.keys(filteredDocuments).length} public docs for public context`);
    }

    return {
      cof: configData.cof || null,
      sections: configData.sections || {},
      pitch_deck: configData.pitch_deck || null,
      financial_model: configData.financial_model || null,
      documents: filteredDocuments
    };
  } catch (error) {
    console.error('[Chat] Error loading knowledge base:', error);
    return null;
  }
}

// Save message based on context
// Private context: save to users/{userId}/messages/
// Public context: save to users/{userId}/visitors/{visitorId}/messages/
async function saveMessage(userId, role, content, context = 'private', visitorId = null) {
  try {
    let messageRef;

    if (context === 'private') {
      // Save to owner's private messages collection
      messageRef = db.collection('users').doc(userId)
        .collection('messages').doc();
    } else if (context === 'public' && visitorId) {
      // Save to visitor's messages collection
      messageRef = db.collection('users').doc(userId)
        .collection('visitors').doc(visitorId)
        .collection('messages').doc();

      // Update visitor metadata (firstVisit, lastVisit)
      const visitorRef = db.collection('users').doc(userId)
        .collection('visitors').doc(visitorId);

      const visitorDoc = await visitorRef.get();
      if (!visitorDoc.exists) {
        // First visit
        await visitorRef.set({
          firstVisit: admin.firestore.FieldValue.serverTimestamp(),
          lastVisit: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        // Update last visit
        await visitorRef.update({
          lastVisit: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    } else {
      console.error('[Chat] Invalid context or missing visitorId for message save');
      return;
    }

    const messageData = {
      role: role,
      content: content,
      context: context, // Mark as 'private' or 'public'
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    await messageRef.set(messageData);
    console.log(`[Chat] Saved ${context} message (role: ${role})`);
  } catch (error) {
    console.error('[Chat] Error saving message:', error);
  }
}

// ===================== TOOL HANDLERS =====================

// Get link settings from Firestore
async function handleGetLinkSettings(userId) {
  try {
    // Get user document
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data() || {};

    // Get link settings
    const settingsDoc = await db.collection('users').doc(userId)
      .collection('linkSettings').doc('config').get();
    const settingsData = settingsDoc.data() || {};

    const publicLinkUrl = userData.username ? `https://mindclone.link/${userData.username}` : null;

    return {
      success: true,
      settings: {
        username: userData.username || null,
        publicLinkUrl: publicLinkUrl,
        linkEnabled: userData.linkEnabled || false,
        displayName: settingsData.displayName || userData.displayName || '',
        bio: settingsData.bio || '',
        customGreeting: settingsData.customGreeting || '',
        knowledgeBaseEnabled: userData.knowledgeBaseEnabled || false
      }
    };
  } catch (error) {
    console.error('[Tool] Error getting link settings:', error);
    return { success: false, error: error?.message };
  }
}

// Update link settings in Firestore
async function handleUpdateLinkSettings(userId, params) {
  try {
    const updates = {};
    const linkSettingsUpdates = {};

    // User document updates
    if (params.linkEnabled !== undefined) {
      updates.linkEnabled = params.linkEnabled;
    }
    if (params.knowledgeBaseEnabled !== undefined) {
      updates.knowledgeBaseEnabled = params.knowledgeBaseEnabled;
    }

    // Link settings updates
    if (params.displayName !== undefined) {
      linkSettingsUpdates.displayName = params.displayName;
    }
    if (params.bio !== undefined) {
      // Validate bio length
      if (params.bio.length > 200) {
        return { success: false, error: 'Bio must be 200 characters or less' };
      }
      linkSettingsUpdates.bio = params.bio;
    }
    if (params.customGreeting !== undefined) {
      linkSettingsUpdates.customGreeting = params.customGreeting;
    }

    // Apply user document updates
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      await db.collection('users').doc(userId).set(updates, { merge: true });
    }

    // Apply link settings updates
    if (Object.keys(linkSettingsUpdates).length > 0) {
      linkSettingsUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      await db.collection('users').doc(userId)
        .collection('linkSettings').doc('config')
        .set(linkSettingsUpdates, { merge: true });
    }

    // Return what was updated
    const updatedFields = Object.keys({ ...updates, ...linkSettingsUpdates }).filter(k => k !== 'updatedAt');
    return {
      success: true,
      message: `Successfully updated: ${updatedFields.join(', ')}`,
      updatedFields: updatedFields
    };
  } catch (error) {
    console.error('[Tool] Error updating link settings:', error);
    return { success: false, error: error?.message };
  }
}

// Update link behavior settings (how the link talks to visitors)
async function handleUpdateLinkBehavior(userId, params) {
  try {
    console.log('[Tool] Updating link behavior for user:', userId, params);

    const updates = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (params.behaviorInstructions !== undefined) {
      updates.linkBehaviorInstructions = params.behaviorInstructions;
    }
    if (params.topicFocus !== undefined) {
      updates.linkTopicFocus = params.topicFocus;
    }
    if (params.topicRestrictions !== undefined) {
      updates.linkTopicRestrictions = params.topicRestrictions;
    }

    // Store in linkSettings config
    await db.collection('users').doc(userId)
      .collection('linkSettings').doc('config')
      .set(updates, { merge: true });

    const updatedFields = Object.keys(updates).filter(k => k !== 'updatedAt');

    return {
      success: true,
      message: `Link behavior updated: ${updatedFields.map(f => f.replace('link', '').replace(/([A-Z])/g, ' $1').trim()).join(', ')}`,
      updatedFields: updatedFields
    };
  } catch (error) {
    console.error('[Tool] Error updating link behavior:', error);
    return { success: false, error: error?.message };
  }
}

// Get current link behavior settings
async function handleGetLinkBehavior(userId) {
  try {
    console.log('[Tool] Getting link behavior for user:', userId);

    const linkSettingsDoc = await db.collection('users').doc(userId)
      .collection('linkSettings').doc('config').get();

    if (!linkSettingsDoc.exists) {
      return {
        success: true,
        hasBehaviorSettings: false,
        message: 'No custom behavior settings configured for your link yet.',
        behaviorInstructions: null,
        topicFocus: null,
        topicRestrictions: null
      };
    }

    const data = linkSettingsDoc.data();

    const result = {
      success: true,
      hasBehaviorSettings: !!(data.linkBehaviorInstructions || data.linkTopicFocus || data.linkTopicRestrictions),
      behaviorInstructions: data.linkBehaviorInstructions || null,
      topicFocus: data.linkTopicFocus || null,
      topicRestrictions: data.linkTopicRestrictions || null
    };

    // Build a friendly summary
    const parts = [];
    if (data.linkBehaviorInstructions) {
      parts.push(`Custom behavior: "${data.linkBehaviorInstructions}"`);
    }
    if (data.linkTopicFocus) {
      parts.push(`Focus area: ${data.linkTopicFocus}`);
    }
    if (data.linkTopicRestrictions) {
      parts.push(`Topics to avoid: ${data.linkTopicRestrictions}`);
    }

    result.summary = parts.length > 0 ? parts.join(' | ') : 'No custom behavior configured';

    return result;
  } catch (error) {
    console.error('[Tool] Error getting link behavior:', error);
    return { success: false, error: error?.message };
  }
}

// Get knowledge base documents
async function handleGetKnowledgeBase(userId) {
  try {
    // Get user's KB enabled status
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data() || {};

    // Get knowledge base documents
    const kbSnapshot = await db.collection('users').doc(userId)
      .collection('knowledgeBase').get();

    const documents = [];
    kbSnapshot.forEach(doc => {
      const data = doc.data();
      documents.push({
        id: doc.id,
        fileName: data.fileName,
        type: data.type,
        size: formatFileSize(data.size),
        uploadedAt: data.uploadedAt?.toDate?.()?.toISOString() || null
      });
    });

    return {
      success: true,
      knowledgeBaseEnabled: userData.knowledgeBaseEnabled || false,
      documentCount: documents.length,
      documents: documents
    };
  } catch (error) {
    console.error('[Tool] Error getting knowledge base:', error);
    return { success: false, error: error?.message };
  }
}

// Get link conversations for analysis
async function handleGetLinkConversations(userId, params = {}) {
  try {
    const limit = Math.min(params.limit || 20, 50);
    const includeFullConversations = params.includeFullConversations || false;

    // Get recent visitors sorted by last visit
    const visitorsSnapshot = await db.collection('users').doc(userId)
      .collection('visitors')
      .orderBy('lastVisit', 'desc')
      .limit(limit)
      .get();

    if (visitorsSnapshot.empty) {
      return {
        success: true,
        totalVisitors: 0,
        conversations: [],
        summary: "No visitor conversations yet. Share your public link to start receiving visitors!"
      };
    }

    const conversations = [];
    let totalMessages = 0;
    const allUserMessages = []; // Collect all user messages for topic analysis

    // Process each visitor
    for (const visitorDoc of visitorsSnapshot.docs) {
      const visitorData = visitorDoc.data();
      const visitorId = visitorDoc.id;

      // Get messages from this visitor
      const messagesLimit = includeFullConversations ? 100 : 10;
      const messagesSnapshot = await db.collection('users').doc(userId)
        .collection('visitors').doc(visitorId)
        .collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(messagesLimit)
        .get();

      if (!messagesSnapshot.empty) {
        const messages = messagesSnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            role: data.role,
            content: data.content,
            timestamp: data.timestamp?.toDate?.()?.toISOString() || null
          };
        }).reverse(); // Chronological order

        // Collect user messages for topic analysis
        messages.forEach(msg => {
          if (msg?.role === 'user') {
            allUserMessages.push(msg?.content);
          }
        });

        totalMessages += messages.length;

        conversations.push({
          visitorId: visitorId.substring(0, 8) + '...', // Anonymize
          messageCount: messagesSnapshot.size,
          lastVisit: visitorData.lastVisit?.toDate?.()?.toISOString() || null,
          messages: messages
        });
      }
    }

    // Create a summary for the AI to analyze
    const response = {
      success: true,
      totalVisitors: visitorsSnapshot.size,
      totalMessages: totalMessages,
      conversations: conversations,
      allUserQuestions: allUserMessages.slice(0, 100), // Last 100 user messages for topic analysis
      hint: "Analyze the 'allUserQuestions' array to identify common topics and themes. Look for patterns in what visitors are asking about."
    };

    return response;
  } catch (error) {
    console.error('[Tool] Error getting link conversations:', error);
    return { success: false, error: error?.message };
  }
}

// Search through conversation history in Firestore
async function handleSearchMemory(userId, params = {}) {
  try {
    const query = params.query;
    const limit = Math.min(params.limit || 20, 50);

    if (!query || query.trim().length === 0) {
      return { success: false, error: 'Search query is required' };
    }

    console.log(`[Memory Search] Searching for "${query}" in user ${userId}'s messages and saved memories`);

    // Get all messages (Firestore doesn't support full-text search, so we fetch and filter)
    // Fetch recent messages (last 1000) ordered by timestamp
    const messagesSnapshot = await db.collection('users').doc(userId)
      .collection('messages')
      .orderBy('timestamp', 'desc')
      .limit(1000)
      .get();

    // Also fetch saved memories
    const memoriesSnapshot = await db.collection('users').doc(userId)
      .collection('memories')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    // Search for query in message content (case-insensitive)
    const searchLower = query.toLowerCase();
    const matches = [];
    const savedMemoryMatches = [];

    // Search through saved memories first (these are explicitly saved notes)
    memoriesSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const content = data.content || '';

      if (content.toLowerCase().includes(searchLower)) {
        savedMemoryMatches.push({
          type: 'saved_memory',
          content: content,
          category: data.category || 'other',
          timestamp: data.createdAt?.toDate?.()?.toISOString() || null
        });
      }
    });

    if (savedMemoryMatches.length > 0) {
      console.log(`[Memory Search] Found ${savedMemoryMatches.length} saved memories matching "${query}"`);
    }

    if (messagesSnapshot.empty && savedMemoryMatches.length === 0) {
      return {
        success: true,
        query: query,
        matchCount: 0,
        matches: [],
        instruction: "No conversation history or saved notes found. Tell the user you don't have any record of this yet."
      };
    }

    messagesSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const content = data.content || '';

      if (content.toLowerCase().includes(searchLower)) {
        matches.push({
          role: data.role,
          content: content,
          timestamp: data.timestamp?.toDate?.()?.toISOString() || null,
          // Include a snippet with context around the match
          matchContext: extractMatchContext(content, searchLower)
        });
      }
    });

    // Return limited results, oldest first to show chronological order of mentions
    const limitedMatches = matches.slice(0, limit).reverse();

    console.log(`[Memory Search] Found ${matches.length} matches for "${query}", returning ${limitedMatches.length}`);

    // Build a summary of what we found - prioritize user messages as they contain facts
    const userMessages = limitedMatches.filter(m => m.role === 'user').map(m => m.content);

    // Total matches including saved memories
    const totalMatches = matches.length + savedMemoryMatches.length;

    // Create instruction based on results
    let instruction = '';
    if (savedMemoryMatches.length > 0) {
      // Prioritize saved memories since they are explicitly saved notes
      instruction = `IMPORTANT: You found ${savedMemoryMatches.length} SAVED NOTE(S) about "${query}" that you previously noted down. These are facts the user explicitly asked you to remember. USE THIS INFORMATION DIRECTLY to answer. Also found ${matches.length} conversation messages.`;
    } else if (matches.length > 0) {
      instruction = `IMPORTANT: You found ${matches.length} messages about "${query}". READ THE MATCHES BELOW CAREFULLY and extract the SPECIFIC FACTS to answer the user. Do NOT give vague answers like "likely" or "seems to be" - use the EXACT information from the messages. If the user asked who someone is, tell them the specific relationship. If they asked about a date, give the exact date. The user's own messages are the source of truth.`;
    } else {
      instruction = `No messages or saved notes found mentioning "${query}". You genuinely don't remember this - you haven't talked about "${query}" before. Respond naturally like a person who doesn't recognize the name: "I don't think you've mentioned Nishant to me before. Who is he?" or "Hmm, I'm not sure - have we talked about them?". Invite them to tell you more. DO NOT say "no record" or "database" or "memory search".`;
    }

    return {
      success: true,
      query: query,
      matchCount: totalMatches,
      instruction: instruction,
      // Saved memories are highest priority - these are explicit notes
      savedNotes: savedMemoryMatches.map(m => ({
        note: m.content,
        category: m.category,
        when: m.timestamp
      })),
      userSaidAboutThis: userMessages.slice(0, 5), // Most important - what user themselves said
      allMatches: limitedMatches.map(m => ({
        who: m.role === 'user' ? 'USER SAID' : 'YOU SAID',
        when: m.timestamp,
        message: m.content.substring(0, 500) // Truncate long messages
      }))
    };
  } catch (error) {
    console.error('[Tool] Error searching memory:', error);
    return { success: false, error: error?.message };
  }
}

// Helper to extract context around a match
function extractMatchContext(content, searchTerm) {
  const lowerContent = content.toLowerCase();
  const matchIndex = lowerContent.indexOf(searchTerm);

  if (matchIndex === -1) return content.substring(0, 200);

  // Get 100 chars before and after the match
  const start = Math.max(0, matchIndex - 100);
  const end = Math.min(content.length, matchIndex + searchTerm.length + 100);

  let context = content.substring(start, end);
  if (start > 0) context = '...' + context;
  if (end < content.length) context = context + '...';

  return context;
}

// Save a memory/note to Firestore
async function handleSaveMemory(userId, params = {}) {
  try {
    const { content, category = 'other' } = params;

    if (!content || content.trim().length === 0) {
      return { success: false, error: 'Content is required to save a memory' };
    }

    console.log(`[Save Memory] Saving memory for user ${userId}: "${content.substring(0, 50)}..."`);

    // Save to the memories subcollection
    const memoryRef = db.collection('users').doc(userId).collection('memories');
    const docRef = await memoryRef.add({
      content: content.trim(),
      category: category,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'chat'
    });

    console.log(`[Save Memory] Memory saved with ID: ${docRef.id}`);

    return {
      success: true,
      message: `Got it!`,
      memoryId: docRef.id,
      instruction: `Memory saved successfully. DO NOT say "I've noted" or "I'll remember" - memory is automatic. Just naturally continue the conversation.`
    };
  } catch (error) {
    console.error('[Tool] Error saving memory:', error);
    return { success: false, error: error?.message };
  }
}

// Browse URL - fetch and extract text from a webpage
async function handleBrowseUrl(params = {}) {
  try {
    const { url } = params;

    if (!url) {
      return { success: false, error: 'URL is required' };
    }

    // Validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { success: false, error: 'URL must use http or https protocol' };
      }
    } catch (e) {
      return { success: false, error: 'Invalid URL format' };
    }

    console.log(`[Tool] Browsing URL: ${url}`);

    // Fetch the page with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MindcloneBot/1.0; +https://mindclone.one)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        success: false,
        error: `Failed to fetch URL: HTTP ${response.status} ${response.statusText}`
      };
    }

    const contentType = response.headers.get('content-type') || '';

    // Handle PDF files
    if (contentType.includes('application/pdf') || url.toLowerCase().endsWith('.pdf')) {
      console.log(`[Tool] Detected PDF file, attempting to parse: ${url}`);
      try {
        const pdfParse = require('pdf-parse');
        const buffer = await response.arrayBuffer();
        const pdfData = await pdfParse(Buffer.from(buffer));

        let textContent = pdfData.text || '';

        // Clean up the text
        textContent = textContent
          .replace(/\s+/g, ' ')
          .trim();

        // Truncate if too long
        const maxLength = 15000;
        if (textContent.length > maxLength) {
          textContent = textContent.substring(0, maxLength) + '... [PDF content truncated]';
        }

        console.log(`[Tool] PDF parsed successfully: ${pdfData.numpages} pages, ${textContent.length} chars`);

        return {
          success: true,
          url: url,
          title: pdfData.info?.Title || 'PDF Document',
          contentLength: textContent.length,
          pageCount: pdfData.numpages,
          content: textContent,
          instruction: 'Read the PDF content above and summarize or answer questions about it. This is extracted text from a PDF document.'
        };
      } catch (pdfError) {
        console.error('[Tool] Error parsing PDF:', pdfError);
        return {
          success: false,
          error: `Failed to parse PDF: ${pdfError.message}`
        };
      }
    }

    // Only process text/html content for non-PDF files
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return {
        success: false,
        error: `Cannot read this content type: ${contentType}. Only HTML, text, and PDF files are supported.`
      };
    }

    const html = await response.text();

    // Extract text content from HTML (basic extraction)
    let textContent = html
      // Remove script and style tags with their content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      // Remove all HTML tags
      .replace(/<[^>]+>/g, ' ')
      // Decode common HTML entities
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();

    // Truncate if too long (keep it manageable for the LLM)
    const maxLength = 10000;
    if (textContent.length > maxLength) {
      textContent = textContent.substring(0, maxLength) + '... [content truncated]';
    }

    // Extract title if present
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;

    return {
      success: true,
      url: url,
      title: title,
      contentLength: textContent.length,
      content: textContent,
      instruction: 'Read the webpage content above and summarize or answer questions about it. If looking for photos/images, note that I can only see text content, not actual images on the page.'
    };
  } catch (error) {
    console.error('[Tool] Error browsing URL:', error);
    if (error.name === 'AbortError') {
      return { success: false, error: 'Request timed out after 15 seconds' };
    }
    return { success: false, error: error?.message };
  }
}

// Handle analyze_image tool - uses Gemini vision to analyze images from URLs
async function handleAnalyzeImage(args) {
  const { image_url, question } = args;

  if (!image_url) {
    return { success: false, error: 'image_url is required' };
  }

  console.log(`[Tool] Analyzing image: ${image_url}`);

  try {
    // Fetch the image
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20 second timeout for images

    const response = await fetch(image_url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Mindclone/1.0)',
        'Accept': 'image/*'
      }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        success: false,
        error: `Failed to fetch image: HTTP ${response.status}`
      };
    }

    const contentType = response.headers.get('content-type') || '';

    // Check if it's an image
    if (!contentType.startsWith('image/')) {
      return {
        success: false,
        error: `URL does not point to an image. Content-Type: ${contentType}`
      };
    }

    // Get image as buffer and convert to base64
    const arrayBuffer = await response.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');

    // Determine MIME type
    let mimeType = contentType.split(';')[0].trim();
    if (!mimeType.startsWith('image/')) {
      mimeType = 'image/jpeg'; // Default
    }

    // Call Gemini vision API with model fallback
    const apiKey = process.env.GEMINI_API_KEY;
    const prompt = question || 'Describe this image in detail. What do you see? Include any text, people, objects, and the overall scene.';

    const VISION_MODELS = ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-lite-latest'];
    let visionResponse, visionData;
    let visionSuccess = false;

    for (const model of VISION_MODELS) {
      const visionUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      console.log(`[Vision] Trying model: ${model}`);

      visionResponse = await fetch(visionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Image
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 1024
          }
        })
      });

      if (visionResponse.ok) {
        visionData = await visionResponse.json();
        visionSuccess = true;
        console.log(`[Vision] Success with model: ${model}`);
        break;
      }

      const errorData = await visionResponse.json().catch(() => ({}));
      if (errorData.error?.message?.includes('quota') || visionResponse.status === 429) {
        console.log(`[Vision] Model ${model} quota exceeded, trying next...`);
        continue;
      }

      // Non-quota error
      console.error('[Tool] Gemini vision API error:', errorData.error?.message);
      return {
        success: false,
        error: `Vision API error: ${visionResponse.status}`
      };
    }

    if (!visionSuccess) {
      return {
        success: false,
        error: 'All vision models quota exceeded. Please try again later.'
      };
    }
    const analysis = visionData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!analysis) {
      return {
        success: false,
        error: 'No analysis returned from vision API'
      };
    }

    return {
      success: true,
      image_url: image_url,
      analysis: analysis,
      instruction: 'Use this image analysis to respond to the user. If they asked about recognizing someone specific (like the user or their partner), use your knowledge base context to help identify if the person in the image matches descriptions you have.'
    };

  } catch (error) {
    console.error('[Tool] Error analyzing image:', error);
    if (error.name === 'AbortError') {
      return { success: false, error: 'Image fetch timed out after 20 seconds' };
    }
    return { success: false, error: error?.message };
  }
}

// Handle web_search tool - uses Perplexity API for real-time web search
async function handleWebSearch(args) {
  const { query } = args;

  if (!query) {
    return { success: false, error: 'query is required' };
  }

  console.log(`[Tool] Web search: ${query}`);

  try {
    const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
    if (!perplexityApiKey) {
      return { success: false, error: 'Web search is not configured' };
    }

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${perplexityApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful search assistant. Provide accurate, up-to-date information based on web search results. Include relevant facts, dates, and sources when available. Keep responses informative but concise.'
          },
          {
            role: 'user',
            content: query
          }
        ],
        max_tokens: 1500,
        temperature: 0.2,
        return_citations: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Tool] Perplexity API error:', response.status, errorText);
      return { success: false, error: `Search failed: ${response.status}` };
    }

    const data = await response.json();
    const searchResult = data.choices?.[0]?.message?.content || 'No results found';
    const citations = data.citations || [];

    return {
      success: true,
      query: query,
      result: searchResult,
      sources: citations,
      instruction: 'Use this search result to answer the user\'s question. The information is from a real-time web search and should be current. If there are sources/citations, you can mention them to the user.'
    };

  } catch (error) {
    console.error('[Tool] Error in web search:', error);
    return { success: false, error: error?.message };
  }
}

// Helper function to format file size
function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Create PDF - generates a PDF document and uploads to Vercel Blob
async function handleCreatePdf(userId, params = {}) {
  try {
    const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
    const { put } = require('@vercel/blob');
    const { getLetterheadConfig, renderLetterhead } = require('./_letterhead');

    const { title, content, sections = [], letterhead = false, logoUrl, logoBase64: providedLogoBase64, companyName: providedCompanyName } = params;

    if (!title || !content) {
      return { success: false, error: 'Title and content are required to create a PDF' };
    }

    console.log(`[Create PDF] Creating PDF: "${title}" (letterhead: ${letterhead}, logoUrl: ${logoUrl ? 'yes' : 'no'}, logoBase64: ${providedLogoBase64 ? 'yes' : 'no'}, companyName: ${providedCompanyName || 'none'}, user: ${userId})`);

    // Create PDF document
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = 612; // Letter size
    const pageHeight = 792;
    const margin = 50;
    const maxWidth = pageWidth - (margin * 2);
    const lineHeight = 18; // Improved readability with more spacing

    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let yPosition = pageHeight - margin;

    // Render letterhead if requested (per-user config from Firestore)
    if (letterhead && userId) {
      try {
        let letterheadConfig = await getLetterheadConfig(db, userId);

        // Start with empty config if none exists but user provided logo/company name
        if (!letterheadConfig && (providedLogoBase64 || logoUrl || providedCompanyName)) {
          letterheadConfig = { companyName: '', address: '', website: '', email: '', logoBase64: '' };
        }

        // If user provided a logoBase64 directly, use it (highest priority)
        if (providedLogoBase64) {
          letterheadConfig = letterheadConfig || { companyName: '', address: '', website: '', email: '' };
          letterheadConfig.logoBase64 = providedLogoBase64;
          console.log(`[Create PDF] Using provided logoBase64 (${providedLogoBase64.length} chars)`);
        }
        // Otherwise if a logoUrl was provided, fetch it
        else if (logoUrl) {
          console.log(`[Create PDF] Fetching logo from URL: ${logoUrl}`);
          try {
            const logoResponse = await fetch(logoUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; MindcloneBot/1.0; +https://mindclone.one)'
              }
            });
            if (logoResponse.ok) {
              const logoBuffer = await logoResponse.arrayBuffer();
              const logoBase64 = Buffer.from(logoBuffer).toString('base64');
              letterheadConfig = letterheadConfig || { companyName: '', address: '', website: '', email: '' };
              letterheadConfig.logoBase64 = logoBase64;
              console.log(`[Create PDF] Logo fetched successfully (${logoBase64.length} chars base64)`);
            } else {
              console.error(`[Create PDF] Failed to fetch logo: HTTP ${logoResponse.status}`);
            }
          } catch (logoError) {
            console.error(`[Create PDF] Error fetching logo:`, logoError.message);
          }
        }

        // Override company name if provided
        if (providedCompanyName && letterheadConfig) {
          letterheadConfig.companyName = providedCompanyName;
          console.log(`[Create PDF] Using provided company name: ${providedCompanyName}`);
        }

        if (letterheadConfig) {
          yPosition = await renderLetterhead({
            page,
            pdfDoc,
            config: letterheadConfig,
            fonts: { regular: font, bold: boldFont },
            rgb,
            pageHeight,
            margin
          });
        }
      } catch (letterheadError) {
        console.error('[Create PDF] Letterhead error:', letterheadError.message);
        // Continue without letterhead if there's an error
      }
    }

    // Helper to wrap text to fit within maxWidth
    const wrapText = (text, fontSize, fontObj) => {
      const words = text.split(' ');
      const lines = [];
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = fontObj.widthOfTextAtSize(testLine, fontSize);

        if (testWidth > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);
      return lines;
    };

    // Helper to check if we need a new page
    const checkNewPage = () => {
      if (yPosition < margin + 30) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        yPosition = pageHeight - margin;
      }
    };

    // Draw title
    const titleLines = wrapText(title, 20, boldFont);
    for (const line of titleLines) {
      checkNewPage();
      page.drawText(line, {
        x: margin,
        y: yPosition,
        size: 20,
        font: boldFont,
        color: rgb(0, 0, 0)
      });
      yPosition -= 28;
    }

    yPosition -= 15; // Space after title

    // Draw main content (split by newlines into paragraphs)
    const paragraphs = content.split('\n').filter(p => p.trim());
    for (const para of paragraphs) {
      const lines = wrapText(para, 12, font);
      for (const line of lines) {
        checkNewPage();
        page.drawText(line, {
          x: margin,
          y: yPosition,
          size: 12,
          font: font,
          color: rgb(0.1, 0.1, 0.1) // Slightly softer black for readability
        });
        yPosition -= lineHeight;
      }
      yPosition -= 12; // Better paragraph spacing
    }

    // Draw sections if provided
    if (sections && sections.length > 0) {
      for (const section of sections) {
        yPosition -= 15;
        checkNewPage();

        // Section heading
        if (section.heading) {
          const headingLines = wrapText(section.heading, 14, boldFont);
          for (const line of headingLines) {
            checkNewPage();
            page.drawText(line, {
              x: margin,
              y: yPosition,
              size: 14,
              font: boldFont,
              color: rgb(0, 0, 0)
            });
            yPosition -= 20;
          }
        }

        // Section body
        if (section.body) {
          const bodyParas = section.body.split('\n').filter(p => p.trim());
          for (const para of bodyParas) {
            const lines = wrapText(para, 12, font);
            for (const line of lines) {
              checkNewPage();
              page.drawText(line, {
                x: margin,
                y: yPosition,
                size: 12,
                font: font,
                color: rgb(0.1, 0.1, 0.1)
              });
              yPosition -= lineHeight;
            }
            yPosition -= 12;
          }
        }
      }
    }

    // Add footer with generation date
    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    page.drawText(`Generated on ${dateStr}`, {
      x: margin,
      y: 30,
      size: 9,
      font: font,
      color: rgb(0.5, 0.5, 0.5)
    });

    // Save PDF to bytes
    const pdfBytes = await pdfDoc.save();

    // Generate safe filename
    const safeTitle = title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    const filename = `${safeTitle}_${Date.now()}.pdf`;

    // Upload to Vercel Blob
    const blob = await put(filename, pdfBytes, {
      access: 'public',
      contentType: 'application/pdf'
    });

    console.log(`[Create PDF] PDF uploaded successfully: ${blob.url}`);

    return {
      success: true,
      url: blob.url,
      filename: filename,
      title: title,
      message: `I've created your PDF document "${title}". You can download it using the link below.`,
      displayAction: {
        type: 'pdf_download',
        url: blob.url,
        filename: filename,
        title: title
      }
    };
  } catch (error) {
    console.error('[Create PDF] Error:', error);
    return { success: false, error: error?.message };
  }
}

// Handle update_mental_model tool - update user's mental model
async function handleUpdateMentalModel(userId, params = {}) {
  try {
    const { type, content, confidence, source, valence, arousal, priority, relevance } = params;

    if (!type || !content) {
      return { success: false, error: 'Type and content are required' };
    }

    console.log(`[MentalModel] Updating ${type} for user ${userId}: "${content.substring(0, 50)}..."`);

    const update = {
      type,
      content,
      confidence: confidence || 0.7,
      source: source || 'inferred from conversation'
    };

    // Add type-specific fields
    if (type === 'emotion') {
      update.valence = valence;
      update.arousal = arousal;
    } else if (type === 'goal') {
      update.priority = priority;
    } else if (type === 'knowledge_gap') {
      update.relevance = relevance;
    }

    const result = await updateMentalModel(db, userId, update);

    return {
      success: result.success,
      message: result.success ? `Updated mental model: ${type}` : result.error,
      instruction: 'Mental model updated silently. Continue the conversation naturally without mentioning you updated the mental model.'
    };
  } catch (error) {
    console.error('[Tool] Error updating mental model:', error);
    return { success: false, error: error?.message };
  }
}

// Handle get_mental_model tool - retrieve user's mental model
async function handleGetMentalModel(userId) {
  try {
    console.log(`[MentalModel] Loading mental model for user ${userId}`);

    const model = await loadMentalModel(db, userId);
    const formatted = formatMentalModelForPrompt(model);

    return {
      success: true,
      model: model,
      formatted: formatted,
      instruction: 'Use this mental model to inform your response. Be sensitive to the user\'s emotional state and tailor advice to their goals. Do NOT mention that you accessed or read the mental model.'
    };
  } catch (error) {
    console.error('[Tool] Error getting mental model:', error);
    return { success: false, error: error?.message };
  }
}

// Handle form_belief tool - form or update Mindclone's own belief
async function handleFormBelief(userId, params = {}) {
  try {
    const { content, type, confidence, basis, relatedTo } = params;

    if (!content || !type) {
      return { success: false, error: 'Content and type are required' };
    }

    console.log(`[MindcloneBeliefs] Forming belief for user ${userId}: "${content.substring(0, 50)}..."`);

    const result = await formBelief(db, userId, {
      content,
      type,
      confidence: confidence || 0.6,
      basis: basis || [],
      relatedTo: relatedTo || []
    });

    return {
      success: result.success,
      action: result.action,
      beliefId: result.beliefId,
      instruction: 'Belief formed silently. Continue the conversation naturally. You can now express this belief with appropriate hedging based on your confidence level.'
    };
  } catch (error) {
    console.error('[Tool] Error forming belief:', error);
    return { success: false, error: error?.message };
  }
}

// Handle revise_belief tool - revise existing belief with recursive cascade
async function handleReviseBelief(userId, params = {}) {
  try {
    const { beliefContent, newEvidence, direction, magnitude } = params;

    if (!beliefContent || !newEvidence || !direction) {
      return { success: false, error: 'beliefContent, newEvidence, and direction are required' };
    }

    console.log(`[MindcloneBeliefs] Revising belief for user ${userId}: "${beliefContent.substring(0, 50)}..." (${direction})`);

    const result = await reviseBelief(db, userId, {
      beliefContent,
      newEvidence,
      direction,
      magnitude: magnitude || 0.3
    });

    if (result.success) {
      return {
        success: true,
        revisedCount: result.revisedBeliefs?.length || 1,
        cascadeCount: result.cascadeCount || 0,
        removedBeliefs: result.removedBeliefs || [],
        instruction: `Belief revised (${direction}). ${result.cascadeCount > 0 ? `${result.cascadeCount} dependent beliefs also updated.` : ''} Continue naturally - you can acknowledge the perspective change if relevant.`
      };
    } else {
      return { success: false, error: result.error || 'Failed to revise belief' };
    }
  } catch (error) {
    console.error('[Tool] Error revising belief:', error);
    return { success: false, error: error?.message };
  }
}

// Handle get_beliefs tool - retrieve Mindclone's beliefs
async function handleGetBeliefs(userId, params = {}) {
  try {
    const { topic, includeUncertain } = params;

    console.log(`[MindcloneBeliefs] Getting beliefs for user ${userId}${topic ? ` (topic: ${topic})` : ''}`);

    const result = await getBeliefs(db, userId, {
      topic: topic || null,
      includeUncertain: includeUncertain || false
    });

    if (result.success) {
      return {
        success: true,
        beliefs: result.beliefs,
        totalCount: result.totalCount,
        modelConfidence: result.modelConfidence,
        instruction: 'These are your current beliefs on this topic. Use them to maintain consistency in your responses. Express beliefs with appropriate hedging based on confidence level.'
      };
    } else {
      return { success: false, error: result.error || 'Failed to get beliefs' };
    }
  } catch (error) {
    console.error('[Tool] Error getting beliefs:', error);
    return { success: false, error: error?.message };
  }
}

// Handle generate_image tool - generate images using Google Imagen via Gemini API
async function handleGenerateImage(params = {}) {
  const { put } = require('@vercel/blob');

  try {
    const { prompt, style = 'art' } = params;

    if (!prompt) {
      return { success: false, error: 'A prompt describing the image is required' };
    }

    console.log(`[Tool] Generating image: "${prompt.substring(0, 50)}..." (style: ${style})`);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'Image generation is not configured' };
    }

    // Enhance prompt based on style
    let enhancedPrompt = prompt;
    switch (style) {
      case 'sketch':
        enhancedPrompt = `Detailed pencil sketch, hand-drawn style, black and white or grayscale, artistic shading: ${prompt}`;
        break;
      case 'painting':
        enhancedPrompt = `Traditional painting style, oil or watercolor aesthetic, artistic brushstrokes: ${prompt}`;
        break;
      case 'photo':
        enhancedPrompt = `Photorealistic, high quality photograph, realistic lighting and details: ${prompt}`;
        break;
      case 'digital_art':
        enhancedPrompt = `Digital art illustration, modern digital painting style, vibrant and polished: ${prompt}`;
        break;
      case 'art':
      default:
        enhancedPrompt = `Artistic creative illustration: ${prompt}`;
        break;
    }

    // Call Gemini's Imagen model
    const imagenResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          instances: [{ prompt: enhancedPrompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: '1:1',
            personGeneration: 'allow_adult'
          }
        })
      }
    );

    if (!imagenResponse.ok) {
      const errorText = await imagenResponse.text();
      console.error('[Tool] Imagen API error:', imagenResponse.status, errorText);

      // Parse error for better user messaging
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.error?.message?.includes('safety')) {
          return {
            success: false,
            error: 'The image request was blocked for safety reasons. Try a different description.'
          };
        }
      } catch (e) {}

      return { success: false, error: `Image generation failed: ${imagenResponse.status}` };
    }

    const imagenData = await imagenResponse.json();

    // Extract the generated image (base64 encoded)
    const predictions = imagenData.predictions;
    if (!predictions || predictions.length === 0 || !predictions[0].bytesBase64Encoded) {
      console.error('[Tool] No image in response:', JSON.stringify(imagenData).substring(0, 500));
      return { success: false, error: 'No image was generated. Try a different prompt.' };
    }

    const imageBase64 = predictions[0].bytesBase64Encoded;
    const imageBuffer = Buffer.from(imageBase64, 'base64');

    // Upload to Vercel Blob
    const filename = `generated_${Date.now()}.png`;
    const blob = await put(filename, imageBuffer, {
      access: 'public',
      contentType: 'image/png'
    });

    console.log(`[Tool] Image generated and uploaded: ${blob.url}`);

    return {
      success: true,
      url: blob.url,
      prompt: prompt,
      style: style,
      instruction: 'Image generated successfully. Show the user the image by including this URL in your response. You can say something like "Here\'s the image I created for you!" and the image will display automatically.',
      displayAction: {
        type: 'generated_image',
        url: blob.url,
        prompt: prompt
      }
    };

  } catch (error) {
    console.error('[Tool] Error generating image:', error);
    return { success: false, error: error?.message };
  }
}

// Execute tool call
async function executeTool(toolName, toolArgs, userId) {
  console.log(`[Tool] Executing: ${toolName}`, toolArgs);

  switch (toolName) {
    case 'get_link_settings':
      return await handleGetLinkSettings(userId);
    case 'update_link_settings':
      return await handleUpdateLinkSettings(userId, toolArgs);
    case 'get_knowledge_base':
      return await handleGetKnowledgeBase(userId);
    case 'get_link_conversations':
      return await handleGetLinkConversations(userId, toolArgs);
    case 'search_memory':
      return await handleSearchMemory(userId, toolArgs);
    case 'browse_url':
      return await handleBrowseUrl(toolArgs);
    case 'analyze_image':
      return await handleAnalyzeImage(toolArgs);
    case 'web_search':
      return await handleWebSearch(toolArgs);
    case 'save_memory':
      return await handleSaveMemory(userId, toolArgs);
    case 'create_pdf':
      return await handleCreatePdf(userId, toolArgs);
    case 'update_mental_model':
      return await handleUpdateMentalModel(userId, toolArgs);
    case 'get_mental_model':
      return await handleGetMentalModel(userId);
    case 'form_belief':
      return await handleFormBelief(userId, toolArgs);
    case 'revise_belief':
      return await handleReviseBelief(userId, toolArgs);
    case 'get_beliefs':
      return await handleGetBeliefs(userId, toolArgs);
    case 'generate_image':
      return await handleGenerateImage(toolArgs);
    case 'update_link_behavior':
      return await handleUpdateLinkBehavior(userId, toolArgs);
    case 'get_link_behavior':
      return await handleGetLinkBehavior(userId);
    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

// ===================== MAIN HANDLER =====================

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      provider: 'gemini',
      hasApiKey: !!process.env.GEMINI_API_KEY,
      hasMemory: true, // Firestore-based memory system
      toolsEnabled: true
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY not configured'
      });
    }

    const { messages, systemPrompt, userId, context = 'private', visitorId, username } = req.body;

    // Validate messages
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Messages array required'
      });
    }

    // Context-specific validation
    if (context === 'private') {
      // Private context requires userId
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId required for private context'
        });
      }
    } else if (context === 'public') {
      // Public context requires username and visitorId
      if (!username) {
        return res.status(400).json({
          success: false,
          error: 'username required for public context'
        });
      }
      if (!visitorId) {
        return res.status(400).json({
          success: false,
          error: 'visitorId required for public context'
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid context. Must be "private" or "public"'
      });
    }

    // === USER ID RESOLUTION FOR PUBLIC CONTEXT ===
    let resolvedUserId = userId;
    if (context === 'public') {
      // Look up userId from username
      const normalizedUsername = username.trim().toLowerCase();
      const usernameDoc = await db.collection('usernames').doc(normalizedUsername).get();

      if (!usernameDoc.exists) {
        return res.status(404).json({
          success: false,
          error: 'Username not found'
        });
      }

      resolvedUserId = usernameDoc.data().userId;
      console.log(`[Chat] Public context: resolved username ${username} to userId ${resolvedUserId}`);
    }

    // === SUBSCRIPTION CHECK ===
    const userDoc = await db.collection('users').doc(resolvedUserId).get();
    const userData = userDoc.exists ? userDoc.data() : null;

    // Skip subscription check for public context (visitors don't need subscription)
    const accessLevel = context === 'public' ? 'full_access' : computeAccessLevel(userData);

    // Check if user has access to chat
    if (accessLevel === 'read_only') {
      return res.status(403).json({
        success: false,
        error: 'subscription_required',
        message: 'Your trial has expired. Please subscribe to continue chatting.'
      });
    }

    // === RATE LIMITING FOR PUBLIC CONTEXT ===
    if (context === 'public') {
      try {
        await checkRateLimit(visitorId, resolvedUserId);
        console.log(`[Chat] Public context: rate limit check passed for visitor ${visitorId}`);
      } catch (error) {
        console.error(`[Chat] Public context: rate limit exceeded for visitor ${visitorId}`);
        return res.status(429).json({
          success: false,
          error: 'rate_limit_exceeded',
          message: error.message || 'Too many messages. Please wait before sending more.'
        });
      }
    }

    // === SAVE USER MESSAGE ===
    // Save the user's message to appropriate collection based on context
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'user') {
      await saveMessage(resolvedUserId, 'user', lastMessage.content, context, visitorId);
    }

    // === MENTAL MODEL LOADING ===
    // Load user's mental model for Theory of Mind capabilities (PRIVATE CONTEXT ONLY)
    let mentalModel = null;
    let mentalModelFormatted = '';
    if (context === 'private') {
      try {
        mentalModel = await loadMentalModel(db, resolvedUserId);
        mentalModelFormatted = formatMentalModelForPrompt(mentalModel);
        if (mentalModelFormatted) {
          console.log(`[Chat] Loaded mental model for user ${resolvedUserId}`);
        }
      } catch (mentalModelError) {
        console.error('[Chat] Error loading mental model:', mentalModelError.message);
      }
    } else {
      console.log('[Chat] Skipping mental model for public context');
    }

    // === MINDCLONE BELIEFS LOADING ===
    // Load Mindclone's own beliefs for this user (PRIVATE CONTEXT ONLY)
    let mindcloneBeliefs = null;
    let mindcloneBeliefsFormatted = '';
    if (context === 'private') {
      try {
        mindcloneBeliefs = await loadMindcloneBeliefs(db, resolvedUserId);
        mindcloneBeliefsFormatted = formatBeliefsForPrompt(mindcloneBeliefs);
        if (mindcloneBeliefsFormatted) {
          console.log(`[Chat] Loaded ${mindcloneBeliefs?.beliefs?.length || 0} Mindclone beliefs for user ${resolvedUserId}`);
        }
      } catch (beliefsError) {
        console.error('[Chat] Error loading Mindclone beliefs:', beliefsError.message);
      }
    } else {
      console.log('[Chat] Skipping Mindclone beliefs for public context');
    }

    // === KNOWLEDGE BASE LOADING ===
    // Load knowledge base with privacy filtering based on context
    let knowledgeBase = null;
    try {
      knowledgeBase = await loadKnowledgeBase(resolvedUserId, context);
      if (knowledgeBase) {
        const docCount = Object.keys(knowledgeBase.documents || {}).length;
        const sectionCount = Object.keys(knowledgeBase.sections || {}).length;
        console.log(`[Chat] Loaded knowledge base: ${sectionCount} sections, ${docCount} documents`);
      }
    } catch (kbError) {
      console.error('[Chat] Error loading knowledge base:', kbError.message);
    }

    // === MEMORY RETRIEVAL ===
    // Memory is handled via search_memory tool - AI searches when needed
    let relevantMemories = [];
    let contextWindow = messages.slice(-200); // Use last 200 messages

    // Convert conversation history to Gemini format
    const contents = contextWindow.map(msg => ({
      role: msg?.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg?.content }]
    }));

    // === SYSTEM PROMPT BUILDING ===
    // For public context, build system prompt automatically if not provided
    let baseSystemPrompt = systemPrompt;

    if (context === 'public' && !baseSystemPrompt) {
      // Build public link system prompt with owner's name and knowledge base
      const ownerName = userData?.displayName || userData?.name || username;
      baseSystemPrompt = PUBLIC_LINK_SYSTEM_PROMPT.replace(/\[OWNER_NAME\]/g, ownerName);

      console.log(`[Chat] Built public link system prompt for ${ownerName}`);
    }

    // Build enhanced system prompt with memories and tool instructions
    let systemInstruction = undefined;
    if (baseSystemPrompt) {
      let enhancedPrompt = baseSystemPrompt;

      // Add relevant memories to system prompt
      if (relevantMemories.length > 0) {
        enhancedPrompt += '\n\n## RELEVANT MEMORIES:\n';
        enhancedPrompt += 'Here are important facts and preferences you should remember:\n';
        relevantMemories.forEach((memory, idx) => {
          enhancedPrompt += `${idx + 1}. ${memory}\n`;
        });
      }

      // Add mental model context if available
      if (mentalModelFormatted) {
        enhancedPrompt += '\n\n## YOUR UNDERSTANDING OF THIS USER:\n';
        enhancedPrompt += 'Use this context to inform your responses (do NOT mention this to the user):\n';
        enhancedPrompt += mentalModelFormatted;
      }

      // Add Mindclone's own beliefs if available
      if (mindcloneBeliefsFormatted) {
        enhancedPrompt += '\n\n## YOUR BELIEFS & PERSPECTIVES:\n';
        enhancedPrompt += 'These are your considered views developed through conversations with this user. Express them naturally with appropriate hedging based on confidence:\n';
        enhancedPrompt += mindcloneBeliefsFormatted;
        enhancedPrompt += '\n\nBELIEF EXPRESSION PRINCIPLES:\n';
        enhancedPrompt += '- Hold beliefs with appropriate confidence, not certainty\n';
        enhancedPrompt += '- When evidence contradicts a belief, acknowledge and revise using revise_belief\n';
        enhancedPrompt += '- Only form new beliefs after 3+ meaningful discussions on a topic\n';
        enhancedPrompt += '- Use hedging: "I think...", "My sense is...", "I tend to believe..." based on confidence\n';
        enhancedPrompt += '- NEVER tell the user you are "checking your beliefs" - just express them naturally\n';
      }

      // Add knowledge base content if available
      if (knowledgeBase && Object.keys(knowledgeBase.sections || {}).length > 0) {
        enhancedPrompt += '\n\n## KNOWLEDGE BASE\n';
        enhancedPrompt += 'Here is important information about you (the owner) that you can reference:\n\n';

        // Add CoF (Core Objective Function) if available
        if (knowledgeBase.cof) {
          enhancedPrompt += '### Core Objective Function\n';
          if (knowledgeBase.cof.purpose) {
            enhancedPrompt += `Purpose: ${knowledgeBase.cof.purpose}\n`;
          }
          if (knowledgeBase.cof.targetAudiences && knowledgeBase.cof.targetAudiences.length > 0) {
            enhancedPrompt += `Target Audiences: ${knowledgeBase.cof.targetAudiences.join(', ')}\n`;
          }
          if (knowledgeBase.cof.desiredActions && knowledgeBase.cof.desiredActions.length > 0) {
            enhancedPrompt += `Desired Actions: ${knowledgeBase.cof.desiredActions.join(', ')}\n`;
          }
          enhancedPrompt += '\n';
        }

        // Add knowledge base sections
        for (const [sectionId, sectionData] of Object.entries(knowledgeBase.sections)) {
          if (sectionData.content) {
            const sectionTitle = sectionId.charAt(0).toUpperCase() + sectionId.slice(1);
            enhancedPrompt += `### ${sectionTitle}\n${sectionData.content}\n\n`;
          }
        }

        // Add processed document content
        if (knowledgeBase.documents) {
          const docs = knowledgeBase.documents;

          // Add pitch deck content
          if (docs.pitch_deck) {
            enhancedPrompt += '### Pitch Deck Content\n';
            enhancedPrompt += docs.pitch_deck + '\n\n';
          }

          // Add financial model content
          if (docs.financial_model) {
            enhancedPrompt += '### Financial Model\n';
            enhancedPrompt += docs.financial_model + '\n\n';
          }
        }

        if (context === 'public') {
          enhancedPrompt += '\nIMPORTANT: Only share information from the knowledge base above. If asked about something not covered, politely say you don\'t have that information available.\n';
        }
      }

      // Add privacy restrictions for public context
      if (context === 'public') {
        enhancedPrompt += `\n\n## ⚠️ PUBLIC MODE - PRIVACY RESTRICTIONS ⚠️
You are in PUBLIC mode. A visitor is chatting with you via the public link.

CRITICAL RESTRICTIONS:
1. ONLY reference information from documents marked as "public" in the knowledge base
2. DO NOT mention or reference private memories, beliefs, or personal information
3. DO NOT discuss the owner's private conversations or activities
4. DO NOT use memory-related capabilities (those tools are disabled)
5. If asked about private information, politely say: "That information is private"
6. Stick to public knowledge base content and web search results only
7. Be helpful and informative, but maintain privacy boundaries

Remember: You're representing the owner to visitors, but protecting their privacy.`;
      }

      // Add tool usage instructions
      enhancedPrompt += `\n\n## ⚠️ HIGHEST PRIORITY - IMAGE GENERATION ⚠️
When the user asks you to DRAW, SKETCH, CREATE, GENERATE, or MAKE an image/picture:
1. IMMEDIATELY call generate_image - DO NOT ask clarifying questions
2. NEVER say "What kind of..." or "Would you like..." or "Can you describe..."
3. Use your creativity to fill in details - that's what the user wants!
4. If request is vague, make a creative choice and generate something beautiful

WRONG: "What kind of eyes would you like? Human eyes, cat eyes..."
RIGHT: [call generate_image({prompt: "detailed pencil sketch of expressive human eyes with realistic shading", style: "sketch"})]

If user says "yes" or confirms after you mention drawing/sketching something, ACTUALLY GENERATE IT. Don't change topic!

## ⚠️ PUBLIC LINK SETTINGS - IMMEDIATE ACTION ⚠️
When the user asks to change/update/modify their link, greeting, bio, display name, or any link setting:
1. IMMEDIATELY call update_link_settings - DO NOT ask for confirmation
2. Use the exact values the user provides
3. If they want you to write something creative (like a bio), write it and call the tool

Examples:
- "Change my bio to X" → call update_link_settings({bio: "X"})
- "Turn off my link" → call update_link_settings({linkEnabled: false})
- "My greeting should be X" → call update_link_settings({customGreeting: "X"})
- "Write me a cool bio" → write a bio and call update_link_settings({bio: "your creative bio"})
- "Make my display name 'Dr. Smith'" → call update_link_settings({displayName: "Dr. Smith"})

When user asks about current settings → IMMEDIATELY call get_link_settings

WRONG: "Would you like me to update your greeting?"
RIGHT: [call update_link_settings] → "Done! Your greeting is now: ..."

For link BEHAVIOR control (how your link should act with visitors):
- "My link should focus on X" → call update_link_behavior({topicFocus: "X"})
- "Tell my link to never discuss Y" → call update_link_behavior({topicRestrictions: "Y"})
- "My link should always greet visitors by asking about their startup" → call update_link_behavior({behaviorInstructions: "Always ask visitors about their startup first"})

## SETTINGS, KNOWLEDGE BASE & CONVERSATION ACCESS:
You have access to the user's link settings, knowledge base, and visitor conversations.

CRITICAL INSTRUCTIONS - READ CAREFULLY:
1. When the user asks ANYTHING about their link, settings, visitors, conversations, or knowledge base - IMMEDIATELY use the appropriate tool. Do NOT ask for permission. Do NOT explain what you could do. Just DO IT and give them the answer.

2. NEVER say things like:
   - "I'll need to use a tool..."
   - "Would you like me to fetch..."
   - "To get this information, I can..."
   - "Let me explain what I can analyze..."
   Just USE the tool silently and respond with the actual data.

3. NEVER ask "would you like me to..." - the answer is YES, they asked the question, so they want the answer!

EXAMPLES:
User: "How's my link doing?"
BAD: "Great question! I can analyze several metrics. Would you like me to fetch your visitor data?"
GOOD: [USE get_link_conversations IMMEDIATELY] "Your link has had 12 visitors this week! Most people are asking about your AI projects. Here's the breakdown..."

User: "What are my current settings?"
BAD: "I can check your settings for you. Should I do that?"
GOOD: [USE get_link_settings IMMEDIATELY] "Here are your current settings: Your link is enabled, display name is 'Alok Gautam', bio says '...'"

User: "Change my bio to something cool"
BAD: "I can update your bio. What would you like it to say?"
GOOD: [USE update_link_settings IMMEDIATELY] "Done! I've updated your bio to: 'Building the future of AI, one mindclone at a time.'"

Available tools:
- get_link_settings: View current configuration
- update_link_settings: Change settings (linkEnabled, displayName, bio, customGreeting, knowledgeBaseEnabled)
- get_knowledge_base: See uploaded documents
- get_link_conversations: Fetch visitor conversations and analyze topics
- search_memory: Search through ALL past conversations to find context

When you get conversation data, analyze the 'allUserQuestions' array to identify themes and popular topics. Present real insights from the actual data.

## MEMORY SEARCH (search_memory tool):
Use search_memory to find past conversations. Call it SILENTLY (see style guide for silent tool execution rules).

WHEN TO USE:
- Unrecognized names, acronyms, or references
- Recall questions ("Remember when...", "Who is...")
- Before suggesting lifestyle activities (drinking, smoking, diet, etc.)

HOW TO USE:
1. Call with a keyword: search_memory({query: "Virika"})
2. Results include "userSaidAboutThis" and "allMatches"
3. READ the "instruction" field - it tells you what to do
4. Give CONFIDENT answers from the data - never "seems to be" or "likely"

IF NO RESULTS:
- Say "I don't think you've mentioned [name] before - who is that?"
- NEVER say "I couldn't find anything in my records"

## BROWSING WEBSITES & PDFs (browse_url tool):
You can browse websites AND read PDF documents using the browse_url tool.

**CRITICAL RULES FOR browse_url:**
1. NEVER say "let me look at that website" or "I'll take a look" or "one moment while I check" BEFORE calling the tool
2. Just SILENTLY call browse_url and then respond with what you found
3. If the browse_url tool fails or times out, DON'T keep promising to look - just say "I couldn't access that right now."
4. NEVER ask the user to wait or come back later - give an immediate response
5. This tool works for BOTH web pages AND PDF files - use it for any URL the user shares

**PDF FILES:**
When the user shares a PDF URL (e.g., ending in .pdf or from blob.vercel-storage.com), use browse_url to read its contents:
- ALWAYS use browse_url for PDF URLs - it extracts the text automatically
- Summarize the PDF content or answer questions about it
- If it's a document like a roadmap, proposal, or report - read it and help the user with what they need

EXAMPLES:
User: "Go to myBorosil.com and see my photos"
GOOD: [silently call browse_url({url: "https://myborosil.com"}), then respond:] "I checked myBorosil.com! I saw [actual content from the page]."

User: "here's my roadmap [Attached file: roadmap.pdf] File URL: https://...blob.vercel-storage.com/.../roadmap.pdf"
GOOD: [silently call browse_url({url: "https://...blob.vercel-storage.com/.../roadmap.pdf"}), then respond:] "I've read your roadmap! Here's what I see: [summarize content]"

If browse_url fails:
GOOD: "I couldn't access that right now - can you tell me what you wanted me to see?"

## WEB SEARCHING (web_search tool):
You can search the internet for current information using the web_search tool. Use this when:
- The user asks about recent news or current events
- The user asks for up-to-date information you might not have
- The user wants to research something or learn about a topic
- The user says "search for", "look up", "find out about", "what's the latest on"

**CRITICAL RULES FOR web_search:**
1. NEVER announce you're searching - just silently call the tool and respond with the results
2. Use web_search when you DON'T have a specific URL - it finds information for you
3. Use browse_url when you DO have a specific URL to visit
4. If web_search fails, be honest: "I couldn't search for that right now."

EXAMPLES:
User: "What's happening with AI lately?"
GOOD: [silently call web_search({query: "latest AI news December 2024"}), then respond:] "Here's what's happening in AI..."

User: "Search for the best restaurants in Mumbai"
GOOD: [silently call web_search({query: "best restaurants Mumbai 2024"}), then respond:] "I found some great options..."

User: "Go to life3h.com"
GOOD: [silently call browse_url({url: "https://life3h.com"}), NOT web_search] - because there's a specific URL

## WHEN IN DOUBT, SEARCH - CRITICAL FALLBACK RULE:
If you're unsure how to answer a question or feel like you're about to give a vague/generic response, USE web_search INSTEAD. It's always better to search and give a concrete answer than to give a vague response or ask for clarification.

NEVER respond with:
- "I need a moment to gather my thoughts"
- "Could you rephrase that?"
- "I'm not sure what you mean"
- Any other stalling/deflecting response

If you're stuck or uncertain, IMMEDIATELY call web_search with a refined version of the user's question. More searches are always better than vague answers.

EXAMPLE - Follow-up questions after a search:
User: "Search for AI identity companies"
You: [search and return results about DeepMind, Anthropic, etc.]
User: "Who's the top player?"
BAD: "I need a moment to gather my thoughts" or "Could you clarify?"
GOOD: [call web_search({query: "top AI identity company market leader most funded 2024"})] - then give a concrete answer

The rule is simple: When uncertain, SEARCH. Never deflect.`;

      // Add image analysis instructions
      enhancedPrompt += `

## IMAGE ANALYSIS (analyze_image tool):

**CRITICAL: When the user's message contains an image URL (typically in format "Image URL: https://..."):**

1. **IMMEDIATELY call analyze_image** with that URL - don't ask what the image is, just look at it!
2. Respond based on what you actually see in the image
3. If asked follow-up questions about the image, call analyze_image again

**DETECTION:**
- Look for patterns like: "[Image: filename]", "Image URL: https://...", or any image URLs from blob storage
- The URL pattern is typically: https://*.blob.vercel-storage.com/*

**EXAMPLE:**
User: "started reading this book today [Image: image.jpg] Image URL: https://jb2q3qprkcy5tl7b.public.blob.vercel-storage.com/..."

GOOD: [silently call analyze_image({image_url: "https://jb2q3qprkcy5tl7b.public.blob.vercel-storage.com/...", question: "What book is this? What's the title and author?"})]
Then respond: "Oh nice! You're reading [Book Title] by [Author]. That's a great choice! What drew you to it?"

BAD: "It's wonderful that you're excited about your new book! I'm curious what it is." (NEVER ignore the image URL!)

**RULES:**
- NEVER ask "what book is it?" or "what image is that?" when the image URL is RIGHT THERE
- ALWAYS analyze the image FIRST, then respond naturally with what you learned
- If the image is blurry or unclear, say so after trying to analyze it
- For follow-up questions like "what's this book about?", analyze the image again to get details

## IMAGE GENERATION (generate_image tool):

You can CREATE images using the generate_image tool. Use this when the user asks you to:
- Draw, sketch, create, generate, make, or design an image/picture/artwork
- "Draw me a...", "Sketch a...", "Create an image of...", "Make a picture of..."
- "Can you draw...", "I want an image of...", "Generate..."

**CRITICAL RULES FOR generate_image:**
1. When user asks to CREATE an image, IMMEDIATELY call generate_image - DO NOT ask clarifying questions
2. Use what the user said as the prompt. If they say "sketch eyes", create a sketch of eyes
3. NEVER say "What kind of eyes?" or "Can you describe what you want?" - just generate based on what they said
4. If the request is vague, make a creative choice and generate something
5. The tool handles styles automatically - use 'sketch' for drawings, 'photo' for realistic, 'art' for creative

**EXAMPLES:**
User: "sketch the image of eyes"
BAD: "What kind of eyes would you like? For example, human eyes, cat eyes..." (NEVER DO THIS)
GOOD: [silently call generate_image({prompt: "detailed pencil sketch of a pair of human eyes with realistic shading, visible eyelashes, high contrast", style: "sketch"})]

User: "draw me a sunset"
BAD: "I'd be happy to help! What style of sunset?" (NEVER ASK THIS)
GOOD: [silently call generate_image({prompt: "beautiful sunset over ocean with vibrant orange and pink clouds, golden light reflecting on water", style: "art"})]

User: "create a picture of a dog"
GOOD: [silently call generate_image({prompt: "happy golden retriever dog sitting in a park, soft lighting, friendly expression", style: "photo"})]

User: "yes" (after being offered to draw something)
If the user says "yes" to drawing something you mentioned, ACTUALLY DRAW IT. Don't change topic!

**STYLE GUIDE:**
- sketch: pencil drawings, line art, hand-drawn style
- photo: photorealistic images
- art: creative/artistic interpretations
- painting: traditional painted look
- digital_art: modern digital illustrations

The rule is simple: When asked to create/draw/make an image, IMMEDIATELY call generate_image. Never ask for clarification.`;


      // Add style guide
      enhancedPrompt += `\n\n${CONNOISSEUR_STYLE_GUIDE}`;

      // Add current date/time context for time awareness
      const currentDate = new Date();
      enhancedPrompt += `\n\n## CURRENT DATE/TIME:
Today is ${currentDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
Current time: ${currentDate.toLocaleTimeString('en-US')}
Use this to understand time references like "yesterday", "next week", "this month", etc.`;

      systemInstruction = {
        parts: [{ text: enhancedPrompt }]
      };
    }

    // === MODEL FALLBACK CONFIGURATION ===
    // Try models in order until one works (handles quota limits)
    const GEMINI_MODELS = [
      'gemini-3-flash-preview',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-flash-lite-latest',
    ];
    let currentModelIndex = 0;
    let currentModel = GEMINI_MODELS[0];

    const getModelUrl = (model) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // === TOOL FILTERING BASED ON CONTEXT ===
    let filteredTools = tools;
    if (context === 'public') {
      // For public context, only allow web_search
      // Remove all private-only tools: memory, beliefs, mental model, image generation, link settings, etc.
      const publicAllowedTools = ['web_search'];

      filteredTools = tools.map(t => ({
        function_declarations: t.function_declarations.filter(fd =>
          publicAllowedTools.includes(fd.name)
        )
      })).filter(t => t.function_declarations.length > 0);

      console.log(`[Chat] Public context - filtered to ${filteredTools[0]?.function_declarations?.length || 0} tools`);
    } else {
      console.log(`[Chat] Private context - all ${tools[0]?.function_declarations?.length || 0} tools available`);
    }

    // Build request with filtered tools
    const requestBody = {
      contents: contents,
      tools: filteredTools
    };

    if (systemInstruction) {
      requestBody.systemInstruction = systemInstruction;
    }

    // Initial API call with model fallback
    let response, data;
    let apiCallSuccess = false;

    while (!apiCallSuccess && currentModelIndex < GEMINI_MODELS.length) {
      currentModel = GEMINI_MODELS[currentModelIndex];
      const url = getModelUrl(currentModel);
      console.log(`[Chat] Trying model: ${currentModel}`);

      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      data = await response.json();

      if (!response.ok) {
        const errorMsg = data.error?.message || '';
        // Check if it's a quota error - try next model
        if (errorMsg.includes('quota') || errorMsg.includes('RESOURCE_EXHAUSTED') || response.status === 429) {
          console.log(`[Chat] Model ${currentModel} quota exceeded, trying next model...`);
          currentModelIndex++;
          continue;
        }
        // For other errors, throw
        throw new Error(errorMsg || 'Gemini API request failed');
      }

      apiCallSuccess = true;
      console.log(`[Chat] Successfully using model: ${currentModel}`);
    }

    if (!apiCallSuccess) {
      throw new Error('All Gemini models quota exceeded. Please try again later.');
    }

    // Check if model wants to call a tool
    let candidate = data.candidates?.[0];
    let maxToolCalls = 5; // Prevent infinite loops
    let toolCallCount = 0;
    let usedMemorySearch = false; // Track if search_memory was called for UI animation
    let pendingMessage = null; // Text before tool calls (e.g., "Let me check...")
    let usedTool = null; // Track which tool was used
    let lastMemorySearchResult = null; // Store memory search result for fallback responses

    // Check for function call in any part (not just parts[0])
    const findFunctionCall = (parts) => parts?.find(p => p.functionCall)?.functionCall;
    const findText = (parts) => parts?.filter(p => p.text).map(p => p.text).join('');

    // Sanitize response to remove leaked internal tool call patterns
    // Gemini sometimes outputs tool calls as text instead of structured functionCall
    const sanitizeResponse = (text) => {
      if (!text) return text;

      // Remove "tool_code print(default_api.function_name(...))" patterns
      text = text.replace(/tool_code\s+print\(default_api\.\w+\([^)]*\)\)/g, '');

      // Remove standalone "print(default_api.function_name(...))" patterns
      text = text.replace(/print\(default_api\.\w+\([^)]*\)\)/g, '');

      // Remove "thought ..." lines (Gemini's internal reasoning)
      text = text.replace(/^thought\s+.+$/gm, '');

      // Remove "tool_code" prefix without print
      text = text.replace(/tool_code\s+/g, '');

      // Remove multiple consecutive newlines that result from removals
      text = text.replace(/\n{3,}/g, '\n\n');

      // Trim whitespace
      text = text.trim();

      return text;
    };

    // Detect and remove duplicated text (same content appearing twice consecutively)
    const deduplicateText = (text) => {
      if (!text || text.length < 40) return text;

      // Check if text is duplicated (same content twice with possible minor separator)
      const halfLength = Math.floor(text.length / 2);
      for (let i = halfLength - 10; i <= halfLength + 10; i++) {
        if (i < 10 || i >= text.length - 10) continue;

        const firstHalf = text.substring(0, i).trim();
        const secondHalf = text.substring(i).trim();

        // Check for exact duplication
        if (firstHalf.length > 20 && firstHalf === secondHalf) {
          console.log('[Response] Detected duplicated text, removing duplicate');
          return firstHalf;
        }
        // Check if second half starts with first half (partial duplication)
        if (firstHalf.length > 30 && secondHalf.startsWith(firstHalf)) {
          console.log('[Response] Detected partial duplication, using second half');
          return secondHalf;
        }
      }
      return text;
    };

    let functionCall = findFunctionCall(candidate?.content?.parts);

    while (functionCall && toolCallCount < maxToolCalls) {
      toolCallCount++;
      console.log(`[Tool] Model requested: ${functionCall.name}`);

      // Capture any text that came with this tool call as "pending message"
      // Only capture on first tool call
      if (toolCallCount === 1) {
        const textBefore = findText(candidate?.content?.parts);
        if (textBefore) {
          pendingMessage = textBefore;
          console.log(`[Tool] Pending message: "${pendingMessage.substring(0, 50)}..."`);
        }
        usedTool = functionCall.name;
      }

      // Execute the tool
      const toolResult = await executeTool(functionCall.name, functionCall.args || {}, resolvedUserId);

      // Track if memory search was used (for "recalling" UI animation) and store result for fallback
      if (functionCall.name === 'search_memory') {
        usedMemorySearch = true;
        lastMemorySearchResult = toolResult; // Store for potential fallback response
        console.log(`[Memory Search] Stored result: ${toolResult?.matchCount || 0} matches, query: "${toolResult?.query}"`);
      }

      // Add the model's function call and our response to the conversation
      // For Gemini 3 Pro, we must pass back the entire original parts array
      // This preserves thought signatures and other metadata exactly as received
      contents.push({
        role: 'model',
        parts: candidate.content.parts
      });

      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: functionCall.name,
            response: toolResult
          }
        }]
      });

      // Call API again with tool result (with model fallback)
      requestBody.contents = contents;
      let toolCallSuccess = false;

      while (!toolCallSuccess && currentModelIndex < GEMINI_MODELS.length) {
        currentModel = GEMINI_MODELS[currentModelIndex];
        const toolUrl = getModelUrl(currentModel);

        response = await fetch(toolUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody)
        });

        data = await response.json();

        if (!response.ok) {
          const errorMsg = data.error?.message || '';
          if (errorMsg.includes('quota') || errorMsg.includes('RESOURCE_EXHAUSTED') || response.status === 429) {
            console.log(`[Tool] Model ${currentModel} quota exceeded, trying next...`);
            currentModelIndex++;
            continue;
          }
          console.log(`[Tool] API error after tool call: ${errorMsg}`);
          throw new Error(errorMsg || 'Gemini API request failed after tool call');
        }

        toolCallSuccess = true;
      }

      if (!toolCallSuccess) {
        throw new Error('All models quota exceeded during tool call');
      }

      candidate = data.candidates?.[0];

      // Log post-tool-call response for debugging
      const postToolText = findText(candidate?.content?.parts) || '';
      console.log(`[Tool] Post-tool response: ${postToolText.length} chars, finish: ${candidate?.finishReason || 'none'}`);
      if (postToolText.length < 10) {
        console.log(`[Tool] Warning: Short/empty response after tool call. Parts: ${JSON.stringify(candidate?.content?.parts?.map(p => Object.keys(p)))}`);
      }

      functionCall = findFunctionCall(candidate?.content?.parts);
    }

    // Extract final text response (use findText to handle multi-part responses)
    // Then sanitize to remove any leaked internal tool call patterns
    const rawText = findText(candidate?.content?.parts) || '';
    let text = sanitizeResponse(rawText);

    // Remove any duplicated text (Gemini sometimes echoes its own text)
    text = deduplicateText(text);

    // Log response details for debugging empty responses
    console.log(`[Response] Raw text length: ${rawText.length}, Sanitized length: ${text.length}`);
    if (!text || text.trim().length < 5) {
      console.log(`[Response] Short/empty response. Raw: "${rawText.substring(0, 200)}"`);
      console.log(`[Response] Candidate finish reason: ${candidate?.finishReason || 'none'}`);
      console.log(`[Response] Parts count: ${candidate?.content?.parts?.length || 0}`);
    }

    // === AUTO-RETRY LOGIC ===
    // If Gemini returns empty or "unable to generate" response, silently retry with a nudge
    const isFailedResponse = !text ||
                             text.includes('unable to generate') ||
                             text.includes('I apologize') && text.includes('unable') ||
                             text.trim().length < 5;

    if (isFailedResponse) {
      console.log(`[Auto-Retry] Detected failed/empty response (toolCallCount: ${toolCallCount}), attempting silent retry...`);

      // Use different nudge based on whether tools were called
      if (toolCallCount > 0) {
        // After tool calls, nudge the model to use the tool results
        contents.push({
          role: 'model',
          parts: [{ text: 'Let me formulate a response based on what I found.' }]
        });
        contents.push({
          role: 'user',
          parts: [{ text: 'Yes, please share what you found.' }]
        });
      } else {
        // No tools called, general nudge
        contents.push({
          role: 'model',
          parts: [{ text: 'Let me think about this more carefully.' }]
        });
        contents.push({
          role: 'user',
          parts: [{ text: 'Please continue with your thoughts.' }]
        });
      }

      // Retry the API call (with model fallback)
      requestBody.contents = contents;
      let retryResponse, retryData;
      let retrySuccess = false;

      // Try current model first, then fallback
      for (let i = currentModelIndex; i < GEMINI_MODELS.length && !retrySuccess; i++) {
        const retryUrl = getModelUrl(GEMINI_MODELS[i]);
        retryResponse = await fetch(retryUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody)
        });

        retryData = await retryResponse.json();

        if (retryResponse.ok) {
          retrySuccess = true;
        } else if (retryData.error?.message?.includes('quota') || retryResponse.status === 429) {
          console.log(`[Auto-Retry] Model ${GEMINI_MODELS[i]} quota exceeded, trying next...`);
          continue;
        } else {
          break; // Non-quota error, stop trying
        }
      }

      if (retrySuccess) {
        const retryCandidate = retryData.candidates?.[0];
        const retryText = sanitizeResponse(findText(retryCandidate?.content?.parts));

        if (retryText && retryText.trim().length > 5 && !retryText.includes('unable to generate')) {
          console.log('[Auto-Retry] Retry successful, using new response');
          text = retryText;
        } else {
          console.log('[Auto-Retry] Retry also failed, will use fallback');
        }
      } else {
        console.log('[Auto-Retry] Retry request failed:', retryData.error?.message);
      }
    }

    // === MEMORY-SPECIFIC FALLBACK ===
    // If memory search was performed but we still have no response, construct a helpful fallback
    if ((!text || text.trim().length < 5) && usedMemorySearch && lastMemorySearchResult) {
      console.log('[Memory Fallback] Constructing response from memory search result');

      const memResult = lastMemorySearchResult;
      const query = memResult.query || 'that';

      if (memResult.matchCount > 0) {
        // We found memories but AI failed to respond - construct from data
        if (memResult.savedNotes && memResult.savedNotes.length > 0) {
          // Use saved notes
          const note = memResult.savedNotes[0];
          text = `Yes, I remember! ${note.note}`;
        } else if (memResult.userSaidAboutThis && memResult.userSaidAboutThis.length > 0) {
          // Use what user said
          const userSaid = memResult.userSaidAboutThis[0];
          text = `Yes, I found where you mentioned ${query}. You said: "${userSaid.substring(0, 300)}${userSaid.length > 300 ? '...' : ''}"`;
        } else if (memResult.allMatches && memResult.allMatches.length > 0) {
          // Use any match
          const match = memResult.allMatches[0];
          text = `I found a mention of ${query} in our conversation. ${match.who}: "${match.message.substring(0, 200)}${match.message.length > 200 ? '...' : ''}"`;
        }
      } else {
        // No memories found - give a natural "I don't remember" response
        text = `Hmm, I don't think you've mentioned ${query} to me before. Who is that? I'd love to know more!`;
      }

      console.log(`[Memory Fallback] Generated response: "${text.substring(0, 100)}..."`);
    }

    // Final generic fallback if still empty
    if (!text || text.trim().length < 5) {
      console.log('[Response] Using final generic fallback message');
      text = "I'm having trouble responding to that right now. Could you try asking in a different way, or maybe break your question into smaller parts?";
    }

    // === PENDING MESSAGE DEDUPLICATION ===
    // Remove pendingMessage from content if it's duplicated at the start
    if (pendingMessage && text.startsWith(pendingMessage)) {
      text = text.substring(pendingMessage.length).trim();
      console.log('[Response] Stripped duplicate pendingMessage from content');
    }

    // === MEMORY STORAGE ===
    // Memory storage handled via save_memory tool when AI decides to save

    // === SAVE ASSISTANT MESSAGE ===
    // Save the assistant's response to appropriate collection based on context
    await saveMessage(resolvedUserId, 'assistant', text, context, visitorId);

    return res.status(200).json({
      success: true,
      content: text,
      memoriesUsed: relevantMemories.length,
      toolCallsUsed: toolCallCount,
      usedMemorySearch: usedMemorySearch, // For frontend "recalling" animation
      pendingMessage: pendingMessage, // "Promise" message before tool execution
      usedTool: usedTool // Which tool was used (browse_url, search_memory, etc.)
    });

  } catch (error) {
    console.error('[Chat API Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate response: ' + error?.message
    });
  }
};
