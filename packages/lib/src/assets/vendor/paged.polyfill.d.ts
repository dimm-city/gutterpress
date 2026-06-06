// paged.polyfill.js is imported only via `with { type: "file" }` (it resolves
// to a path string, never executed as a module here). This sibling declaration
// lets `tsc` treat it as an opaque string asset and skip declaration-emitting
// the bundled third-party source (which trips TS9005 on internal private names).
declare const path: string;
export default path;
