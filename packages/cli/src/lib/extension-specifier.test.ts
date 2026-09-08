import { describe, test, expect } from "bun:test";

import {
  BUNDLED_EXTENSIONS,
  isPathSpecifier,
  parseExtensionSpecifier,
  pinnedNpmSpecifier,
} from "./extension-specifier";
import { BUILTIN_OPTIONAL_PLUGINS } from "./markdown/renderer";

describe("extension specifiers (#265)", () => {
  test("the bundled list and the renderer's bundled registry are the same five names", () => {
    expect(([...BUNDLED_EXTENSIONS] as string[]).sort()).toEqual(Object.keys(BUILTIN_OPTIONAL_PLUGINS).sort());
  });

  test("./, ../, / and a drive letter are paths; nothing else is", () => {
    for (const p of ["./x", "../x", "/abs/x", "C:\\x", "c:/x"]) {
      expect(isPathSpecifier(p)).toBe(true);
    }
    for (const n of ["x", "@scope/x", "plugins/x.js", "markdown-it-mark", "x@1.0.0"]) {
      expect(isPathSpecifier(n)).toBe(false);
    }
  });

  test("parses the three kinds, trimming whitespace", () => {
    expect(parseExtensionSpecifier("./extensions/house")).toEqual({
      kind: "path",
      path: "./extensions/house",
    });
    expect(parseExtensionSpecifier("../shared/dc-design-guide")).toEqual({
      kind: "path",
      path: "../shared/dc-design-guide",
    });
    expect(parseExtensionSpecifier("markdown-it-mark")).toEqual({
      kind: "bundled",
      name: "markdown-it-mark",
    });
    expect(parseExtensionSpecifier("markdown-it-footnote")).toEqual({
      kind: "npm",
      name: "markdown-it-footnote",
    });
    expect(parseExtensionSpecifier("@dimm-city/components@2.1.0")).toEqual({
      kind: "npm",
      name: "@dimm-city/components",
      version: "2.1.0",
    });
    expect(parseExtensionSpecifier(" markdown-it-footnote@4.0.0 ")).toEqual({
      kind: "npm",
      name: "markdown-it-footnote",
      version: "4.0.0",
    });
  });

  test("a bare relative path is refused with the ./ spelling to use", () => {
    expect(() => parseExtensionSpecifier("plugins/my-plugin.js")).toThrow(
      /write it as "\.\/plugins\/my-plugin\.js"/,
    );
    expect(() => parseExtensionSpecifier("extensions/house")).toThrow(
      /write it as "\.\/extensions\/house"/,
    );
    expect(() => parseExtensionSpecifier("my-plugin.mjs")).toThrow(/write it as "\.\/my-plugin\.mjs"/);
  });

  test("a pinned bundled name, an invalid npm name, and an empty string are refused", () => {
    expect(() => parseExtensionSpecifier("markdown-it-mark@1.0.0")).toThrow(/bundled with Gutterpress/);
    expect(() => parseExtensionSpecifier("Not A Name")).toThrow(/not a valid npm package name/);
    expect(() => parseExtensionSpecifier("   ")).toThrow(/specifier is required/);
  });

  test("pinnedNpmSpecifier spells the pin the way npm does", () => {
    expect(pinnedNpmSpecifier("@scope/x", "1.2.3")).toBe("@scope/x@1.2.3");
    expect(parseExtensionSpecifier(pinnedNpmSpecifier("markdown-it-footnote", "4.0.0"))).toEqual({
      kind: "npm",
      name: "markdown-it-footnote",
      version: "4.0.0",
    });
  });
});
