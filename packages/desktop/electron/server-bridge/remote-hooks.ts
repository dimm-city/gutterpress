/**
 * Shared remote-operation hooks for remote:* and publish:* server routes.
 * main.ts builds the object and passes it as the `remote` field to
 * `registerHostServices()`; routes reach it through `getHostServices().remote`
 * (`./host-services.ts`). The lib itself comes from `loadLib()` in
 * `src/routes/api/_lib/route.ts`.
 *
 * SECURITY: token values never appear in responses. The token store's
 * read-side methods are redacted (`status`, `listRedacted`); `set` only stores
 * results the lib returns after validation.
 */

import type { electronTokenStore } from '../credential-store';
import type { CloneRepositoryArgs } from '../../src/lib/platform/shared-types';

/** The desktop's safeStorage-backed credential store: the lib's `TokenStore` plus the redacted read methods. */
export type TokenStore = typeof electronTokenStore;

export interface RemoteHooks {
  tokenStore: TokenStore;
  GITHUB_HOST: string;
  /**
   * Clone a repo into `${parentDir}/${sanitized folderName}` and resolve to the
   * dir to open (the repo root, or a chosen book subPath inside it). Bound in
   * main.ts: the closure does the folder-name sanitization,
   * credential lookup, and `mainWindow.webContents.send("remote:cloneProgress",
   * …)` progress push internally, so the route (a separate Vite bundle with no
   * `mainWindow` reference) only ever calls this one method.
   */
  cloneRepository(args: CloneRepositoryArgs): Promise<{ projectDir: string }>;
}
