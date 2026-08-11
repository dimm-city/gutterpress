/**
 * CSS `content` value parsing + evaluation, shared by the viewer's decoration
 * layer and the compiler's Tier 2/3 synthesis so both produce byte-identical
 * header/footer/cross-reference text from the same author declaration.
 *
 * Handles exactly what the proposal shims: literals, counter(), string(),
 * target-counter(), target-text(), leader(), attr(), content().
 */
import { splitTopLevel } from "./gcpm-extract.ts";

export type ContentPart =
  | { type: "literal"; value: string }
  | { type: "counter"; name: string; style: string }
  | { type: "string"; name: string; which: string }
  | { type: "target-counter"; url: string; counter: string; style: string }
  | { type: "target-text"; url: string; which: string }
  | { type: "leader"; glue: string }
  | { type: "attr"; name: string; as?: string }
  | { type: "content"; which: string }
  | { type: "keyword"; value: string };

export interface EvalContext {
  /** 1-based page number of the page being rendered */
  page?: number;
  /** total page count */
  pages?: number;
  /** named string lookup, GCPM `string(name, which)` */
  strings?: (name: string, which: string) => string | undefined;
  /** `target-counter(url, page)` -> 1-based page of the target */
  targetPage?: (url: string) => number | undefined;
  /** `target-text(url)` -> text of the target */
  targetText?: (url: string, which: string) => string | undefined;
  /** the element the declaration hangs off (for attr()/content()) */
  attr?: (name: string) => string | undefined;
  /**
   * leader() support: return placeholder text for a leader with this glue
   * string (the renderers insert a marker here and later replace it with a
   * measured run of glue). Absent = leaders render as nothing.
   */
  leader?: (glue: string) => string;
  text?: string;
}

const FUNC = /^([a-z-]+)\(/i;

export function parseContent(value: string): ContentPart[] {
  const parts: ContentPart[] = [];
  let i = 0;
  const s = value.trim();
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = closeString(s, i);
      parts.push({ type: "literal", value: unquote(s.slice(i, end)) });
      i = end;
      continue;
    }
    const rest = s.slice(i);
    const fn = FUNC.exec(rest);
    if (fn && fn[1] !== undefined) {
      const open = i + fn[0].length - 1;
      const close = matchParen(s, open);
      const args = splitTopLevel(s.slice(open + 1, close), ",");
      parts.push(toPart(fn[1].toLowerCase(), args));
      i = close + 1;
      continue;
    }
    const word = /^[^\s"']+/.exec(rest)![0];
    parts.push({ type: "keyword", value: word });
    i += word.length;
  }
  return parts;
}

function toPart(name: string, args: string[]): ContentPart {
  switch (name) {
    case "counter":
      return { type: "counter", name: args[0] ?? "page", style: args[1] ?? "decimal" };
    case "string":
      return { type: "string", name: args[0] ?? "", which: args[1] ?? "first" };
    case "target-counter":
      return {
        type: "target-counter",
        url: args[0] ?? "",
        counter: args[1] ?? "page",
        style: args[2] ?? "decimal",
      };
    case "target-text":
      return { type: "target-text", url: args[0] ?? "", which: args[1] ?? "content" };
    case "leader":
      return { type: "leader", glue: unquote(args[0] ?? '"."') };
    case "attr": {
      const [a, as] = (args[0] ?? "").split(/\s+/);
      return { type: "attr", name: a ?? "", as };
    }
    case "content":
      return { type: "content", which: args[0] ?? "text" };
    default:
      return { type: "keyword", value: `${name}(${args.join(",")})` };
  }
}

function closeString(s: string, i: number): number {
  const q = s[i++];
  while (i < s.length) {
    if (s[i] === "\\") i += 2;
    else if (s[i] === q) return i + 1;
    else i++;
  }
  return i;
}

function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      i = closeString(s, i) - 1;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return s.length - 1;
}

export function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
    return t.slice(1, -1).replace(/\\(.)/g, "$1");
  return t;
}

/** `attr(href url)` inside target-counter() -> the element's href. */
export function resolveUrlArg(arg: string, ctx: EvalContext): string {
  const m = /^attr\(\s*([\w-]+)(?:\s+url)?\s*\)$/i.exec(arg.trim());
  if (m && m[1] !== undefined) return ctx.attr?.(m[1]) ?? "";
  return unquote(arg);
}

const ROMAN: Array<[number, string]> = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

export function formatCounter(n: number, style = "decimal"): string {
  switch (style.trim()) {
    case "decimal-leading-zero":
      return n < 10 ? `0${n}` : String(n);
    case "lower-roman":
    case "upper-roman": {
      let v = n;
      let out = "";
      for (const [num, sym] of ROMAN) while (v >= num) (out += sym), (v -= num);
      return style === "upper-roman" ? out.toUpperCase() : out;
    }
    case "lower-alpha":
    case "upper-alpha": {
      let v = n;
      let out = "";
      while (v > 0) {
        const r = (v - 1) % 26;
        out = String.fromCharCode(97 + r) + out;
        v = Math.floor((v - 1) / 26);
      }
      return style === "upper-alpha" ? out.toUpperCase() : out;
    }
    case "none":
      return "";
    default:
      return String(n);
  }
}

export function evaluateContent(parts: ContentPart[], ctx: EvalContext): string {
  let out = "";
  for (const p of parts) {
    switch (p.type) {
      case "literal":
        out += p.value;
        break;
      case "counter":
        out += formatCounter(
          p.name === "pages" ? (ctx.pages ?? 0) : (ctx.page ?? 0),
          p.style,
        );
        break;
      case "string":
        out += ctx.strings?.(p.name, p.which) ?? "";
        break;
      case "target-counter": {
        const url = resolveUrlArg(p.url, ctx);
        const page = ctx.targetPage?.(url);
        out += page === undefined ? "?" : formatCounter(page, p.style);
        break;
      }
      case "target-text": {
        const url = resolveUrlArg(p.url, ctx);
        out += ctx.targetText?.(url, p.which) ?? "";
        break;
      }
      case "attr":
        out += ctx.attr?.(p.name) ?? "";
        break;
      case "content":
        out += ctx.text ?? "";
        break;
      case "leader":
        // A real leader needs layout: the renderer that knows the line's free
        // space supplies ctx.leader and later replaces the marker with a
        // measured run of glue. With no hook it renders as nothing.
        out += ctx.leader?.(p.glue) ?? "";
        break;
      case "keyword":
        if (p.value === "normal" || p.value === "none") break;
        out += p.value;
        break;
    }
  }
  return out;
}

export function evaluate(value: string, ctx: EvalContext): string {
  return evaluateContent(parseContent(value), ctx);
}

/** Does this content value need Tier 3 (measurement)? */
export function needsMeasurement(value: string): boolean {
  return parseContent(value).some(
    (p) => p.type === "target-counter" || p.type === "target-text" || p.type === "leader",
  );
}
