/**
 * FlowPoint — Central OpenAI connection resolver.
 *
 * Priority:
 *   1. Replit AI Integrations proxy (AI_INTEGRATIONS_OPENAI_BASE_URL + AI_INTEGRATIONS_OPENAI_API_KEY)
 *      — no personal API key required, billed via Replit credits.
 *   2. Personal OPENAI_API_KEY (direct api.openai.com).
 *
 * All server code that instantiates an OpenAI client MUST go through
 * resolveOpenAIConnection() so the whole app switches providers consistently.
 */

export interface OpenAIConnection {
  apiKey: string;
  baseURL?: string;
  provider: "replit-proxy" | "direct";
}

export function resolveOpenAIConnection(): OpenAIConnection | null {
  const proxyUrl = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  const proxyKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  if (proxyUrl && proxyKey) {
    return { apiKey: proxyKey, baseURL: proxyUrl, provider: "replit-proxy" };
  }
  const directKey = process.env["OPENAI_API_KEY"];
  if (directKey) {
    return { apiKey: directKey, provider: "direct" };
  }
  return null;
}

export function aiConfigured(): boolean {
  return resolveOpenAIConnection() !== null;
}

/**
 * One-shot chat completion through the resolved provider.
 * Throws if no AI provider is configured or the call fails.
 */
// gpt-5+ models don't support `max_tokens`/`temperature` — they require
// `max_completion_tokens` and always run at temperature 1.
function isGpt5Family(model: string): boolean {
  return /^gpt-5/.test(model);
}

export async function aiChatCompletion(opts: {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
}): Promise<string> {
  const conn = resolveOpenAIConnection();
  if (!conn) throw new Error("AI_NOT_CONFIGURED");
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: conn.apiKey, ...(conn.baseURL ? { baseURL: conn.baseURL } : {}) });
  const model = opts.model ?? "gpt-5-mini";
  const tokenLimit = opts.maxTokens ?? 512;
  const resp = await client.chat.completions.create({
    model,
    ...(isGpt5Family(model)
      ? { max_completion_tokens: tokenLimit }
      : { max_tokens: tokenLimit, temperature: opts.temperature ?? 0.7 }),
    ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
  });
  return resp.choices[0]?.message?.content ?? "";
}
