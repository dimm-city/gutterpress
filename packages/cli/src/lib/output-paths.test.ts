import { describe, test, expect } from "bun:test";
import path from "node:path";
import { bookSlug, resolveOutputDir, artifactName } from "./output-paths";

describe("bookSlug", () => {
  test("slugifies a title", () => {
    expect(bookSlug("My Great Book!")).toBe("my-great-book");
  });

  test("falls back to 'book' when a title has no slug-able characters", () => {
    expect(bookSlug("!!!")).toBe("book");
    expect(bookSlug("")).toBe("book");
    expect(bookSlug(undefined)).toBe("book");
  });

  test("strips diacritics rather than dropping the word", () => {
    expect(bookSlug("Café Noir")).toBe("cafe-noir");
  });
});

describe("resolveOutputDir", () => {
  test("is <manifestDir>/dist/<slug>", () => {
    expect(resolveOutputDir("/p", "My Book")).toBe(path.resolve("/p/dist/my-book"));
  });

  test("two books in ONE tree get separate directories with no configuration", () => {
    // This is the case a single shared `dist` could never handle, no matter how
    // the old `output.dir` was configured.
    expect(resolveOutputDir("/tree/book-01", "Dragon Heist")).not.toBe(
      resolveOutputDir("/tree/book-02", "Design Guide")
    );
  });

  test("anchors on the manifest dir, not the process CWD", () => {
    expect(resolveOutputDir("/elsewhere/proj", "B")).toBe(
      path.resolve("/elsewhere/proj/dist/b")
    );
  });
});

describe("artifactName", () => {
  test("encodes the format in the name", () => {
    expect(artifactName("Dragon Heist", "pdf")).toBe("dragon-heist-pdf.pdf");
    expect(artifactName("Dragon Heist", "pdfx")).toBe("dragon-heist-pdfx.pdf");
  });

  test("pdf and pdfx never collide, so both can ship side by side", () => {
    // Previously both formats shared ONE configured `output.filename`, so
    // building both left only the last one on disk.
    expect(artifactName("B", "pdf")).not.toBe(artifactName("B", "pdfx"));
  });
});
