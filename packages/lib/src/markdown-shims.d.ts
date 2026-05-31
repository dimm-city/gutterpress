declare module "*.md" {
  const content: string;
  export default content;
}

// `with { type: "file" }` imports resolve to a path string at build time.
// TypeScript doesn't model the type attribute, so declare non-standard
// extensions explicitly. JS and JSON have TS-known shapes and are cast at
// the use site via filePath() in embedded-assets.ts.
declare module "*.ico" { const path: string; export default path; }
declare module "*.css" { const path: string; export default path; }
declare module "*.icc" { const path: string; export default path; }
