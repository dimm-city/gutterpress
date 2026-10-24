import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import adapter from "./adapter-electron.js";

// The renderer reaches the host mainly via fetch("/api/...") against
// src/routes/api/**/+server.ts routes; a narrow ipcMain/preload bridge
// (window.electron.*) is reserved for push-event streams and calls that must
// drive a live BrowserWindow — see CLAUDE.md §8.
// (electron.vite.config.ts handles the main/preload build.)
export default defineConfig({
  plugins: [
    sveltekit({
      preprocess: vitePreprocess(),
      // adapter-electron.js writes the SvelteKit server unbundled to
      // build/server/ and the browser assets to build/client/. In production
      // the Electron main process loads that server and answers app://
      // requests with its respond() in-process. In dev, VITE_DEV_SERVER_URL is
      // used directly.
      adapter: adapter({ out: "build" }),
      // Emit relative asset URLs so app://-served pages don't request static
      // assets from the protocol root.
      paths: { relative: true },
    }),
  ],
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
