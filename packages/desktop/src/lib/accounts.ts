/**
 * Sorting the credentials saved on this computer into what the Accounts page
 * lists: GitHub (its own sign-in), Git servers and publishing accounts.
 * Pure — AccountsView reads only the redacted listing (`HostConnectionInfo`:
 * never a token) and the static provider info.
 *
 * A stored entry's `host` is the REAL host, also for a named publishing
 * account (the store keeps those under a compound `<host>#<account>` key that
 * the listing does not expose); the account's name travels in `username`. So
 * an entry is a publishing account when its host is a provider's credential
 * host, and it is removed or replaced through the provider route and the
 * account name, never by its host alone.
 */
import type { PublishProviderStaticInfo } from "#lib/api.ts";
import type { HostConnectionInfo } from "#lib/platform/contract.ts";

const GITHUB_HOST = "github.com";

/** A Git server with a pasted access token. */
export interface ServerAccount {
  host: string;
  username: string;
  unreadable: boolean;
}

/** A saved key (or Google sign-in) for one publishing provider. */
export interface PublishAccount {
  /** Unique among the page's rows. */
  key: string;
  provider: PublishProviderStaticInfo;
  /** The account's name; "" is the provider's default account. */
  account: string;
  /** What the row shows for the account. */
  label: string;
  unreadable: boolean;
}

export interface AccountGroups {
  servers: ServerAccount[];
  publishing: PublishAccount[];
}

/** The providers that take a key, or a Google sign-in: what "Add" offers. */
export function providersWithKeys(providers: PublishProviderStaticInfo[]): PublishProviderStaticInfo[] {
  return providers.filter((p) => p.credentialRequired && p.credentialHost);
}

function accountLabel(e: HostConnectionInfo): string {
  if (e.username) return e.username;
  // The default Google sign-in keeps no username (that field is reserved for a
  // named account's name), so the connected email lives only in its label
  // ("Google Drive — a@b.com", set by connect-google.ts).
  if (e.kind === "google-oauth" && e.label) return e.label.replace(/^Google Drive\s*—\s*/, "");
  return "Default account";
}

export function groupAccounts(entries: HostConnectionInfo[], providers: PublishProviderStaticInfo[]): AccountGroups {
  const keyed = providersWithKeys(providers);
  const servers: ServerAccount[] = [];
  const publishing: PublishAccount[] = [];
  for (const e of entries) {
    if (e.host === GITHUB_HOST) continue;
    const provider = keyed.find((p) => p.credentialHost === e.host);
    if (provider) {
      const account = e.username ?? "";
      publishing.push({
        key: `${provider.id}#${account}`,
        provider,
        account,
        label: accountLabel(e),
        unreadable: !!e.unreadable,
      });
    } else {
      servers.push({ host: e.host, username: e.username ?? "", unreadable: !!e.unreadable });
    }
  }
  // A provider's accounts sit together, in the providers' order, the default first.
  const order = (a: PublishAccount) => keyed.indexOf(a.provider);
  publishing.sort((a, b) => order(a) - order(b) || Number(!!a.account) - Number(!!b.account));
  return { servers, publishing };
}

/**
 * What PublishKeyForm needs of a provider: the Accounts page passes its static
 * listing, the Publish wizard its provider card.
 */
export interface KeyFormProvider {
  id: string;
  label: string;
  tokenUrl?: string | null;
  hint?: string | null;
  connectKind?: "token" | "oauth" | null;
}

/** What to tell the author above the form that replaces a saved key or sign-in (a saved key is never shown). */
export function replaceHint(provider: Pick<KeyFormProvider, "connectKind">): string {
  return provider.connectKind === "oauth"
    ? "Sign in again to replace the saved sign-in."
    : "Your saved key can't be shown. Paste the key again to replace it.";
}

/**
 * The saved account that adding `account` for `providerId` would replace, if
 * any. The store keys names case-insensitively ("Studio" is "studio"), so
 * the match ignores case too.
 */
export function savedAccount<T extends { provider: { id: string }; account: string }>(
  publishing: T[],
  providerId: string,
  account: string,
): T | undefined {
  const wanted = account.trim().toLowerCase();
  return publishing.find((a) => a.provider.id === providerId && a.account.toLowerCase() === wanted);
}
