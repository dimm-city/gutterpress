/**
 * SvelteKit adapter for the Electron host. Writes the SvelteKit server
 * UNBUNDLED — build/server/index.js (exporting `Server`) and
 * build/server/manifest.js — plus the browser assets in build/client/. The
 * Electron main process (electron/sveltekit-host.ts) constructs that Server
 * and answers every app:// request with Server.respond() in-process: no HTTP
 * server, no port. Dependencies resolve from node_modules the way everything
 * else in main does. (@sveltejs/adapter-node's only addition over this is a
 * Node HTTP handler, which this host does not need.)
 */
import { writeFileSync } from "node:fs";

/** @returns {import('@sveltejs/kit').Adapter} */
export default function adapter({ out = "build" } = {}) {
  return {
    name: "adapter-electron",
    async adapt(builder) {
      builder.rimraf(out);
      builder.mkdirp(out);
      builder.writeClient(`${out}/client`);
      builder.writeServer(`${out}/server`);
      writeFileSync(
        `${out}/server/manifest.js`,
        `export const manifest = ${builder.generateManifest({ relativePath: "./" })};\n`,
      );
    },
  };
}
