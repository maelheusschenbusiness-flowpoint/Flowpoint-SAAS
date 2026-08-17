/**
 * ai-tool-calling.ts — Adaptateur function-calling unifié pour les 3 providers.
 *
 * CONCEPTION CLÉ :
 * Chaque round de tool calling maintient les messages dans le format natif du
 * provider (OpenAI ChatCompletionMessageParam[], Anthropic MessageParam[], Gemini
 * contents[]). Le type `nativeMessages` passe ces messages entre les rounds pour
 * éviter toute perte de structure (tool_calls, tool_result, functionResponse).
 * Le `systemPrompt` est retourné dans le résultat et re-passé aux rounds suivants
 * pour Anthropic (top-level `system`) et Gemini (`systemInstruction`).
 *
 * RÈGLE : ce module n'exécute JAMAIS les outils — il ne fait que les détecter.
 * L'exécution est entièrement déléguée à agent/tool-executor.ts.
 */
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { logger } from "../lib/logger.js";
import { resolveOpenAIConnection } from "../lib/openai-client.js";
import { PROVIDER_CAPABILITIES } from "./ai-providers/capabilities.js";
import type { AIProviderId } from "./ai-providers/openai-provider.js";
import type { AIToolCall } from "../agent/mission-tools.js";
import { toOpenAITools, toAnthropicTools, toGeminiTools, type ToolDef } from "../agent/mission-tools.js";
import type { MultimodalMessage } from "./ai-multimodal.js";

// ── Public types ──────────────────────────────────────────────────────────────

export interface ToolCallingResult {
  text: string;
  toolCalls: AIToolCall[];
  provider: AIProviderId;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  /** true = model emitted tool calls; false = final text response */
  hasToolCalls: boolean;
  /**
   * Provider-native messages to use as input for the next round.
   * Contains: original input + assistant reply (with tool_calls / tool_use blocks).
   * Append buildToolResultMessages(...) output to this before calling aiChatWithTools again.
   */
  nativeMessages: unknown[];
  /**
   * System prompt / system instruction extracted from the first round.
   * Carry through to all continuation rounds (needed by Anthropic + Gemini
   * since their system content is a top-level param, not in the messages array).
   */
  systemPrompt?: string;
}

export interface ToolCallingOptions {
  provider: AIProviderId;
  tools: ToolDef[];
  /**
   * Initial conversation messages (first round only).
   * Converted to provider-native format inside each call.
   * Ignored when nativeMessages is provided.
   */
  messages?: MultimodalMessage[];
  /**
   * Provider-native messages for continuation rounds.
   * When provided, `messages` is ignored.
   * Must be the `nativeMessages` returned by a previous round + tool result injection.
   */
  nativeMessages?: unknown[];
  /**
   * System prompt / instruction for Anthropic & Gemini continuation rounds.
   * Pass the `systemPrompt` from the previous ToolCallingResult on round N>0.
   * Ignored by OpenAI (system is part of the messages array).
   */
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
}

export interface ToolResultInjection {
  toolCallId: string;
  toolName: string;
  content: string;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Single non-streaming function-calling turn.
 * Returns either tool_calls to execute, or a final text response.
 * Always returns nativeMessages + systemPrompt for the next round (if needed).
 */
export async function aiChatWithTools(opts: ToolCallingOptions): Promise<ToolCallingResult> {
  const { provider } = opts;
  switch (provider) {
    case "openai":    return callOpenAIWithTools(opts);
    case "anthropic": return callAnthropicWithTools(opts);
    case "gemini":    return callGeminiWithTools(opts);
    default:
      throw new Error(`aiChatWithTools: unknown provider "${String(provider)}"`);
  }
}

// ── Tool result injection ─────────────────────────────────────────────────────

/**
 * Appends tool results to the provider-native messages array.
 * Call with the nativeMessages from the previous round + the executed tool results.
 * Returns the new nativeMessages to pass to the next round.
 */
export function buildToolResultMessages(
  provider: AIProviderId,
  prevNativeMessages: unknown[],
  assistantText: string,
  assistantToolCalls: AIToolCall[],
  toolResults: ToolResultInjection[]
): unknown[] {
  if (provider === "openai") {
    const assistantMsg = {
      role: "assistant" as const,
      content: assistantText || null,
      tool_calls: assistantToolCalls.map(tc => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    };
    const toolMsgs = toolResults.map(r => ({
      role: "tool" as const,
      tool_call_id: r.toolCallId,
      content: r.content,
    }));
    return [...prevNativeMessages, assistantMsg, ...toolMsgs];
  }

  if (provider === "anthropic") {
    const assistantMsg: Anthropic.MessageParam = {
      role: "assistant",
      content: [
        ...(assistantText ? [{ type: "text" as const, text: assistantText }] : []),
        ...assistantToolCalls.map(tc => ({
          type: "tool_use" as const,
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        })),
      ],
    };
    const toolResultMsg: Anthropic.MessageParam = {
      role: "user",
      content: toolResults.map(r => ({
        type: "tool_result" as const,
        tool_use_id: r.toolCallId,
        content: r.content,
      })),
    };
    return [...prevNativeMessages, assistantMsg, toolResultMsg];
  }

  if (provider === "gemini") {
    // Gemini: model turn with functionCall parts, then user turn with functionResponse parts
    const modelTurn = {
      role: "model" as const,
      parts: [
        ...(assistantText ? [{ text: assistantText }] : []),
        ...assistantToolCalls.map(tc => ({
          functionCall: { name: tc.name, args: tc.arguments },
        })),
      ],
    };
    const userTurn = {
      role: "user" as const,
      parts: toolResults.map(r => ({
        functionResponse: {
          name: r.toolName,
          response: { result: r.content },
        },
      })),
    };
    return [...prevNativeMessages, modelTurn, userTurn];
  }

  return prevNativeMessages;
}

// Keep old export name for backward compat if anything still imports it
export { buildToolResultMessages as buildToolResultMessage };

// ── OpenAI ────────────────────────────────────────────────────────────────────

async function callOpenAIWithTools(opts: ToolCallingOptions): Promise<ToolCallingResult> {
  const { provider = "openai", tools, model: reqModel, maxTokens = 2048 } = opts;
  const t0 = Date.now();
  const conn = resolveOpenAIConnection();
  if (!conn) throw new Error("OpenAI API key missing");
  const client = new OpenAI({ apiKey: conn.apiKey, ...(conn.baseURL ? { baseURL: conn.baseURL } : {}) });
  const model = reqModel ?? PROVIDER_CAPABILITIES.openai.defaultModel ?? "gpt-5-mini";

  // OpenAI includes system messages inline in the messages array — no separate param needed
  let nativeInput: OpenAI.ChatCompletionMessageParam[];
  if (opts.nativeMessages) {
    nativeInput = opts.nativeMessages as OpenAI.ChatCompletionMessageParam[];
  } else {
    nativeInput = multimodalToOpenAI(opts.messages ?? []);
  }

  const rawTools = toOpenAITools(tools);
  const resp = await client.chat.completions.create({
    model,
    messages: nativeInput,
    tools: rawTools as unknown as OpenAI.ChatCompletionTool[],
    tool_choice: "auto",
    ...(model.startsWith("gpt-5") || model.startsWith("o")
      // CR-11: reasoning_effort:"low" reduces tool-selection latency.
      // The API default is "medium" when omitted, which adds unnecessary thinking for
      // tool dispatch (create_mission, delete_mission, etc.). "low" is sufficient.
      ? { max_completion_tokens: maxTokens + 500, reasoning_effort: "low" as const }
      : { max_tokens: maxTokens, temperature: 0.3 }),
  });

  const choice = resp.choices[0];
  // Use unknown cast to avoid SDK version mismatch on tool_call shape
  const rawToolCalls = (choice?.message as unknown as {
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
  })?.tool_calls ?? [];
  const toolCalls: AIToolCall[] = rawToolCalls.map(tc => ({
    id: tc.id,
    name: tc.function.name,
    arguments: (() => {
      try { return JSON.parse(tc.function.arguments) as Record<string, unknown>; }
      catch { return {} as Record<string, unknown>; }
    })(),
  }));
  const text = choice?.message?.content ?? "";

  return {
    text, toolCalls, provider: provider as AIProviderId, model,
    promptTokens: resp.usage?.prompt_tokens ?? 0,
    completionTokens: resp.usage?.completion_tokens ?? 0,
    latencyMs: Date.now() - t0,
    hasToolCalls: toolCalls.length > 0,
    nativeMessages: nativeInput,
    // OpenAI embeds system in messages array — no separate systemPrompt needed
  };
}

function multimodalToOpenAI(messages: MultimodalMessage[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.map(m => ({
    role: m.role as "system" | "user" | "assistant",
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  })) as OpenAI.ChatCompletionMessageParam[];
}

// ── Anthropic ──────────────────────────────────────────────────────────────────

async function callAnthropicWithTools(opts: ToolCallingOptions): Promise<ToolCallingResult> {
  const { provider = "anthropic", tools, model: reqModel, maxTokens = 2048 } = opts;
  const t0 = Date.now();
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  const client = new Anthropic({ apiKey });
  const model = reqModel ?? PROVIDER_CAPABILITIES.anthropic.defaultModel ?? "claude-sonnet-4-6";

  let systemPrompt: string | undefined;
  let nativeInput: Anthropic.MessageParam[];

  if (opts.nativeMessages) {
    // Continuation round: messages are already in native format.
    // Re-supply systemPrompt via opts.systemPrompt (carried from first round result).
    nativeInput = opts.nativeMessages as Anthropic.MessageParam[];
    systemPrompt = opts.systemPrompt;
  } else {
    // First round: extract system from MultimodalMessage[] and convert the rest.
    const converted = multimodalToAnthropic(opts.messages ?? []);
    systemPrompt = converted.system;
    nativeInput = converted.messages;
  }

  const resp = await client.messages.create({
    model,
    max_tokens: maxTokens,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: nativeInput,
    tools: toAnthropicTools(tools) as Anthropic.Tool[],
    tool_choice: { type: "auto" },
  });

  const toolCalls: AIToolCall[] = resp.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map(b => ({ id: b.id, name: b.name, arguments: b.input as Record<string, unknown> }));

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("");

  return {
    text, toolCalls, provider: provider as AIProviderId, model,
    promptTokens: resp.usage?.input_tokens ?? 0,
    completionTokens: resp.usage?.output_tokens ?? 0,
    latencyMs: Date.now() - t0,
    hasToolCalls: toolCalls.length > 0,
    nativeMessages: nativeInput,
    systemPrompt, // Carry through to next round
  };
}

function multimodalToAnthropic(messages: MultimodalMessage[]): {
  system?: string; messages: Anthropic.MessageParam[];
} {
  let system: string | undefined;
  const msgs: Anthropic.MessageParam[] = messages
    .filter(m => {
      if (m.role === "system") {
        system = typeof m.content === "string" ? m.content : undefined;
        return false;
      }
      return true;
    })
    .map(m => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));
  return { system, messages: msgs };
}

// ── Gemini ────────────────────────────────────────────────────────────────────

type GeminiPart = { text?: string; functionCall?: unknown; functionResponse?: unknown };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

async function callGeminiWithTools(opts: ToolCallingOptions): Promise<ToolCallingResult> {
  const { provider = "gemini", tools, model: reqModel, maxTokens = 2048 } = opts;
  const t0 = Date.now();
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const savedKey = process.env["GOOGLE_API_KEY"];
  delete process.env["GOOGLE_API_KEY"];
  let client: GoogleGenAI;
  try { client = new GoogleGenAI({ apiKey }); }
  finally { if (savedKey !== undefined) process.env["GOOGLE_API_KEY"] = savedKey; }

  const model = reqModel ?? PROVIDER_CAPABILITIES.gemini.defaultModel;

  let systemInstruction: string | undefined;
  let nativeContents: GeminiContent[];

  if (opts.nativeMessages) {
    // Continuation round: contents already in native format.
    // Re-supply systemInstruction from opts.systemPrompt.
    nativeContents = opts.nativeMessages as GeminiContent[];
    systemInstruction = opts.systemPrompt;
  } else {
    const converted = multimodalToGemini(opts.messages ?? []);
    systemInstruction = converted.systemInstruction;
    nativeContents = converted.contents;
  }

  const gTools = toGeminiTools(tools);
  const resp = await client.models.generateContent({
    model,
    contents: nativeContents as unknown as Parameters<typeof client.models.generateContent>[0]["contents"],
    config: {
      maxOutputTokens: maxTokens,
      ...(systemInstruction ? { systemInstruction } : {}),
      tools: [{ functionDeclarations: gTools as unknown as Array<{ name: string; description: string; parameters: Record<string, unknown> }> }],
    },
  });

  const candidate = resp.candidates?.[0];
  const parts = (candidate?.content?.parts ?? []) as Array<{
    text?: string; thought?: boolean;
    functionCall?: { name: string; args?: Record<string, unknown> };
  }>;

  const text = parts.filter(p => !p.thought && p.text).map(p => p.text ?? "").join("");
  const toolCalls: AIToolCall[] = parts
    .filter(p => p.functionCall)
    .map((p, i) => ({
      id: `gemini_fc_${Date.now()}_${i}`,
      name: p.functionCall!.name,
      arguments: (p.functionCall!.args ?? {}) as Record<string, unknown>,
    }));

  return {
    text, toolCalls, provider: provider as AIProviderId, model,
    promptTokens: resp.usageMetadata?.promptTokenCount ?? 0,
    completionTokens: resp.usageMetadata?.candidatesTokenCount ?? 0,
    latencyMs: Date.now() - t0,
    hasToolCalls: toolCalls.length > 0,
    nativeMessages: nativeContents,
    systemPrompt: systemInstruction, // Carry through to next round
  };
}

function multimodalToGemini(messages: MultimodalMessage[]): {
  systemInstruction?: string; contents: GeminiContent[];
} {
  let systemInstruction: string | undefined;
  const conversationMsgs = messages.filter(m => {
    if (m.role === "system") {
      systemInstruction = typeof m.content === "string" ? m.content : undefined;
      return false;
    }
    return true;
  });

  const merged: GeminiContent[] = [];
  for (const m of conversationMsgs) {
    const role = (m.role === "assistant" ? "model" : "user") as "user" | "model";
    const parts = [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }];
    const last = merged[merged.length - 1];
    if (last && last.role === role) { last.parts.push(...parts); }
    else { merged.push({ role, parts }); }
  }
  if (merged.length === 0 || merged[0]?.role !== "user") {
    merged.unshift({ role: "user", parts: [{ text: " " }] });
  }
  return { systemInstruction, contents: merged };
}

logger.debug("[ai-tool-calling] loaded — providers: openai, anthropic, gemini");
