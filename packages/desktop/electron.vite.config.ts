import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// electron-vite builds the Electron main + preload (ESM — the package is
// "type": "module"). The renderer is NOT built here: it's a SvelteKit
// adapter-node app (server + client bundle) built separately by `vite build`
// into build/, whose Node handler (build/handler.js) Electron main starts on
// a local 127.0.0.1 server and serves to the window via the app:// protocol
// (which proxies each request to that server with fetch — see CLAUDE.md §8).
// externalizeDepsPlugin keeps the runtime deps (gutterpress and its
// graph) out of the bundle so electron-builder ships them from node_modules.
const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // Bake the GitHub OAuth App client id into the MAIN bundle at build time:
    // `process.env.GUTTERPRESS_GITHUB_CLIENT_ID` does not exist on end-user
    // machines, so release CI sets it (repo variable → env on the desktop build
    // step; see docs/adr/0006-remote-git-github-integration.md D1) and this
    // define replaces the expression with the literal value. When unset it
    // bakes "" — which resolveGitHubClientId treats as unset (default-
    // registration fallback).
    define: {
      "process.env.GUTTERPRESS_GITHUB_CLIENT_ID": JSON.stringify(
        process.env.GUTTERPRESS_GITHUB_CLIENT_ID ?? "",
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
        //
        // SFE-P3e review round 1 (CONFIRMED finding): Rollup matches a
        // STRING array entry by exact id, so a bare "gutterpress" entry
        // externalizes only the root import — it does NOT cover
        // "gutterpress/render" or "gutterpress/plugins". Before SFE-P3e no
        // file under electron/ imported a gutterpress subpath at all;
        // electron/editor-projection.ts (this run) introduced the first
        // ones, and with only the bare string here they got BUNDLED into
        // out/main/main.js — inlining a whole second copy of the CLI's
        // plugin loader (module-level state and all: vendorCjsTrees,
        // isolatedVendorTrees, pathPluginCache, cjsResolverInstalled) into
        // the SAME main process that already loads that loader through the
        // ordinary node_modules `gutterpress` specifier (preview/build/
        // export). A RegExp entry matches every subpath, so this covers
        // "gutterpress", "gutterpress/render", "gutterpress/plugins", and
        // any future subpath D11 adds, with no per-subpath upkeep.
        external: ["electron", /^gutterpress(\/.*)?$/, "electron-updater"],
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
        // MUST be CJS with a .cjs extension: the main window runs with
        // sandbox: true (2026-07 security hardening, ARCH review #1/#33), and
        // Electron's sandboxed preload loader cannot execute ESM — an
        // ES-format preload fails with "Cannot use import statement outside
        // a module" and the whole window.electron bridge silently disappears
        // in the packaged app (caught by the packaged-app render gate, not
        // unit tests). The .cjs extension matters because package.json is
        // "type": "module".
        output: { format: "cjs", entryFileNames: "preload.cjs" },
      },
    },
  },
});
