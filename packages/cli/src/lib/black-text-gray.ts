/**
 * K-only black text for PDF/X (#331).
 *
 * PRINT-SPEC GAP: print vendors (DriveThruRPG) require body text to print on
 * the black plate alone (100% K). Chromium writes every text fill as
 * DeviceRGB (`r g b rg`), and the Ghostscript pass in `convertToPdfxCmyk`
 * sends all RGB through the output ICC, so `#000` text lands as four-colour
 * rich black (~47/42/40/100). Ghostscript keeps DeviceGray as gray, which
 * maps to K only — so before that pass, near-black RGB that paints TEXT is
 * rewritten to DeviceGray black. Standard PDF operators in, standard PDF
 * operators out; nothing here is engine-private.
 *
 * REMOVAL TRIGGER: Chromium emitting DeviceGray/DeviceCMYK for black text, or
 * Ghostscript gaining a text-only RGB-black → K mapping (`-dBlackText` and
 * `Text_RGB None` do not do this, measured).
 *
 * What Chromium emits (measured): colour is set with one `r g b RG r g b rg`
 * line directly BEFORE a `BT` block and simply stays in effect afterwards, so
 * the same colour also paints whatever follows `ET` (rules, text-decoration
 * rectangles). Those non-text fills must keep their colour. So the rewrite is
 * scoped to `BT`…`ET`: on entering a text object whose inherited fill/stroke
 * is near-black RGB we emit `0 g`/`0 G`, and at `ET` we put the original RGB
 * back. A near-black `rg`/`RG` set inside the block is rewritten the same way.
 * Page content streams and Form XObjects are both processed; a Form's
 * inherited (pre-`Do`) colour is unknowable from its own stream, so only
 * colours set inside the form are considered.
 *
 * Known limit: text-decoration rectangles (underline/strike) are `re f` after
 * `ET`, i.e. non-text painting, and stay rich black.
 */

// Fixed on purpose (no config knob): the reporter's verified test. Warm inks
// such as #1a1512 qualify; anything visibly coloured does not.
import type { PDFRawStream as RawStream, PDFRef as Ref } from "pdf-lib";

const MAX_CHANNEL = 0.12;
const MAX_SPREAD = 0.04;

type Rgb = [number, number, number];
/** A DeviceRGB colour: parsed channels plus the operand text as authored. */
type Colour = { rgb: Rgb; raw: string };

function isNearBlack([r, g, b]: Rgb): boolean {
  const max = Math.max(r, g, b);
  return max <= MAX_CHANNEL && max - Math.min(r, g, b) <= MAX_SPREAD;
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set("()<>[]{}/%".split("").map((c) => c.charCodeAt(0)));

interface Tok {
  text: string;
  start: number;
  end: number;
  /** true for a bare keyword (operator); false for operands */
  op: boolean;
}

/** Minimal PDF content-stream tokenizer (operands are kept opaque). */
function* tokenize(s: string): Generator<Tok> {
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (WS.has(c)) { i++; continue; }
    const start = i;
    if (c === 0x25) { // % comment
      while (i < n && s[i] !== "\n" && s[i] !== "\r") i++;
      continue;
    }
    if (c === 0x28) { // ( string )
      let depth = 0;
      while (i < n) {
        const d = s[i++];
        if (d === "\\") i++;
        else if (d === "(") depth++;
        else if (d === ")" && --depth === 0) break;
      }
      yield { text: s.slice(start, i), start, end: i, op: false };
      continue;
    }
    if (c === 0x3c && s[i + 1] === "<") { i += 2; yield { text: "<<", start, end: i, op: false }; continue; }
    if (c === 0x3e && s[i + 1] === ">") { i += 2; yield { text: ">>", start, end: i, op: false }; continue; }
    if (c === 0x3c) { // <hex>
      while (i < n && s[i] !== ">") i++;
      i++;
      yield { text: s.slice(start, i), start, end: i, op: false };
      continue;
    }
    if (c === 0x5b || c === 0x5d || c === 0x3e || c === 0x7b || c === 0x7d || c === 0x29) {
      i++;
      yield { text: s[start]!, start, end: i, op: false };
      continue;
    }
    i++;
    while (i < n && !WS.has(s.charCodeAt(i)) && !DELIM.has(s.charCodeAt(i))) i++;
    const text = s.slice(start, i);
    const isOperand = c === 0x2f || /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text);
    yield { text, start, end: i, op: !isOperand };
    if (text === "ID") { // inline image data is raw bytes: skip to its EI
      const m = /\sEI(?=\s|$)/g;
      m.lastIndex = i;
      const hit = m.exec(s);
      i = hit ? hit.index + hit[0].length : n;
    }
  }
}

/**
 * Rewrite near-black RGB fill/stroke to DeviceGray black inside BT…ET of one
 * content stream. Pure string → string; returns the input when nothing changed.
 */
export function rewriteBlackText(src: string): string {
  // Logical (as authored) colour state; null = not a known DeviceRGB colour.
  let fill: Colour | null = null;
  let stroke: Colour | null = null;
  const stack: [Colour | null, Colour | null][] = [];
  let inText = false;
  // Within a text object: the gray we emitted differs from the logical colour.
  let fillDirty = false;
  let strokeDirty = false;

  const edits: { start: number; end: number; text: string }[] = [];
  let operands: Tok[] = [];

  const rgbOf = (): Colour | null => {
    if (operands.length !== 3) return null;
    const v = operands.map((t) => Number(t.text));
    return v.some((x) => Number.isNaN(x))
      ? null
      : { rgb: v as Rgb, raw: operands.map((t) => t.text).join(" ") };
  };

  for (const t of tokenize(src)) {
    if (!t.op) { operands.push(t); continue; }
    const op = t.text;
    switch (op) {
      case "q": stack.push([fill, stroke]); break;
      case "Q": { const p = stack.pop(); if (p) [fill, stroke] = p; break; }
      case "BT":
        inText = true;
        fillDirty = strokeDirty = false;
        {
          let ins = "";
          if (fill && isNearBlack(fill.rgb)) { ins += " 0 g"; fillDirty = true; }
          if (stroke && isNearBlack(stroke.rgb)) { ins += " 0 G"; strokeDirty = true; }
          if (ins) edits.push({ start: t.end, end: t.end, text: ins });
        }
        break;
      case "ET":
        if (inText) {
          let ins = "";
          if (fillDirty && fill) ins += `${fill.raw} rg `;
          if (strokeDirty && stroke) ins += `${stroke.raw} RG `;
          if (ins) edits.push({ start: t.start, end: t.start, text: ins });
        }
        inText = false;
        break;
      case "rg":
      case "RG": {
        const c = rgbOf();
        const isFill = op === "rg";
        if (isFill) fill = c; else stroke = c;
        if (inText && c && isNearBlack(c.rgb)) {
          edits.push({ start: operands[0]!.start, end: t.end, text: isFill ? "0 g" : "0 G" });
          if (isFill) fillDirty = true; else strokeDirty = true;
        } else if (inText) {
          if (isFill) fillDirty = false; else strokeDirty = false;
        }
        break;
      }
      // Any other fill/stroke colour setter makes the logical colour non-RGB.
      case "g": case "k": case "sc": case "scn": case "cs":
        fill = null; if (inText) fillDirty = false; break;
      case "G": case "K": case "SC": case "SCN": case "CS":
        stroke = null; if (inText) strokeDirty = false; break;
    }
    operands = [];
  }
  return applyEdits(src, edits);
}

function applyEdits(s: string, edits: { start: number; end: number; text: string }[]): string {
  if (!edits.length) return s;
  let out = "";
  let pos = 0;
  for (const e of edits) {
    out += s.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  return out + s.slice(pos);
}

/**
 * Apply {@link rewriteBlackText} to every page content stream and Form XObject
 * of a PDF. Returns the input bytes untouched when nothing needed rewriting.
 */
export async function blackTextToGray(pdf: Uint8Array): Promise<Uint8Array> {
  const { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFRef, decodePDFRawStream } =
    await import("pdf-lib");
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const ctx = doc.context;
  const SKIP = ["Filter", "DecodeParms", "Length"].map((k) => PDFName.of(k));
  let changed = false;

  const decode = (s: RawStream): string | null => {
    try {
      return Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
    } catch {
      return null; // unsupported filter: leave the stream alone
    }
  };
  const replace = (
    ref: Ref,
    old: RawStream,
    text: string
  ) => {
    const entries: Record<string, any> = {};
    for (const [k, v] of old.dict.entries()) if (!SKIP.includes(k)) entries[k.decodeText()] = v;
    ctx.assign(ref, ctx.flateStream(Buffer.from(text, "latin1"), entries));
    changed = true;
  };

  // Form XObjects (Chromium/Skia draws much page content through these).
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(PDFName.of("Subtype")) !== PDFName.of("Form")) continue;
    const text = decode(obj);
    if (text === null) continue;
    const next = rewriteBlackText(text);
    if (next !== text) replace(ref, obj, next);
  }

  // Page content: one or many streams, treated as one logical stream.
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const refs: Ref[] = [];
    if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const r = contents.get(i);
        if (r instanceof PDFRef) refs.push(r);
      }
    } else if (contents instanceof PDFRawStream) {
      const r = page.node.get(PDFName.of("Contents"));
      if (r instanceof PDFRef) refs.push(r);
    }
    const streams = refs.map((r) => ctx.lookup(r));
    if (!refs.length || !streams.every((s) => s instanceof PDFRawStream)) continue;
    const parts = streams.map((s) => decode(s as RawStream));
    if (parts.some((p) => p === null)) continue;
    const joined = (parts as string[]).join("\n");
    const next = rewriteBlackText(joined);
    if (next === joined) continue;
    replace(refs[0]!, streams[0] as RawStream, next);
    page.node.set(PDFName.of("Contents"), refs[0]!);
  }

  return changed ? doc.save({ updateFieldAppearances: false }) : pdf;
}
