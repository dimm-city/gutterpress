import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// adapter-static + IPC architecture: the renderer talks to Electron's main
// process via window.electron.* (preload bridge), never via fetch(). The
// SvelteKit build is pure client — no SSR, no server bundle, no node deps
// pulled into vite's graph. So no externals / noExternal config needed.
export default defineConfig({
  plugins: [sveltekit()],
  server: {
    fs: { allow: [".."] },
  },
});
