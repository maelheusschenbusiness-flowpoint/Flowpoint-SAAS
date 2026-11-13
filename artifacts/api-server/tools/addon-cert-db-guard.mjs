/**
 * Fail-closed database identity checks for the destructive add-on certification.
 * This is deliberately runtime configuration, not an application migration.
 */
export const LOCAL_ADDON_CERT_HOST = "127.0.0.1";
export const LOCAL_ADDON_CERT_DATABASE = "flowpoint_ci";

export function getAddonCertDatabaseConfig(env = process.env) {
  const connectionString = env.FLOWPOINT_ADDON_CERT_DATABASE_URL;
  const expectedDatabase = env.FLOWPOINT_ADDON_CERT_EXPECTED_DB;
  const expectedHost = env.FLOWPOINT_ADDON_CERT_EXPECTED_HOST;

  if (!connectionString || !expectedDatabase || !expectedHost) {
    throw new Error(
      "Refusing certification: set the dedicated disposable DB URL, expected DB name, and expected host."
    );
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("Refusing certification: the dedicated database URL is invalid.");
  }

  if (parsed.hostname.toLowerCase() !== expectedHost.toLowerCase()) {
    throw new Error("Refusing certification: database host does not match the explicitly approved host.");
  }
  if (!/(?:^|[_-])(?:e2e|test|cert|disposable|ci)(?:$|[_-])/i.test(expectedDatabase)) {
    throw new Error("Refusing certification: expected database name must identify a test/disposable database.");
  }

  // The API process and this test must share the same database target.
  // Compare in memory only; never print either URL.
  if (!env.DATABASE_URL || env.DATABASE_URL !== connectionString) {
    throw new Error("Refusing certification: DATABASE_URL differs from the dedicated test database URL.");
  }

  return { connectionString, expectedDatabase };
}

/**
 * Local runner guard. Unlike the remote-QA guard above, this accepts exactly
 * the disposable loopback database created by tools/certify-addons.mjs.
 * Validate every URL component before constructing a Pool or opening a socket.
 */
export function getLocalAddonCertDatabaseConfig(env = process.env) {
  const config = getAddonCertDatabaseConfig(env);
  let parsed;
  let databaseFromUrl;
  try {
    parsed = new URL(config.connectionString);
    databaseFromUrl = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    throw new Error("Refusing local certification: database URL is invalid.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Refusing local certification: only PostgreSQL URLs are allowed.");
  }
  if (
    parsed.hostname !== LOCAL_ADDON_CERT_HOST ||
    env.FLOWPOINT_ADDON_CERT_EXPECTED_HOST !== LOCAL_ADDON_CERT_HOST
  ) {
    throw new Error("Refusing local certification: database host must be 127.0.0.1.");
  }
  if (
    config.expectedDatabase !== LOCAL_ADDON_CERT_DATABASE ||
    databaseFromUrl !== LOCAL_ADDON_CERT_DATABASE
  ) {
    throw new Error("Refusing local certification: database name must be flowpoint_ci.");
  }
  if (!parsed.port) {
    throw new Error("Refusing local certification: an explicit local PostgreSQL port is required.");
  }
  if (Number(parsed.port) < 1 || Number(parsed.port) > 65535) {
    throw new Error("Refusing local certification: PostgreSQL port is invalid.");
  }
  if (parsed.search || parsed.hash || parsed.password || parsed.username !== "runner") {
    throw new Error("Refusing local certification: connection overrides and non-runner credentials are not allowed.");
  }

  return { ...config, host: LOCAL_ADDON_CERT_HOST, port: Number(parsed.port) };
}

export async function assertAddonCertDatabaseIsDisposable(pool, expectedDatabase) {
  try {
    const identity = await pool.query("SELECT current_database() AS database_name");
    if (identity.rows?.[0]?.database_name !== expectedDatabase) {
      throw new Error("database name mismatch");
    }

    // Remote QA still provisions this marker independently. The local runner
    // creates it only inside its own temporary loopback PostgreSQL cluster.
    const marker = await pool.query(
      `SELECT database_name, classification
         FROM public.flowpoint_test_database_guard
        WHERE purpose = $1`,
      ["addon-cert"]
    );
    if (
      marker.rows?.length !== 1 ||
      marker.rows[0].database_name !== expectedDatabase ||
      marker.rows[0].classification !== "disposable"
    ) {
      throw new Error("disposable database marker mismatch");
    }
  } catch {
    // Avoid leaking connection details. Missing marker/table is a hard stop.
    throw new Error(
      "Refusing certification: database identity or disposable-isolation marker could not be verified."
    );
  }
}
