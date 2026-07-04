/**
 * Shared helper for remote server routes.
 *
 * SECURITY: token values never appear in responses. The tokenStore methods
 * exposed here are read-only (status, listRedacted) or credential-lifecycle
 * (delete, set) but the set path only stores results returned by the lib after
 * validation — the raw token is consumed by the lib and never echoed back.
 *
 * The error-sanitization helper (handleRemoteErrors) lives in the shared
 * server-bridge/friendly-errors module and is re-exported here so remote route
 * handlers keep importing it from `../_hooks`.
 */

export {
  getRemoteHooks as getHooks,
  type LibModule,
  type RemoteHooks,
  type TokenStore,
} from '../../../../electron/server-bridge/remote-hooks';

export { handleRemoteErrors } from '../../../../electron/server-bridge/friendly-errors';
