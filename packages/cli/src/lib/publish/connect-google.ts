/**
 * Shared Google Drive connect flow (#221) — the ONE implementation behind
 * both the CLI's `--connect` branch and (Phase 2) the desktop's connect
 * route, mirroring how `connect.ts` is shared for pasted-token providers.
 *
 * Unlike `connectPublishProvider` (verify-before-store for a PASTED token),
 * this flow is verify-by-construction: `GoogleAuthProvider.connect()` only
 * returns a credential after a successful token exchange, so there is no
 * separate "try it against the platform" step — storing it IS the proof.
 */
import { GDRIVE_HOST, GoogleAuthProvider, type GoogleHostCallbacks } from "./google-auth.ts";
import { publishCredentialKey, type PublishDeps } from "./types.ts";

export interface ConnectGoogleDriveOptions {
  /**
   * Optional account label for a NAMED credential (two Google accounts) —
   * stored under the compound `gdrive#<account>` key, same mechanism as
   * every other provider's named accounts (types.ts `publishCredentialKey`).
   */
  account?: string;
  /** Explicit client id/secret overrides (tests; advanced use). */
  clientId?: string;
  clientSecret?: string;
  /** Override the system-browser opener (tests; advanced use). */
  openBrowser?: (url: string) => Promise<void>;
}

export interface ConnectGoogleDriveResult {
  connected: true;
  /** The connected account's email, when Google returned one. */
  email?: string;
}

/**
 * Run the loopback+PKCE flow and store the resulting refresh-token credential.
 */
export async function connectGoogleDrive(
  options: ConnectGoogleDriveOptions,
  deps: PublishDeps,
  callbacks: GoogleHostCallbacks,
): Promise<ConnectGoogleDriveResult> {
  const provider = new GoogleAuthProvider({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    fetchImpl: deps.fetch,
    ...(options.openBrowser ? { openBrowser: options.openBrowser } : {}),
  });
  const credential = await provider.connect(callbacks);
  const email = credential.username;
  const account = (options.account ?? "").trim();
  const key = publishCredentialKey(GDRIVE_HOST, account);
  // `username` carries the ACCOUNT LABEL for named credentials (the same
  // convention `connect.ts` uses, and what `listPublishAccounts` reads) — the
  // default (unnamed) entry must have NONE, even though GoogleAuthProvider's
  // own credential (mirroring GitHub's username=login convention) already
  // carries the account's email in `username`. Destructure it out explicitly
  // rather than spreading `...credential` and conditionally overriding —
  // the conditional spread lets that email leak through as a false "account
  // label" whenever `account` is empty, which broke the saved-accounts
  // picker on every default connect (found in review, #221).
  const { username: _accountEmailAsUsername, ...credentialWithoutUsername } = credential;
  await deps.tokenStore.set(key, {
    ...credentialWithoutUsername,
    ...(account ? { username: account } : {}),
    label: account ? `${account} (${email ?? "Google Drive"})` : credential.label,
  });
  return { connected: true, ...(email ? { email } : {}) };
}
