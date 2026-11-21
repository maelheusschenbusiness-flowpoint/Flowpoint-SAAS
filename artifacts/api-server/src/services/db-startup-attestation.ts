import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { pool } from "@workspace/db";

export const RENDER_TEST_PROJECT_REF_SHA256 =
  "027d7ee0f01185369530c913fb8dedebd939683c29e28197d7b782d890599989";

export type AttestationStatus = "PASS" | "FAIL" | "UNKNOWN";

export interface ResolvedDbIdentity {
  host?: string;
  database?: string;
  user?: string;
}

export interface DbAttestation {
  status: AttestationStatus;
  guardStatus: AttestationStatus;
  projectFingerprint: string | null;
  expectedProjectFingerprint: string;
}

type PoolClientWithResolvedConfig = {
  connectionParameters?: ResolvedDbIdentity;
  release(): void;
};

type PoolLike = Pick<Pool, "connect">;

const REF_FROM_HOST = /^db\.([a-z0-9]{20})\.supabase\.co$/i;
const REF_FROM_USER = /^postgres\.([a-z0-9]{20})$/i;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function getProjectRef(identity: ResolvedDbIdentity): { ref: string | null; conflict: boolean } {
  const hostRef = identity.host?.match(REF_FROM_HOST)?.[1]?.toLowerCase() ?? null;
  const userRef = identity.user?.match(REF_FROM_USER)?.[1]?.toLowerCase() ?? null;
  return {
    ref: hostRef ?? userRef,
    conflict: !!hostRef && !!userRef && hostRef !== userRef,
  };
}

function guardStatus(identity: ResolvedDbIdentity, env: NodeJS.ProcessEnv): AttestationStatus {
  const hostGuard = env["DB_HOTE_ATTENDU"]?.trim();
  const userGuard = env["DB_UTILISATEUR_ATTENDU"]?.trim();
  const host = identity.host?.trim().toLowerCase();
  const database = identity.database?.trim().toLowerCase();
  const user = identity.user?.trim();
  if (!hostGuard || !userGuard || !host || !database || !user) return "UNKNOWN";

  const parts = hostGuard.split(",");
  const expectedTargets = parts.map((part) => {
    const segments = part.trim().toLowerCase().split("/");
    if (segments.length > 2 || !segments[0]) return null;
    return { host: segments[0], database: segments[1] ?? "" };
  });
  if (!expectedTargets.length || expectedTargets.some((target) => target === null)) return "UNKNOWN";
  const hostMatches = expectedTargets.some((target) =>
    target!.host === host && (!target!.database || target!.database === database)
  );
  if (!hostMatches || user !== userGuard) return "FAIL";
  return "PASS";
}

export function evaluateDbAttestation(
  identity: ResolvedDbIdentity | null,
  env: NodeJS.ProcessEnv = process.env,
  expectedProjectFingerprint = RENDER_TEST_PROJECT_REF_SHA256,
): DbAttestation {
  const resolved = identity ?? {};
  const project = getProjectRef(resolved);
  const projectFingerprint = project.ref ? sha256(project.ref) : null;
  const validExpected = /^[a-f0-9]{64}$/i.test(expectedProjectFingerprint);
  const projectStatus: AttestationStatus = !identity || !validExpected || project.conflict || !projectFingerprint
    ? (project.conflict ? "FAIL" : "UNKNOWN")
    : projectFingerprint === expectedProjectFingerprint.toLowerCase() ? "PASS" : "FAIL";
  const guards = identity ? guardStatus(identity, env) : "UNKNOWN";
  const status = projectStatus === "FAIL" || guards === "FAIL"
    ? "FAIL"
    : projectStatus === "PASS" && guards === "PASS" ? "PASS" : "UNKNOWN";

  return {
    status,
    guardStatus: guards,
    projectFingerprint,
    expectedProjectFingerprint: validExpected ? expectedProjectFingerprint.toLowerCase() : "UNKNOWN",
  };
}

/**
 * Reads connection parameters from a client created by the API's actual pool.
 * node-postgres has already resolved DATABASE_URL versus PGHOST/PGUSER here.
 */
export async function attestResolvedPool(
  activePool: PoolLike = pool,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DbAttestation> {
  let client: PoolClientWithResolvedConfig | undefined;
  try {
    client = await activePool.connect() as unknown as PoolClientWithResolvedConfig;
    return evaluateDbAttestation(client.connectionParameters ?? null, env);
  } catch {
    return evaluateDbAttestation(null, env);
  } finally {
    client?.release();
  }
}
