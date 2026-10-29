/**
 * The Publish wizard manages no accounts of its own: it reuses the Accounts
 * page's form and the same routes. A source-level guard, since components are
 * not rendered in these tests: a second key-entry form (or its drafts) must
 * not creep back into the wizard, and both places must use PublishKeyForm.
 */
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../../src", rel), "utf-8");
const wizard = read("lib/components/PublishWizard.svelte");
const accounts = read("lib/components/AccountsView.svelte");
const form = read("lib/components/PublishKeyForm.svelte");

test("the wizard and the Accounts page add and replace accounts with the same PublishKeyForm", () => {
  expect(wizard).toContain('import PublishKeyForm from "#lib/components/PublishKeyForm.svelte"');
  expect(accounts).toContain('import PublishKeyForm from "#lib/components/PublishKeyForm.svelte"');
  expect(wizard).toContain("<PublishKeyForm");
});

test("the wizard has no key entry or Google sign-in of its own", () => {
  expect(wizard).not.toMatch(/type="password"/);
  expect(wizard).not.toMatch(/api\.publish\.(connect|disconnect)|connectGoogle|publishTokenDrafts|publishAccountDrafts/);
  // The one place a key is checked and a sign-in is driven is the shared form.
  expect(form).toContain("api.publish.connect(");
  expect(form).toContain("connectGoogleStart(");
});

test("the wizard offers a way to open the Accounts page", () => {
  expect(wizard).toContain("onManageAccounts");
});
