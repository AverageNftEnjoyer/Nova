import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEMORY_PATH = path.join(__dirname, "..", "nova_memory.json");

// Token limits (hard constraints)
const TOKEN_LIMITS = {
  identity: 300,
  working_context: 200
};

/**
 * Approximate token count using GPT tokenizer heuristics.
 * ~4 chars per token for English, conservative estimate.
 */
export function countTokens(text) {
  if (!text) return 0;
  const str = typeof text === "string" ? text : JSON.stringify(text);
  // Conservative: ~3.5 chars per token for mixed content
  return Math.ceil(str.length / 3.5);
}

/**
 * Validate token count does not exceed limit.
 * Returns { valid: boolean, count: number, limit: number }
 */
export function validateTokenBound(content, limit) {
  const count = countTokens(content);
  return {
    valid: count <= limit,
    count,
    limit
  };
}

/**
 * Load memory from disk. Returns null on failure.
 * NO caching - always reads fresh from disk.
 */
function loadRaw() {
  try {
    const raw = fs.readFileSync(MEMORY_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Save memory to disk atomically.
 */
function saveRaw(data) {
  data.metadata = data.metadata || {};
  data.metadata.last_updated = new Date().toISOString();
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(data, null, 2));
}

/**
 * Get identity memory (≤300 tokens).
 * Returns the identity object or a default.
 */
export function getIdentity() {
  const mem = loadRaw();
  if (!mem?.identity?.content) {
    return {
      who_i_am: "Nova, a confident AI assistant",
      long_term_goals: ["Assist the user"],
      preferences: { tone: "confident", response_style: "natural" }
    };
  }
  return mem.identity.content;
}

/**
 * Get working context memory (≤200 tokens).
 * Returns the working context object.
 */
export function getWorkingContext() {
  const mem = loadRaw();
  if (!mem?.working_context?.content) {
    return {
      current_task: null,
      active_topics: [],
      user_facts: []
    };
  }
  return mem.working_context.content;
}

/**
 * Build identity prompt string with token enforcement.
 * Returns { prompt: string, tokens: number }
 */
export function buildIdentityPrompt() {
  const identity = getIdentity();

  let prompt = `Your name is ${identity.who_i_am || "Nova"}.`;

  if (identity.preferences?.tone) {
    prompt += ` Maintain a ${identity.preferences.tone} tone.`;
  }
  if (identity.preferences?.response_style) {
    prompt += ` Be ${identity.preferences.response_style} in responses.`;
  }
  if (identity.long_term_goals?.length > 0) {
    prompt += ` Goals: ${identity.long_term_goals.join("; ")}.`;
  }

  const validation = validateTokenBound(prompt, TOKEN_LIMITS.identity);
  if (!validation.valid) {
    // Truncate to fit - take first portion
    const maxChars = TOKEN_LIMITS.identity * 3.5;
    prompt = prompt.slice(0, Math.floor(maxChars)) + "...";
  }

  return {
    prompt,
    tokens: countTokens(prompt)
  };
}

/**
 * Build working context prompt string with token enforcement.
 * Returns { prompt: string, tokens: number }
 */
export function buildWorkingContextPrompt() {
  const ctx = getWorkingContext();
  const parts = [];

  if (ctx.current_task) {
    parts.push(`Current task: ${ctx.current_task}`);
  }
  if (ctx.user_facts?.length > 0) {
    parts.push(`Known about user: ${ctx.user_facts.join("; ")}`);
  }
  if (ctx.active_topics?.length > 0) {
    parts.push(`Active topics: ${ctx.active_topics.join(", ")}`);
  }

  let prompt = parts.join(". ");

  const validation = validateTokenBound(prompt, TOKEN_LIMITS.working_context);
  if (!validation.valid) {
    // Truncate to fit
    const maxChars = TOKEN_LIMITS.working_context * 3.5;
    prompt = prompt.slice(0, Math.floor(maxChars)) + "...";
  }

  return {
    prompt,
    tokens: countTokens(prompt)
  };
}

/**
 * Update identity memory. Enforces token bound.
 * Returns { success: boolean, error?: string }
 */
export function updateIdentity(newContent) {
  const validation = validateTokenBound(newContent, TOKEN_LIMITS.identity);
  if (!validation.valid) {
    return {
      success: false,
      error: `Identity exceeds ${TOKEN_LIMITS.identity} tokens (got ${validation.count})`
    };
  }

  const mem = loadRaw() || createDefaultMemory();
  mem.identity.content = newContent;
  saveRaw(mem);
  return { success: true };
}

/**
 * Update working context memory. Enforces token bound.
 * Returns { success: boolean, error?: string }
 */
export function updateWorkingContext(newContent) {
  const validation = validateTokenBound(newContent, TOKEN_LIMITS.working_context);
  if (!validation.valid) {
    return {
      success: false,
      error: `Working context exceeds ${TOKEN_LIMITS.working_context} tokens (got ${validation.count})`
    };
  }

  const mem = loadRaw() || createDefaultMemory();
  mem.working_context.content = newContent;
  saveRaw(mem);
  return { success: true };
}

/**
 * Add a user fact to working context.
 * Enforces token bound - removes oldest facts if needed.
 */
export function addUserFact(fact) {
  const ctx = getWorkingContext();
  ctx.user_facts = ctx.user_facts || [];

  // Check if fact already exists
  if (ctx.user_facts.some(f => f.toLowerCase() === fact.toLowerCase())) {
    return { success: true, duplicate: true };
  }

  ctx.user_facts.push(fact);

  // Enforce token bound - remove oldest facts until within limit
  while (!validateTokenBound(ctx, TOKEN_LIMITS.working_context).valid && ctx.user_facts.length > 0) {
    ctx.user_facts.shift();
  }

  return updateWorkingContext(ctx);
}

/**
 * Set current task in working context.
 */
export function setCurrentTask(task) {
  const ctx = getWorkingContext();
  ctx.current_task = task;

  // Enforce bound
  const validation = validateTokenBound(ctx, TOKEN_LIMITS.working_context);
  if (!validation.valid) {
    // Task too long - truncate
    const maxLen = 100;
    ctx.current_task = task.slice(0, maxLen) + "...";
  }

  return updateWorkingContext(ctx);
}

/**
 * Clear current task.
 */
export function clearCurrentTask() {
  const ctx = getWorkingContext();
  ctx.current_task = null;
  return updateWorkingContext(ctx);
}

/**
 * Create default memory structure.
 */
function createDefaultMemory() {
  return {
    identity: {
      max_tokens: TOKEN_LIMITS.identity,
      content: {
        who_i_am: "Nova, a confident and articulate AI assistant",
        long_term_goals: ["Assist the user efficiently"],
        preferences: { tone: "confident and warm", response_style: "natural" }
      }
    },
    working_context: {
      max_tokens: TOKEN_LIMITS.working_context,
      content: {
        current_task: null,
        active_topics: [],
        user_facts: []
      }
    },
    metadata: {
      last_updated: null,
      version: "1.0"
    }
  };
}

/**
 * Build complete system prompt with selective memory injection.
 *
 * @param {Object} options - Injection options
 * @param {boolean} options.includeIdentity - Include identity memory (default: true)
 * @param {boolean} options.includeWorkingContext - Include working context (default: true)
 * @returns {{ prompt: string, tokenBreakdown: Object }}
 */
export function buildSystemPrompt(options = {}) {
  const {
    includeIdentity = true,
    includeWorkingContext = true
  } = options;

  const parts = [];
  const tokenBreakdown = { identity: 0, working_context: 0, total: 0 };

  if (includeIdentity) {
    const identity = buildIdentityPrompt();
    parts.push(identity.prompt);
    tokenBreakdown.identity = identity.tokens;
  }

  if (includeWorkingContext) {
    const ctx = buildWorkingContextPrompt();
    if (ctx.prompt) {
      parts.push(ctx.prompt);
      tokenBreakdown.working_context = ctx.tokens;
    }
  }

  const prompt = parts.join("\n\n");
  tokenBreakdown.total = countTokens(prompt);

  return { prompt, tokenBreakdown };
}

/**
 * Extract new facts from conversation (async, background).
 * Facts are added to working context with token enforcement.
 */
export async function extractFacts(openai, userText, assistantReply) {
  const ctx = getWorkingContext();
  const existing = ctx.user_facts || [];

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      max_tokens: 150,
      messages: [
        {
          role: "system",
          content: `Extract personal facts about the user. Output JSON array of short strings.
Known: ${existing.length ? existing.join("; ") : "(none)"}
Rules: Only NEW facts. Short statements. Output [] if none. JSON array only.`
        },
        {
          role: "user",
          content: `User: "${userText}"\nAssistant: "${assistantReply}"`
        }
      ]
    });

    const parsed = JSON.parse(res.choices[0].message.content.trim());
    if (Array.isArray(parsed)) {
      for (const fact of parsed) {
        if (typeof fact === "string" && fact.trim()) {
          addUserFact(fact.trim());
        }
      }
    }
  } catch (e) {
    console.error("[Memory] Extraction error:", e.message);
  }
}

// Legacy compatibility - load just user facts
export function loadMemory() {
  const ctx = getWorkingContext();
  return ctx.user_facts || [];
}

// Legacy compatibility - save user facts
export function saveMemory(facts) {
  const ctx = getWorkingContext();
  ctx.user_facts = facts;
  updateWorkingContext(ctx);
}
