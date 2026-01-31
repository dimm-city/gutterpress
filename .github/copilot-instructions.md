# Copilot Instructions for print-md

## Project Overview
**print-md** is a Bun-based CLI tool that converts markdown to professional print-ready PDFs using Prince XML for PDF generation and Vivliostyle for live preview. It features a sophisticated build pipeline with format strategies, extensible markdown plugins, and a dual-server preview architecture.

## Core Architecture

### Build Pipeline (Strategy Pattern)
The build system uses strategy pattern in `src/build/formats/`:
- **PdfFormatStrategy**: Generates PDF via Prince XML typesetter
- **HtmlFormatStrategy**: Outputs standalone HTML with inlined assets

All strategies implement `FormatStrategy` interface with `build()` and `validateOutput()` methods.

### Configuration Cascade (CLI > Manifest > Defaults)
Configuration flows through `ConfigurationManager` in `src/config/config-state.ts`:
1. CLI options override everything
2. `manifest.yaml` provides project defaults
3. Application defaults from `src/constants.ts`

**Key files**: Input directory + `manifest.yaml` defines styles, extensions, file order, page format.

### Dual-Server Preview Architecture
Preview mode (`src/server.ts`) runs two servers:
- **Bun Server** (user port): Toolbar UI, API endpoints, reverse proxy to Vite
- **Vite Server** (auto port): Serves preview.html with HMR in temp directory

Request flow: `User → Bun (toolbar) → Vite (preview content + HMR)`

## Development Patterns

### Bun-First Development
- Use `Bun.file()`, `Bun.write()` over Node.js equivalents
- Asset bundling: `import ... with { type: 'text' }` for inline assets
- Tests: `bun:test` with `describe`, `it`, `expect` (see `src/utils/*.test.ts`)

### Error Handling
Custom error hierarchy in `src/utils/errors.ts`:
- `BuildError`: Build pipeline failures
- `ConfigError`: Configuration/manifest issues
- `ValidationError`: Path/input validation

### CSS Resolution Pipeline
Critical for theme customization (`src/utils/css-utils.ts`):
1. Default styles (optional via `disableDefaultStyles`)
2. User styles from `manifest.yaml` styles array
3. Two-tier resolution: bundled themes → user directory
4. Recursive `@import` inlining with circular detection

## Key Commands & Workflows

### Development
```bash
# Build from source (development)
bun src/cli.ts build ./examples/dc-rules

# Preview with live reload
bun src/cli.ts preview ./examples/dc-rules --verbose --debug

# Run tests
bun test
bun test src/utils/css-utils.test.ts --watch
```

### Asset Changes Require Server Restart
**Critical**: Changes to `src/assets/` require server restart - assets are bundled at startup.

## Extensibility Points

### Adding Markdown Plugins
1. Create plugin in `src/markdown/plugins/` following markdown-it plugin pattern
2. Register in `createPagedMarkdownEngine()` in `src/markdown/markdown.ts`
3. Add CSS to `src/assets/plugins/` if needed
4. Update `MarkdownExtensionOptions` interface in `src/types.ts`
5. Enable via `manifest.yaml` extensions array

Example plugin structure (see `ttrpg-directives-plugin.ts`):
```typescript
export default function myPlugin(md: MarkdownIt, options?: PluginOptions) {
  md.inline.ruler.before('emphasis', 'my_rule', parseFunction);
}
```

### Adding Build Formats
1. Implement `FormatStrategy` interface in `src/build/formats/`
2. Add to format strategy map in `src/build/build.ts`
3. Update `OutputFormat` enum in `src/types.ts`
4. Add CLI option in `src/cli.ts`

## Critical Implementation Details

### Temporary Directory Management
- Preview mode: `/tmp/print-md-preview-*` (auto-cleanup)
- PDF build: `.tmp/[basename]/` in working directory
- Debug mode preserves temp files for inspection

### Path Security
All file operations go through `src/utils/path-security.ts` with:
- Directory traversal prevention
- Home directory boundary enforcement
- Unicode normalization and symlink resolution

### Extension Configuration
`manifest.yaml` extensions array controls markdown plugins:
- `ttrpg`: TTRPG directives (stat blocks, dice notation)
- `dimmCity`: Dimm City syntax (district badges, roll prompts)
- `containers`: Legacy container syntax
- Empty/omitted = all plugins enabled

## File Organization Conventions
- **Types**: Centralized in `src/types.ts` with JSDoc
- **Constants**: Application-wide values in `src/constants.ts`
- **Utils**: Reusable functions in `src/utils/` with comprehensive tests
- **Assets**: Bundled resources in `src/assets/` (themes, scripts, fonts)
- **Formats**: Build strategies in `src/build/formats/`
- **Plugins**: Markdown extensions in `src/markdown/plugins/`

When working with this codebase, always consider the configuration cascade, use Bun-native APIs, and test changes with both build and preview modes.