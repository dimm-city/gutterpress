/**
 * The wizard's Google Drive step (#452): a teammate who can't reach the book's
 * folder picks their own, saved for them only. The controller decides the words
 * and where a pick is saved (publish-section-controller.test.ts); the wizard
 * only shows them. A source-level guard, since components are not rendered in
 * these tests.
 */
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const wizard = fs.readFileSync(path.resolve(__dirname, "../../src/lib/components/PublishWizard.svelte"), "utf-8");
const driveStep = wizard.slice(wizard.indexOf("{#if card.destinations}"), wizard.indexOf("{:else if card.kind === \"plugin\"}"));

test("the Drive step shows the controller's prompt and picks through it", () => {
  expect(driveStep).toContain("controller.destinationPrompt(card.id)");
  expect(driveStep).toContain("{prompt.message}");
  expect(driveStep).toContain("prompt.selected");
  expect(wizard).toContain("controller.selectDestination(card.id, destination)");
});

test("the wizard never decides where a folder is saved: no manifest or private keys of its own", () => {
  expect(wizard).not.toMatch(/folderId|myFolder|setConfig/);
});

test("changing the book's folder says it is for everyone before saving, with a way out", () => {
  expect(driveStep).toContain("This changes the folder for everyone who publishes this book.");
  expect(driveStep).toContain("controller.confirmBookDestination(card.id)");
  expect(driveStep).toContain("controller.cancelBookDestination(card.id)");
});

test("the step offers the book's folder back, and a folder just for me", () => {
  expect(driveStep).toMatch(/prompt\.canUseBook[\s\S]*controller\.useBookDestination\(card\.id\)[\s\S]*Use the book's folder/);
  expect(driveStep).toMatch(
    /prompt\.canChooseOwn[\s\S]*controller\.chooseOwnDestination\(card\.id\)[\s\S]*Use a different folder just for me/,
  );
});
