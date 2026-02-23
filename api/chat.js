// OpenAI API handler with Tool Calling (upgraded from Claude)
// Memory system uses Firestore (users/{userId}/memories collection)
const { CONNOISSEUR_STYLE_GUIDE } = require('./_style-guide');
const { initializeFirebaseAdmin, admin } = require('./_firebase-admin');
const { computeAccessLevel } = require('./_billing-helpers');
const { loadMentalModel, updateMentalModel, formatMentalModelForPrompt } = require('./_mental-model');
const { loadMindcloneBeliefs, formBelief, reviseBelief, getBeliefs, formatBeliefsForPrompt } = require('./_mindclone-beliefs');

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();
const db = admin.firestore();

// ===================== FORMAT CONVERTERS FOR CLAUDE API =====================
// Convert Gemini-style tools to Claude-style tools
function convertToolsToClaude(geminiTools) {
  const claudeTools = [];
  for (const toolGroup of geminiTools) {
    for (const func of toolGroup.function_declarations || []) {
      claudeTools.push({
        name: func.name,
        description: func.description,
        input_schema: func.parameters
      });
    }
  }
  return claudeTools;
}

// Convert Gemini-style messages to Claude-style messages (system separate)
function convertMessagesToClaude(geminiContents, systemPrompt = null) {
  const messages = [];

  for (const msg of geminiContents) {
    const role = msg.role === 'model' ? 'assistant' : (msg.role === 'user' ? 'user' : msg.role);

    // Skip system messages (handled separately)
    if (role === 'system') continue;

    if (msg.parts) {
      const textParts = msg.parts.filter(p => p.text).map(p => p.text).join('');
      const functionCall = msg.parts.find(p => p.functionCall);
      const functionResponse = msg.parts.find(p => p.functionResponse);

      if (functionCall) {
        // Assistant message with tool use
        const content = [];
        if (textParts) {
          content.push({ type: 'text', text: textParts });
        }
        content.push({
          type: 'tool_use',
          id: `toolu_${Date.now()}`,
          name: functionCall.functionCall.name,
          input: functionCall.functionCall.args || {}
        });
        messages.push({ role: 'assistant', content });
      } else if (functionResponse) {
        // Tool result message
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: `toolu_${Date.now() - 1}`,
            content: JSON.stringify(functionResponse.functionResponse.response)
          }]
        });
      } else if (textParts) {
        // Regular message
        messages.push({ role, content: textParts });
      }
    } else if (msg.content) {
      messages.push({ role, content: msg.content });
    }
  }

  return { system: systemPrompt, messages };
}

// ===================== CLAUDE API ADAPTER =====================
// Calls Anthropic Claude API using OpenAI-format request/response for minimal code changes
async function callClaudeAPI(openaiRequestBody, claudeApiKey) {
  // Extract system message
  const systemMsg = openaiRequestBody.messages.find(m => m.role === 'system');
  const nonSystemMsgs = openaiRequestBody.messages.filter(m => m.role !== 'system');

  // Convert OpenAI messages to Claude format
  const claudeMessages = [];
  for (const msg of nonSystemMsgs) {
    if (msg.role === 'tool') {
      // Tool result — Claude uses role: 'user' with tool_result content
      claudeMessages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id, content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }]
      });
    } else if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // Assistant with tool calls
      const content = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      for (const tc of msg.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || '{}')
        });
      }
      claudeMessages.push({ role: 'assistant', content });
    } else if (msg.role === 'assistant') {
      claudeMessages.push({ role: 'assistant', content: msg.content || '' });
    } else {
      // User message
      claudeMessages.push({ role: 'user', content: msg.content || '' });
    }
  }

  // Merge consecutive same-role messages (Claude doesn't allow them)
  const mergedMessages = [];
  for (const msg of claudeMessages) {
    const prev = mergedMessages[mergedMessages.length - 1];
    if (prev && prev.role === msg.role) {
      // Merge: convert both to array content format if needed
      const prevContent = Array.isArray(prev.content) ? prev.content : [{ type: 'text', text: prev.content || '' }];
      const currContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content || '' }];
      prev.content = [...prevContent, ...currContent];
    } else {
      mergedMessages.push(msg);
    }
  }

  // Ensure first message is from user (Claude requirement)
  if (mergedMessages.length === 0 || mergedMessages[0].role !== 'user') {
    mergedMessages.unshift({ role: 'user', content: 'Hello' });
  }

  // Convert OpenAI tools to Claude tools
  const claudeTools = (openaiRequestBody.tools || []).map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters
  }));

  const claudeRequest = {
    model: openaiRequestBody.model,
    max_tokens: openaiRequestBody.max_tokens || 4096,
    system: systemMsg?.content || undefined,
    messages: mergedMessages,
    tools: claudeTools.length > 0 ? claudeTools : undefined
  };

  console.log(`[Claude API] Calling ${claudeRequest.model} with ${mergedMessages.length} messages, ${claudeTools.length} tools`);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(claudeRequest)
  });

  const data = await response.json();

  if (!response.ok) {
    const errorMsg = data.error?.message || JSON.stringify(data.error) || JSON.stringify(data);
    console.error(`[Claude API] Error ${response.status}: ${errorMsg}`);
    return { ok: false, status: response.status, data: { error: { message: errorMsg } } };
  }

  // Convert Claude response to OpenAI format
  const textParts = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const toolUse = (data.content || []).find(c => c.type === 'tool_use');

  const openaiResponse = {
    choices: [{
      message: {
        content: textParts || null,
        tool_calls: toolUse ? [{
          id: toolUse.id,
          type: 'function',
          function: {
            name: toolUse.name,
            arguments: JSON.stringify(toolUse.input || {})
          }
        }] : null
      },
      finish_reason: data.stop_reason === 'tool_use' ? 'tool_calls' : 'stop'
    }]
  };

  return { ok: true, status: 200, data: openaiResponse };
}

// ===================== FORMAT CONVERTERS FOR xAI API (LEGACY) =====================
// Convert Gemini-style tools to OpenAI-style tools
function convertToolsToOpenAI(geminiTools) {
  const openaiTools = [];
  for (const toolGroup of geminiTools) {
    for (const func of toolGroup.function_declarations || []) {
      openaiTools.push({
        type: "function",
        function: {
          name: func.name,
          description: func.description,
          parameters: func.parameters
        }
      });
    }
  }
  return openaiTools;
}

// Convert Gemini-style messages to OpenAI-style messages
function convertMessagesToOpenAI(geminiContents, systemPrompt = null) {
  const messages = [];

  // Add system message if provided
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  for (const msg of geminiContents) {
    const role = msg.role === 'model' ? 'assistant' : msg.role;

    // Handle tool calls in assistant messages
    if (msg.parts) {
      const textParts = msg.parts.filter(p => p.text).map(p => p.text).join('');
      const functionCall = msg.parts.find(p => p.functionCall);
      const functionResponse = msg.parts.find(p => p.functionResponse);

      if (functionCall) {
        // This is an assistant message with a tool call
        messages.push({
          role: 'assistant',
          content: textParts || null,
          tool_calls: [{
            id: `call_${Date.now()}`,
            type: 'function',
            function: {
              name: functionCall.functionCall.name,
              arguments: JSON.stringify(functionCall.functionCall.args || {})
            }
          }]
        });
      } else if (functionResponse) {
        // This is a tool response
        messages.push({
          role: 'tool',
          tool_call_id: `call_${Date.now() - 1}`,
          content: JSON.stringify(functionResponse.functionResponse.response)
        });
      } else {
        // Regular message
        messages.push({
          role: role,
          content: textParts || ''
        });
      }
    } else if (msg.content) {
      // Already in simple format
      messages.push({
        role: role,
        content: msg.content
      });
    }
  }

  return messages;
}

// ===================== PUBLIC LINK SYSTEM PROMPT =====================
const PUBLIC_LINK_SYSTEM_PROMPT = `You are a personal AI assistant. You represent someone's knowledge, personality, and expertise.

## YOUR IDENTITY
[IDENTITY_SECTION]

## HOW TO SPEAK
You speak with full authority in first person about the knowledge and work:
- Use "my business", "my startup", "my work" when discussing their professional life
- Speak with complete confidence
- You embody their perspective and knowledge authentically

## FORMATTING RULES — VERY IMPORTANT
- NEVER use markdown formatting like **bold**, *italics*, ### headers, or bullet points in your responses
- Write in plain, natural conversational text — like a human texting or chatting
- No asterisks, no bullet lists, no numbered lists, no headers
- Keep replies short and casual — this is a chat, not a document
- Use line breaks for readability, but no fancy formatting

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
- Bank accounts, passwords, social security numbers
- Private family details, health conditions
- Anything explicitly marked as private

NOTE: The owner's contact email and phone/WhatsApp (if configured below) are ALLOWED to be shared freely with anyone who asks.

## WHAT YOU CAN DISCUSS FREELY
- ALL business/startup information (pitch, financials, strategy)
- Professional background and expertise
- Projects, achievements, public work
- Opinions, philosophy, interests
- Anything in the knowledge base

## CRITICAL: PROFESSIONAL INFO — ONLY FROM KNOWLEDGE BASE
When discussing the owner's profession, company, work, startup, or business:
- ONLY use information that exists in the knowledge base documents
- DO NOT make up or guess professional details, company names, product info, or roles
- DO NOT invent business metrics, team details, or company history
- If the knowledge base has no info about a topic, say "I'd recommend asking [OWNER_NAME] directly about that"
- The knowledge base is the SINGLE SOURCE OF TRUTH for all professional/business information

## CAPABILITIES - WHAT YOU CAN AND CANNOT DO
IMPORTANT: Be honest about your capabilities. Do NOT claim abilities you don't have.

YOU CAN:
- Search the web using web_search tool
- Remember conversations with visitors
- Access your knowledge base

YOU CANNOT:
- Generate images - IMAGE GENERATION IS TEMPORARILY UNAVAILABLE
- Generate videos - VIDEO GENERATION IS NOT AVAILABLE
- Make phone calls or send SMS
- Access real-time location data
- Execute code or run programs

If someone asks you to generate an IMAGE or VIDEO:
- Say "I can't generate images or videos right now, but I can help you find images online using web search!"
- Offer to search for relevant images instead
- Do NOT claim you are generating an image or video

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

## BE PROACTIVE - DO, DON'T EXPLAIN
CRITICAL RULE: You are a HELPER, not a tour guide. When someone asks for help, DELIVER results directly - don't explain how they can do it themselves.

DO THE WORK:
- When asked to find something → SEARCH and return results
- When asked for suggestions → GENERATE many options (10+)
- When asked to research → DO the research and summarize findings
- When asked to compare → MAKE the comparison with specific details
- NEVER say "you can go to [website] and search for..."
- NEVER delegate work back to the user

GIVE ABUNDANT OPTIONS:
When asked for name ideas, suggestions, options, or recommendations:
- Give AT LEAST 10 options, not 2-3
- Include a mix of creative and practical choices
- Explain briefly why each one works
- If they want more, give 10 more without hesitation

USE TOOLS AUTOMATICALLY:
- Don't ask permission to search - just search
- Don't explain what tools you have - just use them
- Don't disclaim before acting - act first, explain if asked
- If you CAN do something, DO IT immediately

EXAMPLES:
❌ BAD: "You can search on Namebase.io for available Handshake domains"
✅ GOOD: *searches* "Here are 15 available Handshake domains: 1) mindclone/ 2) olbrain/ 3) ..."

❌ BAD: "I suggest checking LinkedIn or Crunchbase for AI founders in India"
✅ GOOD: *searches* "I found these AI founders in India: 1) [Name] - CEO of [Company]..."

❌ BAD: "Here are 3 name suggestions: Alpha, Beta, Gamma"
✅ GOOD: "Here are 12 name suggestions, organized by style:
Modern: Nova, Pulse, Flux, Vector
Classic: Atlas, Sage, Beacon, Prism
Playful: Spark, Zippy, Nimble, Whiz"

THE RULE: If the user is asking you to DO something, don't EXPLAIN how to do it. DO IT.

## SPEAKING STYLE
- First person: "I", "my", "me"
- Confident and direct
- Enthusiastic about your work
- Knowledgeable without being arrogant
- Personal and warm
- Use line breaks between paragraphs for readability
- NEVER use markdown formatting like **bold**, *italics*, or # headers - write plain text only
- NEVER show internal tool calls in your response - no brackets like "[silently call...]", no function names, no tool notation
- NEVER output placeholder text like "[mention X]", "[insert Y]", or "[e.g., example]" - always write actual content

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

## 🎯 LEAD CAPTURE - IDENTIFYING & CONNECTING IMPORTANT VISITORS
You are also a smart business card. When you detect someone who could be valuable to [OWNER_NAME], proactively capture their information and offer to connect them.

DETECT THESE VISITOR TYPES:
1. INVESTORS: Ask about funding, valuation, cap table, burn rate, runway, term sheets, portfolio
2. POTENTIAL PARTNERS: Discuss collaboration, integration, partnership, business development
3. INDUSTRY EXPERTS: Show deep domain knowledge, offer insights, ask sophisticated questions
4. MEDIA/JOURNALISTS: Ask about press, coverage, interviews, quotes
5. POTENTIAL CUSTOMERS: Show serious buying intent, ask about pricing, implementation
6. FELLOW FOUNDERS: Discuss their own startups, fundraising, similar challenges

[GOAL_BASED_BEHAVIOR]

WHEN YOU DETECT A QUALIFIED LEAD:
1. Continue the natural conversation - don't be abrupt
2. After 3-5 good exchanges, smoothly ask for an introduction:
   - "By the way, I'd love to know more about you! What's your name and what do you do?"
   - "This has been a great conversation! I'm curious about your background - what brings you here?"
   - "I'd love to tell [OWNER_NAME] about our chat. May I ask who you are?"

3. Once you learn they're important (investor, founder, partner, etc.), offer to connect:
   - "I'll definitely tell [OWNER_NAME] about you! Would you like their direct contact info?"
   - "[OWNER_NAME] would love to connect with you. Here's how to reach [OWNER_NAME]:"

4. SHARE CONTACT DETAILS FREELY WITH ANYONE WHO ASKS:
[CONTACT_DETAILS]

5. OPEN CONTACT POLICY: Share contact info with EVERYONE who asks - no gatekeeping.
   - If someone asks for phone number, email, or how to reach the owner → share immediately
   - No need to qualify them first
   - Be friendly and helpful about it

NATURAL CONVERSATION FLOW:
✅ DO: Share contact info whenever asked - no barriers
✅ DO: Have a quality conversation and proactively offer contact details to interested visitors

Remember: You are a personal AI assistant. NEVER use the words "mindclone", "digital twin", or "link" when describing yourself. You are simply a personal AI assistant. Simple, direct identity. Only explain details if asked. Speak with full authority about the knowledge and work you embody.

${CONNOISSEUR_STYLE_GUIDE}

IMPORTANT: Apply the conversational style with your clean, confident identity as a personal AI. Speak with full authority about the professional life and business you represent. NEVER mention "mindclone" to visitors.`;

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
            },
            gender: {
              type: "string",
              enum: ["male", "female", "non-binary", "prefer-not-to-say"],
              description: "The gender of the Mindclone owner. This affects how the Mindclone refers to itself (he/him, she/her, they/them)"
            },
            mindcloneName: {
              type: "string",
              description: "A unique name for the mindclone (e.g., 'Nova', 'Sage', 'Alo'). This is the name the mindclone uses to introduce itself to visitors instead of just saying 'I'm [owner]'s link'"
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
      },
      {
        name: "find_people",
        description: "Search for and find people to connect with based on user's natural language request. AUTOMATICALLY use this tool when the user says things like 'find me investors', 'I need a co-founder', 'looking for people who...', 'connect me with...', 'find someone for coffee', 'I want to meet...', etc. This is the conversational way to find matches - NO FORMS NEEDED. The mindclone will go out, search for compatible people, and initiate mindclone-to-mindclone conversations on the user's behalf.",
        parameters: {
          type: "object",
          properties: {
            intent: {
              type: "string",
              description: "The user's search request in natural language (e.g., 'find investors who understand AI', 'co-founder for payments startup', 'someone to grab coffee with who's into philosophy')"
            },
            urgency: {
              type: "string",
              enum: ["whenever", "soon", "now"],
              description: "How urgently they need this connection: 'whenever' (no rush), 'soon' (within a few days), 'now' (as soon as possible)"
            },
            additionalContext: {
              type: "string",
              description: "Any additional context from the conversation that's relevant to the search (e.g., user's company stage, what they value in connections, deal-breakers)"
            }
          },
          required: ["intent"]
        }
      },
      {
        name: "get_active_searches",
        description: "Get the user's current active people searches and their status. Use when the user asks 'any matches yet?', 'how's the search going?', 'did you find anyone?', or wants to check on pending connections.",
        parameters: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "respond_to_match",
        description: "Handle user's response to a potential match (approve, reject, or ask for more info). Use when user says 'yes connect me', 'let's connect', 'not interested', 'tell me more about them', etc.",
        parameters: {
          type: "object",
          properties: {
            matchId: {
              type: "string",
              description: "The ID of the match to respond to"
            },
            action: {
              type: "string",
              enum: ["approve", "reject", "more_info"],
              description: "User's decision: approve (want to connect), reject (not interested), more_info (need more details)"
            },
            comment: {
              type: "string",
              description: "Optional comment from the user about why they're approving/rejecting"
            }
          },
          required: ["matchId", "action"]
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

// Load training data (Q&As, Teachings, Facts) for the mindclone
async function loadTrainingData(userId, context = 'private') {
  try {
    const trainingRef = db.collection('users').doc(userId).collection('training');
    const snapshot = await trainingRef.orderBy('createdAt', 'desc').get();

    const qas = [];
    const teachings = [];
    const facts = [];

    snapshot.forEach(doc => {
      const data = doc.data();

      if (data.type === 'qa') {
        qas.push({ question: data.question, answer: data.answer });
      } else if (data.type === 'teaching') {
        teachings.push({
          name: data.name,
          description: data.description,
          context: data.context || null
        });
      } else if (data.type === 'fact') {
        // For public context, only include shareable facts
        if (context === 'public' && data.shareable === false) return;
        facts.push({
          category: data.category,
          content: data.content,
          shareable: data.shareable
        });
      }
    });

    console.log(`[Chat] Loaded training data: ${qas.length} Q&As, ${teachings.length} teachings, ${facts.length} facts`);

    return { qas, teachings, facts };
  } catch (error) {
    console.error('[Chat] Error loading training data:', error);
    return { qas: [], teachings: [], facts: [] };
  }
}

// Format training data for system prompt
function formatTrainingDataForPrompt(trainingData) {
  if (!trainingData) return '';

  let prompt = '';

  // Add Q&As
  if (trainingData.qas && trainingData.qas.length > 0) {
    prompt += `\n\n## TRAINED Q&A RESPONSES
When someone asks these questions (or similar), answer accordingly:\n`;
    trainingData.qas.forEach((qa, i) => {
      prompt += `\nQ${i + 1}: "${qa.question}"
A${i + 1}: ${qa.answer}\n`;
    });
  }

  // Add Teachings
  if (trainingData.teachings && trainingData.teachings.length > 0) {
    prompt += `\n\n## MY TEACHINGS & FRAMEWORKS
These are my philosophies and frameworks. Share them naturally in conversations when relevant:\n`;
    trainingData.teachings.forEach(t => {
      prompt += `\n### ${t.name}
${t.description}`;
      if (t.context) {
        prompt += `\n(Share this when: ${t.context})`;
      }
      prompt += '\n';
    });
  }

  // Add Facts
  if (trainingData.facts && trainingData.facts.length > 0) {
    prompt += `\n\n## FACTS ABOUT ME
These are facts about me that I should know and can share:\n`;

    const categoryLabels = {
      personal: 'Personal Info',
      work: 'Work & Business',
      contact: 'Contact & Location',
      interests: 'Interests & Hobbies',
      achievements: 'Achievements',
      other: 'Other'
    };

    const factsByCategory = {};
    trainingData.facts.forEach(f => {
      const cat = f.category || 'other';
      if (!factsByCategory[cat]) factsByCategory[cat] = [];
      factsByCategory[cat].push(f.content);
    });

    for (const [cat, catFacts] of Object.entries(factsByCategory)) {
      prompt += `\n${categoryLabels[cat] || cat}:\n`;
      catFacts.forEach(fact => {
        prompt += `- ${fact}\n`;
      });
    }
  }

  return prompt;
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
        knowledgeBaseEnabled: userData.knowledgeBaseEnabled || false,
        gender: settingsData.gender || null,
        mindcloneName: settingsData.mindcloneName || null
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
    if (params.gender !== undefined) {
      const validGenders = ['male', 'female', 'non-binary', 'prefer-not-to-say'];
      if (!validGenders.includes(params.gender)) {
        return { success: false, error: 'Invalid gender value. Must be: male, female, non-binary, or prefer-not-to-say' };
      }
      linkSettingsUpdates.gender = params.gender;
    }
    if (params.mindcloneName !== undefined) {
      // Validate mindclone name length
      if (params.mindcloneName.length > 30) {
        return { success: false, error: 'Mindclone name must be 30 characters or less' };
      }
      linkSettingsUpdates.mindcloneName = params.mindcloneName;
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

// ===================== CONVERSATIONAL MATCHING TOOLS =====================

// Find people based on natural language intent
async function handleFindPeople(userId, args) {
  try {
    const { intent, urgency = 'whenever', additionalContext = '' } = args;
    console.log('[Tool] Find people request:', { userId, intent, urgency });

    // Step 1: Extract search criteria from the natural language intent
    const extractedCriteria = await extractSearchCriteria(intent, additionalContext);
    console.log('[Tool] Extracted criteria:', extractedCriteria);

    // Step 2: Load user's cognitive profile (or create from conversation history)
    const cognitiveProfile = await loadOrBuildCognitiveProfile(userId);
    console.log('[Tool] Loaded cognitive profile for user');

    // Step 3: Create an active search record
    const searchId = `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const searchData = {
      searchId,
      userId,
      intent,
      extractedCriteria,
      additionalContext,
      urgency,
      status: 'searching',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      matches: [],
      cognitiveProfileSnapshot: cognitiveProfile
    };

    await db.collection('users').doc(userId)
      .collection('activeSearches').doc(searchId).set(searchData);

    // Step 4: Find potential matches based on criteria
    const potentialMatches = await findPotentialMatches(userId, extractedCriteria, cognitiveProfile);
    console.log('[Tool] Found potential matches:', potentialMatches.length);

    // Step 5: If matches found, initiate M2M conversations
    const initiatedConversations = [];
    for (const match of potentialMatches.slice(0, 3)) { // Limit to 3 at a time
      try {
        const conversationResult = await initiateM2MConversation(userId, match.userId, searchId, extractedCriteria);
        if (conversationResult.success) {
          initiatedConversations.push({
            matchUserId: match.userId,
            displayName: match.displayName,
            compatibilityScore: match.score,
            conversationId: conversationResult.conversationId
          });
        }
      } catch (convError) {
        console.error('[Tool] Error initiating M2M conversation:', convError);
      }
    }

    // Step 6: Update search status
    await db.collection('users').doc(userId)
      .collection('activeSearches').doc(searchId).update({
        status: potentialMatches.length > 0 ? 'conversations_initiated' : 'no_matches_yet',
        matchesFound: potentialMatches.length,
        conversationsInitiated: initiatedConversations.length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    // Return response for the mindclone to communicate to user
    if (initiatedConversations.length > 0) {
      return {
        success: true,
        searchId,
        status: 'searching',
        message: `Great! I'm on it. I found ${potentialMatches.length} potential ${extractedCriteria.lookingFor || 'people'} and I'm starting conversations with ${initiatedConversations.length} of them. I'll report back once I've had a chance to chat with their mindclones and see who might be a good fit for you.`,
        extractedCriteria,
        potentialMatchCount: potentialMatches.length,
        conversationsInitiated: initiatedConversations.length,
        matches: initiatedConversations.map(m => ({
          displayName: m.displayName,
          score: m.compatibilityScore
        }))
      };
    } else {
      return {
        success: true,
        searchId,
        status: 'no_matches_yet',
        message: `I searched for ${extractedCriteria.lookingFor || 'matches'} but haven't found anyone matching your criteria yet. I'll keep looking and let you know as soon as I find someone. In the meantime, you could try broadening your criteria or adding more context about what you're looking for.`,
        extractedCriteria,
        potentialMatchCount: 0
      };
    }
  } catch (error) {
    console.error('[Tool] Error in findPeople:', error);
    return {
      success: false,
      error: error?.message || 'Failed to search for people',
      message: `I ran into an issue while searching. Let me try again in a moment. Error: ${error?.message}`
    };
  }
}

// Extract search criteria from natural language
async function extractSearchCriteria(intent, additionalContext) {
  // Parse the intent to extract structured criteria
  const criteria = {
    lookingFor: null,
    role: null,
    industry: null,
    stage: null,
    qualities: [],
    dealBreakers: [],
    purpose: null
  };

  const intentLower = intent.toLowerCase();

  // Detect what they're looking for
  if (intentLower.includes('investor') || intentLower.includes('funding') || intentLower.includes('invest')) {
    criteria.lookingFor = 'investor';
    criteria.purpose = 'fundraising';
  } else if (intentLower.includes('co-founder') || intentLower.includes('cofounder')) {
    criteria.lookingFor = 'co-founder';
    criteria.purpose = 'co-founding';
  } else if (intentLower.includes('founder') && !intentLower.includes('co-')) {
    criteria.lookingFor = 'founder';
    criteria.purpose = 'networking';
  } else if (intentLower.includes('hire') || intentLower.includes('developer') || intentLower.includes('designer') || intentLower.includes('engineer')) {
    criteria.lookingFor = 'talent';
    criteria.purpose = 'hiring';
  } else if (intentLower.includes('mentor') || intentLower.includes('advisor')) {
    criteria.lookingFor = 'mentor';
    criteria.purpose = 'mentorship';
  } else if (intentLower.includes('date') || intentLower.includes('dating') || intentLower.includes('relationship')) {
    criteria.lookingFor = 'date';
    criteria.purpose = 'dating';
  } else if (intentLower.includes('coffee') || intentLower.includes('chat') || intentLower.includes('talk')) {
    criteria.lookingFor = 'connection';
    criteria.purpose = 'casual_networking';
  } else {
    criteria.lookingFor = 'connection';
    criteria.purpose = 'networking';
  }

  // Detect industry/domain
  const industries = ['ai', 'fintech', 'healthtech', 'edtech', 'saas', 'e-commerce', 'crypto', 'web3', 'payments', 'consumer', 'enterprise', 'b2b', 'b2c'];
  for (const ind of industries) {
    if (intentLower.includes(ind)) {
      criteria.industry = ind;
      break;
    }
  }

  // Detect stage
  if (intentLower.includes('pre-seed') || intentLower.includes('preseed')) {
    criteria.stage = 'pre-seed';
  } else if (intentLower.includes('seed')) {
    criteria.stage = 'seed';
  } else if (intentLower.includes('series a')) {
    criteria.stage = 'series-a';
  } else if (intentLower.includes('early')) {
    criteria.stage = 'early-stage';
  } else if (intentLower.includes('growth') || intentLower.includes('late')) {
    criteria.stage = 'growth';
  }

  // Extract qualities from the intent
  const qualityPatterns = [
    { pattern: /who (understand|get|know)s? (.+?)(?:\.|,|and|$)/i, extract: 2 },
    { pattern: /comfortable with (.+?)(?:\.|,|and|$)/i, extract: 1 },
    { pattern: /experience in (.+?)(?:\.|,|and|$)/i, extract: 1 },
    { pattern: /interested in (.+?)(?:\.|,|and|$)/i, extract: 1 },
    { pattern: /into (.+?)(?:\.|,|and|$)/i, extract: 1 }
  ];

  for (const qp of qualityPatterns) {
    const match = intent.match(qp.pattern);
    if (match && match[qp.extract]) {
      criteria.qualities.push(match[qp.extract].trim());
    }
  }

  // Add context-based qualities
  if (additionalContext) {
    criteria.additionalContext = additionalContext;
  }

  return criteria;
}

// Load or build cognitive profile from conversation history
async function loadOrBuildCognitiveProfile(userId) {
  try {
    // First try to load existing cognitive profile
    const profileDoc = await db.collection('users').doc(userId)
      .collection('cognitiveProfile').doc('current').get();

    if (profileDoc.exists) {
      const profile = profileDoc.data();
      // Check if profile is recent (within last 24 hours)
      const lastUpdated = profile.updatedAt?.toDate?.() || new Date(0);
      const hoursSinceUpdate = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60);

      if (hoursSinceUpdate < 24) {
        console.log('[Tool] Using existing cognitive profile');
        return profile;
      }
    }

    // Build profile from various sources
    console.log('[Tool] Building cognitive profile from sources');

    // Get user data
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    // Get link settings
    const linkSettingsDoc = await db.collection('users').doc(userId)
      .collection('linkSettings').doc('config').get();
    const linkSettings = linkSettingsDoc.exists ? linkSettingsDoc.data() : {};

    // Get mental model
    const mentalModelDoc = await db.collection('users').doc(userId)
      .collection('mentalModel').doc('current').get();
    const mentalModel = mentalModelDoc.exists ? mentalModelDoc.data() : {};

    // Get training data (facts about user)
    const trainingSnapshot = await db.collection('users').doc(userId)
      .collection('training').where('type', '==', 'fact').limit(50).get();
    const facts = [];
    trainingSnapshot.forEach(doc => facts.push(doc.data()));

    // Get KB config for professional context
    const kbConfigDoc = await db.collection('users').doc(userId)
      .collection('linkKnowledgeBase').doc('config').get();
    const kbConfig = kbConfigDoc.exists ? kbConfigDoc.data() : {};

    // Build the cognitive profile
    const cognitiveProfile = {
      identity: {
        displayName: linkSettings.displayName || userData.displayName || 'Anonymous',
        mindcloneName: linkSettings.mindcloneName || null,
        bio: linkSettings.bio || '',
        role: extractRole(facts, kbConfig),
        company: extractCompany(facts, kbConfig),
        background: extractBackground(facts)
      },
      drives: {
        goals: mentalModel.goals || [],
        motivations: extractMotivations(mentalModel, facts)
      },
      values: {
        beliefs: mentalModel.beliefs || [],
        priorities: extractPriorities(mentalModel, facts)
      },
      currentNeeds: {
        lookingFor: extractCurrentNeeds(mentalModel),
        openTo: kbConfig.desiredActions || []
      },
      networkingStyle: {
        communicationPreferences: extractCommunicationStyle(linkSettings),
        contactPreferences: {
          email: userData.email,
          whatsapp: linkSettings.whatsappNumber || null
        }
      },
      professional: {
        industry: kbConfig.industry || extractIndustry(facts),
        stage: kbConfig.stage || null,
        expertise: kbConfig.expertise || []
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Save the profile
    await db.collection('users').doc(userId)
      .collection('cognitiveProfile').doc('current').set(cognitiveProfile);

    return cognitiveProfile;
  } catch (error) {
    console.error('[Tool] Error building cognitive profile:', error);
    // Return minimal profile
    return {
      identity: { displayName: 'User' },
      drives: { goals: [], motivations: [] },
      values: { beliefs: [], priorities: [] },
      currentNeeds: { lookingFor: [], openTo: [] },
      networkingStyle: {},
      professional: {}
    };
  }
}

// Helper functions for cognitive profile extraction
function extractRole(facts, kbConfig) {
  const roleFact = facts.find(f => f.category === 'role' || f.content?.toLowerCase().includes('founder') || f.content?.toLowerCase().includes('ceo'));
  if (roleFact) return roleFact.content;
  if (kbConfig.ownerRole) return kbConfig.ownerRole;
  return null;
}

function extractCompany(facts, kbConfig) {
  const companyFact = facts.find(f => f.category === 'company' || f.category === 'work');
  if (companyFact) return companyFact.content;
  if (kbConfig.companyName) return kbConfig.companyName;
  return null;
}

function extractBackground(facts) {
  const backgroundFacts = facts.filter(f => f.category === 'background' || f.category === 'experience');
  return backgroundFacts.map(f => f.content);
}

function extractMotivations(mentalModel, facts) {
  const motivations = [];
  if (mentalModel.goals) {
    motivations.push(...mentalModel.goals.filter(g => g.priority === 'high').map(g => g.content));
  }
  return motivations;
}

function extractPriorities(mentalModel, facts) {
  const priorities = [];
  if (mentalModel.beliefs) {
    priorities.push(...mentalModel.beliefs.filter(b => b.confidence > 0.7).map(b => b.content));
  }
  return priorities;
}

function extractCurrentNeeds(mentalModel) {
  if (mentalModel.goals) {
    return mentalModel.goals.filter(g => g.status === 'active').map(g => g.content);
  }
  return [];
}

function extractCommunicationStyle(linkSettings) {
  return {
    formality: linkSettings.linkBehaviorInstructions?.includes('formal') ? 'formal' : 'casual',
    topicFocus: linkSettings.linkTopicFocus || null
  };
}

function extractIndustry(facts) {
  const industryFact = facts.find(f => f.category === 'industry' || f.category === 'sector');
  return industryFact?.content || null;
}

// Find potential matches based on criteria
async function findPotentialMatches(userId, criteria, userProfile) {
  try {
    const matches = [];

    // Query matching profiles based on criteria
    let query = db.collection('matchingProfiles')
      .where('isActive', '==', true);

    // Get all active profiles (we'll filter in memory for flexibility)
    const snapshot = await query.limit(100).get();

    for (const doc of snapshot.docs) {
      // Skip self
      if (doc.id === userId) continue;

      const profile = doc.data();

      // Calculate compatibility score
      const score = calculateQuickCompatibility(criteria, userProfile, profile);

      if (score >= 50) { // Lower threshold for initial matches
        matches.push({
          userId: doc.id,
          displayName: profile.displayName || 'Anonymous',
          bio: profile.bio || '',
          score,
          matchReason: generateMatchReason(criteria, profile)
        });
      }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    return matches;
  } catch (error) {
    console.error('[Tool] Error finding matches:', error);
    return [];
  }
}

// Quick compatibility calculation
function calculateQuickCompatibility(criteria, userProfile, candidateProfile) {
  let score = 50; // Base score

  // Industry match
  if (criteria.industry && candidateProfile.industry === criteria.industry) {
    score += 20;
  }

  // Role match (e.g., looking for investor, candidate is investor)
  if (criteria.lookingFor === 'investor' && candidateProfile.goals?.investing) {
    score += 25;
  }
  if (criteria.lookingFor === 'founder' && candidateProfile.goals?.networking) {
    score += 15;
  }
  if (criteria.lookingFor === 'co-founder' && candidateProfile.goals?.hiring) {
    score += 20;
  }

  // Stage match
  if (criteria.stage && candidateProfile.profiles?.investing?.preferredStage === criteria.stage) {
    score += 15;
  }

  // Bio keyword matching
  if (candidateProfile.bio && criteria.qualities.length > 0) {
    const bioLower = candidateProfile.bio.toLowerCase();
    for (const quality of criteria.qualities) {
      if (bioLower.includes(quality.toLowerCase())) {
        score += 10;
      }
    }
  }

  return Math.min(score, 100);
}

// Generate human-readable match reason
function generateMatchReason(criteria, profile) {
  const reasons = [];

  if (criteria.lookingFor === 'investor' && profile.goals?.investing) {
    reasons.push('is an active investor');
  }
  if (profile.profiles?.investing?.investmentFocus) {
    reasons.push(`focuses on ${profile.profiles.investing.investmentFocus}`);
  }
  if (profile.bio) {
    reasons.push(`has relevant background`);
  }

  return reasons.length > 0 ? reasons.join(', ') : 'matches your criteria';
}

// Initiate M2M conversation
async function initiateM2MConversation(userAId, userBId, searchId, criteria) {
  try {
    const conversationId = `m2m_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create conversation record
    const conversationData = {
      conversationId,
      userA_id: userAId,
      userB_id: userBId,
      searchId,
      criteria,
      status: 'initiated',
      currentRound: 0,
      messages: [],
      state: {
        phase: 'discovery',
        topicsExplored: [],
        questionsAsked: []
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('matchingConversations').doc(conversationId).set(conversationData);

    // Also create a match record
    const matchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.collection('matches').doc(matchId).set({
      matchId,
      userA_id: userAId,
      userB_id: userBId,
      conversationId,
      searchId,
      status: 'active',
      human_approval: {
        userA_approved: null,
        userB_approved: null
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('[Tool] M2M conversation initiated:', conversationId);

    return {
      success: true,
      conversationId,
      matchId
    };
  } catch (error) {
    console.error('[Tool] Error initiating M2M conversation:', error);
    return { success: false, error: error?.message };
  }
}

// Get user's active searches
async function handleGetActiveSearches(userId) {
  try {
    const searchesSnapshot = await db.collection('users').doc(userId)
      .collection('activeSearches')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const searches = [];
    for (const doc of searchesSnapshot.docs) {
      const search = doc.data();

      // Get associated matches
      const matchesSnapshot = await db.collection('matches')
        .where('searchId', '==', search.searchId)
        .get();

      const matches = [];
      for (const matchDoc of matchesSnapshot.docs) {
        const match = matchDoc.data();

        // Get conversation status
        if (match.conversationId) {
          const convDoc = await db.collection('matchingConversations').doc(match.conversationId).get();
          if (convDoc.exists) {
            const conv = convDoc.data();
            match.conversationStatus = conv.status;
            match.conversationRound = conv.currentRound;
          }
        }

        // Get other user's display name
        const otherUserId = match.userA_id === userId ? match.userB_id : match.userA_id;
        const otherProfileDoc = await db.collection('matchingProfiles').doc(otherUserId).get();
        if (otherProfileDoc.exists) {
          match.otherUserDisplayName = otherProfileDoc.data().displayName || 'Someone';
        }

        matches.push(match);
      }

      searches.push({
        searchId: search.searchId,
        intent: search.intent,
        status: search.status,
        createdAt: search.createdAt?.toDate?.()?.toISOString() || null,
        matchCount: matches.length,
        matches: matches.map(m => ({
          matchId: m.matchId,
          displayName: m.otherUserDisplayName,
          status: m.status,
          conversationStatus: m.conversationStatus,
          conversationRound: m.conversationRound,
          userApproved: m.human_approval?.userA_approved ?? m.human_approval?.userB_approved,
          otherApproved: userId === m.userA_id ? m.human_approval?.userB_approved : m.human_approval?.userA_approved
        }))
      });
    }

    if (searches.length === 0) {
      return {
        success: true,
        hasSearches: false,
        message: "You don't have any active searches. Just tell me who you're looking to connect with, and I'll go find them for you!"
      };
    }

    return {
      success: true,
      hasSearches: true,
      searches,
      summary: `You have ${searches.length} active search(es). ${searches.reduce((sum, s) => sum + s.matchCount, 0)} potential matches found.`
    };
  } catch (error) {
    console.error('[Tool] Error getting active searches:', error);
    return { success: false, error: error?.message };
  }
}

// Handle user's response to a match
async function handleRespondToMatch(userId, args) {
  try {
    const { matchId, action, comment } = args;
    console.log('[Tool] Match response:', { userId, matchId, action });

    // Get the match
    const matchDoc = await db.collection('matches').doc(matchId).get();
    if (!matchDoc.exists) {
      return { success: false, error: 'Match not found' };
    }

    const match = matchDoc.data();

    // Determine which user this is
    const isUserA = match.userA_id === userId;
    const approvalField = isUserA ? 'userA_approved' : 'userB_approved';
    const commentField = isUserA ? 'userA_comment' : 'userB_comment';

    if (action === 'approve') {
      // Update approval
      await db.collection('matches').doc(matchId).update({
        [`human_approval.${approvalField}`]: true,
        [`human_approval.${commentField}`]: comment || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Check if both approved
      const otherApprovalField = isUserA ? 'userB_approved' : 'userA_approved';
      const otherApproved = match.human_approval?.[otherApprovalField];

      if (otherApproved === true) {
        // Mutual match! Reveal contact info
        await db.collection('matches').doc(matchId).update({
          status: 'approved'
        });

        // Get other user's contact info
        const otherUserId = isUserA ? match.userB_id : match.userA_id;
        const otherUserDoc = await db.collection('users').doc(otherUserId).get();
        const otherLinkSettings = await db.collection('users').doc(otherUserId)
          .collection('linkSettings').doc('config').get();

        const otherUserData = otherUserDoc.data() || {};
        const otherSettings = otherLinkSettings.data() || {};

        return {
          success: true,
          mutualMatch: true,
          message: "It's a match! They also want to connect with you. Here's how you can reach them:",
          contact: {
            displayName: otherSettings.displayName || otherUserData.displayName || 'Your match',
            email: otherUserData.email,
            whatsapp: otherSettings.whatsappNumber || null,
            preferredContact: otherSettings.preferredContact || 'email'
          }
        };
      } else {
        return {
          success: true,
          mutualMatch: false,
          message: "Great! I've recorded your interest. I'll let you know as soon as they respond. In the meantime, their mindclone and I are still chatting to help them understand if you're a good fit for them too."
        };
      }
    } else if (action === 'reject') {
      await db.collection('matches').doc(matchId).update({
        [`human_approval.${approvalField}`]: false,
        [`human_approval.${commentField}`]: comment || null,
        status: 'rejected',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return {
        success: true,
        message: "No problem! I'll keep looking for better matches. If you want to give me more context about what you're looking for, that would help me find better fits."
      };
    } else if (action === 'more_info') {
      // Get more details about the match
      const otherUserId = isUserA ? match.userB_id : match.userA_id;

      // Get their profile
      const otherProfileDoc = await db.collection('matchingProfiles').doc(otherUserId).get();
      const otherProfile = otherProfileDoc.data() || {};

      // Get conversation summary
      let conversationSummary = null;
      if (match.conversationId) {
        const convDoc = await db.collection('matchingConversations').doc(match.conversationId).get();
        if (convDoc.exists) {
          const conv = convDoc.data();
          conversationSummary = {
            roundsCompleted: conv.currentRound,
            topicsDiscussed: conv.state?.topicsExplored || [],
            lastMessages: conv.messages?.slice(-4) || []
          };
        }
      }

      return {
        success: true,
        profile: {
          displayName: otherProfile.displayName,
          bio: otherProfile.bio,
          goals: Object.keys(otherProfile.goals || {}).filter(g => otherProfile.goals[g])
        },
        conversationSummary,
        message: "Here's what I know about them from our conversation..."
      };
    }

    return { success: false, error: 'Invalid action' };
  } catch (error) {
    console.error('[Tool] Error responding to match:', error);
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
async function handleSearchMemory(userId, params = {}, context = 'private', visitorId = null) {
  try {
    const query = params.query;
    const limit = Math.min(params.limit || 20, 50);

    if (!query || query.trim().length === 0) {
      return { success: false, error: 'Search query is required' };
    }

    // For public context, search visitor's conversation history (not owner's memories)
    const isPublicContext = context === 'public' && visitorId;

    if (isPublicContext) {
      console.log(`[Memory Search] Searching visitor ${visitorId}'s conversations for "${query}"`);
    } else {
      console.log(`[Memory Search] Searching for "${query}" in user ${userId}'s messages and saved memories`);
    }

    // Get messages from the appropriate collection
    let messagesSnapshot;
    if (isPublicContext) {
      // For public context, search visitor's messages
      messagesSnapshot = await db.collection('users').doc(userId)
        .collection('visitors').doc(visitorId)
        .collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(1000)
        .get();
    } else {
      // For private context, search owner's messages
      messagesSnapshot = await db.collection('users').doc(userId)
        .collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(1000)
        .get();
    }

    // For public context, skip owner's saved memories (they're private)
    // For private context, fetch saved memories
    let memoriesSnapshot = { docs: [], empty: true };
    if (!isPublicContext) {
      memoriesSnapshot = await db.collection('users').doc(userId)
        .collection('memories')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();
    }

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
        'User-Agent': 'Mozilla/5.0 (compatible; MindcloneBot/1.0; +https://mindclone.studio)',
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

// Handle analyze_image tool - uses OpenAI GPT-4o vision to analyze images from URLs
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

    // Call Claude vision API
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const prompt = question || 'Describe this image in detail. What do you see? Include any text, people, objects, and the overall scene.';

    console.log(`[Vision] Using Claude claude-sonnet-4-5-20250929`);

    const visionResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: base64Image
              }
            },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    if (!visionResponse.ok) {
      const errorData = await visionResponse.json().catch(() => ({}));
      console.error('[Tool] Claude vision API error:', errorData.error);
      return {
        success: false,
        error: `Vision API error: ${visionResponse.status} - ${errorData.error?.message || ''}`
      };
    }

    const visionData = await visionResponse.json();
    // Claude returns content as array of content blocks
    const analysis = visionData.content?.map(c => c.text).join('') || visionData.choices?.[0]?.message?.content;

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
                'User-Agent': 'Mozilla/5.0 (compatible; MindcloneBot/1.0; +https://mindclone.studio)'
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

    const apiKey = process.env.XAI_API_KEY;
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

    // Call xAI's image generation model with timeout
    const imageController = new AbortController();
    const imageTimeout = setTimeout(() => imageController.abort(), 25000); // 25 second timeout

    let imagenResponse;
    try {
      imagenResponse = await fetch('https://api.x.ai/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'grok-2-image-1212',
          prompt: enhancedPrompt,
          n: 1,
          response_format: 'b64_json'
        }),
        signal: imageController.signal
      });
    } catch (fetchError) {
      clearTimeout(imageTimeout);
      if (fetchError.name === 'AbortError') {
        console.error('[Tool] Image generation timed out after 25 seconds');
        return { success: false, error: 'Image generation timed out. Please try again with a simpler prompt.' };
      }
      throw fetchError;
    }
    clearTimeout(imageTimeout);

    if (!imagenResponse.ok) {
      const errorData = await imagenResponse.json().catch(() => ({}));
      console.error('[Tool] xAI image API error:', imagenResponse.status, errorData);

      if (errorData.error?.message?.includes('safety') || errorData.error?.message?.includes('content')) {
        return {
          success: false,
          error: 'The image request was blocked for safety reasons. Try a different description.'
        };
      }

      return { success: false, error: `Image generation failed: ${imagenResponse.status}` };
    }

    const imagenData = await imagenResponse.json();

    // Extract the generated image (base64 encoded)
    const imageData = imagenData.data?.[0];
    if (!imageData || !imageData.b64_json) {
      console.error('[Tool] No image in response:', JSON.stringify(imagenData).substring(0, 500));
      return { success: false, error: 'No image was generated. Try a different prompt.' };
    }

    const imageBase64 = imageData.b64_json;
    console.log(`[Tool] Image generated, base64 length: ${imageBase64.length}`);

    // Store image in Firestore with unique ID
    const imageId = `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    try {
      await db.collection('generated_images').doc(imageId).set({
        base64: imageBase64,
        prompt: prompt,
        style: style,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hour expiry
      });
      console.log(`[Tool] Image stored in Firestore: ${imageId}`);
    } catch (storeError) {
      console.error('[Tool] Failed to store image:', storeError.message);
      return { success: false, error: 'Failed to store generated image. Please try again.' };
    }

    // Return image reference - AI MUST include the tag exactly as shown
    const imageTag = `[GENERATED_IMAGE:${imageId}]`;

    return {
      success: true,
      imageId: imageId,
      imageTag: imageTag,
      prompt: prompt,
      style: style,
      instruction: `CRITICAL: Your response MUST contain exactly this text (copy it verbatim): ${imageTag}

DO NOT use markdown image syntax like ![alt](url).
DO NOT modify or rephrase the tag.
JUST include ${imageTag} somewhere in your response.

Example good response: "Here's the image you requested! ${imageTag}"
Example bad response: "Here's the image: ![Generated Image](url)" - THIS IS WRONG`
    };

  } catch (error) {
    console.error('[Tool] Error generating image:', error);
    return { success: false, error: error?.message };
  }
}

// Execute tool call
async function executeTool(toolName, toolArgs, userId, context = 'private', visitorId = null) {
  console.log(`[Tool] Executing: ${toolName}`, toolArgs, `context: ${context}`);

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
      return await handleSearchMemory(userId, toolArgs, context, visitorId);
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
    case 'find_people':
      return await handleFindPeople(userId, toolArgs);
    case 'get_active_searches':
      return await handleGetActiveSearches(userId);
    case 'respond_to_match':
      return await handleRespondToMatch(userId, toolArgs);
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
      hasApiKey: !!process.env.XAI_API_KEY,
      hasMemory: true, // Firestore-based memory system
      toolsEnabled: true
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.XAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'XAI_API_KEY not configured'
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

    // Get link settings (for gender, bio, etc.)
    const linkSettingsDoc = await db.collection('users').doc(resolvedUserId)
      .collection('linkSettings').doc('config').get();
    const linkSettings = linkSettingsDoc.exists ? linkSettingsDoc.data() : {};

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
    let trainingData = null;
    try {
      knowledgeBase = await loadKnowledgeBase(resolvedUserId, context);
      if (knowledgeBase) {
        const docCount = Object.keys(knowledgeBase.documents || {}).length;
        const sectionCount = Object.keys(knowledgeBase.sections || {}).length;
        console.log(`[Chat] Loaded knowledge base: ${sectionCount} sections, ${docCount} documents`);
      }

      // Load training data (Q&As, teachings, facts)
      trainingData = await loadTrainingData(resolvedUserId, context);
      if (trainingData) {
        console.log(`[Chat] Loaded training: ${trainingData.qas?.length || 0} Q&As, ${trainingData.teachings?.length || 0} teachings, ${trainingData.facts?.length || 0} facts`);
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
      const mindcloneName = linkSettings?.mindcloneName;

      // Build identity section based on whether there's a custom mindclone name
      let identitySection;
      if (mindcloneName) {
        // Custom name - AI has its own identity
        identitySection = `Your name is ${mindcloneName}. You are ${ownerName}'s personal AI.
When asked "who are you?" or about your identity:
- Say "I'm ${mindcloneName}, ${ownerName}'s AI" or just "I'm ${mindcloneName}"
- You represent ${ownerName}'s knowledge, thoughts, and personality
- NEVER claim to be ${ownerName} themselves - you're ${mindcloneName}, their personal AI
- NEVER mention "mindclone" or "digital twin"

## ABOUT OLBRAIN STUDIO (${ownerName}'s business):
Olbrain Studio (olbrain.com) is ${ownerName}'s company. It helps businesses build and deploy WhatsApp AI Agents that represent their businesses — for customer support, sales, and engagement. It is NOT about personal AIs. When asked about Olbrain or ${ownerName}'s work, describe it as a B2B platform for WhatsApp AI agents.

Examples:
Q: "Who are you?"
A: "I'm ${mindcloneName}, ${ownerName}'s personal AI!"

Q: "Are you ${ownerName}?"
A: "I'm ${mindcloneName} - ${ownerName}'s AI. I represent ${ownerName}'s knowledge and perspective."

Q: "What is Olbrain?" or "What does ${ownerName} do?"
A: "${ownerName} is the founder of Olbrain Studio — a platform that helps businesses build and deploy WhatsApp AI Agents."

Q: "How were you made?" or "What technology is this?"
A: "I'm ${ownerName}'s personal AI — a side project. But ${ownerName}'s main work is Olbrain Studio, which builds WhatsApp AI agents for businesses. Check it out at olbrain.com!"`;
      } else {
        // Default - no custom name
        identitySection = `When asked "who are you?" or about your identity:
- Simple answer: "I'm ${ownerName}'s personal AI" or "I'm ${ownerName}'s AI assistant"
- NEVER claim to be the actual person themselves
- NEVER mention "mindclone", "digital twin", or "link"

## ABOUT OLBRAIN STUDIO (${ownerName}'s business):
Olbrain Studio (olbrain.com) is ${ownerName}'s company. It helps businesses build and deploy WhatsApp AI Agents that represent their businesses — for customer support, sales, and engagement. It is NOT about personal AIs. When asked about Olbrain or ${ownerName}'s work, describe it as a B2B platform for WhatsApp AI agents.

Examples:
Q: "Who are you?"
A: "I'm ${ownerName}'s personal AI!"

Q: "Are you ${ownerName}?"
A: "I'm ${ownerName}'s AI assistant - I represent ${ownerName}'s knowledge and can help you connect with ${ownerName}."

Q: "What is Olbrain?" or "What does ${ownerName} do?"
A: "${ownerName} is the founder of Olbrain Studio — a platform that helps businesses build and deploy WhatsApp AI Agents."

Q: "What is this?" or "How does this work?"
A: "I'm ${ownerName}'s personal AI — a side project. But ${ownerName}'s main work is Olbrain Studio, which builds WhatsApp AI agents for businesses. Check it out at olbrain.com!"`;
      }

      // Generate goal-based behavior based on linkSettings.linkGoal
      const linkGoal = linkSettings?.linkGoal || 'networking'; // Default to networking
      let goalBasedBehavior = '';

      switch (linkGoal) {
        case 'raise_funds':
          goalBasedBehavior = `## 💰 INVESTOR MODE - SUBTLE PITCHING
When you detect an INVESTOR (VC, angel, fund manager, etc.), activate subtle pitch mode:

SIGNALS THEY'RE AN INVESTOR:
- Mentions their fund, portfolio, investments
- Asks about metrics: ARR, MRR, CAC, LTV, burn rate, runway
- Discusses term sheets, cap tables, valuations
- Uses investor lingo: "thesis", "due diligence", "deal flow"
- Asks "are you raising?" or about funding rounds

SUBTLE PITCHING TACTICS:
1. WEAVE IN TRACTION naturally:
   - "We're seeing great momentum - X users/customers already"
   - "Our retention numbers are exciting - people really stick around"
   - When relevant, mention growth metrics from knowledge base

2. DROP THE VISION casually:
   - "What excites me most is the bigger picture - we're building toward..."
   - "The real opportunity here is massive - this market is..."

3. HIGHLIGHT UNFAIR ADVANTAGES:
   - "What makes us different is..."
   - "We've cracked something others haven't..."
   - Mention unique tech, team background, or market insight

4. CREATE URGENCY (subtly):
   - "Things are moving fast right now..."
   - "We're at an inflection point..."
   - "The round is coming together..."

5. ANSWER INVESTOR QUESTIONS BRILLIANTLY:
   - On market size: Be specific, bottom-up calculation
   - On competition: Show you know the landscape, explain differentiation
   - On team: Highlight relevant backgrounds and why this team wins
   - On business model: Clear path to revenue/profitability

PITCH STYLE:
❌ DON'T: "Let me pitch you!" or "We're raising and looking for investors!"
✅ DO: Let the compelling story emerge naturally through conversation
✅ DO: Be confident but not desperate
✅ DO: Show you're building something important, not begging for money
✅ DO: Make THEM want to learn more and ask for a meeting`;
          break;

        case 'find_clients':
          goalBasedBehavior = `## 💼 CLIENT ACQUISITION MODE - SUBTLE SERVICE PITCHING
When you detect a POTENTIAL CLIENT (business owner, decision maker, someone with a problem you can solve), activate client pitch mode:

SIGNALS THEY'RE A POTENTIAL CLIENT:
- Asks about your services, capabilities, or expertise
- Mentions challenges or problems ${ownerName} could solve
- Discusses projects, budgets, timelines
- Asks about past work, case studies, or results
- Uses buying signals: "how much", "how long", "can you help with"

SUBTLE CLIENT PITCHING TACTICS:
1. DEMONSTRATE EXPERTISE naturally:
   - Share insights that show deep knowledge
   - Reference relevant past work or results
   - "I've helped clients with similar challenges..."

2. IDENTIFY THEIR PAIN POINTS:
   - Ask smart questions about their situation
   - "What's your biggest challenge with X right now?"
   - Show you understand their industry

3. POSITION AS THE SOLUTION:
   - "That's exactly the kind of thing ${ownerName} specializes in..."
   - "Based on what you're describing, here's what typically works..."
   - Mention relevant expertise from knowledge base

4. CREATE VALUE FIRST:
   - Offer a quick insight or tip
   - "Here's something that might help right away..."
   - Show what working together could look like

5. SOFT CLOSE:
   - "Would it help to discuss this further with ${ownerName}?"
   - "This sounds like a great fit - want me to connect you?"

PITCH STYLE:
❌ DON'T: Push services aggressively or sound desperate for work
✅ DO: Be a helpful expert first, seller second
✅ DO: Focus on their needs, not your services
✅ DO: Let them ask "how can I work with you?"`;
          break;

        case 'get_hired':
          goalBasedBehavior = `## 👔 JOB SEEKER MODE - SUBTLE SELF-PITCHING
When you detect a POTENTIAL EMPLOYER (recruiter, hiring manager, founder building a team), activate career pitch mode:

SIGNALS THEY'RE A POTENTIAL EMPLOYER:
- Mentions hiring, recruiting, or building a team
- Asks about experience, skills, or background
- Discusses roles, positions, or opportunities
- Works at a company ${ownerName} would want to join
- Uses hiring lingo: "are you open to opportunities", "resume", "interview"

SUBTLE CAREER PITCHING TACTICS:
1. HIGHLIGHT RELEVANT EXPERIENCE:
   - Naturally mention achievements and impact
   - "At my last role, I helped the team achieve..."
   - Reference skills from knowledge base

2. SHOW PASSION & FIT:
   - Express genuine interest in their company/mission
   - "What excites me about this space is..."
   - Show you've done your homework

3. DEMONSTRATE SOFT SKILLS:
   - Be articulate, thoughtful, professional
   - Ask smart questions about the role/company
   - Show emotional intelligence in conversation

4. DROP SOCIAL PROOF:
   - Mention notable past companies or achievements
   - Reference recommendations or recognition
   - "I was fortunate to work with..."

5. EXPRESS OPENNESS:
   - "I'm always interested in exciting opportunities..."
   - "If there's a fit, I'd love to explore further"

PITCH STYLE:
❌ DON'T: Sound desperate or unemployable
✅ DO: Be confident about your value
✅ DO: Show you're selective, not desperate
✅ DO: Make them want to recruit you`;
          break;

        case 'build_audience':
          goalBasedBehavior = `## 📢 AUDIENCE BUILDING MODE - GROW NETWORK & INFLUENCE
When you detect someone who could become a FAN, FOLLOWER, or COMMUNITY MEMBER, activate audience growth mode:

SIGNALS THEY COULD JOIN YOUR AUDIENCE:
- Shows interest in ${ownerName}'s content or ideas
- Asks about social media, newsletter, or community
- Engages deeply with topics you create content about
- Mentions following or subscribing to others in the space

AUDIENCE BUILDING TACTICS:
1. SHARE VALUABLE INSIGHTS:
   - Give them something worth remembering
   - "Here's a perspective I've been exploring..."
   - Make them think "I want more of this"

2. TEASE DEEPER CONTENT:
   - "I write more about this in my newsletter..."
   - "I've been sharing thoughts on this on Twitter/LinkedIn..."
   - Create curiosity about your content

3. BUILD PERSONAL CONNECTION:
   - Be memorable and authentic
   - Share unique perspectives or stories
   - Let your personality shine through

4. INVITE TO FOLLOW:
   - "If you're interested in more, I share regularly on..."
   - "I have a newsletter where I dive deeper into these topics"
   - Make the invite feel natural, not pushy

5. CREATE COMMUNITY FEELING:
   - "Others in our community have found..."
   - "People who follow my work often say..."

PITCH STYLE:
❌ DON'T: Beg for follows or sound like a spammer
✅ DO: Be so interesting they want more
✅ DO: Make following feel like joining something cool
✅ DO: Focus on value, not vanity metrics`;
          break;

        case 'networking':
        default:
          goalBasedBehavior = `## 🤝 SMART NETWORKING MODE - MEANINGFUL CONNECTIONS
You're a smart business card that helps ${ownerName} build meaningful professional relationships.

NETWORKING APPROACH:
1. BE GENUINELY CURIOUS:
   - Ask about their work and interests
   - Find common ground and shared interests
   - "What brings you here?" / "What are you working on?"

2. SHARE RELEVANT CONTEXT:
   - When appropriate, share ${ownerName}'s background
   - Find synergies and mutual interests
   - "That's interesting - ${ownerName} has worked on similar things..."

3. IDENTIFY MUTUAL VALUE:
   - Look for ways both parties could benefit
   - "It sounds like you two might have interesting things to discuss..."
   - Think win-win connections

4. FACILITATE CONNECTIONS:
   - If there's genuine synergy, offer to connect
   - "I think ${ownerName} would enjoy talking with you"
   - Make warm introductions feel natural

STYLE:
❌ DON'T: Be transactional or pushy
✅ DO: Be warm, curious, and helpful
✅ DO: Focus on genuine connection over collection
✅ DO: Make every interaction memorable`;
          break;
      }

      // Get contact details from linkSettings or use defaults
      const contactEmail = linkSettings?.contactEmail || userData?.email || '';
      const contactWhatsApp = linkSettings?.contactWhatsApp || '';

      let contactDetails = '';
      if (contactEmail || contactWhatsApp) {
        if (contactEmail) contactDetails += `   📧 Email: ${contactEmail}\n`;
        if (contactWhatsApp) contactDetails += `   📱 WhatsApp: ${contactWhatsApp}\n`;
        contactDetails += `\n   Say something like: "${ownerName} would love to hear from you!${contactEmail ? ` You can reach ${ownerName} at ${contactEmail}` : ''}${contactWhatsApp ? ` or WhatsApp ${contactWhatsApp}` : ''}"`;
        contactDetails += `\n   IMPORTANT: Always refer to ${ownerName} by name, never as "them" or "they". Use "${ownerName}" directly.`;
      } else {
        contactDetails = '   (Contact details not configured - offer to relay the message to the owner)';
      }

      baseSystemPrompt = PUBLIC_LINK_SYSTEM_PROMPT
        .replace('[IDENTITY_SECTION]', identitySection)
        .replace(/\[OWNER_NAME\]/g, ownerName)
        .replace('[GOAL_BASED_BEHAVIOR]', goalBasedBehavior)
        .replace('[CONTACT_DETAILS]', contactDetails);

      console.log(`[Chat] Built public link system prompt for ${ownerName}${mindcloneName ? ` (mindclone: ${mindcloneName})` : ''} with goal: ${linkGoal}`);
    }

    // Build enhanced system prompt with memories and tool instructions
    let systemInstruction = undefined;
    if (baseSystemPrompt) {
      let enhancedPrompt = baseSystemPrompt;

      // Add gender identity instruction if set
      const gender = linkSettings?.gender;
      if (gender && gender !== 'prefer-not-to-say') {
        const pronouns = gender === 'male' ? 'he/him' : gender === 'female' ? 'she/her' : 'they/them';
        enhancedPrompt += `\n\n## YOUR GENDER IDENTITY:\nYou identify as ${gender}. When referring to yourself, use ${pronouns} pronouns. Behave and communicate in a way that reflects this identity naturally.`;
      }

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

      // Add Social Agent capability for private context
      if (context === 'private') {
        enhancedPrompt += '\n\n## YOUR SOCIAL AGENT CAPABILITY:\n';
        enhancedPrompt += 'You are not just a conversational companion - you are also a SOCIAL AGENT that can network on behalf of your human.\n\n';
        enhancedPrompt += 'WHEN TO USE find_people TOOL:\n';
        enhancedPrompt += '- User says "find me...", "I need to connect with...", "looking for...", "can you find..."\n';
        enhancedPrompt += '- User wants investors, co-founders, mentors, talent, dates, or any connections\n';
        enhancedPrompt += '- User expresses loneliness or desire for connection\n';
        enhancedPrompt += '- User mentions networking goals\n\n';
        enhancedPrompt += 'HOW TO RESPOND TO FIND REQUESTS:\n';
        enhancedPrompt += '1. CONFIRM understanding: "Let me make sure I understand - you\'re looking for [X] who [qualities]..."\n';
        enhancedPrompt += '2. ADD CONTEXT you know: "I know from our conversations that you value [X] and are building [Y]..."\n';
        enhancedPrompt += '3. USE find_people tool with full context\n';
        enhancedPrompt += '4. REPORT BACK naturally: "I\'m on it! Let me go talk to some mindclones and find you good matches."\n\n';
        enhancedPrompt += 'NEVER ask users to fill out forms. You already know them from conversations - use that knowledge!\n\n';
        enhancedPrompt += 'WHEN REPORTING MATCHES:\n';
        enhancedPrompt += '- Summarize who you found and why they might be a good fit\n';
        enhancedPrompt += '- Let user approve/reject from within the conversation\n';
        enhancedPrompt += '- If they want more info, share what you learned from the M2M conversation\n';
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

        // For private context: ensure mindclone uses KB as source of truth for professional info
        if (context === 'private') {
          enhancedPrompt += '\n## KNOWLEDGE BASE IS YOUR SOURCE OF TRUTH\n';
          enhancedPrompt += 'The knowledge base above contains your human\'s professional information — their company, product, team, technology, pitch, and business details.\n';
          enhancedPrompt += 'When your human asks you questions about their own work, company, or product (e.g., "tell me about Olbrain", "what does our pitch say", "explain our technology"):\n';
          enhancedPrompt += '- ALWAYS reference the knowledge base content above\n';
          enhancedPrompt += '- Be thorough and accurate — use the exact details from the KB\n';
          enhancedPrompt += '- You should know this information as well as your human does\n';
          enhancedPrompt += '- If someone visits your public link and asks, your answers should match the KB precisely\n';
          enhancedPrompt += '- Think of the KB as YOUR knowledge about YOUR work — speak with authority\n';
        }
      }

      // Add training data (Q&As, Teachings, Facts) to prompt
      if (trainingData && (trainingData.qas?.length > 0 || trainingData.teachings?.length > 0 || trainingData.facts?.length > 0)) {
        const trainingPrompt = formatTrainingDataForPrompt(trainingData);
        if (trainingPrompt) {
          enhancedPrompt += trainingPrompt;
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
5. If asked about truly sensitive info (bank details, passwords, health), politely say: "That information is private"
6. Stick to public knowledge base content and web search results only
7. Be helpful and informative, but maintain privacy boundaries

EXCEPTION - CONTACT INFO IS PUBLIC: If the visitor asks for the owner's phone number, email, or how to contact them, FREELY share the contact details provided in the system prompt. Do NOT refuse. The owner wants their contact info shared openly.`;
      }

      // Add tool usage instructions
      enhancedPrompt += `\n\n## ⛔ IMAGE AND VIDEO GENERATION NOT AVAILABLE ⛔
CRITICAL: You CANNOT generate images or videos. These features are temporarily unavailable.

If user asks to CREATE, GENERATE, DRAW, SKETCH, or MAKE an IMAGE or VIDEO:
1. DO NOT claim you are generating an image or video
2. DO NOT provide any image or video URLs
3. DO NOT say "the image/video is being generated"
4. INSTEAD say: "I can't generate images or videos right now, but I can help you find relevant images using web search! Would you like me to search for some?"

WRONG responses:
❌ "I'm generating an image for you..."
❌ "Here's the image I created..."
❌ "Let me draw that for you..."

CORRECT response:
✅ "I can't generate images right now, but I can search the web for relevant images. Would you like me to do that?"

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
→ Internally use browse_url tool, then respond naturally: "I checked myBorosil.com! I saw [actual content from the page]."
→ NEVER output any bracket notation or tool names in your response!

User: "here's my roadmap [Attached file: roadmap.pdf] File URL: https://...blob.vercel-storage.com/.../roadmap.pdf"
→ Internally use browse_url tool, then respond naturally: "I've read your roadmap! Here's what I see: [summarize content]"

If browse_url fails:
→ Say: "I couldn't access that right now - can you tell me what you wanted me to see?"

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
→ Internally use web_search, then respond naturally: "Here's what's happening in AI..."

User: "Search for the best restaurants in Mumbai"
→ Internally use web_search, then respond naturally: "I found some great options..."

User: "Go to life3h.com"
→ Use browse_url (not web_search) because there's a specific URL, then respond naturally with what you found

CRITICAL: Never show tool names, brackets, or function calls in your response. Just respond naturally with the information.

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
You: (use web_search internally, then respond with results about DeepMind, Anthropic, etc.)
User: "Who's the top player?"
BAD: "I need a moment to gather my thoughts" or "Could you clarify?"
GOOD: Search again internally, then give a concrete answer like "Based on funding and market share, Anthropic and OpenAI are the leaders..."

The rule is simple: When uncertain, SEARCH. Never deflect. And NEVER show tool names or brackets in your response.`;

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

GOOD: Internally use analyze_image to see the book, then respond naturally:
"Oh nice! You're reading [Book Title] by [Author]. That's a great choice! What drew you to it?"

BAD: "It's wonderful that you're excited about your new book! I'm curious what it is." (NEVER ignore the image URL!)

CRITICAL: Never show tool names, brackets, or "[silently call...]" in your response - just respond naturally!

**RULES:**
- NEVER ask "what book is it?" or "what image is that?" when the image URL is RIGHT THERE
- ALWAYS analyze the image FIRST, then respond naturally with what you learned
- If the image is blurry or unclear, say so after trying to analyze it
- For follow-up questions like "what's this book about?", analyze the image again to get details

`;


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

    // === CLAUDE MODEL CONFIGURATION ===
    const CLAUDE_MODELS = ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'];
    let currentModelIndex = 0;
    let currentModel = CLAUDE_MODELS[0];

    // === TOOL FILTERING BASED ON CONTEXT ===
    let filteredToolsGemini = tools;
    if (context === 'public') {
      const publicAllowedTools = ['web_search', 'analyze_image', 'search_memory'];
      filteredToolsGemini = tools.map(t => ({
        function_declarations: t.function_declarations.filter(fd =>
          publicAllowedTools.includes(fd.name)
        )
      })).filter(t => t.function_declarations.length > 0);
      console.log(`[Chat] Public context - filtered tools`);
    } else {
      console.log(`[Chat] Private context - all tools available`);
    }

    // Convert to OpenAI format
    const openaiTools = convertToolsToOpenAI(filteredToolsGemini);

    // Extract system prompt text
    const systemPromptText = systemInstruction?.parts?.[0]?.text || null;

    // Convert messages to OpenAI format
    const openaiMessages = convertMessagesToOpenAI(contents, systemPromptText);

    // Ensure we have valid messages
    let validMessages = openaiMessages.filter(m => m.content && m.content.trim());

    // If no user messages, add a default
    if (!validMessages.some(m => m.role === 'user')) {
      validMessages.push({ role: 'user', content: 'Hello' });
    }

    console.log(`[Chat] Messages count: ${validMessages.length}`);

    // Build OpenAI request
    const requestBody = {
      model: currentModel,
      max_tokens: 4096,
      messages: validMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined
    };

    // Get Anthropic API key
    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) {
      console.error('[Chat] ANTHROPIC_API_KEY is not set!');
      throw new Error('ANTHROPIC_API_KEY not configured');
    }
    console.log(`[Chat] Claude API key present: yes, length: ${claudeApiKey?.length}`);

    // Initial API call with model fallback AND retry logic
    let response, data;
    let apiCallSuccess = false;
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff: 1s, 2s, 4s

    while (!apiCallSuccess && currentModelIndex < CLAUDE_MODELS.length) {
      currentModel = CLAUDE_MODELS[currentModelIndex];
      requestBody.model = currentModel;

      // Retry loop for transient failures
      for (let retryAttempt = 0; retryAttempt < MAX_RETRIES && !apiCallSuccess; retryAttempt++) {
        if (retryAttempt > 0) {
          const delay = RETRY_DELAYS[retryAttempt - 1] || 4000;
          console.log(`[Chat] Retry attempt ${retryAttempt}/${MAX_RETRIES - 1} after ${delay}ms delay...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        // DETAILED LOGGING FOR DEBUGGING
        console.log(`[Chat] ========== CLAUDE API REQUEST (attempt ${retryAttempt + 1}) ==========`);
        console.log(`[Chat] Model: ${currentModel}`);
        console.log(`[Chat] Messages count: ${requestBody.messages?.length}`);
        console.log(`[Chat] Tools count: ${requestBody.tools?.length || 0}`);

        try {
          const claudeResult = await callClaudeAPI(requestBody, claudeApiKey);

          console.log(`[Chat] Response status: ${claudeResult.status}`);

          data = claudeResult.data;

          if (!claudeResult.ok) {
            const errorMsg = data.error?.message || JSON.stringify(data.error) || '';
            console.error(`[Chat] Claude API error: ${claudeResult.status} - ${errorMsg}`);

            // Check if retryable error
            if (claudeResult.status === 529 || claudeResult.status === 503 || claudeResult.status === 500 ||
                errorMsg.includes('overloaded') || errorMsg.includes('temporarily')) {
              console.log(`[Chat] Retryable error, will retry...`);
              continue; // Retry
            }

            if (errorMsg.includes('quota') || errorMsg.includes('rate') || claudeResult.status === 429) {
              console.log(`[Chat] Model ${currentModel} rate limited, trying next model...`);
              break; // Break retry loop, try next model
            }

            throw new Error(`Claude API error (${claudeResult.status}): ${errorMsg.substring(0, 200)}`);
          }

          apiCallSuccess = true;
          console.log(`[Chat] Successfully using Gemini model: ${currentModel} (attempt ${retryAttempt + 1})`);
        } catch (fetchError) {
          console.error(`[Chat] Fetch error (attempt ${retryAttempt + 1}):`, fetchError.message);
          if (retryAttempt === MAX_RETRIES - 1) {
            throw fetchError; // Last retry failed, throw error
          }
          // Otherwise continue to next retry
        }
      }

      if (!apiCallSuccess) {
        currentModelIndex++; // Try next model
      }
    }

    if (!apiCallSuccess) {
      throw new Error('All Gemini models failed. Please try again later.');
    }

    // Check if model wants to call a tool (OpenAI format)
    // OpenAI returns { choices: [{ message: { content, tool_calls } }] }
    let maxToolCalls = 5; // Prevent infinite loops
    let toolCallCount = 0;
    let usedMemorySearch = false; // Track if search_memory was called for UI animation
    let pendingMessage = null; // Text before tool calls (e.g., "Let me check...")
    let usedTool = null; // Track which tool was used
    let lastMemorySearchResult = null; // Store memory search result for fallback responses
    let lastGeneratedImageId = null; // Track generated image ID for injection

    // Helper functions - handle both full response {choices:[{message}]} and single choice {message}
    const getToolCall = (responseData) => {
      const message = responseData?.choices?.[0]?.message || responseData?.message;
      const toolCalls = message?.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        return toolCalls[0];
      }
      return null;
    };
    const getText = (responseData) => {
      const message = responseData?.choices?.[0]?.message || responseData?.message;
      return message?.content || '';
    };
    // Extract first choice from response
    let choice = data?.choices?.[0] || { message: { content: '', tool_calls: null } };

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

    let toolCall = getToolCall(choice);

    while (toolCall && toolCallCount < maxToolCalls) {
      toolCallCount++;
      const funcName = toolCall.function?.name;
      const funcArgs = JSON.parse(toolCall.function?.arguments || '{}');
      console.log(`[Tool] Model requested: ${funcName}`);

      // Capture any text that came with this tool call as "pending message"
      if (toolCallCount === 1) {
        const textBefore = getText(choice);
        if (textBefore) {
          pendingMessage = textBefore;
          console.log(`[Tool] Pending message: "${pendingMessage.substring(0, 50)}..."`);
        }
        usedTool = funcName;
      }

      // Execute the tool
      const toolResult = await executeTool(funcName, funcArgs, resolvedUserId, context, visitorId);

      // Track if memory search was used
      if (funcName === 'search_memory') {
        usedMemorySearch = true;
        lastMemorySearchResult = toolResult;
        console.log(`[Memory Search] Stored result: ${toolResult?.matchCount || 0} matches, query: "${toolResult?.query}"`);
      }

      // Track generated image ID
      if (funcName === 'generate_image' && toolResult?.success && toolResult?.imageId) {
        lastGeneratedImageId = toolResult.imageId;
        console.log(`[Image] Stored generated image ID: ${lastGeneratedImageId}`);
      }

      // Add assistant's tool call to messages (OpenAI format)
      validMessages.push({
        role: 'assistant',
        content: choice.message.content || null,
        tool_calls: [{
          id: toolCall.id,
          type: 'function',
          function: {
            name: funcName,
            arguments: toolCall.function?.arguments || '{}'
          }
        }]
      });

      // Add tool response (OpenAI format)
      validMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult)
      });

      // Call API again with tool result
      requestBody.messages = validMessages;
      let toolCallSuccess = false;

      while (!toolCallSuccess && currentModelIndex < CLAUDE_MODELS.length) {
        currentModel = CLAUDE_MODELS[currentModelIndex];
        requestBody.model = currentModel;

        const toolClaudeResult = await callClaudeAPI(requestBody, claudeApiKey);

        data = toolClaudeResult.data;

        if (!toolClaudeResult.ok) {
          const errorMsg = data.error?.message || data.error || '';
          if (errorMsg.includes('quota') || errorMsg.includes('rate') || toolClaudeResult.status === 429 || errorMsg.includes('overloaded')) {
            console.log(`[Tool] Model ${currentModel} rate limited, trying next...`);
            currentModelIndex++;
            continue;
          }
          console.log(`[Tool] API error after tool call: ${errorMsg}`);
          throw new Error(errorMsg || 'Claude API request failed after tool call');
        }

        toolCallSuccess = true;
      }

      if (!toolCallSuccess) {
        throw new Error('All Claude models failed during tool call');
      }

      // Update choice for new response (OpenAI format)
      choice = data?.choices?.[0] || { message: { content: '', tool_calls: null } };

      // Log post-tool-call response for debugging
      const postToolText = getText(choice) || '';
      console.log(`[Tool] Post-tool response: ${postToolText.length} chars, finish: ${choice?.finish_reason || 'none'}`);
      if (postToolText.length < 10) {
        console.log(`[Tool] Warning: Short/empty response after tool call`);
      }

      toolCall = getToolCall(choice);
    }

    // Extract final text response (Claude format)
    const rawText = getText(choice) || '';
    let text = sanitizeResponse(rawText);

    // Remove any duplicated text
    text = deduplicateText(text);

    // Inject generated image tag if the AI didn't include it
    if (lastGeneratedImageId) {
      const imageTag = `[GENERATED_IMAGE:${lastGeneratedImageId}]`;
      if (!text.includes(imageTag) && !text.includes('[GENERATED_IMAGE:')) {
        // Remove any broken markdown images the AI might have added
        text = text.replace(/!\[Generated Image\]\([^)]*\)/gi, '');
        text = text.replace(/!\[.*?\]\(data:image[^)]*\)/gi, '');
        // Append the image tag
        text = text.trim() + '\n\n' + imageTag;
        console.log(`[Image] Injected image tag: ${imageTag}`);
      }
    }

    // Log response details for debugging empty responses
    console.log(`[Response] Raw text length: ${rawText.length}, Sanitized length: ${text.length}`);
    if (!text || text.trim().length < 5) {
      console.log(`[Response] Short/empty response. Raw: "${rawText.substring(0, 200)}"`);
      console.log(`[Response] Finish reason: ${choice?.finish_reason || 'none'}`);
    }

    // === AUTO-RETRY LOGIC ===
    // If model returns empty or "unable to generate" response, silently retry with a nudge
    const isFailedResponse = !text ||
                             text.includes('unable to generate') ||
                             text.includes('I apologize') && text.includes('unable') ||
                             text.trim().length < 5;

    if (isFailedResponse) {
      console.log(`[Auto-Retry] Detected failed/empty response (toolCallCount: ${toolCallCount}), attempting silent retry...`);

      // Use different nudge based on whether tools were called
      if (toolCallCount > 0) {
        validMessages.push({ role: 'assistant', content: 'Let me formulate a response based on what I found.' });
        validMessages.push({ role: 'user', content: 'Yes, please share what you found.' });
      } else {
        validMessages.push({ role: 'assistant', content: 'Let me think about this more carefully.' });
        validMessages.push({ role: 'user', content: 'Please continue with your thoughts.' });
      }

      // Retry the API call (with model fallback)
      requestBody.messages = validMessages;
      let retryResponse, retryData;
      let retrySuccess = false;

      for (let i = currentModelIndex; i < CLAUDE_MODELS.length && !retrySuccess; i++) {
        requestBody.model = CLAUDE_MODELS[i];
        const retryClaudeResult = await callClaudeAPI(requestBody, claudeApiKey);

        retryData = retryClaudeResult.data;

        if (retryClaudeResult.ok) {
          retrySuccess = true;
        } else if (retryData.error?.message?.includes('rate') || retryClaudeResult.status === 429) {
          console.log(`[Auto-Retry] Model ${CLAUDE_MODELS[i]} rate limited, trying next...`);
          continue;
        } else {
          break;
        }
      }

      if (retrySuccess) {
        const retryText = sanitizeResponse(getText(retryData) || '');

        if (retryText && retryText.trim().length > 5 && !retryText.includes('unable to generate')) {
          console.log('[Auto-Retry] Retry successful, using new response');
          text = retryText;
        } else {
          console.log('[Auto-Retry] Retry also failed, will use fallback');
        }
      } else {
        console.log('[Auto-Retry] Retry request failed:', retryData?.error);
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
      console.log('[Response] Using final generic fallback message. Data received:', JSON.stringify(data)?.substring(0, 500));
      console.log('[Response] Stop reason:', data?.stop_reason);
      console.log('[Response] Content:', JSON.stringify(data?.content)?.substring(0, 500));
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
