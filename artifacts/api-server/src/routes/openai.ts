/**
 * FlowPoint — Reusable OpenAI client
 * Retry logic, timeout, token tracking, model selection by plan.
 */

import OpenAI from "openai";
import { logger } from "../logger.js";
import { TIMEOUTS, RETRY_CONFIG, AI_LIMITS, normalizePlan } from "../config.js";
import { store } from "../../services/store.js";
import { resolveOpenAIConnection, aiConfigured } from "../lib/openai-client.js";

let _client: OpenAI | null = null;
let _clientProvider: string | null = null;

export function getOpenAIClient(): OpenAI {
  const conn = resolveOpenAIConnection();
  if (!_client || _clientProvider !== (conn?.provider ?? null)) {
    _client = new OpenAI({
      apiKey: conn?.apiKey ?? '',
      ...(conn?.baseURL ? { baseURL: conn.baseURL } : {}),
      timeout: TIMEOUTS.openai,
      maxRetries: RETRY_CONFIG.openai.maxAttempts,
    });
    _clientProvider = conn?.provider ?? null;
  }
  return _client;
}

export function getModelForCurrentPlan(): string {
  const plan = normalizePlan(store.me?.plan ?? 'standard');
  return AI_LIMITS[plan].model;
}

export interface CompletionOptions {
  systemPrompt: string;
  userPrompt:   string;
  maxTokens?:   number;
  temperature?: number;
  model?:       string;
  json?:        boolean;
}

export async function completion(opts: CompletionOptions): Promise<string> {
  if (!aiConfigured()) {
    logger.warn('[OpenAI] No AI provider configured — returning fallback');
    return opts.json ? '{}' : 'AI non disponible — clé API manquante.';
  }

  const client = getOpenAIClient();
  const model  = opts.model ?? getModelForCurrentPlan();
  const maxTokens = opts.maxTokens ?? 512;

  let lastErr: unknown;
  const { maxAttempts, baseDelayMs, maxDelayMs } = RETRY_CONFIG.openai;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        temperature: opts.temperature ?? 0.7,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user',   content: opts.userPrompt   },
        ],
      });
      const content = response.choices[0]?.message?.content ?? '';
      logger.debug({ model, tokens: response.usage?.total_tokens, attempt }, '[OpenAI] Completion OK');
      return content;
    } catch (err: unknown) {
      lastErr = err;
      const errMsg = String((err as { message?: string })?.message ?? '');
      const isRetryable = errMsg.includes('timeout') || errMsg.includes('rate') || errMsg.includes('529') || errMsg.includes('503');
      if (!isRetryable || attempt === maxAttempts) break;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      logger.warn({ attempt, delay, err: errMsg }, '[OpenAI] Retrying after error');
      await new Promise(r => setTimeout(r, delay));
    }
  }

  logger.error({ err: lastErr }, '[OpenAI] All retries exhausted');
  throw lastErr;
}

/** Lightweight streaming completion stub — yields full text for now */
export async function streamCompletion(opts: CompletionOptions): Promise<string> {
  return completion(opts);
}

/** Embed text (for future semantic search) */
export async function embed(text: string): Promise<number[]> {
  if (!aiConfigured()) return [];
  const client = getOpenAIClient();
  try {
    const res = await client.embeddings.create({ model: 'text-embedding-3-small', input: text });
    return res.data[0]?.embedding ?? [];
  } catch (err) {
    logger.error({ err }, '[OpenAI] Embedding failed');
    return [];
  }
}
