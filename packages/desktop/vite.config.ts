import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// adapter-node architecture (see svelte.config.js): the SvelteKit build emits
// a Node server bundle (build/server/, build/handler.js) alongside the client
// assets (build/client/). The renderer reaches the host mainly via
// fetch("/api/...") against src/routes/api/**/+server.ts routes; a narrow
// ipcMain/preload bridge (window.electron.*) is reserved for push-event
// streams and calls that must drive a live BrowserWindow — see CLAUDE.md §8.
// (electron.vite.config.ts handles the main/preload build.)
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
