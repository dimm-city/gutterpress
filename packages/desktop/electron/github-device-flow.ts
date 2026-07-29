/**
 * github-device-flow.ts — the GitHub OAuth device-flow "one connect at a
 * time" state trio behind remote:connectGitHubStart / remote:connectGitHubWait
 * / remote:connectGitHubCancel, extracted from electron/main.ts (ARCH review
 * finding #6).
 *
 * `codePromise` resolves with the user code (phase 1 of the two-phase
 * invoke, shown in the connect dialog); `donePromise` resolves once the user
 * approves in the browser and the credential is stored (phase 2, polled by
 * remote:connectGitHubWait). All real device-flow work happens in the lib's
 * `GitHubAuthProvider` (CLAUDE.md §7: isomorphic-git + plain fetch — never
 * system git/gh); this class only owns the single-in-flight-attempt state and
 * the credential-store write on success. Friendly-error sanitization
 * (handleRemoteErrors) stays at the main.ts call site, matching every other
 * remote:* handler.
 *
 * Node/lib-side ONLY — never imported by the renderer.
 */

  import type { DeviceCodeInfo, TokenStore } from "gutterpress";

  type LibModule = typeof import("gutterpress");

interface ActiveGitHubConnect {
  controller: AbortController;
  codePromise: Promise<DeviceCodeInfo>;
  donePromise: Promise<{ connected: boolean; username?: string }>;
}

export interface GitHubDeviceFlowDeps {
  /** Lazily load gutterpress. Cached by the caller. */
  loadLib: () => Promise<LibModule>;
  /** Credential store the approved connection is written to. */
  tokenStore: TokenStore;
  /** Remote host the credential is keyed under (GITHUB_HOST in main.ts). */
  githubHost: string;
  /** Resolves the OAuth app client id at connect time (env-derived; not fixed at construction). */
  clientId: () => string;
}

export class GitHubDeviceFlow {
  private active: ActiveGitHubConnect | null = null;

  constructor(private readonly deps: GitHubDeviceFlowDeps) {}

  /** remote:connectGitHubStart — begins a device-flow attempt, returns the user code. */
  async start(): Promise<DeviceCodeInfo> {
    // Replace any in-flight attempt (e.g. the user reopened the dialog).
    this.active?.controller.abort();
    this.active = null;

    const lib = await this.deps.loadLib();
    const controller = new AbortController();
    let resolveCode!: (info: DeviceCodeInfo) => void;
    const codePromise = new Promise<DeviceCodeInfo>((resolve) => {
      resolveCode = resolve;
    });
    const provider = new lib.GitHubAuthProvider({ clientId: this.deps.clientId() });
    const donePromise = provider
      .connect({ onUserCode: resolveCode, signal: controller.signal })
      .then(async (credential) => {
        await this.deps.tokenStore.set(this.deps.githubHost, credential);
        return {
          connected: true,
          ...(credential.username ? { username: credential.username } : {}),
        };
      });
    // Park the rejection until remote:connectGitHubWait consumes it — an
    // unconsumed failure must not surface as an unhandled rejection.
    donePromise.catch(() => {});
    this.active = { controller, codePromise, donePromise };
    // If connect fails BEFORE producing a user code (offline, bad client id),
    // codePromise never settles — race it against the failure so the start
    // call rejects with the friendly message instead of hanging.
    return await Promise.race([codePromise, donePromise.then(() => codePromise)]);
  }

  /** remote:connectGitHubWait — blocks until the user approves (or the attempt fails/aborts). */
  async wait(): Promise<{ connected: boolean; username?: string }> {
    const active = this.active;
    if (!active) {
      throw new Error("No GitHub sign-in is in progress. Try again.");
    }
    try {
      return await active.donePromise;
    } finally {
      if (this.active === active) this.active = null;
    }
  }

  /** remote:connectGitHubCancel — aborts the in-flight attempt, if any. */
  cancel(): { ok: true } {
    this.active?.controller.abort();
    this.active = null;
    return { ok: true };
  }
}
