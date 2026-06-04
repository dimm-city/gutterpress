import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// electron-vite builds the Electron main + preload (ESM — the package is
// "type": "module"). The renderer is NOT built here: it's a SvelteKit
// adapter-static SPA built separately by `vite build` into build/, and served
// by main via the app:// protocol. externalizeDepsPlugin keeps the runtime deps
// (@dimm-city/print-md-lib and its graph) out of the bundle so electron-builder
// ships them from node_modules.
const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      rollupOptions: {
        // electron is the runtime (devDependency → not caught by
        // externalizeDepsPlugin) and the lib is a workspace:* dep (also not
        // caught). Externalize both: electron is provided by the runtime, and
        // the lib (with its puppeteer-core/markdown-it graph) loads from
        // node_modules — keeping main tiny.
        // fflate is externalized too: bundling its CJS form injects a
        // `var require = createRequire(...)` that collides with electron-vite's
        // own injected require banner ("Identifier 'require' has already been
        // declared") and crashes the main process on launch. It's a production
        // dependency, so electron-builder ships it from node_modules.
        external: ["electron", "@dimm-city/print-md-lib", "fflate"],
        input: resolve(root, "electron/main.ts"),
        output: { format: "es", entryFileNames: "main.js" },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: {
        external: ["electron"],
        input: resolve(root, "electron/preload.ts"),
        output: { format: "es", entryFileNames: "preload.js" },
      },
    },
  },
});
