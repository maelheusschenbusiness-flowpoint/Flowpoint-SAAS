/**
 * access-mode.test.ts — matrice resolveAccessMode (fonction PURE) x temps.
 *
 * Horloge SIMULEE : `now` est un parametre, aucun sleep reel, aucune base.
 * Couvre la regle commerciale validee : annulation = acces jusqu'a
 * current_period_end puis lecture seule ; past_due = grace PAST_DUE_GRACE_DAYS
 * depuis past_due_since puis lecture seule.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  resolveAccessMode, parsePastDueGraceDays, DEFAULT_PAST_DUE_GRACE_DAYS,
  type AccessConfig, type AccessState,
} from "./subscription-state.js";
import { getAccessConfig } from "./access-config.js";
import { logger } from "./logger.js";

const DAY = 86_400_000;
const NOW = new Date("2026-11-08T12:00:00.000Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
const ANCHOR = new Date("2026-11-01T00:00:00.000Z");
const CFG: AccessConfig = { pastDueGraceDays: 3, legacyPastDueAnchor: ANCHOR };

const mode = (s: AccessState, now = NOW, cfg = CFG) => resolveAccessMode(s, now, cfg);

describe("resolveAccessMode — statuts vivants", () => {
  it("active → full", () => {
    expect(mode({ status: "active", currentPeriodEnd: at(10) })).toMatchObject({ mode: "full", reason: "active" });
  });
  it("trialing → full", () => {
    expect(mode({ status: "trialing" })).toMatchObject({ mode: "full", reason: "trialing" });
  });
  it("active + cancel_at_period_end=true, periode future → acces normal jusqu'a la fin", () => {
    const d = mode({ status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: at(5) });
    expect(d).toMatchObject({ mode: "full", reason: "active_cancel_scheduled" });
    expect(d.accessEndsAt).toBe(at(5));
  });
  it("active + cancel_at_period_end=true, periode ECHUE (webhook de fin pas encore recu) → lecture seule", () => {
    expect(mode({ status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: at(-0.01) }))
      .toMatchObject({ mode: "read_only", reason: "cancel_scheduled_period_ended" });
  });
  it("active + cancel_at_period_end=false, periode echue (renouvellement en retard) → reste full", () => {
    expect(mode({ status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: at(-1) }).mode).toBe("full");
  });
});

describe("resolveAccessMode — annulation (canceled) x temps", () => {
  it("avant current_period_end → full", () => {
    expect(mode({ status: "canceled", currentPeriodEnd: at(9) })).toMatchObject({ mode: "full", reason: "canceled_paid_period" });
  });
  it("a la seconde pres : 1 s avant → full ; a l'instant exact → lecture seule", () => {
    const end = new Date(NOW.getTime() + 1000).toISOString();
    expect(mode({ status: "canceled", currentPeriodEnd: end }).mode).toBe("full");
    expect(mode({ status: "canceled", currentPeriodEnd: end }, new Date(NOW.getTime() + 1000)).mode).toBe("read_only");
    expect(mode({ status: "canceled", currentPeriodEnd: end }, new Date(NOW.getTime() + 2000)).mode).toBe("read_only");
  });
  it("apres current_period_end → lecture seule", () => {
    expect(mode({ status: "canceled", currentPeriodEnd: at(-1) })).toMatchObject({ mode: "read_only", reason: "canceled_period_ended" });
  });
  it("sans date de periode → lecture seule (jamais d'acces complet par defaut)", () => {
    expect(mode({ status: "canceled", currentPeriodEnd: null }).mode).toBe("read_only");
  });
  it("date de periode illisible → lecture seule", () => {
    expect(mode({ status: "canceled", currentPeriodEnd: "n'importe quoi" }).mode).toBe("read_only");
  });
});

describe("resolveAccessMode — past_due x temps", () => {
  it("grace de 3 jours depuis past_due_since : J+1 → full", () => {
    const d = mode({ status: "past_due", pastDueSince: at(-1) });
    expect(d).toMatchObject({ mode: "full", reason: "past_due_grace" });
    expect(d.graceEndsAt).toBe(at(2));
  });
  it("J+3 exact → lecture seule ; J+2,99 → full", () => {
    expect(mode({ status: "past_due", pastDueSince: at(-3) }).mode).toBe("read_only");
    expect(mode({ status: "past_due", pastDueSince: at(-2.99) }).mode).toBe("full");
  });
  it("hors grace → lecture seule, meme si current_period_end est dans le futur (periode Stripe avancee mais IMPAYEE)", () => {
    expect(mode({ status: "past_due", pastDueSince: at(-4), currentPeriodEnd: at(26) }))
      .toMatchObject({ mode: "read_only", reason: "past_due_grace_expired" });
  });
  it("la grace ne depend PAS de current_period_end passee", () => {
    expect(mode({ status: "past_due", pastDueSince: at(-1), currentPeriodEnd: at(-20) }).mode).toBe("full");
  });
  it("PAST_DUE_GRACE_DAYS=0 → lecture seule immediate", () => {
    expect(mode({ status: "past_due", pastDueSince: at(-0.001) }, NOW, { ...CFG, pastDueGraceDays: 0 }).mode).toBe("read_only");
  });
  it("PAST_DUE_GRACE_DAYS=10 → full a J+9", () => {
    expect(mode({ status: "past_due", pastDueSince: at(-9) }, NOW, { ...CFG, pastDueGraceDays: 10 }).mode).toBe("full");
  });
  it("organisation DEJA past_due sans horodatage : ancre = activation de la regle, pas de bascule brutale", () => {
    // Ancre le 1er novembre : grace jusqu'au 4. Au 2 novembre → full.
    expect(mode({ status: "past_due", pastDueSince: null, currentPeriodEnd: at(-30) }, new Date("2026-11-02T00:00:00Z")).mode).toBe("full");
    expect(mode({ status: "past_due", pastDueSince: null }, new Date("2026-11-04T00:00:00Z")).mode).toBe("read_only");
    // Le jour du deploiement lui-meme (ancre = maintenant) : full.
    expect(mode({ status: "past_due", pastDueSince: null, currentPeriodEnd: at(-30) }, NOW, { ...CFG, legacyPastDueAnchor: NOW }).mode).toBe("full");
  });
  it("horodatage illisible → traite comme absent (ancre de regle)", () => {
    expect(mode({ status: "past_due", pastDueSince: "xx" }, new Date("2026-11-02T00:00:00Z")).mode).toBe("full");
  });
});

describe("resolveAccessMode — autres statuts", () => {
  it.each(["unpaid", "paused"])("%s → lecture seule", (status) => {
    expect(mode({ status, currentPeriodEnd: at(10) }).mode).toBe("read_only");
    expect(mode({ status }).mode).toBe("read_only");
  });
  it.each(["incomplete", "incomplete_expired", "expired", "pending_billing", "none"])("%s → blocked", (status) => {
    expect(mode({ status, currentPeriodEnd: at(10) })).toMatchObject({ mode: "blocked", reason: "no_subscription" });
  });
  it("statut inconnu / nul → blocked, jamais d'acces par defaut", () => {
    expect(mode({ status: "plan-fantaisiste" })).toMatchObject({ mode: "blocked", reason: "unknown_status" });
    expect(mode({ status: null }).mode).toBe("blocked");
  });
});

describe("PAST_DUE_GRACE_DAYS — configuration", () => {
  it("absent / vide → 3, valide", () => {
    expect(parsePastDueGraceDays(undefined)).toEqual({ days: 3, valid: true });
    expect(parsePastDueGraceDays("")).toEqual({ days: 3, valid: true });
    expect(DEFAULT_PAST_DUE_GRACE_DAYS).toBe(3);
  });
  it("entiers valides, 0 inclus", () => {
    expect(parsePastDueGraceDays("0")).toEqual({ days: 0, valid: true });
    expect(parsePastDueGraceDays("7")).toEqual({ days: 7, valid: true });
    expect(parsePastDueGraceDays(" 5 ")).toEqual({ days: 5, valid: true });
    expect(parsePastDueGraceDays("30")).toEqual({ days: 30, valid: true });
  });
  it.each(["-1", "abc", "2.5", "1e3", "31", "999999", "NaN", "3 jours"])("valeur invalide %j → 3 (valid=false)", (raw) => {
    expect(parsePastDueGraceDays(raw)).toEqual({ days: 3, valid: false });
  });
  it("getAccessConfig lit l'environnement et journalise une valeur invalide", () => {
    expect(getAccessConfig({ PAST_DUE_GRACE_DAYS: "5" } as NodeJS.ProcessEnv).pastDueGraceDays).toBe(5);
    expect(getAccessConfig({ PAST_DUE_GRACE_DAYS: "0" } as NodeJS.ProcessEnv).pastDueGraceDays).toBe(0);
    expect(getAccessConfig({} as NodeJS.ProcessEnv).pastDueGraceDays).toBe(3);
    (logger.warn as unknown as { mockClear(): void }).mockClear();
    expect(getAccessConfig({ PAST_DUE_GRACE_DAYS: "bientot" } as NodeJS.ProcessEnv).pastDueGraceDays).toBe(3);
    expect((logger.warn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });
  it("PAST_DUE_RULE_ACTIVATED_AT surcharge l'ancre ; invalide → ancre par defaut", () => {
    const iso = "2026-10-01T00:00:00.000Z";
    expect(getAccessConfig({ PAST_DUE_RULE_ACTIVATED_AT: iso } as NodeJS.ProcessEnv).legacyPastDueAnchor.toISOString()).toBe(iso);
    const d = getAccessConfig({ PAST_DUE_RULE_ACTIVATED_AT: "zzz" } as NodeJS.ProcessEnv).legacyPastDueAnchor;
    expect(Number.isNaN(d.getTime())).toBe(false);
  });
});
