import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    benchmark: {
      include: ["bench/**/*.native-bench.ts"],
    },
    maxWorkers: 1,
    passWithNoTests: false,
    pool: "forks",
  },
});
