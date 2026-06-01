// The lib ships no .d.ts yet (see docs/build-pipeline-followups.md). main.ts
// dynamic-imports it and casts the result to its own LibModule interface, so an
// untyped module declaration is all that's needed for the electron typecheck.
declare module "@dimm-city/print-md-lib";
