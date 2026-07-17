import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Workspace packages — resolves to source so oxc can transform them
      "@workspace/db":      resolve(__dirname, "../../lib/db/src/index.ts"),
      "@workspace/api-zod": resolve(__dirname, "../../lib/api-zod/src/index.ts"),
    },
  },
  test: {
    // Run only files that are self-contained (pure functions / no live DB required)
    include: [
      "src/lib/startup-retry.test.ts",
      "src/startup-bootstrap.test.ts",
      "src/services/ai-economy.test.ts",
      "src/services/ai-engine.credit-calc.test.ts",
      "src/services/ai-economy-db.test.ts",
      "src/services/ai-attachments.test.ts",
      "src/services/ai-attachments-db.test.ts",
      "src/services/ai-attachment-parser.test.ts",
      "src/services/ai-attachment-parser-db.test.ts",
      "src/services/ai-multimodal.test.ts",
      "src/routes/ai-chat-attachments.test.ts",
      "src/routes/team-files.test.ts",
      "src/routes/overview.test.ts",
    ],
    environment: "node",
    globals:     false,
    reporters:   ["verbose"],
    // Mock heavy deps that would require a real DB connection
    setupFiles:  ["./src/vitest.setup.ts"],
    // Use the isolated tsconfig so oxc does NOT pick up the composite/references
    // from tsconfig.json (which targets compiled workspace packages, not source).
    // tsconfig.json composite+references must stay intact for tsc project build.
    typecheck: { tsconfig: "./tsconfig.vitest.json" },
  },
});
