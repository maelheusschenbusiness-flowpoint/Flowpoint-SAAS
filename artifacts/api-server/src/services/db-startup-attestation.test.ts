import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import {
  attestResolvedPool,
  evaluateDbAttestation,
  RENDER_TEST_PROJECT_REF_SHA256,
  type ResolvedDbIdentity,
} from "./db-startup-attestation.js";
import { createHash } from "node:crypto";

const REF = "abcdefghijklmnopqrst";
const TEST_HOST = "aws-1-eu-central-1.pooler.supabase.com";
const savedEnv = { ...process.env };

function envWithGuards(identity: ResolvedDbIdentity): NodeJS.ProcessEnv {
  return {
    DB_HOTE_ATTENDU: `${identity.host}/${identity.database}`,
    DB_UTILISATEUR_ATTENDU: identity.user,
  };
}

function resolvedConfig(client: Client): ResolvedDbIdentity {
  const params = (client as unknown as { connectionParameters: ResolvedDbIdentity }).connectionParameters;
  return { host: params.host, database: params.database, user: params.user };
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

describe("database startup attestation", () => {
  it("resolves DATABASE_URL from node-postgres client parameters", () => {
    const client = new Client({
      connectionString: `postgresql://postgres.${REF}:synthetic@${TEST_HOST}:5432/postgres`,
    });
    const identity = resolvedConfig(client);
    const result = evaluateDbAttestation(
      identity,
      envWithGuards(identity),
      createHash("sha256").update(REF).digest("hex"),
    );
    expect(identity.user).toBe(`postgres.${REF}`);
    expect(result.status).toBe("PASS");
  });

  it("resolves PGHOST/PGUSER from node-postgres client parameters", () => {
    delete process.env["DATABASE_URL"];
    delete process.env["MONGO_URI"];
    Object.assign(process.env, {
      PGHOST: TEST_HOST,
      PGUSER: `postgres.${REF}`,
      PGDATABASE: "postgres",
      PGPORT: "5432",
      PGPASSWORD: "synthetic",
    });
    const client = new Client({});
    const identity = resolvedConfig(client);
    const result = evaluateDbAttestation(
      identity,
      envWithGuards(identity),
      createHash("sha256").update(REF).digest("hex"),
    );
    expect(identity.host).toBe(TEST_HOST);
    expect(identity.user).toBe(`postgres.${REF}`);
    expect(result.status).toBe("PASS");
  });

  it("attests the configuration on the client returned by the pool and releases it", async () => {
    const identity = { host: TEST_HOST, database: "postgres", user: `postgres.${REF}` };
    const release = vi.fn();
    const activePool = {
      connect: vi.fn().mockResolvedValue({ connectionParameters: identity, release }),
    };
    const result = await attestResolvedPool(activePool as never, envWithGuards(identity));
    expect(result.projectFingerprint).toBe(createHash("sha256").update(REF).digest("hex"));
    expect(release).toHaveBeenCalledOnce();
  });

  it("returns UNKNOWN when the pool cannot expose a resolved connection", async () => {
    const activePool = { connect: vi.fn().mockRejectedValue(new Error("connection failed")) };
    const result = await attestResolvedPool(activePool as never, {});
    expect(result.status).toBe("UNKNOWN");
    expect(JSON.stringify(result)).not.toContain("connection failed");
  });

  it("fails when the actual project fingerprint differs from Test", () => {
    const identity = { host: TEST_HOST, database: "postgres", user: `postgres.${REF}` };
    expect(evaluateDbAttestation(identity, envWithGuards(identity), RENDER_TEST_PROJECT_REF_SHA256).status)
      .toBe("FAIL");
  });

  it("does not pass when target guards are absent", () => {
    const identity = { host: TEST_HOST, database: "postgres", user: `postgres.${REF}` };
    const result = evaluateDbAttestation(
      identity,
      {},
      createHash("sha256").update(REF).digest("hex"),
    );
    expect(result.status).toBe("UNKNOWN");
    expect(result.guardStatus).toBe("UNKNOWN");
  });

  it("fails when either target guard contradicts the resolved pool target", () => {
    const identity = { host: TEST_HOST, database: "postgres", user: `postgres.${REF}` };
    const result = evaluateDbAttestation(identity, {
      DB_HOTE_ATTENDU: "wrong-host.example/postgres",
      DB_UTILISATEUR_ATTENDU: `postgres.${REF}`,
    }, createHash("sha256").update(REF).digest("hex"));
    expect(result.status).toBe("FAIL");
    expect(result.guardStatus).toBe("FAIL");
  });

  it("returns UNKNOWN when the resolved pool config is unavailable or ambiguous", () => {
    expect(evaluateDbAttestation(null, {}, RENDER_TEST_PROJECT_REF_SHA256).status).toBe("UNKNOWN");
    const ambiguous = {
      host: "db.abcdefghijklmnopqrst.supabase.co",
      database: "postgres",
      user: "postgres.zyxwvutsrqponmlkjihg",
    };
    expect(evaluateDbAttestation(ambiguous, envWithGuards(ambiguous)).status).toBe("FAIL");
  });

  it("exposes only statuses and fingerprints, never connection fields", () => {
    const identity = { host: TEST_HOST, database: "postgres", user: `postgres.${REF}` };
    const result = evaluateDbAttestation(identity, envWithGuards(identity), createHash("sha256").update(REF).digest("hex"));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(TEST_HOST);
    expect(serialized).not.toContain(identity.user);
    expect(serialized).not.toContain(identity.database);
  });
});
