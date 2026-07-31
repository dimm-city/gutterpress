/**
 * WelcomeLanding tab-state regressions (Codex review on PR #134, 2026-07-30).
 *
 * The landing is BOTH the start screen and the app's only empty state, and the
 * component stays mounted for the whole session — only its `{#if visible}`
 * block is torn down. So `activeTab` survives a dismissal unless something
 * resets it: read the Help tab, close the layer, and the next empty state (a
 * failed open, a closed project) reopens on Help with the book list and
 * recovery actions hidden behind a tab the author never chose.
 *
 * Source-text pins, per this repo's convention for component wiring (see
 * settings-connections.test.ts) — the reset is a transition-lifecycle
 * behaviour that a DOM-free unit test cannot observe.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const landing = read("src/lib/components/WelcomeLanding.svelte");

describe("the landing returns to Projects after it is dismissed", () => {
  test("the outro-end handler resets the tab", () => {
    expect(landing).toMatch(/function onOutroEnd\(\)\s*\{\s*activeTab = "projects";/);
  });

  test("the handler is actually bound to the transitioning element", () => {
    expect(landing).toContain("onoutroend={onOutroEnd}");
  });

  test("the transition that fires `outroend` is still there", () => {
    // The reset is deliberately coupled to the fade: `outroend` is dispatched
    // by the transition runtime, so dropping `transition:` would silently
    // strand the tab on Help. If the transition moves or changes, this test
    // is the prompt to re-home the reset rather than lose it.
    const section = landing.slice(landing.indexOf('<section\n    class="landing"'));
    const openTag = section.slice(0, section.indexOf(">"));
    expect(openTag).toMatch(/transition:fade/);
    expect(openTag).toContain("onoutroend={onOutroEnd}");
  });
});

describe("start-screen copy", () => {
  test("no 'Welcome back' greeting over the continue card", () => {
    // Owner request 2026-07-30: the card already names the book it is
    // offering to reopen. The first-run hero stays — with nothing to
    // continue, the screen still has to introduce itself.
    expect(landing).not.toContain("Welcome back");
    expect(landing).toContain("Welcome to Gutterpress");
  });
});
