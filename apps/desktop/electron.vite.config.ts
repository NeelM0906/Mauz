import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sharedEntry = resolve(__dirname, "../../packages/shared/src/index.ts");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@mauzai/shared"] })],
    resolve: {
      alias: {
        "@mauzai/shared": sharedEntry
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@mauzai/shared"] })],
    resolve: {
      alias: {
        "@mauzai/shared": sharedEntry
      }
    }
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@mauzai/shared": sharedEntry,
        "@renderer": resolve(__dirname, "src/renderer/src")
      }
    }
  }
});
