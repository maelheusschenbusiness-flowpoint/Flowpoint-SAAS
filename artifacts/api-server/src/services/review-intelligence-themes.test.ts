import { describe, expect, it } from "vitest";
import { summarizeReviewThemes, type ReviewItem } from "./review-intel-service.js";

const reviews: ReviewItem[] = [
  { id: "a", author: "A", rating: 2, text: "Retard important et aucune réponse", sentiment: "negative", platform: "google", replied: false, date: "2026-01-01" },
  { id: "b", author: "B", rating: 5, text: "Équipe accueillante, service excellent", sentiment: "positive", platform: "google", replied: true, date: "2026-01-02" },
  { id: "c", author: "C", rating: 3, text: "Long délai, pas de réponse", sentiment: "neutral", platform: "google", replied: false, date: "2026-01-03" },
];

describe("Review Intelligence local theme analysis", () => {
  it("counts recurring themes and negative reviews without an AI provider", () => {
    const themes = summarizeReviewThemes(reviews);
    expect(themes.find(x => x.theme === "Délais")).toMatchObject({ count: 2, negativeCount: 1 });
    expect(themes.find(x => x.theme === "Communication")).toMatchObject({ count: 2, negativeCount: 1 });
    expect(themes.find(x => x.theme === "Service client")).toMatchObject({ count: 1, negativeCount: 0 });
  });

  it("returns no fabricated themes when there are no stored reviews", () => {
    expect(summarizeReviewThemes([])).toEqual([]);
  });
});
