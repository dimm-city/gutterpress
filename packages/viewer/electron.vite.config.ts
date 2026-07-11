import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// electron-vite builds the Electron main + preload (ESM — the package is
// "type": "module"). The renderer is NOT built here: it's a SvelteKit
// adapter-node app (server + client bundle) built separately by `vite build`
// into build/, whose Node handler (build/handler.js) Electron main starts on
// a local 127.0.0.1 server and serves to the window via the app:// protocol
// (which proxies each request to that server with fetch — see CLAUDE.md §8).
// externalizeDepsPlugin keeps the runtime deps (@dimm-city/print-md and its
// graph) out of the bundle so electron-builder ships them from node_modules.
const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // Bake the GitHub OAuth App client id into the MAIN bundle at build time:
    // `process.env.PRINT_MD_GITHUB_CLIENT_ID` does not exist on end-user
    // machines, so release CI sets it (repo variable → env on the viewer build
    // step; see docs/adr/0006-remote-git-github-integration.md D1) and this
    // define replaces the expression with the literal value. When unset it
    // bakes "" — which resolveGitHubClientId treats as unset (default-
    // registration fallback).
    define: {
      "process.env.PRINT_MD_GITHUB_CLIENT_ID": JSON.stringify(
        process.env.PRINT_MD_GITHUB_CLIENT_ID ?? "",
      ),
    },
    build: {
      outDir: "out/main",
      rollupOptions: {
        // electron is the runtime (devDependency → not caught by
        // externalizeDepsPlugin) and the lib is a workspace:* dep (also not
        // caught). Externalize both: electron is provided by the runtime, and
        // the lib (with its puppeteer-core/markdown-it graph) loads from
        // node_modules — keeping main tiny.
        // electron-updater is externalized explicitly (the plugin misses it
        // under bun's node_modules layout): it's a production dependency, so
        // electron-builder ships it and its CJS graph from node_modules.
        external: ["electron", "@dimm-city/print-md", "electron-updater"],
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
