import { beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import app from "../artifacts/api-server/src/app.js";
import { createServer } from "http";

let server: ReturnType<typeof createServer>;
export let BASE_URL: string;

beforeAll(async () => {
  // Start test server on random port
  server = createServer(app);
  await new Promise<void>((resolve) =>
    server.listen(0, () => resolve()),
  );
  const addr = server.address() as { port: number };
  BASE_URL = `http://localhost:${addr.port}`;

  // Run DB migrations / seed minimal test data
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    console.warn("DB not available — some tests may be skipped");
  }
});

afterAll(async () => {
  server?.close();
});
