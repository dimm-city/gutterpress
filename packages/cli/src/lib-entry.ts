// Library entry for `@dimm-city/print-md` when consumed under the `bun` export
// condition (dev + tests). It re-exports the full runtime of the internal source
// package `@dimm-city/print-md-lib` so bun consumers resolve types and values
// straight from source — no build step required.
//
// The published/node build (`default` condition → dist/index.js) is produced by
// scripts/build-npm.ts as a self-contained bundle; this file is only the
// source-resolution path. See docs/runtime-lib-update-plan.md.
export * from "@dimm-city/print-md-lib";
