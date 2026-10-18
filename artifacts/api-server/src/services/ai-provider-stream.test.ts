import { beforeEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  openaiStream: vi.fn(),
  anthropicStream: vi.fn(),
  geminiStream: vi.fn(),
}));

vi.mock("../lib/openai-client.js", () => ({
  resolveOpenAIConnection: () => ({ apiKey: "test-key", baseURL: undefined }),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock("./ai-providers/openai-provider.js", () => ({
  OpenAIProvider: class {
    stream(...args: unknown[]) { return providerMocks.openaiStream(...args); }
    chat(...args: unknown[]) { return Promise.resolve({}); }
  },
}));
vi.mock("./ai-providers/anthropic-provider.js", () => ({
  AnthropicProvider: class {
    stream(...args: unknown[]) { return providerMocks.anthropicStream(...args); }
    chat(...args: unknown[]) { return Promise.resolve({}); }
  },
}));
vi.mock("./ai-providers/gemini-provider.js", () => ({
  GeminiProvider: class {
    stream(...args: unknown[]) { return providerMocks.geminiStream(...args); }
    chat(...args: unknown[]) { return Promise.resolve({}); }
  },
}));

import { aiStream, resetProviders } from "./ai-provider.js";

async function readText(stream: ReturnType<typeof aiStream>): Promise<string[]> {
  const chunks: string[] = [];
  while (true) {
    const step = await stream.next();
    if (step.done) return chunks;
    if ("content" in step.value) chunks.push(step.value.content);
  }
}

const chatOptions = {
  systemPrompt: "test",
  userPrompt: "test",
};

describe("AI provider stream lifecycle", () => {
  beforeEach(() => {
    resetProviders();
    providerMocks.openaiStream.mockReset();
    providerMocks.anthropicStream.mockReset();
    providerMocks.geminiStream.mockReset();
  });

  it("does not retry a strict-provider stream after sending partial output", async () => {
    providerMocks.openaiStream.mockImplementation(async function* () {
      yield { content: "partiel" };
      throw new Error("connection lost");
    });

    const stream = aiStream({ ...chatOptions, provider: "openai", strictProvider: true });
    const collected: string[] = [];
    await expect(async () => {
      while (true) {
        const step = await stream.next();
        if (step.done) break;
        if ("content" in step.value) collected.push(step.value.content);
      }
    }).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });

    expect(collected).toEqual(["partiel"]);
    expect(providerMocks.openaiStream).toHaveBeenCalledTimes(1);
  });

  it("does not switch providers after an internal stream has sent partial output", async () => {
    providerMocks.openaiStream.mockImplementation(async function* () {
      yield { content: "partiel" };
      throw new Error("connection lost");
    });

    const stream = aiStream(chatOptions);
    await expect(readText(stream)).rejects.toMatchObject({ code: "AI_ALL_PROVIDERS_FAILED" });

    expect(providerMocks.openaiStream).toHaveBeenCalledTimes(1);
    expect(providerMocks.anthropicStream).not.toHaveBeenCalled();
    expect(providerMocks.geminiStream).not.toHaveBeenCalled();
  });

  it("closes the provider stream when the caller cancels", async () => {
    let providerClosed = false;
    providerMocks.openaiStream.mockImplementation(async function* () {
      try {
        yield { content: "premier morceau" };
        yield { content: "second morceau" };
      } finally {
        providerClosed = true;
      }
    });

    const stream = aiStream({ ...chatOptions, provider: "openai", strictProvider: true });
    const first = await stream.next();
    expect(first).toMatchObject({ value: { content: "premier morceau" }, done: false });

    await stream.return(undefined as never);

    expect(providerClosed).toBe(true);
  });
});
