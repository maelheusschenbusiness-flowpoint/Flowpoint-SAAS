import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: { connect: vi.fn() } }));
vi.mock("../lib/openai-client.js", () => ({ aiChatCompletion: vi.fn() }));

import { pool } from "@workspace/db";
import { aiChatCompletion } from "../lib/openai-client.js";
import { createPost, generateAiPost } from "./gbp-posting-service.js";

const clientQuery = vi.fn();
const release = vi.fn();
const dbResult = (rows: unknown[]) => ({ rows, rowCount: rows.length }) as never;

describe("GBP post studio generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientQuery.mockReset();
    vi.mocked(pool.connect).mockResolvedValue({ query: clientQuery, release } as never);
  });

  it("passes the selected language and character limit to the generator", async () => {
    vi.mocked(aiChatCompletion).mockResolvedValue(JSON.stringify({
      content: "Een nieuwe lunchspecial, kom langs!",
      callToAction: "Bezoek ons",
    }));

    const generated = await generateAiPost("org-1", {
      locationId: "loc-1",
      locationName: "Bistro Central",
      postType: "offer",
      language: "nl",
      maxCharacters: 140,
      keywords: ["lunch", "centrum"],
      tone: "friendly",
      objective: "visits",
    });

    expect(generated.content).toContain("lunch");
    expect(aiChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: expect.stringContaining("néerlandais"),
      userPrompt: expect.stringContaining("centrum"),
    }));
  });

  it("rejects generated text that exceeds the requested limit", async () => {
    vi.mocked(aiChatCompletion).mockResolvedValue(JSON.stringify({
      content: "x".repeat(101),
      callToAction: "En savoir plus",
    }));

    await expect(generateAiPost("org-1", { maxCharacters: 100 })).rejects.toThrow("AI_GENERATION_OVER_LIMIT");
  });

  it("persists generation settings with the reviewed post draft", async () => {
    clientQuery.mockResolvedValueOnce(dbResult([])).mockResolvedValueOnce(dbResult([{ id: "post-1" }]));
    const settings = {
      language: "en",
      tone: "expert",
      objective: "calls",
      industry: "dentistry",
      keywords: ["local dentist"],
      maxCharacters: 420,
    };

    await createPost("org-1", {
      locationId: "loc-1",
      content: "Call us this week.",
      generationOptions: settings,
    });

    expect(clientQuery.mock.calls[0][0]).toContain("generation_options");
    expect(JSON.parse(clientQuery.mock.calls[0][1][19] as string)).toMatchObject(settings);
    expect(release).toHaveBeenCalledOnce();
  });
});
