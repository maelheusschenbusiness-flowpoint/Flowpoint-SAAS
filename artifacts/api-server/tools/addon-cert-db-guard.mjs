/**
 * Fail-closed database identity checks for the destructive add-on certification.
 * This is deliberately runtime configuration, not an application migration.
 */
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
  if (!/(?:e2e|test|cert|disposable)/i.test(expectedDatabase)) {
    throw new Error("Refusing certification: expected database name must identify a test/disposable database.");
  }

  // The API process and this test must share the same database target.
  // Compare in memory only; never print either URL.
  if (!env.DATABASE_URL || env.DATABASE_URL !== connectionString) {
    throw new Error("Refusing certification: DATABASE_URL differs from the dedicated test database URL.");
  }

  return { connectionString, expectedDatabase };
}

export async function assertAddonCertDatabaseIsDisposable(pool, expectedDatabase) {
  try {
    const identity = await pool.query("SELECT current_database() AS database_name");
    if (identity.rows?.[0]?.database_name !== expectedDatabase) {
      throw new Error("database name mismatch");
    }

    // Provision manually only after verifying this is a dedicated, isolated,
    // disposable DB. Never add this marker through an app migration:
    //   CREATE TABLE public.flowpoint_test_database_guard (
    //     purpose text PRIMARY KEY, database_name text NOT NULL,
    //     classification text NOT NULL CHECK (classification = 'disposable')
    //   );
    //   INSERT INTO public.flowpoint_test_database_guard
    //     VALUES ('addon-cert', '<exact current_database() value>', 'disposable');
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
