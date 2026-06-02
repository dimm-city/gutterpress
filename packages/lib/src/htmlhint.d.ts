// htmlhint ships no type declarations at its package root (its package.json has
// no "types"/"exports" field, so a bare `import { HTMLHint } from "htmlhint"`
// resolves to the untyped dist/htmlhint.js main). The real declarations live
// under dist/core; re-export them here so the bare import is fully typed while
// the runtime import path stays the documented package root.
declare module "htmlhint" {
  export * from "htmlhint/dist/core/core";
}
