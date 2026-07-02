/**
 * Shared helper for remote server routes.
 *
 * SECURITY: token values never appear in responses. The tokenStore methods
 * exposed here are read-only (status, listRedacted) or credential-lifecycle
 * (delete, set) but the set path only stores results returned by the lib after
 * validation — the raw token is consumed by the lib and never echoed back.
 */

export {
  getRemoteHooks as getHooks,
  type LibModule,
  type RemoteHooks,
  type TokenStore,
} from '../../../../electron/server-bridge/remote-hooks';

/** Regex matching lib's own author-friendly error messages — pass through verbatim. */
const REMOTE_FRIENDLY_ERROR =
  /couldn't reach github|reconnect github|connect github|sign-?in|declined|expired|canceled|already has files|valid web url|https|repository couldn't be found|couldn't be downloaded|try again|in progress|access token|web address|couldn't reach|didn't accept|wasn't found|certificate|git server/i;

/** Redact credential-bearing URL userinfo before logging. */
function redactUrlCredentials(text: string): string {
  return text.replace(/\/\/[^/\s:]+:[^@\s]+@/g, '//(redacted)@');
}

/**
 * Wrap a remote operation with the same error-sanitization logic as the IPC
 * handlers in main.ts: author-friendly lib messages pass through verbatim;
 * anything else is logged in full and replaced with a terse safe message.
 */
export async function handleRemoteErrors<T>(channel: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${channel}] failed: ${redactUrlCredentials(msg)}`);
    if (e instanceof Error && e.stack) console.error(redactUrlCredentials(e.stack));
    if (e instanceof Error && (e as { cause?: unknown }).cause) {
      console.error(`  cause: ${redactUrlCredentials(String((e as { cause?: unknown }).cause))}`);
    }
    if (REMOTE_FRIENDLY_ERROR.test(msg)) throw new Error(msg);
    throw new Error(
      'The online repository operation could not be completed. See the app log for details.',
    );
  }
}
