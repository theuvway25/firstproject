const logger = require('../utils/logger');
require('dotenv').config();

// Prefer IPv4 — this host's IPv6 transit is flaky and undici sometimes picks a
// dead IPv6 address for openrouter.ai, causing intermittent "fetch failed".
// Idempotent and process-wide; also set in server.js for all outbound calls.
try { require('dns').setDefaultResultOrder('ipv4first'); } catch { /* older node */ }

// LLM Provider Configuration
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'openrouter'; // 'openrouter' or 'google'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'google/gemini-2.0-flash-exp';

// Provider-specific configurations
const PROVIDERS = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'google/gemini-2.0-flash-exp',
    getHeaders: (apiKey) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'LedgerAI v2.0'
    }),
    formatRequest: (model, messages, temperature) => ({
      model,
      messages,
      temperature
    }),
    extractResponse: (data) => data.choices?.[0]?.message?.content?.trim()
  },
  '9router': {
    url: process.env.NINEROUTER_URL || 'http://localhost:20128/v1/chat/completions',
    defaultModel: 'kr/claude-sonnet-4.5',
    getHeaders: (apiKey) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }),
    formatRequest: (model, messages, temperature) => ({
      model,
      messages,
      temperature,
      stream: false,
      max_tokens: parseInt(process.env.CODE_GEN_MAX_TOKENS) || 4096
    }),
    extractResponse: (data) => data.choices?.[0]?.message?.content?.trim()
  },
  google: {
    url: (model, apiKey) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    defaultModel: 'gemini-2.0-flash-exp',
    getHeaders: () => ({
      'Content-Type': 'application/json'
    }),
    formatRequest: (model, messages, temperature) => {
      // Convert OpenAI-style messages to Google's format
      const contents = messages.map(msg => ({
        role: msg.role === 'system' ? 'user' : msg.role, // Google doesn't have 'system' role
        parts: [{ text: msg.content }]
      }));

      // Merge system message with first user message if present
      if (messages[0]?.role === 'system' && messages.length > 1) {
        const systemContent = messages[0].content;
        const userContent = messages[1].content;
        return {
          contents: [
            {
              role: 'user',
              parts: [{ text: `${systemContent}\n\n${userContent}` }]
            },
            ...messages.slice(2).map(msg => ({
              role: msg.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: msg.content }]
            }))
          ],
          generationConfig: {
            temperature: temperature,
            maxOutputTokens: 32768
          }
        };
      }

      return {
        contents: contents.map(c => ({
          ...c,
          role: c.role === 'assistant' ? 'model' : 'user'
        })),
        generationConfig: {
          temperature: temperature,
          maxOutputTokens: 8192
        }
      };
    },
    extractResponse: (data) => data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  }
};

/**
 * Universal LLM API caller that supports multiple providers
 * @param {Array} messages - Array of message objects with role and content
 * @param {number} temperature - Temperature for generation (0-1)
 * @returns {Promise<string>} - Generated text response
 */
async function callLLM(messages, temperature = 0.1) {
  const provider = PROVIDERS[LLM_PROVIDER];

  if (!provider) {
    throw new Error(`Invalid LLM_PROVIDER: ${LLM_PROVIDER}. Must be 'openrouter', 'google' or '9router'`);
  }

  // Validate API key
  let apiKey;
  if (LLM_PROVIDER === 'openrouter') {
    apiKey = OPENROUTER_API_KEY;
  } else if (LLM_PROVIDER === '9router') {
    apiKey = process.env.NINEROUTER_API_KEY;
  } else {
    apiKey = GOOGLE_API_KEY;
  }

  if (!apiKey) {
    throw new Error(`${LLM_PROVIDER.toUpperCase()}_API_KEY is not configured`);
  }

  // Determine model to use
  const model = LLM_MODEL || provider.defaultModel;

  // Build request
  const url = typeof provider.url === 'function'
    ? provider.url(model, apiKey)
    : provider.url;

  const headers = provider.getHeaders(apiKey);
  const body = provider.formatRequest(model, messages, temperature);

  logger.info('LLM API call', {
    provider: LLM_PROVIDER,
    model,
    messageCount: messages.length
  });

  // ── Resilient fetch ────────────────────────────────────────────────────────
  // Retries transient failures (network "fetch failed", 429, 5xx) with backoff.
  // Auth/credit errors (401/403/402) are NOT retried — they won't self-heal.
  // An AbortController timeout prevents a hung connection from blocking forever.
  const MAX_ATTEMPTS = 3;
  const REQUEST_TIMEOUT_MS = 60000;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (netErr) {
      // Network-level failure (DNS, connect, abort/timeout) — retryable
      clearTimeout(timer);
      lastErr = netErr;
      const reason = netErr.name === 'AbortError'
        ? `timeout after ${REQUEST_TIMEOUT_MS}ms`
        : (netErr.cause?.code || netErr.cause?.message || netErr.message);
      logger.warn('LLM API network error — will retry', {
        provider: LLM_PROVIDER,
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        reason
      });
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 500 * attempt + Math.floor(Math.random() * 250)));
        continue;
      }
      logger.error('❌ LLM API call failed (network)', { provider: LLM_PROVIDER, error: reason });
      throw new Error(`LLM API network error: ${reason}`);
    }
    clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetails = '';
      try {
        const errorJson = JSON.parse(errorText);
        errorDetails = errorJson.error?.message || errorJson.message || errorText;
      } catch {
        errorDetails = errorText;
      }

      // Non-retryable auth/credit errors — fail fast
      if (response.status === 402) {
        logger.error('💳 LLM API: INSUFFICIENT CREDITS', { provider: LLM_PROVIDER, status: response.status, error: errorDetails });
        throw new Error(`LLM API error (${response.status}): ${errorDetails}`);
      }
      if (response.status === 401 || response.status === 403) {
        logger.error('🔑 LLM API: AUTHENTICATION FAILED', { provider: LLM_PROVIDER, status: response.status, error: errorDetails });
        throw new Error(`LLM API error (${response.status}): ${errorDetails}`);
      }

      // Retryable server-side errors (429 rate limit, 5xx)
      if (response.status === 429 || response.status >= 500) {
        lastErr = new Error(`LLM API error (${response.status}): ${errorDetails}`);
        logger.warn('LLM API transient HTTP error — will retry', {
          provider: LLM_PROVIDER,
          status: response.status,
          attempt,
          maxAttempts: MAX_ATTEMPTS
        });
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 700 * attempt + Math.floor(Math.random() * 300)));
          continue;
        }
      }

      logger.error('❌ LLM API call failed', { provider: LLM_PROVIDER, status: response.status, error: errorDetails });
      throw new Error(`LLM API error (${response.status}): ${errorDetails}`);
    }

    const data = await response.json();
    const content = provider.extractResponse(data);

    if (!content) {
      logger.warn('⚠️ LLM response was empty');
      throw new Error('Empty response from LLM');
    }

    return content;
  }

  // Exhausted all attempts
  throw lastErr || new Error('LLM API call failed after retries');
}

/**
 * Get current LLM provider info
 */
function getProviderInfo() {
  let configured = false;
  if (LLM_PROVIDER === 'openrouter') {
    configured = !!OPENROUTER_API_KEY;
  } else if (LLM_PROVIDER === '9router') {
    configured = !!process.env.NINEROUTER_API_KEY;
  } else {
    configured = !!GOOGLE_API_KEY;
  }

  return {
    provider: LLM_PROVIDER,
    model: LLM_MODEL || PROVIDERS[LLM_PROVIDER]?.defaultModel,
    configured
  };
}

module.exports = {
  callLLM,
  getProviderInfo
};
