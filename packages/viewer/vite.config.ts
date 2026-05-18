import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  ssr: {
    // print-md uses Bun-specific APIs (Bun.serve, Bun.file, with { type: "file" } imports)
    // and native deps (puppeteer-core, chokidar). Keep them external so Vite doesn't try
    // to bundle them for SSR — the SvelteKit server runs under Bun and resolves them
    // at runtime via the workspace dep.
    noExternal: [],
    external: [
      "@dimm-city/print-md",
      "puppeteer-core",
      "chokidar",
      "citty",
      "yaml",
      "markdown-it",
      "markdown-it-attrs",
      "markdown-it-footnote",
      "markdown-it-source-map",
      "pagedjs",
      "stylelint",
    ],
  },
  server: {
    fs: {
      // Allow reading sources from the workspace (sibling packages).
      allow: [".."],
    },
  },
});
