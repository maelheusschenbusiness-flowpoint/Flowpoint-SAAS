/**
 * Conversion B — la page d'inscription mesuree par `funnel-tracking.js`.
 *
 * `signin.html` charge deja ce script : c'est lui qui doit signaler le
 * formulaire affiche (`signup_started`), la premiere saisie
 * (`signup_form_engaged`) et joindre le `fp_lid` opaque que la page a range dans
 * sessionStorage. Le script reel est execute dans un bac a sable.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";

const SCRIPT = readFileSync(join(process.cwd(), "../flowpoint-export/funnel-tracking.js"), "utf8");
const FP_LID = "TestLeadFp_0000000004D";

interface Options { path?: string; consent?: boolean; fpLid?: string | null; signupHidden?: boolean; withForm?: boolean }

function executer(o: Options = {}) {
  const envois: Record<string, unknown>[] = [];
  const ecouteurs: Record<string, Array<() => void>> = {};
  const form = { addEventListener: (type: string, fn: () => void) => { (ecouteurs[type] ??= []).push(fn); } };
  const cookies = new Map<string, string>();
  if (o.consent !== false) cookies.set("fp_analytics_consent", "accepted");
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  if (o.fpLid) session.set("fp_lid", o.fpLid);
  const fetch = (_url: string, init: { body: string }) => {
    envois.push(JSON.parse(init.body) as Record<string, unknown>);
    return { catch: () => undefined };
  };
  const contexte: Record<string, unknown> = {
    URL, URLSearchParams, JSON, Set, Element: class {}, HTMLAnchorElement: class {},
    crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
    location: { pathname: o.path ?? "/signin.html", search: "", hostname: "app.flowpoint.pro", href: "https://app.flowpoint.pro/signin.html" },
    document: {
      // Comme un navigateur : ecrire `document.cookie` AJOUTE un cookie, sans
      // effacer les autres.
      get cookie() { return [...cookies].map(([k, v]) => `${k}=${v}`).join("; "); },
      set cookie(value: string) {
        const [pair] = value.split(";");
        const i = pair!.indexOf("=");
        cookies.set(pair!.slice(0, i).trim(), pair!.slice(i + 1));
      },
      addEventListener: () => undefined,
      getElementById: (id: string) => {
        if (id === "signup-screen") return { style: { display: o.signupHidden ? "none" : "" } };
        if (id === "signup-form") return o.withForm === false ? null : form;
        return null;
      },
    },
    localStorage: { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => local.set(k, v) },
    sessionStorage: { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => session.set(k, v) },
    window: { fetch },
  };
  new Script(SCRIPT).runInNewContext(contexte);
  const saisir = () => (ecouteurs["input"] ?? []).forEach((fn) => fn());
  return { envois, saisir };
}

describe("page d'inscription : formulaire affiche, puis premiere saisie", () => {
  it("le formulaire affiche emet signup_started avec le fp_lid", () => {
    const { envois } = executer({ fpLid: FP_LID });
    expect(envois).toHaveLength(1);
    expect(envois[0]).toMatchObject({ etape: "signup_started", fp_lid: FP_LID });
    expect(envois[0]!["visiteurId"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("la premiere saisie emet signup_form_engaged, une seule fois", () => {
    const { envois, saisir } = executer({ fpLid: FP_LID });
    saisir(); saisir(); saisir();
    expect(envois.map((e) => e["etape"])).toEqual(["signup_started", "signup_form_engaged"]);
    expect(envois[1]).toMatchObject({ fp_lid: FP_LID });
  });

  it("sans consentement, rien ne part — ni affichage, ni saisie", () => {
    const { envois, saisir } = executer({ consent: false, fpLid: FP_LID });
    saisir();
    expect(envois).toHaveLength(0);
  });

  it("un fp_lid absent ou mal forme n'est jamais transmis", () => {
    for (const fpLid of [null, "trop-court", "email@example.com"]) {
      const { envois } = executer({ fpLid });
      expect(envois[0]).not.toHaveProperty("fp_lid");
    }
  });

  it("le retour Google masque le formulaire : aucun affichage compte", () => {
    const { envois } = executer({ signupHidden: true });
    expect(envois).toHaveLength(0);
  });

  it("les autres pages gardent leur comportement", () => {
    expect(executer({ path: "/pricing.html" }).envois.map((e) => e["etape"])).toEqual(["tarifs_vus"]);
    expect(executer({ path: "/checkout.html" }).envois.map((e) => e["etape"])).toEqual(["signup_started"]);
    expect(executer({ path: "/dashboard.html" }).envois).toHaveLength(0);
  });
});
