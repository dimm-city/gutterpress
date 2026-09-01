/**
 * google-connect-flow.ts — the Google Drive OAuth "one connect at a time"
 * state trio behind publish:connectGoogleStart / publish:connectGoogleWait /
 * publish:connectGoogleCancel (#221, docs/gdrive-publish-plan.md D10),
 * mirroring `electron/github-device-flow.ts` exactly.
 *
 * Unlike the GitHub device flow there is no user code to display — Google's
 * loopback+PKCE flow (google-auth.ts's `GoogleAuthProvider`) only ever hands
 * back the auth URL the browser was sent to, so `start()` resolves with
 * `{ authUrl }` (a "browser didn't open? click here" fallback) instead of a
 * code. `authUrlPromise` resolves with that URL (phase 1, mirroring
 * `codePromise`); `donePromise` resolves once the user approves in the
 * browser and the credential is stored (phase 2, polled by
 * publish:connectGoogleWait). All real OAuth work happens in the lib's
 * `connectGoogleDrive` (CLAUDE.md §7's spirit: no external CLI/SDK, plain
 * fetch); this class only owns the single-in-flight-attempt state and opens
 * the auth URL via `shell.openExternal` (host-side — see the constructor
 * `openExternal` dep, wired to `main.ts`'s existing http(s)-only gate).
 *
 * `GoogleAuthProvider.connect()` would ALSO best-effort open the URL itself
 * by default (via the lib's own spawn-based `openPath()`). That is suppressed
 * here — `connectGoogleDrive`'s `openBrowser` override (added alongside this
 * fix) is passed a no-op — because Electron's `shell.openExternal` (via the
 * `openExternal` dep below, wired to `main.ts`'s existing http(s)-only gate)
 * is the reliable, sandboxed, already-validated path the rest of the app
 * uses for external links, and D10 specifies it explicitly. This class is
 * therefore the ONE place a browser opens on this platform, not two.
 *
 * Node/lib-side ONLY — never imported by the renderer.
 */

import type { TokenStore } from "gutterpress";
// GoogleConnectStartResult/GoogleConnectResult have no lib-side equivalent
// (unlike DeviceCodeInfo, which github-device-flow.ts imports straight from
// "gutterpress" — GoogleAuthProvider.connect()'s onAuthUrl callback just
// takes a bare `url: string`, and the lib's own connectGoogleDrive() result
// shape is `{ connected: true; email? }`, not what the IPC bridge returns).
// These two are desktop-local wire shapes (shared-types.ts), reached here via
// the single-import re-export convention bridge-types.ts documents.
import type { GoogleConnectResult, GoogleConnectStartResult } from "./bridge-types";

type LibModule = typeof import("gutterpress");

interface ActiveGoogleConnect {
  controller: AbortController;
  authUrlPromise: Promise<GoogleConnectStartResult>;
  donePromise: Promise<GoogleConnectResult>;
}

export interface GoogleConnectFlowDeps {
  /** Lazily load gutterpress. Cached by the caller. */
  loadLib: () => Promise<LibModule>;
  /** Credential store the approved connection is written to. */
  tokenStore: TokenStore;
  /** Opens a URL in the system browser (host-side; validated http(s)-only —
   *  see main.ts's `appHooksImpl.openExternal`). Failure is non-fatal: the
   *  auth URL is already handed back from `start()` as a fallback link. */
  openExternal: (url: string) => Promise<void>;
}

export class GoogleConnectFlow {
  private active: ActiveGoogleConnect | null = null;

  constructor(private readonly deps: GoogleConnectFlowDeps) {}

  /** publish:connectGoogleStart — begins a connect attempt, returns the auth URL. */
  async start(account?: string): Promise<GoogleConnectStartResult> {
    // Replace any in-flight attempt (e.g. the user reopened the dialog).
    this.active?.controller.abort();
    this.active = null;

    const lib = await this.deps.loadLib();
    const controller = new AbortController();
    let resolveAuthUrl!: (v: GoogleConnectStartResult) => void;
    const authUrlPromise = new Promise<GoogleConnectStartResult>((resolve) => {
      resolveAuthUrl = resolve;
    });

    const donePromise = lib
      .connectGoogleDrive(
        // openBrowser: async () => {} suppresses the lib's own default opener
        // (see the class doc) — shell.openExternal below is the sole opener.
        { ...(account ? { account } : {}), openBrowser: async () => {} },
        { tokenStore: this.deps.tokenStore },
        {
          onAuthUrl: (url) => {
            resolveAuthUrl({ authUrl: url });
            // Best-effort; the URL was already handed to the host UI above as
            // a fallback link.
            this.deps.openExternal(url).catch(() => {});
          },
          signal: controller.signal,
        },
      )
      .then((result): GoogleConnectResult => ({
        connected: true,
        ...(result.email ? { email: result.email } : {}),
      }));
    // Park the rejection until publish:connectGoogleWait consumes it — an
    // unconsumed failure must not surface as an unhandled rejection.
    donePromise.catch(() => {});
    this.active = { controller, authUrlPromise, donePromise };
    // If connect fails BEFORE producing an auth URL (offline, no client
    // configured), authUrlPromise never settles — race it against the
    // failure so start() rejects with the friendly message instead of hanging.
    return await Promise.race([authUrlPromise, donePromise.then(() => authUrlPromise)]);
  }

  /** publish:connectGoogleWait — blocks until the user approves (or the attempt fails/aborts). */
  async wait(): Promise<GoogleConnectResult> {
    const active = this.active;
    if (!active) {
      throw new Error("No Google Drive sign-in is in progress. Try again.");
    }
    try {
      return await active.donePromise;
    } finally {
      if (this.active === active) this.active = null;
    }
  }

  /** publish:connectGoogleCancel — aborts the in-flight attempt, if any. */
  cancel(): { ok: true } {
    this.active?.controller.abort();
    this.active = null;
    return { ok: true };
  }
}
