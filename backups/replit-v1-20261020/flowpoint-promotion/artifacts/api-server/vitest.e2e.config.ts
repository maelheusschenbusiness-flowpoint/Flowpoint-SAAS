import { defineConfig } from "vitest/config";
import { resolve } from "path";
const api = __dirname;
export default defineConfig({
  resolve: { alias: {
    "@workspace/db": resolve(api, "../../lib/db/src/index.ts"),
    "@workspace/api-zod": resolve(api, "../../lib/api-zod/src/index.ts"),
  } },
  test: { root: api, include: ["src/tests/e2e-ailab-transmission.test.ts"], testTimeout: 30000, hookTimeout: 30000 },
});
