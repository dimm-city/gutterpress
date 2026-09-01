import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// adapter-static architecture (see svelte.config.js): the SvelteKit build
// emits a plain static file tree to build/ — no Node server, no
// build/handler.js, no src/routes/api/** (deleted in SFE-P5c/P5d). The
// renderer reaches the host through typed IPC (window.electron.* /
// getPlatform(), preload.ts) for push-event streams and live-BrowserWindow
// calls, and through the same IPC surface for request/reply operations that
// used to be +server.ts routes — see CLAUDE.md §8. In production,
// electron/app-protocol.ts serves build/ directly from disk under the app://
// scheme. (electron.vite.config.ts handles the main/preload build.)
export default defineConfig({
  plugins: [sveltekit()],
  server: {
    fs: { allow: [".."] },
  },
  ssr: {
    // Vite bundles LINKED (workspace) deps into the SSR output by default.
    // That breaks the lib's embedded assets: gutterpress's dist carries
    // `with { type: "file" }` assets as sibling files referenced by relative
    // string paths resolved against the module's own dirname
    // (packages/cli/src/lib/embedded-assets.ts). Bundling moved the module
    // into build/server/chunks/ WITHOUT the asset files, so every scaffold/
    // theme/schema read failed in the packaged app ("favicon-….ico not found
    // in app.asar"). Externalized, the routes load the real package from
    // node_modules — the same copy Electron main already imports.
    external: ["gutterpress"],
  },
});
