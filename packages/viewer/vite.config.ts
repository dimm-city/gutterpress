import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// adapter-node architecture (see svelte.config.js): the SvelteKit build emits
// a Node server bundle (build/server/, build/handler.js) alongside the client
// assets (build/client/). The renderer reaches the host mainly via
// fetch("/api/...") against src/routes/api/**/+server.ts routes; a narrow
// ipcMain/preload bridge (window.electron.*) is reserved for push-event
// streams and calls that must drive a live BrowserWindow — see CLAUDE.md §8.
// This config only builds the SvelteKit app itself; no externals / noExternal
// config needed here (electron.vite.config.ts handles the main/preload build).
export default defineConfig({
  plugins: [sveltekit()],
  server: {
    fs: { allow: [".."] },
  },
});
