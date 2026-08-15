/** Which attribute KEYS ride on which token types, and how many are authored? */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { md } from "./harness.ts";

const REPO = new URL("../../../", import.meta.url).pathname;
const BOOKS = [
  "examples/gutterpress-user-guide",
  "examples/gutterwire-zine",
  "examples/with-validation",
  "examples/with-design-guide/book-01",
  "examples/with-design-guide/book-02",
  "examples/with-design-guide/design-guide",
  "docs/fixtures/css-authoring-spike/book",
];

/** Attrs the token intrinsically owns — not authored `{...}` braces. */
const INTRINSIC: Record<string, Set<string>> = {
  image: new Set(["src", "alt", "title"]),
  link_open: new Set(["href", "title"]),
};

const byKey = new Map<string, number>();
const byType = new Map<string, number>();

const authored = (t: any) =>
  (t.attrs ?? []).filter(
    ([k]: [string]) => !(INTRINSIC[t.type] ?? new Set()).has(k) && !k.startsWith("data-"),
  );

const walk = (toks: any[]) => {
  for (const t of toks) {
    const kept = authored(t);
    if (kept.length) {
      byType.set(t.type, (byType.get(t.type) ?? 0) + 1);
      for (const [k] of kept) byKey.set(`${t.type}.${k}`, (byKey.get(`${t.type}.${k}`) ?? 0) + 1);
    }
    if (t.children) walk(t.children);
  }
};

for (const b of BOOKS)
  for (const f of readdirSync(join(REPO, b)).filter((f) => f.endsWith(".md")))
    walk(md.parse(readFileSync(join(REPO, b, f), "utf8"), {}));

console.log("authored attrs by token.key:");
for (const [k, n] of [...byKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25))
  console.log(`  ${k.padEnd(30)} ${n}`);
console.log(`\ntotal token types carrying authored attrs: ${byType.size}`);
