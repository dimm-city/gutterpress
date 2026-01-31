# Removing Paged.js: Standardizing on Vivliostyle + Prince

> **Status: COMPLETED**
> This migration has been completed. This document is preserved for historical reference and to document the architectural decisions made.

This document outlines the steps that were taken to remove Paged.js from print-md and standardize on:
- **Vivliostyle Viewer** for preview
- **Prince XML** for print-ready PDF export

## Current State

The codebase currently supports multiple engines:
- **Paged.js** (default preview engine via polyfill injection)
- **Vivliostyle** (alternative preview engine via embedded viewer)
- **pagedjs-cli** (PDF generation via Chromium headless)
- **Prince** (PDF generation for CMYK/PDF/X)

## Target State

After this migration:
- **Vivliostyle** is the only preview engine
- **Prince** is the only PDF engine
- No engine selection abstraction needed (simpler code)
- Smaller bundle size (no Paged.js polyfill)

---

## Phase 1: Remove Paged.js Preview Engine

### 1.1 Remove Paged.js Assets

Delete the following files from `src/assets/preview/scripts/`:

```bash
rm src/assets/preview/scripts/paged.polyfill.js
rm src/assets/preview/scripts/interface.js
```

### 1.2 Remove Engine Abstraction

The engine abstraction was designed for multi-engine support. With only Vivliostyle, simplify to direct usage.

**Delete the entire engines directory:**

```bash
rm -rf src/preview/engines/
```

**Files removed:**
- `src/preview/engines/types.ts`
- `src/preview/engines/registry.ts`
- `src/preview/engines/pagedjs-engine.ts`
- `src/preview/engines/vivliostyle-engine.ts`
- `src/preview/engines/index.ts`
- `src/preview/engines/engines.test.ts`

### 1.3 Update Server Context

**File:** `src/preview/server-context.ts`

Remove the `currentEngine` field from `ServerState`:

```typescript
// REMOVE this line from ServerState interface
currentEngine: PreviewEngineId;

// REMOVE this line from createServerState function
currentEngine: options.engine || 'pagedjs',
```

Remove the `PreviewEngineId` import:

```typescript
// CHANGE
import type { PreviewServerOptions, PreviewEngineId } from '../types.ts';

// TO
import type { PreviewServerOptions } from '../types.ts';
```

### 1.4 Update Types

**File:** `src/types.ts`

Remove the `PreviewEngineId` type:

```typescript
// DELETE this block
/**
 * Preview engine identifier
 */
export type PreviewEngineId = 'pagedjs' | 'vivliostyle';
```

Remove the `engine` field from `PreviewServerOptions`:

```typescript
// REMOVE this line from PreviewServerOptions
engine?: PreviewEngineId;
```

### 1.5 Update File Watcher

**File:** `src/preview/file-watcher.ts`

Replace engine-based HTML generation with direct Vivliostyle approach:

```typescript
// REMOVE these imports
import type { PreviewEngineId } from '../types.ts';
import { getEngineOrDefault } from './engines/index.ts';

// CHANGE the generateAndWriteHtml function signature
export async function generateAndWriteHtml(
  inputPath: string,
  tempDir: string,
  config: any
): Promise<void> {
  const htmlContent = await generateHtmlFromMarkdown(inputPath, config);

  // Vivliostyle loads HTML as-is, no script injection needed
  // Just ensure proper doctype
  let processedHtml = htmlContent;
  if (!processedHtml.trim().toLowerCase().startsWith('<!doctype')) {
    processedHtml = '<!DOCTYPE html>\n' + processedHtml;
  }

  const outputPath = path.join(tempDir, 'preview.html');
  await Bun.write(outputPath, processedHtml);
  debug(`Generated preview.html in ${tempDir}`);
}

// UPDATE the watcher callback to remove engine parameter
await generateAndWriteHtml(state.currentInputPath, state.tempDir, updatedConfig);
```

### 1.6 Update Lifecycle

**File:** `src/preview/lifecycle.ts`

Update `restartPreview` to remove engine parameter:

```typescript
// CHANGE
await generateAndWriteHtml(newInputPath, state.tempDir, updatedConfig, state.currentEngine);

// TO
await generateAndWriteHtml(newInputPath, state.tempDir, updatedConfig);
```

### 1.7 Update Server

**File:** `src/server.ts`

Remove engine selection:

```typescript
// DELETE these lines
const engineId = options.engine || 'pagedjs';

// CHANGE
await generateAndWriteHtml(inputPath, tempDir, config, engineId);

// TO
await generateAndWriteHtml(inputPath, tempDir, config);
```

### 1.8 Update API Middleware

**File:** `src/preview/api-middleware.ts`

Remove engine API and imports:

```typescript
// REMOVE these imports
import { getAllEngines, getEngine } from './engines/index.ts';
import type { PreviewEngineId } from '../types.ts';

// DELETE the handleGetEngine function entirely

// REMOVE this route handler
if (url.pathname === '/api/engine' && req.method === 'GET') {
  handleGetEngine(res, state);
  return;
}
```

### 1.9 Update CLI

**File:** `src/cli.ts`

Remove engine option from preview command:

```typescript
// REMOVE from PreviewCommandOptions interface
engine: string;

// REMOVE this option line
.option('--engine <engine>', 'Preview engine: pagedjs or vivliostyle (default: pagedjs)', 'pagedjs')

// REMOVE the engine validation block
const validEngines = ['pagedjs', 'vivliostyle'] as const;
const engine = opts.engine as typeof validEngines[number];
if (!validEngines.includes(engine)) {
  throw new ConfigError(`Invalid engine: "${opts.engine}". Valid engines: ${validEngines.join(', ')}`);
}

// REMOVE engine from startPreviewServer call
engine,

// UPDATE help text - remove this line
$ print-md preview --engine vivliostyle    # Use Vivliostyle engine
```

---

## Phase 2: Remove pagedjs-cli PDF Engine

### 2.1 Remove pagedjs-cli Wrapper

**Delete:**

```bash
rm src/build/formats/pagedjs-cli-wrapper.ts
rm src/build/formats/pdf-format.ts
```

### 2.2 Rename Prince Format to PDF

**Rename:**

```bash
mv src/build/formats/prince-pdf-format.ts src/build/formats/pdf-format.ts
mv src/build/formats/prince-cli-wrapper.ts src/build/formats/prince-wrapper.ts
```

### 2.3 Update PDF Format Strategy

**File:** `src/build/formats/pdf-format.ts`

Update the class name and imports:

```typescript
// CHANGE class name
export class PdfFormatStrategy implements FormatStrategy {
  // ... existing implementation using Prince
}

// UPDATE import path
import { generatePdfWithPrince } from './prince-wrapper.ts';
```

### 2.4 Update Build Orchestration

**File:** `src/build/build.ts`

Simplify format strategy selection:

```typescript
// REMOVE PrincePdfFormatStrategy import
import { PrincePdfFormatStrategy } from './formats/prince-pdf-format.ts';

// UPDATE imports
import { PdfFormatStrategy } from './formats/pdf-format.ts';

// SIMPLIFY getFormatStrategy - remove 'prince' case
function getFormatStrategy(format: OutputFormat): FormatStrategy {
  switch (format) {
    case 'pdf' as OutputFormat:
      return new PdfFormatStrategy();
    case 'html' as OutputFormat:
      return new HtmlFormatStrategy();
    case 'preview' as OutputFormat:
      return new PreviewFormatStrategy();
    default:
      throw new Error(`Unknown format: ${format}`);
  }
}
```

### 2.5 Update Output Format Enum

**File:** `src/types.ts`

Remove PRINCE format:

```typescript
// CHANGE
export enum OutputFormat {
  HTML = 'html',
  PDF = 'pdf',
  PREVIEW = 'preview',
  PRINCE = 'prince'
}

// TO
export enum OutputFormat {
  HTML = 'html',
  PDF = 'pdf',
  PREVIEW = 'preview'
}
```

### 2.6 Update Config Validation

**File:** `src/utils/config.ts`

Remove 'prince' from valid formats:

```typescript
// CHANGE
type ValidFormat = 'html' | 'pdf' | 'preview' | 'prince';
const validFormats: readonly ValidFormat[] = ['html', 'pdf', 'preview', 'prince'] as const;

// TO
type ValidFormat = 'html' | 'pdf' | 'preview';
const validFormats: readonly ValidFormat[] = ['html', 'pdf', 'preview'] as const;
```

### 2.7 Update CLI

**File:** `src/cli.ts`

Update format option description:

```typescript
// CHANGE
.option('--format <format>', 'Output format: html, pdf, preview, or prince (default: pdf)', 'pdf')

// TO
.option('--format <format>', 'Output format: html, pdf, or preview (default: pdf)', 'pdf')
```

---

## Phase 3: Update Preview Format Strategy

### 3.1 Simplify Preview Format

**File:** `src/build/formats/preview-format.ts`

Remove Paged.js polyfill injection:

```typescript
// DELETE the injectPagedJsPolyfill function entirely

// UPDATE build method to not inject polyfill
async build(options: BuildOptions, htmlContent: string): Promise<string> {
  // ... existing setup code ...

  // Just ensure proper doctype for Vivliostyle
  let processedHtml = htmlContent;
  if (!processedHtml.trim().toLowerCase().startsWith('<!doctype')) {
    processedHtml = '<!DOCTYPE html>\n' + processedHtml;
  }

  await writeFile(previewPath, processedHtml);

  // ... rest of method ...
}
```

---

## Phase 4: Update Preview UI

### 4.1 Simplify Preview.js

**File:** `src/assets/preview/scripts/preview.js`

The preview UI needs updates to work with Vivliostyle's embedded viewer instead of the Paged.js polyfill approach.

**Key changes:**

1. **Change iframe src to Vivliostyle viewer:**
   ```javascript
   // Instead of loading preview.html directly
   iframe.src = '/vendor/vivliostyle/index.html#src=/preview.html&renderAllPages=false&spread=auto';
   ```

2. **Update previewAPI access:**
   Vivliostyle exposes navigation differently. The `vivliostyle-interface.js` adapter bridges this gap.

3. **Remove Paged.js-specific code:**
   - Remove `PagedConfig` references
   - Remove polyfill loading checks
   - Update page navigation to use Vivliostyle's API

### 4.2 Update index.html

**File:** `src/assets/preview/index.html`

Update the iframe to point to Vivliostyle viewer:

```html
<!-- CHANGE -->
<iframe id="preview-frame" src="preview.html"></iframe>

<!-- TO -->
<iframe id="preview-frame" src="/vendor/vivliostyle/index.html#src=/preview.html"></iframe>
```

---

## Phase 5: Cleanup and Testing

### 5.1 Remove Unused Dependencies

**File:** `package.json`

Check if `pagedjs` or `pagedjs-cli` are listed as dependencies and remove them:

```bash
bun remove pagedjs pagedjs-cli
```

### 5.2 Update Tests

- Delete any tests specific to Paged.js engine
- Update integration tests to expect Prince for PDF output
- Update preview tests to expect Vivliostyle behavior

### 5.3 Update Documentation

**Files to update:**
- `CLAUDE.md` - Remove Paged.js references, update architecture section
- `README.md` - Update installation/usage instructions
- Any other docs referencing engine selection

### 5.4 Verify Prince Installation

Add a helpful error message when Prince is not installed:

```typescript
// In prince-wrapper.ts
if (!isInstalled) {
  throw new BuildError(
    'Prince XML is required for PDF generation.\n' +
    'Install from: https://www.princexml.com/download/\n' +
    'Or use Docker: docker run -v $(pwd):/docs princexml/prince /docs/book.html -o /docs/output.pdf'
  );
}
```

---

## Summary of Files to Delete

```
src/assets/preview/scripts/paged.polyfill.js
src/assets/preview/scripts/interface.js
src/preview/engines/                          (entire directory)
src/build/formats/pagedjs-cli-wrapper.ts
src/build/formats/pdf-format.ts               (old version, replaced by Prince)
```

## Summary of Files to Modify

```
src/types.ts                    - Remove PreviewEngineId, PRINCE format
src/preview/server-context.ts   - Remove currentEngine
src/preview/file-watcher.ts     - Remove engine abstraction
src/preview/lifecycle.ts        - Remove engine parameter
src/preview/api-middleware.ts   - Remove engine API
src/server.ts                   - Remove engine selection
src/cli.ts                      - Remove --engine option, update --format
src/utils/config.ts             - Remove 'prince' format
src/build/build.ts              - Remove prince format case
src/build/formats/preview-format.ts  - Remove polyfill injection
src/assets/preview/scripts/preview.js - Update for Vivliostyle
src/assets/preview/index.html   - Update iframe src
```

## Testing Checklist

After completing the migration:

- [ ] `bun test` - All tests pass
- [ ] `bun run type-check` - No type errors
- [ ] `print-md preview` - Opens Vivliostyle viewer correctly
- [ ] `print-md build --format pdf` - Generates PDF with Prince
- [ ] `print-md build --format html` - Generates standalone HTML
- [ ] `print-md build --format preview` - Generates offline preview
- [ ] Page navigation works in preview
- [ ] Spread view works in preview
- [ ] Debug mode works in preview
- [ ] Folder switching works in preview
- [ ] PDF includes proper pagination
- [ ] PDF/X profiles work (if specified)

---

## Rollback Plan

If issues are encountered, the current dual-engine implementation can be kept by:
1. Not deleting any files
2. Keeping `--engine pagedjs` as the default
3. Marking Vivliostyle as experimental

The engine abstraction provides a clean separation that makes this safe.
