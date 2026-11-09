import { describe, it, expect } from "vitest";
import {
  billingFromPaymentMethod, fillPendingSignup, fillOrgSettings, ensureEuVatTaxId, isEuVat,
} from "../lib/billing-profile.js";

/** Base factice : tables en memoire, semantique COALESCE(NULLIF(col,''), $x). */
function fakeDb(initial: { pending?: Record<string, Record<string, string | null>>; settings?: Record<string, Record<string, string | null>>; orgs?: Record<string, string> } = {}) {
  const pending = initial.pending ?? {};
  const settings = initial.settings ?? {};
  const orgs = initial.orgs ?? {};
  const cols = ["country", "address", "city", "postal_code", "phone", "vat"];
  return {
    pending, settings,
    async query(sql: string, p: unknown[] = []) {
      if (sql.includes("FROM organizations")) {
        return { rows: Object.entries(orgs).filter(([, e]) => e === p[0]).map(([id]) => ({ id })) };
      }
      const table = sql.includes("UPDATE pending_signups") ? pending : settings;
      const row = table[String(p[0])];
      if (!row) return { rows: [], rowCount: 0 };
      cols.forEach((c, i) => {
        const cur = row[c];
        if (!cur) row[c] = (p[i + 1] as string | null) ?? cur ?? null;
      });
      return { rows: [], rowCount: 1 };
    },
  };
}

const PM = { phone: "+32 470 00 00 00", address: { line1: "Rue X 1", line2: "Bte 2", city: "Liège", postal_code: "4000", country: "be" } };

describe("billingFromPaymentMethod", () => {
  it("extrait adresse, telephone et TVA normalisee", () => {
    const b = billingFromPaymentMethod(PM, "be 0123.456.789")!;
    expect(b).toEqual({ country: "BE", address: "Rue X 1, Bte 2", city: "Liège", postalCode: "4000", phone: "+32 470 00 00 00", vat: "BE0123456789" });
  });
  it("ignore une adresse incomplete (sans ligne 1 ou sans pays)", () => {
    const b = billingFromPaymentMethod({ address: { city: "Liège", country: "BE" } })!;
    expect(b).toBeNull();
  });
  it("rien d'utile → null", () => {
    expect(billingFromPaymentMethod(null)).toBeNull();
    expect(billingFromPaymentMethod({}, "n/a")).toBeNull();
  });
});

describe("persistance (champs vides seulement, idempotente)", () => {
  it("remplit pending_signups sans ecraser une valeur deja saisie", async () => {
    const db = fakeDb({ pending: { t1: { country: null, address: "", city: null, postal_code: null, phone: "+33 1", vat: null } } });
    const b = billingFromPaymentMethod(PM, "FR12345678901")!;
    await fillPendingSignup(db, "t1", b);
    await fillPendingSignup(db, "t1", b); // relance
    expect(db.pending["t1"]).toEqual({ country: "BE", address: "Rue X 1, Bte 2", city: "Liège", postal_code: "4000", phone: "+33 1", vat: "FR12345678901" });
  });
  it("complete org_settings sous la cle email ET la cle UUID quand le webhook a deja active", async () => {
    const db = fakeDb({
      orgs: { "uuid-1": "a@b.be" },
      settings: {
        "a@b.be": { country: null, address: null, city: null, postal_code: null, phone: null, vat: null },
        "uuid-1": { country: "FR", address: "Deja la", city: null, postal_code: null, phone: null, vat: null },
      },
    });
    const n = await fillOrgSettings(db, "a@b.be", billingFromPaymentMethod(PM, "BE0123456789")!);
    expect(n).toBe(2);
    expect(db.settings["a@b.be"]["address"]).toBe("Rue X 1, Bte 2");
    expect(db.settings["uuid-1"]["address"]).toBe("Deja la");   // jamais ecrase
    expect(db.settings["uuid-1"]["country"]).toBe("FR");
    expect(db.settings["uuid-1"]["vat"]).toBe("BE0123456789");
  });
  it("ne cree pas de ligne org_settings si le compte n'est pas encore active", async () => {
    const db = fakeDb();
    expect(await fillOrgSettings(db, "x@y.fr", billingFromPaymentMethod(PM)!)).toBe(0);
    expect(Object.keys(db.settings)).toHaveLength(0);
  });
});

describe("ensureEuVatTaxId", () => {
  function fakeStripe(existing: Array<{ type: string; value: string }> = [], failCreate = false) {
    const created: string[] = [];
    return {
      created,
      customers: {
        async listTaxIds() { return { data: [...existing, ...created.map(v => ({ type: "eu_vat", value: v }))] }; },
        async createTaxId(_id: string, p: { type: "eu_vat"; value: string }) {
          if (failCreate) throw new Error("tax_id_invalid");
          created.push(p.value); return {};
        },
      },
    };
  }
  it("cree le Tax ID une seule fois malgre les relances", async () => {
    const s = fakeStripe();
    expect(await ensureEuVatTaxId(s, "cus_1", "BE0123456789")).toBe("created");
    expect(await ensureEuVatTaxId(s, "cus_1", "be 0123.456.789")).toBe("already_present");
    expect(await ensureEuVatTaxId(s, "cus_1", "BE0123456789")).toBe("already_present");
    expect(s.created).toEqual(["BE0123456789"]);
  });
  it("reconnait un Tax ID deja present sous une autre ecriture", async () => {
    const s = fakeStripe([{ type: "eu_vat", value: "BE 0123.456.789" }]);
    expect(await ensureEuVatTaxId(s, "cus_1", "BE0123456789")).toBe("already_present");
    expect(s.created).toEqual([]);
  });
  it("refuse hors UE (pas de type eu_vat pour CH ou GB) et les valeurs invalides", async () => {
    const s = fakeStripe();
    expect(await ensureEuVatTaxId(s, "cus_1", "CHE123456789")).toBe("not_eu");
    expect(await ensureEuVatTaxId(s, "cus_1", "GB123456789")).toBe("not_eu");
    expect(await ensureEuVatTaxId(s, "cus_1", "42")).toBe("invalid");
    expect(s.created).toEqual([]);
  });
  it("une erreur Stripe ne remonte pas (l'activation continue)", async () => {
    expect(await ensureEuVatTaxId(fakeStripe([], true), "cus_1", "FR12345678901")).toBe("failed");
  });
  it("prefixes UE : EL pour la Grece, pas GR", () => {
    expect(isEuVat("EL123456789")).toBe(true);
    expect(isEuVat("GR123456789")).toBe(false);
  });
});
