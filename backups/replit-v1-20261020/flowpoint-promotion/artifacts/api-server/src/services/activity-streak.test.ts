import { describe, expect, it } from "vitest";
import {
  calculateStreak,
  dateKeyInTimezone,
  normalizeActivityTimezone,
  recordActivityDay,
  shiftDateKey,
} from "./activity-streak.js";

describe("canonical activity streak calculation", () => {
  const today = "2026-09-16";

  it("counts one eligible persisted day once", () => {
    expect(calculateStreak(["2026-09-16", "2026-09-16"], today)).toEqual({
      current: 1,
      best: 1,
    });
  });

  it("increments consecutive local calendar days", () => {
    expect(calculateStreak(["2026-09-14", "2026-09-15", "2026-09-16"], today)).toEqual({
      current: 3,
      best: 3,
    });
  });

  it("breaks the current streak at a missing day but preserves the best run", () => {
    expect(calculateStreak([
      "2026-09-10",
      "2026-09-12",
      "2026-09-13",
      "2026-09-14",
      "2026-09-16",
    ], today)).toEqual({
      current: 1,
      best: 3,
    });
  });

  it("uses yesterday while the current local day has no row", () => {
    expect(calculateStreak(["2026-09-14", "2026-09-15"], today)).toEqual({
      current: 2,
      best: 2,
    });
  });

  it("does not invent a streak from old activity", () => {
    expect(calculateStreak(["2025-01-01"], today)).toEqual({
      current: 0,
      best: 1,
    });
  });

  it("keeps owner and invited member streaks independent", () => {
    const ownerDays = ["2026-09-14", "2026-09-15", "2026-09-16"];
    const memberDays = ["2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16"];

    expect(calculateStreak(ownerDays, today).current).toBe(3);
    expect(calculateStreak(memberDays, today).current).toBe(5);
  });

  it("does not attribute unidentifiable activity to the owner", async () => {
    const calls: string[] = [];
    const db = async (sql: string) => {
      calls.push(sql);
      return { rows: [] };
    };
    const ownerDays = ["2026-09-16"];
    expect(calculateStreak(ownerDays, today).current).toBe(1);
    for (const userId of [
      undefined,
      "default",
      "service",
      "system",
      "apikey:test",
      "org-uuid",
      "legacy@example.com",
    ]) {
      expect(await recordActivityDay(db, "org-uuid", userId)).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it("shifts date-only keys without 24-hour timestamp arithmetic", () => {
    expect(shiftDateKey("2026-03-29", 1)).toBe("2026-03-30");
    expect(shiftDateKey("2026-10-25", 1)).toBe("2026-10-26");
  });

  it("is safe across the Brussels spring DST boundary", () => {
    expect(dateKeyInTimezone(new Date("2026-03-29T22:30:00.000Z"), "Europe/Brussels"))
      .toBe("2026-03-30");
    expect(calculateStreak(["2026-03-29", "2026-03-30"], "2026-03-30"))
      .toEqual({ current: 2, best: 2 });
  });

  it("is safe across the Brussels autumn DST boundary", () => {
    expect(dateKeyInTimezone(new Date("2026-10-25T22:30:00.000Z"), "Europe/Brussels"))
      .toBe("2026-10-25");
    expect(calculateStreak(["2026-10-24", "2026-10-25", "2026-10-26"], "2026-10-26"))
      .toEqual({ current: 3, best: 3 });
  });

  it("normalizes invalid timezone values to the product default", () => {
    expect(normalizeActivityTimezone("not/a-timezone")).toBe("Europe/Brussels");
    expect(normalizeActivityTimezone("Europe/Paris")).toBe("Europe/Paris");
  });

  it("ignores malformed date values instead of turning them into activity", () => {
    expect(calculateStreak(["not-a-date", "2026-09-16T00:00:00Z"], today)).toEqual({
      current: 1,
      best: 1,
    });
  });

  it("uses the same result for the owner in every caller", () => {
    const persistedOwnerDays = ["2026-09-15", "2026-09-16"];
    const sidebar = calculateStreak(persistedOwnerDays, today).current;
    const activity = calculateStreak(persistedOwnerDays, today).current;
    const team = calculateStreak(persistedOwnerDays, today).current;
    expect({ sidebar, activity, team }).toEqual({ sidebar: 2, activity: 2, team: 2 });
  });
});