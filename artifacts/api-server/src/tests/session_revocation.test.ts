/**
 * Certification — la revocation des sessions est ATTENDUE (et transactionnelle)
 * lors du retrait d'un membre.
 *
 * Historique : ce test imposait `await invalidateAllSessions(...)` dans team.ts
 * (par opposition a l'ancien `.catch()` en tir-et-oublie). Depuis, la revocation
 * a ete durcie : elle est faite dans la transaction `withOrgDb` du retrait, par
 * un `DELETE FROM user_sessions WHERE org_id = $1 ...` limite a l'organisation
 * (jamais les sessions d'une autre organisation du meme utilisateur). Le test
 * verifiait donc un detail d'implementation disparu. Il verifie maintenant le
 * contrat actuel, tout en gardant son intention (pas de tir-et-oublie, echec =
 * erreur remontee, pas d'avalement silencieux).
 *
 * Le comportement (sessions de l'org A revoquees, celles de l'org B conservees)
 * est execute dans src/routes/team-member-removal-security.test.ts.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(process.cwd(), "src/routes/team.ts"), "utf8");

describe("session revocation on member removal (contrat statique)", () => {
  it("n'utilise plus l'ancien tir-et-oublie invalidateAllSessions(...).catch(", () => {
    expect(src).not.toContain("invalidateAllSessions(memberEmail).catch(");
  });

  it("supprime les sessions DANS la transaction du retrait, limitees a l'organisation", () => {
    const removal = src.indexOf("const removed = await withOrgDb(org, async (client) => {");
    expect(removal).toBeGreaterThanOrEqual(0);
    const del = src.indexOf("DELETE FROM user_sessions", removal);
    expect(del).toBeGreaterThan(removal);
    const stmt = src.slice(del, del + 300);
    expect(stmt).toMatch(/WHERE org_id = \$1/);
    // La requete est attendue (await client.query) et non lancee en arriere-plan.
    const before = src.slice(Math.max(0, del - 120), del);
    expect(before).toContain("await client.query(");
  });

  it("marque le membre retire APRES la revocation des sessions (ordre garanti)", () => {
    const del = src.indexOf("DELETE FROM user_sessions");
    const markRemoved = src.indexOf("SET status = 'removed'", del);
    expect(del).toBeGreaterThanOrEqual(0);
    expect(markRemoved).toBeGreaterThan(del);
  });

  it("un echec de revocation fait echouer la route (journalise en error, jamais avale)", () => {
    const catchIdx = src.indexOf("} catch (err) {", src.indexOf("member access revoked"));
    expect(catchIdx).toBeGreaterThanOrEqual(0);
    const region = src.slice(catchIdx, catchIdx + 400);
    expect(region).toContain("logger.error");
  });
});
