import { describe, it, expect } from "vitest";
import { analyserJournalListen } from "./journal-listen.ts";
import { bilan } from "./bilan-rapport.ts";

const OK = `2026-11-08 12:00:01   --> setup_intent.succeeded [evt_1A]
2026-11-08 12:00:02  <--  [200] POST http://localhost:8080/api/billing/webhook [evt_1A]
2026-11-08 12:00:03   --> customer.subscription.created [evt_1B]
2026-11-08 12:00:03  <--  [200] POST http://localhost:8080/api/billing/webhook [evt_1B]`;

describe("journal de `stripe listen`", () => {
  it("toutes les livraisons en 2xx", () => { const r = analyserJournalListen(OK); expect(r.livraisons).toHaveLength(2); expect(r.echecs).toEqual([]); expect(r.sansReponse).toEqual([]); });
  it("un 400/500 final est un echec ; un 500 suivi d'un 200 (rejeu Stripe) est un succes", () => {
    expect(analyserJournalListen(OK.replace("[200] POST http://localhost:8080/api/billing/webhook [evt_1B]", "[400] POST http://localhost:8080/api/billing/webhook [evt_1B]")).echecs.map((l) => l.statut)).toEqual([400]);
    const retry = OK + "\n  <--  [200] POST http://localhost:8080/api/billing/webhook [evt_1B]\n";
    const r = analyserJournalListen(retry.replace(/\[200\] POST (\S+) \[evt_1B\]\n/, "[503] POST $1 [evt_1B]\n"));
    expect(r.echecs).toEqual([]);
  });
  it("evenement transmis sans reponse", () => { expect(analyserJournalListen("12:00 --> setup_intent.succeeded [evt_9]").sansReponse).toHaveLength(1); });
});

describe("bilan du rapport Playwright : jamais de faux vert", () => {
  const rapport = (statuts: string[]) => ({ suites: [{ specs: statuts.map((s) => ({ tests: [{ status: s }] })) }] });
  it("GO seulement si tout passe", () => { expect(bilan(rapport(["expected", "expected"])).go).toBe(true); });
  it("un test saute ou en echec, ou aucun test : NO-GO", () => {
    expect(bilan(rapport(["expected", "skipped"])).go).toBe(false);
    expect(bilan(rapport(["expected", "unexpected"])).go).toBe(false);
    expect(bilan(rapport(["skipped", "skipped"])).go).toBe(false);
    expect(bilan(rapport([])).go).toBe(false);
  });
});
