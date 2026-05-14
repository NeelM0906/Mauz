import { defineConfig } from "vitest/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@mauzai\/api\/server$/,
        replacement: resolve(__dirname, "../api/src/server.ts")
      },
      {
        find: /^@mauzai\/shared$/,
        replacement: resolve(__dirname, "../../packages/shared/src/index.ts")
      },
      {
        find: /^@mauzai\/shared\/(.*)$/,
        replacement: resolve(__dirname, "../../packages/shared/src/$1")
      },
      {
        find: /^@renderer\/(.*)$/,
        replacement: resolve(__dirname, "src/renderer/src/$1")
      }
    ]
  }
});
