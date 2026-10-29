/**
 * How the Accounts page sorts the saved credentials (src/lib/accounts.ts):
 * GitHub has its own section, a stored entry whose host is a publishing
 * provider's credential host is a publishing account (a named one carries its
 * name in `username`), and anything else is a Git server.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { groupAccounts, providersWithKeys, savedAccount } from "../../src/lib/accounts";
import type { PublishProviderStaticInfo } from "../../src/lib/api";
import type { HostConnectionInfo } from "../../src/lib/platform/contract";

function provider(id: string, label: string, over: Partial<PublishProviderStaticInfo> = {}): PublishProviderStaticInfo {
  return {
    id,
    label,
    kind: "api",
    credentialRequired: true,
    credentialHost: `${id}.example`,
    tokenUrl: null,
    hint: null,
    connectKind: null,
    ...over,
  };
}

const PROVIDERS = [
  provider("local", "A folder on this computer", { credentialRequired: false, credentialHost: null }),
  provider("itch", "itch.io", { credentialHost: "itch.io" }),
  provider("kdp", "Amazon KDP", { kind: "guided", credentialRequired: false, credentialHost: "kdp.amazon.com" }),
  provider("shopify", "Shopify", { credentialHost: "shopify" }),
  provider("gdrive", "Google Drive", { credentialHost: "gdrive", connectKind: "oauth" }),
];

function entry(host: string, over: Partial<HostConnectionInfo> = {}): HostConnectionInfo {
  return { host, kind: "token", createdAt: 1, ...over };
}

describe("providersWithKeys", () => {
  test("keeps the providers that take a key or a Google sign-in, in order", () => {
    expect(providersWithKeys(PROVIDERS).map((p) => p.id)).toEqual(["itch", "shopify", "gdrive"]);
  });
});

describe("groupAccounts", () => {
  test("GitHub is left to its own section", () => {
    const groups = groupAccounts([entry("github.com", { kind: "github-oauth" })], PROVIDERS);
    expect(groups).toEqual({ servers: [], publishing: [] });
  });

  test("a provider's credential host is a publishing account; any other host is a Git server", () => {
    const groups = groupAccounts(
      [entry("gitlab.com", { username: "ada" }), entry("itch.io"), entry("git.example.org:3000", { unreadable: true })],
      PROVIDERS,
    );
    expect(groups.servers).toEqual([
      { host: "gitlab.com", username: "ada", unreadable: false },
      { host: "git.example.org:3000", username: "", unreadable: true },
    ]);
    expect(groups.publishing.map((a) => [a.provider.id, a.account, a.label])).toEqual([["itch", "", "Default account"]]);
  });

  test("a named account shares its provider's host, is told apart by its name, and sits after the default", () => {
    const groups = groupAccounts(
      [entry("itch.io", { username: "Studio", label: "Studio" }), entry("itch.io"), entry("shopify", { username: "Shop B" })],
      PROVIDERS,
    );
    expect(groups.publishing.map((a) => [a.key, a.provider.id, a.account, a.label])).toEqual([
      ["itch#", "itch", "", "Default account"],
      ["itch#Studio", "itch", "Studio", "Studio"],
      ["shopify#Shop B", "shopify", "Shop B", "Shop B"],
    ]);
  });

  test("a provider's accounts sit together, in the providers' order, not the store's", () => {
    const groups = groupAccounts(
      [entry("gdrive", { kind: "google-oauth" }), entry("itch.io", { username: "Studio" }), entry("shopify"), entry("itch.io")],
      PROVIDERS,
    );
    expect(groups.publishing.map((a) => a.key)).toEqual(["itch#", "itch#Studio", "shopify#", "gdrive#"]);
  });

  test("the default Google sign-in shows its email, which lives only in the label", () => {
    const groups = groupAccounts(
      [entry("gdrive", { kind: "google-oauth", label: "Google Drive — ada@example.com" })],
      PROVIDERS,
    );
    expect(groups.publishing[0]?.label).toBe("ada@example.com");
  });

  test("an entry that no longer decrypts keeps saying so", () => {
    const groups = groupAccounts([entry("itch.io", { unreadable: true })], PROVIDERS);
    expect(groups.publishing[0]?.unreadable).toBe(true);
  });

  test("nothing saved, or no providers: two empty lists", () => {
    expect(groupAccounts([], PROVIDERS)).toEqual({ servers: [], publishing: [] });
    // With no provider info a publishing host can't be told from a server: all are servers.
    expect(groupAccounts([entry("itch.io")], []).servers).toHaveLength(1);
  });
});

describe("savedAccount", () => {
  const publishing = groupAccounts([entry("itch.io"), entry("itch.io", { username: "Studio" })], PROVIDERS).publishing;

  test("finds the default account, or a named one ignoring case (the store keys names case-insensitively)", () => {
    expect(savedAccount(publishing, "itch", "")?.account).toBe("");
    expect(savedAccount(publishing, "itch", "  ")?.account).toBe("");
    expect(savedAccount(publishing, "itch", "studio")?.account).toBe("Studio");
  });

  test("is undefined for an account or provider that isn't saved", () => {
    expect(savedAccount(publishing, "itch", "Other")).toBeUndefined();
    expect(savedAccount(publishing, "shopify", "")).toBeUndefined();
  });
});

// ── Where things live ───────────────────────────────────────────────────────
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

describe("wiring", () => {
  test("Settings keeps Appearance, Saving and the Accounts… row; the name and email moved to Accounts, above GitHub", () => {
    const settings = read("src/lib/components/SettingsView.svelte");
    expect(settings.match(/<h2 id="settings-[a-z]+">[^<]+/g)).toEqual([
      '<h2 id="settings-appearance">Appearance',
      '<h2 id="settings-saving">Saving',
      '<h2 id="settings-accounts">Accounts',
    ]);
    expect(settings).not.toMatch(/gitIdentity|settings-name|settings-email/);

    const accounts = read("src/lib/components/AccountsView.svelte");
    // The same settings keys, saved on change.
    expect(accounts).toContain("onchange={(e) => settings.set({ gitIdentity: { authorName: e.currentTarget.value } })}");
    expect(accounts).toContain("onchange={(e) => settings.set({ gitIdentity: { authorEmail: e.currentTarget.value } })}");
    const order = ["accounts-identity", "accounts-github", "accounts-servers", "accounts-publishing"].map((id) => accounts.indexOf(`<h2 id="${id}">`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("the missing name and email banner opens Accounts with the cursor in Name", () => {
    const page = read("src/routes/+page.svelte");
    const banner = page.slice(page.indexOf('class="identity-action"'), page.indexOf("Add your name &amp; email"));
    expect(banner).toContain('accountsFocus = "name"');
    expect(banner).toContain("accountsOpen = true");
    expect(page).toContain("<AccountsView onClose={closeAccounts} focus={accountsFocus} />");
    expect(read("src/lib/components/AccountsView.svelte")).toContain('initialFocus={focus === "name" ? "#accounts-name" : undefined}');
  });

  test("every form that takes a secret uses a password field that suppresses autofill", () => {
    for (const file of ["GitServerForm", "PublishKeyForm"]) {
      const src = read(`src/lib/components/${file}.svelte`);
      expect(src).toContain('type="password" autocomplete="new-password"');
    }
  });

  test("Book setup's server connect and the Accounts page share one Git server form", () => {
    expect(read("src/lib/components/ProjectConnectionsSection.svelte")).toContain("<GitServerForm");
    expect(read("src/lib/components/AccountsView.svelte")).toContain("<GitServerForm");
  });
});
