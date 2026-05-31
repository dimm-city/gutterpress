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

// Untyped stylelint config presets — we inline their `rules` (see
// stylelint/stylelint.config.ts) to avoid runtime `extends` resolution.
declare module "stylelint-config-standard" {
  const config: { rules: Record<string, unknown> };
  export default config;
}
declare module "stylelint-config-recommended" {
  const config: { rules: Record<string, unknown> };
  export default config;
}
