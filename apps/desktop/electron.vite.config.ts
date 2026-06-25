import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sharedEntry = resolve(__dirname, "../../packages/shared/src/index.ts");
const apiServerEntry = resolve(__dirname, "../api/src/server.ts");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@mauzai/api", "@mauzai/shared"] })],
    resolve: {
      alias: {
        "@mauzai/api/server": apiServerEntry,
        "@mauzai/shared": sharedEntry
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@mauzai/api", "@mauzai/shared"] })],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
          chunkFileNames: "[name]-[hash].cjs"
        }
      }
    },
    resolve: {
      alias: {
        "@mauzai/api/server": apiServerEntry,
        "@mauzai/shared": sharedEntry
      }
    }
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@mauzai/api/server": apiServerEntry,
        "@mauzai/shared": sharedEntry,
        "@renderer": resolve(__dirname, "src/renderer/src")
      }
    }
  }
});
