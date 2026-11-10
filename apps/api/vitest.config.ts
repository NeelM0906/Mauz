import { defineConfig } from "vitest/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // The first test in each file pays module-load cost, which is slow on
    // Windows (Defender scans every module); the 5s default times out there.
    testTimeout: 20_000
  },
  resolve: {
    alias: [
      {
        find: /^@mauzai\/shared$/,
        replacement: resolve(__dirname, "../../packages/shared/src/index.ts")
      },
      {
        find: /^@mauzai\/shared\/(.*)$/,
        replacement: resolve(__dirname, "../../packages/shared/src/$1")
      }
    ]
  }
});
