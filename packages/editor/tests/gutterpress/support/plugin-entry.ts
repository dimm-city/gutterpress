import { createEditorProjection, createMarkdownRenderer, type GutterpressProjection } from "gutterpress/render";
import { MemoryDocumentHost } from "../../../src/core/index.ts";
import { mountGutterpressEditor, type GutterpressEditorMount } from "../../../src/gutterpress/mount.ts";
import { asideMarkerPlugin } from "./plugin-fixture.ts";

/**
 * SFE-P2c Lane C — the browser-side scenario driver for
 * `../plugin-region.btest.ts`. Sibling of `./entry.ts` (SFE-P2b's own
 * driver for `../gutterpress.btest.ts`) — deliberately a SEPARATE file
 * rather than an extension of that one: `entry.ts` backs an
 * ALREADY-APPROVED suite whose every fixture depends on `buildProjection`
 * calling `createEditorProjection(text, { sourceVersion })` with NO `md`/
 * `trusted` (the untrusted, plugin-free default) — widening that function's
 * signature risks disturbing behavior that file's own tests pin. This file
 * instead composes the SAME production entry points (`createEditorProjection`,
 * `mountGutterpressEditor` — never a second hand-wired mount) with a
 * plugin-applied `md` and `trusted: true`, proving the SFE-P2c plugin-region
 * views against the real fork exactly the way `entry.ts` proves the P2b
 * marker/raw-html/generated-view ones.
 *
 * Own global name (`window.__gpGutterpressPlugin`, own `__gpPluginScriptRan`
 * flag) for the same reason `entry.ts`'s header documents: `src/gutterpress/
 * tsconfig.json`'s "include" pulls every browser test entry it lists into
 * ONE TypeScript program, so two different `declare global` shapes under
 * the same name would collide.
 */

export interface MountResult {
  readonly containerSelector: string;
}

export interface ChipInfo {
  readonly kind: string;
  readonly className: string;
  readonly textContent: string;
  readonly gpBlockKind: string | undefined;
}

declare global {
  interface Window {
    __gpGutterpressPlugin: GutterpressPluginDriver;
    __gpReady?: boolean;
    /** Poisoned by a plugin-region's own embedded `<script>` payload IF it ever executes -- must stay `false` throughout every case in this suite. */
    __gpPluginScriptRan?: boolean;
  }
}

export interface GutterpressPluginDriver {
  /**
   * Builds a REAL projection from `text` via `createEditorProjection` with a
   * `createMarkdownRenderer([asideMarkerPlugin(keepEvidence)])` instance and
   * `trusted: true`, then mounts through the real, production
   * `mountGutterpressEditor` — backed by a fresh `MemoryDocumentHost` seeded
   * with the SAME `text` at version 0, matching `entry.ts`'s own `mount`
   * convention (`sourceVersion: 0`, matching the host's initial version).
   */
  mount(text: string, keepEvidence: boolean): MountResult;
  dispose(): void;

  getHostText(): string;
  getHostVersion(): number;
  /** G-11 -- true once the LIVE host's version has moved past the mounted projection's own `sourceVersion`. */
  needsRefresh(): boolean;

  /** Every `.md-block` element in the mounted document, in order. */
  blockCount(): number;
  blockClassName(index: number): string;
  /** `textContent` of the i-th `.md-block` -- used to prove a REFUSED region still renders its own real text (never silently dropped), not merely that it lacks a chip class. */
  blockTextContent(index: number): string;

  /** Every `.gp-block-chip` element in the mounted document, in order. */
  chipCount(): number;
  chipInfo(index: number): ChipInfo;
  /** `outerHTML` of the i-th `.gp-block-chip` -- used to inspect a plugin-region chip's inert source preview text directly (proof of textContent-only construction: a literal `<script>` renders escaped). */
  chipOuterHTML(index: number): string;
}

const CONTAINER_ID = "gp-gutterpress-plugin-mount";

let mountHandle: GutterpressEditorMount | undefined;
let host: MemoryDocumentHost | undefined;

function buildProjection(text: string, keepEvidence: boolean): GutterpressProjection {
  const md = createMarkdownRenderer([asideMarkerPlugin(keepEvidence)]);
  return createEditorProjection(text, { sourceVersion: 0, md, trusted: true });
}

function doMount(text: string, keepEvidence: boolean): MountResult {
  mountHandle?.dispose();
  document.getElementById(CONTAINER_ID)?.remove();

  host = new MemoryDocumentHost({ text, version: 0 });
  const projection = buildProjection(text, keepEvidence);

  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  document.body.appendChild(container);

  mountHandle = mountGutterpressEditor(container, host, { projection });

  return { containerSelector: `#${CONTAINER_ID}` };
}

function requireHost(): MemoryDocumentHost {
  if (!host) throw new Error("plugin-region harness: mount() has not been called yet");
  return host;
}

function blockElements(): HTMLElement[] {
  const root = document.getElementById(CONTAINER_ID);
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(".md-document > .md-block"));
}

function chipElements(): HTMLElement[] {
  const root = document.getElementById(CONTAINER_ID);
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(".gp-block-chip"));
}

function requireChip(index: number): HTMLElement {
  const el = chipElements()[index];
  if (!el) throw new Error(`plugin-region harness: no chip at index ${index}`);
  return el;
}

window.__gpPluginScriptRan = false;

window.__gpGutterpressPlugin = {
  mount: (text: string, keepEvidence: boolean) => doMount(text, keepEvidence),
  dispose(): void {
    mountHandle?.dispose();
  },

  getHostText: () => requireHost().getSnapshot().text,
  getHostVersion: () => requireHost().getSnapshot().version,
  needsRefresh: () => {
    if (!mountHandle) throw new Error("plugin-region harness: mount() has not been called yet");
    return mountHandle.needsRefresh();
  },

  blockCount: () => blockElements().length,
  blockClassName(index: number): string {
    const el = blockElements()[index];
    if (!el) throw new Error(`plugin-region harness: no block at index ${index}`);
    return el.className;
  },
  blockTextContent(index: number): string {
    const el = blockElements()[index];
    if (!el) throw new Error(`plugin-region harness: no block at index ${index}`);
    return el.textContent ?? "";
  },

  chipCount: () => chipElements().length,
  chipInfo(index: number): ChipInfo {
    const el = requireChip(index);
    return {
      kind: el.dataset["gpBlockKind"] ?? "",
      className: el.className,
      textContent: el.textContent ?? "",
      gpBlockKind: el.dataset["gpBlockKind"],
    };
  },
  chipOuterHTML: (index: number) => requireChip(index).outerHTML,
};
window.__gpReady = true;
