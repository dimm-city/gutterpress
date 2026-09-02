/**
 * SFE-P2b Lane B — turns a `ChipPlan` (plain data, `plan.ts`) into a real
 * `CustomBlockRendering` DOM tree. This is the ONLY module under
 * `src/gutterpress/**` that touches `document`/DOM element types — kept
 * separate from `match.ts`/`plan.ts` precisely so those two stay importable
 * (and testable, under plain `bun:test` with no DOM global) without ever
 * reaching this file. See `match.ts`'s header for the full rationale.
 *
 * SANITIZATION MECHANISM (D12; run spec: "do NOT hand-roll a sanitizer"):
 * every string this module renders from source-controlled or
 * pipeline-generated content — a raw-html block's own bytes, a generated
 * view's HTML — is written via `Text` nodes / `.textContent` ONLY, never
 * `.innerHTML`, never `DOMParser`, never any markup-parsing API. Setting
 * `.textContent` cannot execute a `<script>` tag or an `onerror`-bearing
 * attribute: the browser never parses the string as markup at all, so
 * there is no sanitizer to write or get wrong — the content is INERT BY
 * CONSTRUCTION, not by an allowlist that could have a gap. This is the
 * deliberately-safe interim named in the run spec: rich, trust-aware
 * raw-html/plugin rendering is P2c/P3 host work (D12); this run's inactive
 * rendering is always a plain, safe SOURCE PREVIEW.
 *
 * SEGMENTS (marker-family blocks only — see `plan.ts`'s header): one real
 * DOM `Text` node per character of `plan.sourceText`, each its own
 * length-1 `SourceSegment`, reusing the exact pattern
 * `tests/vscode-adapter/custom-view/support/entry.ts`'s `"segmented-text"`
 * mode proved live in `fork-hook.btest.ts` (caret entry lands INSIDE the
 * chip at the exact expected offset, matching keyboard-navigation
 * precision on drag).
 *
 * `md-block` (run spec: "the fork host-applies it now but the provider
 * sets its own classes too"): the fork's own `renderCustomBlock` call site
 * already applies `md-block` to whatever `dom` this module returns (per
 * `CustomBlockRendering.dom`'s own doc comment in
 * `packages/vscode-markdown-editor/dist/index.d.ts`: "The host adds the
 * `md-block` class to this element itself"). This module sets it anyway —
 * redundant (`classList.add` is idempotent) but documents, at the call
 * site, exactly which class every `.gp-block-chip`-scoped style and this
 * package's own DOM queries depend on, mirroring the SAME redundancy the
 * P1b2 fork patch itself adopted for the identical reason (see
 * `tests/vscode-adapter/custom-view/support/entry.ts`'s own comment on the
 * same call).
 *
 * PLUGIN-REGION (SFE-P2c): the raw-html branch above ("no segments... the
 * P1b2 bare-dom fallback... rendered as an inert source preview") is reused
 * VERBATIM for `plugin-region` — both kinds share `editMode: "source"`
 * (`plan.ts`'s own "PLUGIN-REGION (SFE-P2c)" header section explains why),
 * so `plan.segmented` is `false` for either and this function never
 * branches on `plan.block.kind` for that decision, or for anything else —
 * the kind label (`plan.block.kind`), the CSS modifier class
 * (`${CHIP_ROOT_CLASS}--${plan.block.kind}`), and `viewAttributes`
 * rendering below are already fully generic. The SAME `.textContent`-only
 * inertness this header documents above therefore applies unchanged to a
 * project plugin's own consumed source — including a `<script>` payload
 * embedded in it, or in one of its `viewAttributes` — with no new
 * sanitization code and no new attack surface. `tests/gutterpress/
 * plugin-region.btest.ts` (SFE-P2c) proves this live: a plugin-region chip
 * carrying a `<script>` payload in both its source text and a view
 * attribute never executes it, exactly like the existing raw-html proof in
 * `gutterpress.btest.ts`.
 */
import type { CustomBlockRendering, SourceSegment } from "@dimm-city/vscode-markdown-editor";
import type { ChipPlan } from "./plan.ts";

/** Root class every chip element carries; also the CSS/test-query prefix for every part below it. */
export const CHIP_ROOT_CLASS = "gp-block-chip";

function el(doc: Document, tag: string, className: string): HTMLElement {
  const created = doc.createElement(tag);
  created.className = className;
  return created;
}

/**
 * A labelled, read-only, INERT text preview: `html` is written via
 * `.textContent` only (see this module's header) — a `<script>` or
 * `onerror`-bearing payload renders as literal, non-executing visible
 * text, never parsed markup.
 */
function renderInertPreview(doc: Document, label: string, html: string, extraClass: string): HTMLElement {
  const wrap = el(doc, "div", `${CHIP_ROOT_CLASS}__preview ${extraClass}`);
  const labelEl = el(doc, "div", `${CHIP_ROOT_CLASS}__preview-label`);
  labelEl.textContent = label;
  const pre = doc.createElement("pre");
  pre.className = `${CHIP_ROOT_CLASS}__preview-source`;
  pre.textContent = html;
  wrap.append(labelEl, pre);
  return wrap;
}

/**
 * Materializes `plan` into a real `CustomBlockRendering`. `doc` is threaded
 * in explicitly (never the bare `document` global) so a mount inside an
 * iframe/isolated document — `mountGutterpressEditor`'s own `container.ownerDocument`
 * (see `mount.ts`) — gets ITS OWN document's elements, matching
 * `web/mount.ts`'s identical iframe-safety convention for CSS injection.
 */
export function renderChipPlan(plan: ChipPlan, doc: Document): CustomBlockRendering {
  const dom = el(doc, "div", `md-block ${CHIP_ROOT_CLASS} ${CHIP_ROOT_CLASS}--${plan.block.kind}`);
  dom.dataset["gpBlockKind"] = plan.block.kind;

  const kindLabel = el(doc, "div", `${CHIP_ROOT_CLASS}__kind`);
  kindLabel.textContent = plan.block.kind;
  dom.appendChild(kindLabel);

  let segments: SourceSegment[] | undefined;
  if (plan.segmented) {
    // Marker family: per-character segments over the WHOLE sourceText (the
    // P1b2 "segmented-text" pattern — see this module's header).
    const sourceEl = el(doc, "div", `${CHIP_ROOT_CLASS}__source`);
    segments = [];
    for (let i = 0; i < plan.sourceText.length; i++) {
      const charNode = doc.createTextNode(plan.sourceText[i] ?? "");
      sourceEl.appendChild(charNode);
      segments.push({ dom: charNode, start: i, length: 1 });
    }
    dom.appendChild(sourceEl);
  } else {
    // raw-html/plugin-region (or any future non-"structured" kind): the
    // P1b2 bare-dom fallback — no segments, caret entry lands at the
    // block's own start — rendered as an inert source preview (see this
    // module's header on sanitization). `plan.inactivePreviewText` (SFE-P2c
    // repair round 1 — see `plan.ts`'s own header) prefers the pipeline's
    // own rendered fragment over the raw authored text when the projection
    // supplies one; still written via `.textContent` only, so the
    // script-payload inertness proof is unaffected by WHICH string this is.
    const pre = doc.createElement("pre");
    pre.className = `${CHIP_ROOT_CLASS}__source ${CHIP_ROOT_CLASS}__source--inert`;
    pre.textContent = plan.inactivePreviewText;
    dom.appendChild(pre);
    if (plan.renderedHtml !== undefined) {
      // The book's own output for this block (a project plugin's rendering,
      // or the author's raw HTML) as real DOM, so the editor shows what the
      // PDF shows. Scripts, event handlers and javascript: URLs are stripped
      // — this HTML renders inside the app's own document, not the preview
      // iframe.
      dom.appendChild(renderSanitizedHtml(doc, plan.renderedHtml, `${CHIP_ROOT_CLASS}__rendered`));
    }
  }

  if (plan.block.viewAttributes) {
    const attrsEl = el(doc, "div", `${CHIP_ROOT_CLASS}__attrs`);
    for (const [key, value] of Object.entries(plan.block.viewAttributes)) {
      const badge = el(doc, "span", `${CHIP_ROOT_CLASS}__attr`);
      badge.dataset["attrName"] = key;
      // Inert text badge (AP-06 view metadata) — never interactive, never
      // written back to source.
      badge.textContent = `${key}="${value}"`;
      attrsEl.appendChild(badge);
    }
    dom.appendChild(attrsEl);
  }

  // Generated-view previews (D6/G-04/AP-13): read-only, inert, and NEVER
  // given segments — there is no writable range to map a caret into
  // (GeneratedView has no from/to at the type level; see plan.ts).
  for (const html of plan.generatedPreviews) {
    dom.appendChild(
      renderInertPreview(doc, "Generated preview (read-only)", html, `${CHIP_ROOT_CLASS}__generated`),
    );
  }

  return segments ? { dom, segments } : { dom };
}

const BLOCKED_TAGS = new Set(["SCRIPT", "IFRAME", "OBJECT", "EMBED", "FRAME", "LINK", "META", "BASE"]);

function renderSanitizedHtml(doc: Document, html: string, className: string): HTMLElement {
  const wrap = el(doc, "div", className);
  const tpl = doc.createElement("template");
  tpl.innerHTML = html;
  const walker = doc.createTreeWalker(tpl.content, 1 /* NodeFilter.SHOW_ELEMENT */);
  const doomed: Element[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node as Element;
    if (BLOCKED_TAGS.has(element.tagName)) {
      doomed.push(element);
      continue;
    }
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on") || ((name === "href" || name === "src" || name === "xlink:href") && value.startsWith("javascript:"))) {
        element.removeAttribute(attr.name);
      }
    }
  }
  for (const element of doomed) element.remove();
  wrap.appendChild(tpl.content);
  return wrap;
}

/**
 * `@end-section` — the marker grammar's one explicit closer. It projects no
 * block of its own (it produces no token), so it is rendered from its text:
 * a muted chip with per-character segments, editable like any marker line.
 */
export function renderCloseMarkerChip(doc: Document, sourceText: string): CustomBlockRendering {
  return renderSourceOnlyChip(doc, sourceText, "end-section", "end");
}

/**
 * A raw HTML tag that opens or closes a container the author wrote by hand
 * (`<div class="colophon-grid">` … `</div>`). The wrapper itself is mounted
 * by `groupBlocks`, so the tag's own block is source and nothing else — the
 * book's HTML has no box here either. Locked, this chip is dropped like any
 * other authoring affordance; unlocked it names what the line does.
 */
export function renderContainerTagChip(doc: Document, sourceText: string): CustomBlockRendering {
  return renderSourceOnlyChip(doc, sourceText, "html-container", "html");
}

/** A chip that shows only its own source, character by character so the fork can map a caret into it. */
function renderSourceOnlyChip(doc: Document, sourceText: string, variant: string, label: string): CustomBlockRendering {
  const dom = el(doc, "div", `md-block ${CHIP_ROOT_CLASS} ${CHIP_ROOT_CLASS}--${variant}`);
  dom.dataset["gpBlockKind"] = variant;
  const kindLabel = el(doc, "div", `${CHIP_ROOT_CLASS}__kind`);
  kindLabel.textContent = label;
  dom.appendChild(kindLabel);
  const sourceEl = el(doc, "div", `${CHIP_ROOT_CLASS}__source`);
  const segments: SourceSegment[] = [];
  for (let i = 0; i < sourceText.length; i++) {
    const charNode = doc.createTextNode(sourceText[i] ?? "");
    sourceEl.appendChild(charNode);
    segments.push({ dom: charNode, start: i, length: 1 });
  }
  dom.appendChild(sourceEl);
  return { dom, segments };
}
