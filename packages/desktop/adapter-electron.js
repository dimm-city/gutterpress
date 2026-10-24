/**
 * SvelteKit adapter for the Electron host. Writes the SvelteKit server
 * UNBUNDLED — build/server/index.js and the rest of the server output, plus
 * build/server/server.js, which exports the ready-made `server` instance
 * (`builder.generateServerInstance`) — and the browser assets in
 * build/client/. The Electron main process (electron/sveltekit-host.ts)
 * initialises that server and answers every app:// request with its
 * respond() in-process: no HTTP server, no port. Dependencies resolve from
 * node_modules the way everything else in main does. (@sveltejs/adapter-node's
 * only addition over this is a Node HTTP handler, which this host does not
 * need.)
 */
import { rmSync } from "node:fs";

/** @returns {import('@sveltejs/kit').Adapter} */
export default function adapter({ out = "build" } = {}) {
  return {
    name: "adapter-electron",
    adapt(builder) {
      rmSync(out, { force: true, recursive: true });
      builder.writeClient(`${out}/client`);
      builder.writeServer(`${out}/server`);
      builder.generateServerInstance(`${out}/server/server.js`, { serverDirectory: `${out}/server` });
    },
  };
}
