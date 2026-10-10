/**
 * K-only black text for PDF/X (#331, #336).
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
 * Page content streams and Form XObjects are both processed.
 *
 * Size threshold (#336): DriveThruRPG recommends rich black for text LARGER
 * than 24pt, so only text at or below {@link LARGE_TEXT_PT} is rewritten. The
 * effective size is `Tf` size × the text matrix's scale (`Tm`) × the CTM's
 * scale (`cm`, restored by `q`/`Q`) — each reduced to √|det| of its 2×2, so
 * rotation and flips do not matter and anisotropic scaling is averaged.
 * `Tz`/`Ts` are ignored. A Form XObject's stream cannot know the CTM it is
 * drawn under, so the page pass records the CTM at each `Do` and the form is
 * sized from that (the smallest, if drawn more than once — K-only large text
 * is harmless, rich small text is not). A form reached any other way (nested
 * in another form, unreferenced) has unknown scale and is treated as small.
 * A `Tf` inside a text object re-evaluates, so one `BT` can switch between
 * K-only and rich as the size crosses the threshold.
 *
 * Underline / strike-through (#336): Chromium (tagged PDF, which the engine
 * always requests) wraps each text run and its decoration in one marked-content
 * span (`/NonStruct <</MCID n>> BDC … EMC`) and paints the decoration as a thin
 * `x y w h re f` outside `BT…ET`. A near-black such rect, thinner than a fifth
 * of the span's small text, is wrapped `q 0 g … Q` so it prints K-only like the
 * text it decorates. A rect outside any span, or in a span with no small text
 * (rules, borders, large headings), is left alone — nothing is guessed.
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
 * DriveThruRPG: black text LARGER than this (in points) may be rich black;
 * at or below it, it must be K-only.
 */
export const LARGE_TEXT_PT = 24;
// Float slack so 32px × 0.75 (= 24pt, give or take a ulp of matrix maths) counts as 24.
const SIZE_EPS = 0.05;

const area = (m: number[]) => Math.sqrt(Math.abs(m[0]! * m[3]! - m[1]! * m[2]!));

/**
 * Effective text size in points, from the operators that decide it: `cm`
 * (nested by `q`/`Q`), `BT`/`Tm` and `Tf`. See the module doc for the model.
 */
class TextScale {
  private font = 0;
  private tm = 1;
  private stack: [number, number][] = [];
  constructor(private ctm: number) {}

  /** The CTM's scale: what a user-space length is worth in points. */
  get unit(): number { return this.ctm; }
  /** Effective size of the text being drawn, in points. */
  get size(): number { return this.font * this.tm * this.ctm; }

  /** Feed one operator; returns true when {@link size} may have changed. */
  op(op: string, nums: number[]): boolean {
    switch (op) {
      case "q": this.stack.push([this.ctm, this.font]); return false;
      case "Q": { const p = this.stack.pop(); if (p) [this.ctm, this.font] = p; return true; }
      case "cm": if (nums.length === 6) this.ctm *= area(nums); return true;
      case "BT": this.tm = 1; return true;
      case "Tm": if (nums.length === 6) this.tm = area(nums); return true;
      case "Tf": this.font = Math.abs(nums[nums.length - 1] ?? 0) || 0; return true;
    }
    return false;
  }
}

/** What a stream's caller knows that the stream itself cannot. */
export interface ContentContext {
  /** Scale in effect where the stream starts: 1 for a page, the invoking CTM for a form. 0 = unknown (treated as small). */
  baseScale?: number;
  /** Called for each `Do` with the XObject's resource name and the CTM scale there. */
  onDo?: (name: string, scale: number) => void;
}

type Edit = { start: number; end: number; text: string };

interface Span {
  hasSmall: boolean;
  maxSmall: number;
  /** thin near-black rects seen in this span: edit positions and thickness (pt) */
  rects: { start: number; end: number; thickness: number }[];
}

/**
 * Rewrite near-black RGB fill/stroke to DeviceGray black inside BT…ET of one
 * content stream, for text at or below {@link LARGE_TEXT_PT}, plus the thin
 * decoration rects in that text's marked-content span. Pure string → string;
 * returns the input when nothing changed.
 */
export function rewriteBlackText(src: string, ctx: ContentContext = {}): string {
  // Logical (as authored) colour state; null = not a known DeviceRGB colour.
  let fill: Colour | null = null;
  let stroke: Colour | null = null;
  const stack: [Colour | null, Colour | null][] = [];
  const scale = new TextScale(ctx.baseScale ?? 1);
  let inText = false;
  // Within a text object: the gray we emitted differs from the logical colour.
  let fillDirty = false;
  let strokeDirty = false;
  const spans: Span[] = [];
  let lastOp = "";
  let rect: { start: number; thickness: number } | null = null;

  const edits: Edit[] = [];
  let operands: Tok[] = [];

  const rgbOf = (): Colour | null => {
    if (operands.length !== 3) return null;
    const v = operands.map((t) => Number(t.text));
    return v.some((x) => Number.isNaN(x))
      ? null
      : { rgb: v as Rgb, raw: operands.map((t) => t.text).join(" ") };
  };
  const isSmall = () => scale.size <= LARGE_TEXT_PT + SIZE_EPS;

  // Make the emitted colour match the logical one for the CURRENT size: gray
  // while small, the authored RGB once large. `at` is where to insert. The `0 g`
  // put in at BT (before the Tf that sizes the run is known) is taken back out,
  // not restored over, if the size turns out large before anything is shown.
  let fillIns: Edit | null = null;
  let strokeIns: Edit | null = null;
  const syncOne = (
    colour: Colour | null, dirty: boolean, ins: Edit | null, at: number, gray: string, op: string
  ): [boolean, Edit | null] => {
    if (!colour || !isNearBlack(colour.rgb)) return [dirty, ins];
    const small = isSmall();
    if (small && !dirty) {
      const e = { start: at, end: at, text: ` ${gray}` };
      edits.push(e);
      return [true, e];
    }
    if (!small && dirty) {
      if (ins) ins.text = "";
      else edits.push({ start: at, end: at, text: ` ${colour.raw} ${op}` });
      return [false, null];
    }
    return [dirty, ins];
  };
  const sync = (at: number) => {
    [fillDirty, fillIns] = syncOne(fill, fillDirty, fillIns, at, "0 g", "rg");
    [strokeDirty, strokeIns] = syncOne(stroke, strokeDirty, strokeIns, at, "0 G", "RG");
  };

  const flush = (s: Span) => {
    for (const r of s.rects) {
      if (r.thickness > 0.2 * s.maxSmall) continue;
      edits.push({ start: r.start, end: r.start, text: "q 0 g " }, { start: r.end, end: r.end, text: " Q" });
    }
  };

  for (const t of tokenize(src)) {
    if (!t.op) { operands.push(t); continue; }
    const op = t.text;
    const nums = operands.map((o) => Number(o.text));
    const sizeMayHaveChanged = scale.op(op, nums);
    switch (op) {
      case "q": stack.push([fill, stroke]); break;
      case "Q": { const p = stack.pop(); if (p) [fill, stroke] = p; break; }
      case "BT":
        inText = true;
        fillDirty = strokeDirty = false;
        fillIns = strokeIns = null;
        sync(t.end);
        break;
      case "Tf": case "Tm":
        if (inText && sizeMayHaveChanged) sync(t.end);
        break;
      case "ET":
        if (inText) {
          let ins = "";
          if (fillDirty && fill) ins += `${fill.raw} rg `;
          if (strokeDirty && stroke) ins += `${stroke.raw} RG `;
          if (ins) edits.push({ start: t.start, end: t.start, text: ins });
        }
        inText = false;
        fillIns = strokeIns = null;
        break;
      case "rg":
      case "RG": {
        const c = rgbOf();
        const isFill = op === "rg";
        if (isFill) fill = c; else stroke = c;
        if (inText && c && isNearBlack(c.rgb) && isSmall()) {
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
      case "Do": {
        const name = operands[operands.length - 1]?.text;
        if (name?.startsWith("/")) ctx.onDo?.(name.slice(1), scale.unit);
        break;
      }
      case "BDC": case "BMC": spans.push({ hasSmall: false, maxSmall: 0, rects: [] }); break;
      case "EMC": {
        const s = spans.pop();
        if (!s) break;
        const parent = spans[spans.length - 1];
        if (s.hasSmall) flush(s); else parent?.rects.push(...s.rects);
        if (parent && s.hasSmall) {
          parent.hasSmall = true;
          parent.maxSmall = Math.max(parent.maxSmall, s.maxSmall);
        }
        break;
      }
      case "Tj": case "TJ": case "'": case '"': {
        fillIns = strokeIns = null; // shown: the colour is committed
        const span = spans[spans.length - 1];
        if (span && inText && isSmall()) {
          span.hasSmall = true;
          span.maxSmall = Math.max(span.maxSmall, scale.size);
        }
        break;
      }
      case "re":
        rect = !inText && fill && isNearBlack(fill.rgb) && operands.length === 4 && nums.every((x) => !Number.isNaN(x))
          ? { start: operands[0]!.start, thickness: Math.min(Math.abs(nums[2]!), Math.abs(nums[3]!)) * scale.unit }
          : null;
        break;
      case "f": case "F": case "f*":
        // a decoration is exactly `x y w h re f` — anything between disqualifies
        if (rect && lastOp === "re") spans[spans.length - 1]?.rects.push({ ...rect, end: t.end });
        break;
    }
    lastOp = op;
    operands = [];
  }
  return applyEdits(src, edits);
}

function applyEdits(s: string, edits: Edit[]): string {
  if (!edits.length) return s;
  // Decoration edits are decided at EMC, after later positions were recorded.
  // Array#sort is stable, so same-position insertions keep their order.
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let pos = 0;
  for (const e of edits) {
    out += s.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  return out + s.slice(pos);
}

// ---------------------------------------------------------------------------
// PDF traversal
// ---------------------------------------------------------------------------

/**
 * Hand every page content stream, then every Form XObject stream, to `visit`
 * (which may return replacement text). Pages come first: they record the CTM
 * each form is drawn under, which {@link rewriteBlackText} needs to size the
 * form's text. Returns whether any stream was replaced.
 */
async function visitContent(
  doc: import("pdf-lib").PDFDocument,
  visit: (src: string, info: ContentContext) => string
): Promise<boolean> {
  const { PDFName, PDFRawStream, PDFArray, PDFRef, PDFDict, decodePDFRawStream } = await import("pdf-lib");
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
  const replace = (ref: Ref, old: RawStream, text: string) => {
    const entries: Record<string, any> = {};
    for (const [k, v] of old.dict.entries()) if (!SKIP.includes(k)) entries[k.decodeText()] = v;
    ctx.assign(ref, ctx.flateStream(Buffer.from(text, "latin1"), entries));
    changed = true;
  };

  // form ref -> smallest CTM scale it is drawn under
  const formScale = new Map<string, number>();

  const formMatrixScale = (form: RawStream): number => {
    const m = form.dict.lookupMaybe(PDFName.of("Matrix"), PDFArray);
    const nums = m?.asArray().map((n: any) => Number(n.toString()));
    return nums?.length === 6 && !nums.some(Number.isNaN) ? area(nums) : 1;
  };

  // Page content: one or many streams, treated as one logical stream.
  const pages = doc.getPages();
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p]!;
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
    if (parts.some((q) => q === null)) continue;
    const joined = (parts as string[]).join("\n");
    const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    const next = visit(joined, {
      baseScale: 1,
      onDo: (name, scale) => {
        const ref = xobjects?.get(PDFName.of(name));
        const form = ref instanceof PDFRef ? ctx.lookup(ref) : undefined;
        if (!(ref instanceof PDFRef) || !(form instanceof PDFRawStream)) return;
        if (form.dict.get(PDFName.of("Subtype")) !== PDFName.of("Form")) return;
        const at = scale * formMatrixScale(form);
        formScale.set(ref.tag, Math.min(formScale.get(ref.tag) ?? Infinity, at));
      },
    });
    if (next === joined) continue;
    replace(refs[0]!, streams[0] as RawStream, next);
    page.node.set(PDFName.of("Contents"), refs[0]!);
  }

  // Form XObjects (Chromium/Skia draws much page content through these).
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(PDFName.of("Subtype")) !== PDFName.of("Form")) continue;
    const text = decode(obj);
    if (text === null) continue;
    const next = visit(text, {
      baseScale: formScale.get(ref.tag) ?? 0,
    });
    if (next !== text) replace(ref, obj, next);
  }
  return changed;
}

/**
 * Apply {@link rewriteBlackText} to every page content stream and Form XObject
 * of a PDF. Returns the input bytes untouched when nothing needed rewriting.
 */
export async function blackTextToGray(pdf: Uint8Array): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const changed = await visitContent(doc, (src, info) => rewriteBlackText(src, info));
  return changed ? doc.save({ updateFieldAppearances: false }) : pdf;
}
