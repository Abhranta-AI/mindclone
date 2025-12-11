// LLM Gateway Abstraction Layer using OpenRouter
// Provides a unified interface for LLM calls with automatic model switching

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Model configuration with fallback chain
const MODELS = {
  default: 'google/gemini-2.0-flash-exp:free',
  smart: 'anthropic/claude-sonnet-4',
  fast: 'google/gemini-2.0-flash-exp:free',
  fallback: 'meta-llama/llama-3.1-8b-instruct:free'
};

/**
 * Convert Gemini format messages to OpenAI/OpenRouter format
 * Handles both regular messages and function calls
 */
function convertGeminiToOpenRouter(messages) {
  return messages.map(msg => {
    const converted = {
      role: msg.role === 'model' ? 'assistant' : msg.role
    };

    // Handle text content
    if (msg.parts) {
      const textParts = msg.parts.filter(p => p.text);
      const funcCallParts = msg.parts.filter(p => p.functionCall);
      const funcResponseParts = msg.parts.filter(p => p.functionResponse);

      if (textParts.length > 0) {
        converted.content = textParts.map(p => p.text).join('\n');
      }

      if (funcCallParts.length > 0) {
        converted.tool_calls = funcCallParts.map(p => ({
          id: `call_${Date.now()}_${Math.random()}`,
          type: 'function',
          function: {
            name: p.functionCall.name,
            arguments: JSON.stringify(p.functionCall.args || {})
          }
        }));
      }

      if (funcResponseParts.length > 0) {
        converted.tool_calls = funcResponseParts.map((p, idx) => ({
          id: `call_${Date.now()}_${idx}`,
          type: 'function',
          function: {
            name: p.functionResponse.name,
            arguments: '{}'
          }
        }));
        converted.content = funcResponseParts.map(p =>
          JSON.stringify(p.functionResponse.response)
        ).join('\n');
      }
    }

    return converted;
  });
}

/**
 * Convert Gemini tools format to OpenRouter tools format
 */
function convertGeminiToolsToOpenRouter(geminiTools) {
  if (!geminiTools || geminiTools.length === 0) return [];

  const tools = [];
  for (const toolGroup of geminiTools) {
    if (toolGroup.function_declarations) {
      for (const decl of toolGroup.function_declarations) {
        tools.push({
          type: 'function',
          function: {
            name: decl.name,
            description: decl.description,
            parameters: {
              type: 'object',
              properties: decl.parameters?.properties || {},
              required: decl.parameters?.required || []
            }
          }
        });
      }
    }
  }
  return tools;
}

/**
 * Convert OpenRouter response format back to Gemini format
 */
function convertOpenRouterToGemini(openRouterData) {
  if (!openRouterData.choices || openRouterData.choices.length === 0) {
    throw new Error('No choices in OpenRouter response');
  }

  const choice = openRouterData.choices[0];
  const message = choice.message;

  return {
    candidates: [{
      content: {
        parts: convertOpenRouterContentToParts(message)
      },
      finishReason: choice.finish_reason
    }]
  };
}

/**
 * Convert OpenRouter message content to Gemini parts format
 */
function convertOpenRouterContentToParts(message) {
  const parts = [];

  // Add text content
  if (message.content) {
    parts.push({ text: message.content });
  }

  // Add tool calls as function calls
  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const toolCall of message.tool_calls) {
      if (toolCall.type === 'function') {
        parts.push({
          functionCall: {
            name: toolCall.function.name,
            args: JSON.parse(toolCall.function.arguments || '{}')
          }
        });
      }
    }
  }

  return parts.length > 0 ? parts : [{ text: '' }];
}

/**
 * Make a chat request to OpenRouter with automatic format conversion
 * @param {Array} messages - Messages in Gemini format
 * @param {Array} geminiTools - Tools in Gemini format
 * @param {String} systemInstruction - System instruction text
 * @param {Object} options - Additional options (model, temperature, etc.)
 */
async function chat(messages, geminiTools = [], systemInstruction = null, options = {}) {
  const model = options.model || MODELS.default;

  // Validate API key
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable not set');
  }

  // Convert formats
  const openRouterMessages = convertGeminiToOpenRouter(messages);
  const openRouterTools = convertGeminiToolsToOpenRouter(geminiTools);

  // Build request body
  const requestBody = {
    model,
    messages: openRouterMessages,
    temperature: options.temperature || 1.0,
    top_p: options.top_p || 1.0,
    top_k: options.top_k || 0
  };

  // Add system instruction if provided
  if (systemInstruction) {
    requestBody.messages.unshift({
      role: 'system',
      content: systemInstruction
    });
  }

  // Add tools if provided
  if (openRouterTools.length > 0) {
    requestBody.tools = openRouterTools;
    requestBody.tool_choice = options.tool_choice || 'auto';
  }

  // Add optional fields
  if (options.max_tokens) {
    requestBody.max_tokens = options.max_tokens;
  }

  // Make the request
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://mindclone.one',
      'X-Title': 'Mindclone'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      `OpenRouter API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`
    );
  }

  const data = await response.json();

  // Convert response back to Gemini format for compatibility
  return convertOpenRouterToGemini(data);
}

module.exports = { chat, MODELS, convertGeminiToOpenRouter, convertGeminiToolsToOpenRouter };
