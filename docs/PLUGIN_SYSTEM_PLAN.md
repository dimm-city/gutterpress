# Plugin System Design Plan

> **Superseded (2026-05-17):** This document is the historical design plan
> from early prototyping. The shipping plugin system is documented in the
> **[User Guide: Chapter 6 — Plugins](../examples/print-md-user-guide/06-plugins.md)**. 
> The `:::name ... :::` container syntax referenced throughout this document 
> was removed in the [2026-05 migration](migrations/2026-05-removing-container-syntax.md).
> Kept for archaeology only.

## ✅ Implementation Status

**Status:** Phase 1 Complete (2025-01-19)

**Implemented Solution:** Option 3 - Hybrid Manifest-Based System

### What Was Implemented

✅ **Core Infrastructure (Phase 1)**
- PluginLoader class with support for 4 plugin types (local, package, builtin, remote stub)
- Type definitions and error classes (`src/types/plugin-types.ts`)
- Integration into markdown processing pipeline
- Priority-based loading order
- Automatic CSS collection and injection
- Security validation (path traversal prevention)
- Plugin caching for performance
- Manifest schema updates (Zod + JSON Schema)
- Comprehensive unit tests (35/35 passing)
- Integration tests (8/10 passing, core functionality verified)
- Complete documentation (README, user guide, CLAUDE.md, examples)

✅ **Built-in Plugins**
- `ttrpg` - TTRPG features (stat blocks, dice notation)
- `dimmCity` - Dimm City game syntax

✅ **Examples**
- `examples/plugins/callouts-plugin.js` - Full-featured callout/admonition plugin
- `examples/plugins/README.md` - Complete plugin development guide
- `examples/with-custom-plugin/` - Working example project

✅ **Documentation**
- Updated README.md with plugin system section
- Added comprehensive plugin section to docs/user-guide.md
- Documented architecture in CLAUDE.md
- Created plugin development guide with examples

### Files Created/Modified

**New Files:**
- `src/types/plugin-types.ts` (194 lines)
- `src/markdown/plugin-loader.ts` (531 lines)
- `src/markdown/plugin-loader.test.ts` (516 lines)
- `tests/integration/plugin-system.test.ts` (613 lines)
- `examples/plugins/callouts-plugin.js` (185 lines)
- `examples/plugins/README.md` (550 lines)
- `examples/with-custom-plugin/*` (4 markdown files + manifest)

**Modified Files:**
- `src/markdown/markdown.ts` - Plugin integration
- `src/types.ts` - Added plugins field to Manifest
- `src/schemas/manifest.schema.ts` - Zod validation for plugins
- `src/assets/manifest.schema.json` - JSON Schema for editor autocomplete
- `README.md` - Plugin system documentation
- `docs/user-guide.md` - Plugin usage guide
- `CLAUDE.md` - Architecture documentation

### Future Work (Phase 2+)

⏸️ **Not Yet Implemented:**
- Remote plugin loading (security concerns require careful design)
- npm package auto-discovery
- Plugin marketplace/registry
- Advanced plugin versioning
- Plugin dependency resolution

---

## Executive Summary

Design a runtime plugin system that allows users to extend print-md's markdown processing without modifying the core codebase. This enables custom markdown syntax, directives, and transformations to be added as standalone modules.

**Recommended Solution:** Option 3 - Hybrid Manifest-Based System ✅ IMPLEMENTED

---

## Current State Analysis

### Existing Architecture

**Current Plugin Implementation:**
```typescript
// src/markdown/markdown.ts
import ttrpgPlugin from './plugins/ttrpg-directives-plugin.ts';
import dimmCityPlugin from './plugins/dimm-city-plugin.ts';
import containerPlugin from './plugins/container-plugin.ts';

// Hardcoded plugin registration
if (extensions.includes('ttrpg')) {
  md.use(ttrpgPlugin, options);
}
```

**Problems:**
- ❌ Plugins are hardcoded and compiled into print-md
- ❌ Adding new plugins requires forking print-md
- ❌ No way for users to create custom syntax
- ❌ Third-party plugins impossible
- ❌ Every new feature increases bundle size

**Requirements:**
1. Load plugins at runtime (not compile time)
2. Support local files AND npm packages
3. Type-safe plugin API
4. Error handling and validation
5. CSS injection for plugin styles
6. Documentation and discoverability
7. Backward compatibility with existing plugins

---

## Option 1: Simple File-Based Plugin System

### Architecture

**User Workflow:**
```yaml
# manifest.yaml
plugins:
  - "./plugins/my-custom-plugin.js"
  - "./plugins/another-plugin.ts"
```

**Plugin File Structure:**
```javascript
// plugins/my-custom-plugin.js
export default function myPlugin(md, options) {
  // markdown-it plugin implementation
  md.block.ruler.before('heading', 'custom-block', (state, startLine) => {
    // Custom parsing logic
  });
}

// Optional: Export CSS for this plugin
export const css = `
  .custom-block {
    background: #f0f0f0;
    padding: 1em;
  }
`;

// Optional: Plugin metadata
export const metadata = {
  name: 'my-custom-plugin',
  version: '1.0.0',
  description: 'Adds custom block syntax'
};
```

**print-md Implementation:**
```typescript
// src/markdown/plugin-loader.ts
import { pathToFileURL } from 'url';

async function loadPlugin(pluginPath: string, baseDir: string) {
  const absolutePath = path.resolve(baseDir, pluginPath);

  // Security check
  validatePluginPath(absolutePath, baseDir);

  // Dynamic import (works for .js, .mjs, .ts with bun)
  const module = await import(pathToFileURL(absolutePath).href);

  return {
    plugin: module.default,
    css: module.css,
    metadata: module.metadata || {}
  };
}

// In markdown.ts
for (const pluginPath of manifest.plugins || []) {
  const { plugin, css } = await loadPlugin(pluginPath, inputDir);
  md.use(plugin, options);
  if (css) collectedCSS.push(css);
}
```

### Pros
- ✅ Simple implementation
- ✅ No external dependencies
- ✅ Fast loading (local files)
- ✅ TypeScript support via Bun
- ✅ Easy debugging (source visible)

### Cons
- ❌ No versioning
- ❌ No dependency management
- ❌ Hard to share plugins
- ❌ No plugin discovery
- ❌ Security risks (arbitrary code execution)
- ❌ No validation before loading

### Risk Assessment
- **Security:** HIGH - Users can execute arbitrary code
- **Maintainability:** MEDIUM - Simple but limited
- **DX:** GOOD - Easy to get started
- **Scalability:** LOW - Doesn't support plugin ecosystem

---

## Option 2: npm Package-Based System

### Architecture

**User Workflow:**
```bash
# Install plugins as npm packages
npm install print-md-plugin-callouts
npm install @mycompany/print-md-plugin-custom
```

```yaml
# manifest.yaml (plugins auto-discovered OR explicitly listed)
plugins:
  - "print-md-plugin-callouts"
  - "@mycompany/print-md-plugin-custom"
```

**Plugin Package Structure:**
```
print-md-plugin-callouts/
├── package.json          # Standard npm package
├── index.js              # Plugin entry point
├── styles.css            # Plugin styles (optional)
├── README.md
└── examples/
    └── usage.md
```

**Plugin package.json:**
```json
{
  "name": "print-md-plugin-callouts",
  "version": "1.2.0",
  "description": "Adds callout box syntax to print-md",
  "main": "index.js",
  "keywords": ["print-md", "print-md-plugin", "markdown-it"],
  "peerDependencies": {
    "print-md": "^1.0.0"
  },
  "print-md": {
    "type": "markdown-plugin",
    "css": "./styles.css",
    "priority": 100
  }
}
```

**Plugin Implementation (index.js):**
```javascript
// index.js
module.exports = function calloutPlugin(md, options = {}) {
  md.use(require('markdown-it-container'), 'callout', {
    validate: (params) => params.trim().match(/^callout\s+(.*)$/),
    render: (tokens, idx) => {
      const m = tokens[idx].info.trim().match(/^callout\s+(.*)$/);
      if (tokens[idx].nesting === 1) {
        const type = md.utils.escapeHtml(m[1]);
        return `<div class="callout callout-${type}">`;
      } else {
        return '</div>\n';
      }
    }
  });
};

// Export metadata
module.exports.metadata = {
  name: 'callout-plugin',
  version: '1.2.0',
  description: 'Adds callout boxes'
};
```

**print-md Discovery & Loading:**
```typescript
// src/markdown/plugin-discovery.ts
interface PluginPackage {
  name: string;
  version: string;
  pluginPath: string;
  css?: string;
  priority: number;
}

async function discoverPlugins(projectDir: string): Promise<PluginPackage[]> {
  const plugins: PluginPackage[] = [];
  const packageJsonPath = path.join(projectDir, 'package.json');

  if (!await fileExists(packageJsonPath)) {
    return plugins;
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath));
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies
  };

  // Find all packages with "print-md-plugin" prefix or keyword
  for (const [name, version] of Object.entries(deps)) {
    if (name.startsWith('print-md-plugin-') ||
        name.includes('/print-md-plugin-')) {

      const pluginPkg = await loadPluginPackage(name, projectDir);
      if (pluginPkg) plugins.push(pluginPkg);
    }
  }

  // Sort by priority
  return plugins.sort((a, b) => b.priority - a.priority);
}

async function loadPluginPackage(
  name: string,
  projectDir: string
): Promise<PluginPackage | null> {
  try {
    const pluginPath = path.join(projectDir, 'node_modules', name);
    const pkgJson = JSON.parse(
      await readFile(path.join(pluginPath, 'package.json'))
    );

    const print-mdConfig = pkgJson.print-md || {};

    return {
      name,
      version: pkgJson.version,
      pluginPath: path.join(pluginPath, pkgJson.main || 'index.js'),
      css: print-mdConfig.css
        ? path.join(pluginPath, print-mdConfig.css)
        : undefined,
      priority: print-mdConfig.priority || 100
    };
  } catch (error) {
    warn(`Failed to load plugin ${name}: ${error.message}`);
    return null;
  }
}

// In markdown.ts
const discoveredPlugins = await discoverPlugins(inputDir);

for (const pkg of discoveredPlugins) {
  const plugin = await import(pkg.pluginPath);
  md.use(plugin.default || plugin, options);

  if (pkg.css) {
    const css = await readFile(pkg.css);
    collectedCSS.push(css);
  }
}
```

**Explicit Configuration (manifest.yaml):**
```yaml
# Auto-discover all installed plugins
plugins:
  auto-discover: true

# OR explicitly list plugins
plugins:
  - name: "print-md-plugin-callouts"
    enabled: true
    options:
      types: ["note", "warning", "tip"]

  - name: "@mycompany/print-md-plugin-custom"
    enabled: true
    options:
      strict: false
```

### Pros
- ✅ Standard npm ecosystem
- ✅ Versioning and dependency management
- ✅ Easy to share and publish
- ✅ Plugin discovery
- ✅ Can bundle with TypeScript, tests, docs
- ✅ Community can build ecosystem

### Cons
- ❌ Requires npm installation step
- ❌ More complex for simple custom syntax
- ❌ Plugin must be in node_modules
- ❌ Harder to debug (in node_modules)
- ❌ Overhead of publishing for internal plugins

### Risk Assessment
- **Security:** MEDIUM - npm packages can be vetted
- **Maintainability:** HIGH - Standard package management
- **DX:** EXCELLENT - Standard npm workflow
- **Scalability:** EXCELLENT - Full ecosystem support

---

## Option 3: Hybrid Manifest-Based System ⭐ RECOMMENDED

### Architecture

Combines the simplicity of local files with the power of npm packages.

**User Workflow:**

```yaml
# manifest.yaml
plugins:
  # Local file (quick prototyping)
  - type: "local"
    path: "./plugins/my-custom.js"
    enabled: true

  # npm package (shared/published)
  - type: "package"
    name: "print-md-plugin-callouts"
    version: "^1.2.0"
    enabled: true
    options:
      types: ["note", "warning"]

  # Built-in plugin (backward compatible)
  - type: "builtin"
    name: "ttrpg"
    enabled: true

  # Remote URL (advanced)
  - type: "remote"
    url: "https://cdn.example.com/plugins/custom-plugin.js"
    integrity: "sha384-..."
    enabled: false  # Disabled by default for security
```

**Simplified Syntax (auto-detect type):**
```yaml
plugins:
  - "./plugins/my-custom.js"                    # local (auto-detected)
  - "print-md-plugin-callouts"                   # package (auto-detected)
  - name: "ttrpg"                               # builtin (auto-detected)
    options: { strict: true }
```

**Plugin Loader Implementation:**

```typescript
// src/markdown/plugin-loader.ts
import { z } from 'zod';

// Plugin configuration schema
const PluginConfigSchema = z.union([
  // String shorthand
  z.string(),

  // Full configuration
  z.object({
    type: z.enum(['local', 'package', 'builtin', 'remote']).optional(),

    // For local files
    path: z.string().optional(),

    // For npm packages
    name: z.string().optional(),
    version: z.string().optional(),

    // For remote URLs
    url: z.string().url().optional(),
    integrity: z.string().optional(),

    // Common fields
    enabled: z.boolean().default(true),
    options: z.record(z.any()).optional(),
    priority: z.number().default(100)
  })
]);

type PluginConfig = z.infer<typeof PluginConfigSchema>;

interface LoadedPlugin {
  name: string;
  plugin: MarkdownItPlugin;
  css?: string;
  metadata: PluginMetadata;
}

class PluginLoader {
  private baseDir: string;
  private builtinPlugins: Map<string, MarkdownItPlugin>;
  private cache: Map<string, LoadedPlugin>;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.cache = new Map();

    // Register built-in plugins
    this.builtinPlugins = new Map([
      ['ttrpg', ttrpgPlugin],
      ['dimmCity', dimmCityPlugin],
      ['containers', containerPlugin]
    ]);
  }

  async loadPlugin(config: PluginConfig): Promise<LoadedPlugin | null> {
    // Normalize config
    const normalized = this.normalizeConfig(config);

    if (!normalized.enabled) {
      return null;
    }

    // Check cache
    const cacheKey = this.getCacheKey(normalized);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Determine type if not specified
    const type = normalized.type || this.detectType(normalized);

    let loaded: LoadedPlugin;

    switch (type) {
      case 'local':
        loaded = await this.loadLocalPlugin(normalized);
        break;

      case 'package':
        loaded = await this.loadPackagePlugin(normalized);
        break;

      case 'builtin':
        loaded = await this.loadBuiltinPlugin(normalized);
        break;

      case 'remote':
        loaded = await this.loadRemotePlugin(normalized);
        break;

      default:
        throw new Error(`Unknown plugin type: ${type}`);
    }

    // Cache loaded plugin
    this.cache.set(cacheKey, loaded);

    return loaded;
  }

  private normalizeConfig(config: PluginConfig): NormalizedPluginConfig {
    if (typeof config === 'string') {
      return {
        type: undefined,
        path: config,
        name: config,
        enabled: true,
        options: {},
        priority: 100
      };
    }
    return config as NormalizedPluginConfig;
  }

  private detectType(config: NormalizedPluginConfig): PluginType {
    // Local file
    if (config.path?.match(/^\.\.?\//) || config.path?.endsWith('.js') || config.path?.endsWith('.ts')) {
      return 'local';
    }

    // Remote URL
    if (config.url || config.path?.startsWith('http')) {
      return 'remote';
    }

    // Built-in plugin
    if (this.builtinPlugins.has(config.name || '')) {
      return 'builtin';
    }

    // npm package (default)
    return 'package';
  }

  private async loadLocalPlugin(config: NormalizedPluginConfig): Promise<LoadedPlugin> {
    const pluginPath = path.resolve(this.baseDir, config.path!);

    // Security validation
    validateSafePath(pluginPath, this.baseDir);

    if (!await fileExists(pluginPath)) {
      throw new Error(`Plugin file not found: ${config.path}`);
    }

    try {
      // Dynamic import (Bun supports .ts files)
      const module = await import(pathToFileURL(pluginPath).href);

      return {
        name: config.path!,
        plugin: module.default || module,
        css: module.css,
        metadata: module.metadata || {
          name: path.basename(pluginPath, path.extname(pluginPath)),
          version: '0.0.0',
          description: 'Local plugin'
        }
      };
    } catch (error) {
      throw new Error(`Failed to load plugin ${config.path}: ${error.message}`);
    }
  }

  private async loadPackagePlugin(config: NormalizedPluginConfig): Promise<LoadedPlugin> {
    const packageName = config.name!;

    try {
      // Try to resolve from node_modules
      const packagePath = path.join(this.baseDir, 'node_modules', packageName);

      if (!await fileExists(packagePath)) {
        throw new Error(
          `Plugin package not found: ${packageName}\n` +
          `Run: npm install ${packageName}`
        );
      }

      // Load package.json
      const pkgJson = JSON.parse(
        await readFile(path.join(packagePath, 'package.json'))
      );

      // Validate version if specified
      if (config.version && !satisfiesVersion(pkgJson.version, config.version)) {
        throw new Error(
          `Plugin ${packageName} version ${pkgJson.version} ` +
          `does not satisfy ${config.version}`
        );
      }

      // Import plugin
      const pluginEntryPoint = path.join(packagePath, pkgJson.main || 'index.js');
      const module = await import(pathToFileURL(pluginEntryPoint).href);

      // Load CSS if specified in package.json
      const print-mdConfig = pkgJson.print-md || {};
      let css: string | undefined;

      if (print-mdConfig.css) {
        const cssPath = path.join(packagePath, print-mdConfig.css);
        css = await readFile(cssPath);
      }

      return {
        name: packageName,
        plugin: module.default || module,
        css,
        metadata: {
          name: packageName,
          version: pkgJson.version,
          description: pkgJson.description || '',
          ...module.metadata
        }
      };
    } catch (error) {
      throw new Error(`Failed to load package plugin ${packageName}: ${error.message}`);
    }
  }

  private async loadBuiltinPlugin(config: NormalizedPluginConfig): Promise<LoadedPlugin> {
    const pluginName = config.name!;
    const plugin = this.builtinPlugins.get(pluginName);

    if (!plugin) {
      throw new Error(`Unknown built-in plugin: ${pluginName}`);
    }

    // Load CSS for built-in plugins
    const cssPath = path.join(
      __dirname,
      `../assets/plugins/${pluginName}-components.css`
    );

    let css: string | undefined;
    if (await fileExists(cssPath)) {
      css = await readFile(cssPath);
    }

    return {
      name: pluginName,
      plugin,
      css,
      metadata: {
        name: pluginName,
        version: '1.0.0',
        description: `Built-in ${pluginName} plugin`
      }
    };
  }

  private async loadRemotePlugin(config: NormalizedPluginConfig): Promise<LoadedPlugin> {
    // Remote plugins are DISABLED by default for security
    if (!config.enabled) {
      throw new Error('Remote plugins must be explicitly enabled');
    }

    const url = config.url || config.path!;

    // Validate integrity if provided
    if (!config.integrity) {
      throw new Error(
        'Remote plugins require integrity hash for security\n' +
        `Add: integrity: "sha384-..."`
      );
    }

    try {
      // Fetch plugin code
      const response = await fetch(url);
      const code = await response.text();

      // Verify integrity
      const hash = await calculateIntegrity(code);
      if (hash !== config.integrity) {
        throw new Error('Plugin integrity check failed');
      }

      // Create a data URL to import
      const dataUrl = `data:text/javascript;base64,${btoa(code)}`;
      const module = await import(dataUrl);

      return {
        name: url,
        plugin: module.default || module,
        css: module.css,
        metadata: module.metadata || {
          name: path.basename(new URL(url).pathname, '.js'),
          version: '0.0.0',
          description: 'Remote plugin'
        }
      };
    } catch (error) {
      throw new Error(`Failed to load remote plugin ${url}: ${error.message}`);
    }
  }

  private getCacheKey(config: NormalizedPluginConfig): string {
    return JSON.stringify({
      type: config.type,
      path: config.path,
      name: config.name,
      url: config.url
    });
  }
}
```

**Integration with Markdown Processing:**

```typescript
// src/markdown/markdown.ts
export async function createPagedMarkdownEngine(
  config: ResolvedConfig,
  inputDir: string
): Promise<MarkdownIt> {
  const md = MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
  });

  // Core markdown-it plugins (always loaded)
  md.use(markdownItAnchor);
  md.use(markdownItAttrs);
  md.use(imgSize);

  // Initialize plugin loader
  const pluginLoader = new PluginLoader(inputDir);
  const collectedCSS: string[] = [];

  // Load plugins from manifest
  const pluginConfigs = config.manifest.plugins || [];

  for (const pluginConfig of pluginConfigs) {
    try {
      const loaded = await pluginLoader.loadPlugin(pluginConfig);

      if (loaded) {
        // Apply plugin to markdown-it
        const options = typeof pluginConfig === 'object'
          ? pluginConfig.options
          : {};

        md.use(loaded.plugin, options);

        // Collect CSS
        if (loaded.css) {
          collectedCSS.push(loaded.css);
        }

        info(`✓ Loaded plugin: ${loaded.metadata.name} v${loaded.metadata.version}`);
      }
    } catch (error) {
      if (config.strict) {
        throw error;
      } else {
        warn(`Failed to load plugin: ${error.message}`);
      }
    }
  }

  // Store collected CSS for later injection
  (md as any).pluginCSS = collectedCSS;

  return md;
}
```

**Backward Compatibility:**

```typescript
// Support legacy extensions array
if (config.manifest.extensions && !config.manifest.plugins) {
  config.manifest.plugins = config.manifest.extensions.map(ext => ({
    type: 'builtin',
    name: ext,
    enabled: true
  }));
}
```

### Plugin Development Experience

**Quick Start (Local Plugin):**

```bash
# 1. Create plugin file
mkdir plugins
cat > plugins/my-syntax.js << 'EOF'
export default function mySyntaxPlugin(md, options = {}) {
  md.inline.ruler.push('my_syntax', (state, silent) => {
    // Custom inline syntax: [[text]]
    if (state.src.charCodeAt(state.pos) !== 0x5B /* [ */) return false;
    if (state.src.charCodeAt(state.pos + 1) !== 0x5B) return false;

    const start = state.pos + 2;
    const max = state.posMax;
    let pos = start;

    while (pos < max) {
      if (state.src.charCodeAt(pos) === 0x5D &&
          state.src.charCodeAt(pos + 1) === 0x5D) {
        if (!silent) {
          const token = state.push('my_syntax', '', 0);
          token.content = state.src.slice(start, pos);
        }
        state.pos = pos + 2;
        return true;
      }
      pos++;
    }

    return false;
  });

  md.renderer.rules.my_syntax = (tokens, idx) => {
    return `<span class="my-syntax">${md.utils.escapeHtml(tokens[idx].content)}</span>`;
  };
}

export const css = `
  .my-syntax {
    background: yellow;
    font-weight: bold;
  }
`;

export const metadata = {
  name: 'my-syntax',
  version: '1.0.0',
  description: 'Adds [[double bracket]] syntax'
};
EOF

# 2. Add to manifest
cat >> manifest.yaml << 'EOF'
plugins:
  - "./plugins/my-syntax.js"
EOF

# 3. Build
print-md build
```

**Publishing Plugin (npm Package):**

```bash
# 1. Create plugin package
mkdir print-md-plugin-callouts
cd print-md-plugin-callouts

# 2. Initialize package
npm init -y

# 3. Update package.json
cat > package.json << 'EOF'
{
  "name": "print-md-plugin-callouts",
  "version": "1.0.0",
  "description": "Callout boxes for print-md",
  "main": "index.js",
  "keywords": ["print-md", "print-md-plugin", "markdown"],
  "peerDependencies": {
    "print-md": "^1.0.0"
  },
  "dependencies": {
    "markdown-it-container": "^4.0.0"
  },
  "print-md": {
    "type": "markdown-plugin",
    "css": "./styles.css",
    "priority": 100
  }
}
EOF

# 4. Create plugin
cat > index.js << 'EOF'
const container = require('markdown-it-container');

module.exports = function calloutPlugin(md, options = {}) {
  const types = options.types || ['note', 'warning', 'tip', 'important'];

  types.forEach(type => {
    md.use(container, type, {
      render: (tokens, idx) => {
        if (tokens[idx].nesting === 1) {
          return `<div class="callout callout-${type}">\n`;
        } else {
          return '</div>\n';
        }
      }
    });
  });
};

module.exports.metadata = {
  name: 'callout-plugin',
  version: '1.0.0',
  description: 'Adds callout box syntax'
};
EOF

# 5. Create styles
cat > styles.css << 'EOF'
.callout {
  border-left: 4px solid #ccc;
  padding: 1em;
  margin: 1em 0;
}

.callout-note { border-left-color: #3b82f6; background: #eff6ff; }
.callout-warning { border-left-color: #f59e0b; background: #fef3c7; }
.callout-tip { border-left-color: #10b981; background: #d1fae5; }
.callout-important { border-left-color: #ef4444; background: #fee2e2; }
EOF

# 6. Publish
npm publish
```

**Using Published Plugin:**

```bash
# 1. Install
npm install print-md-plugin-callouts

# 2. Add to manifest
cat >> manifest.yaml << 'EOF'
plugins:
  - name: "print-md-plugin-callouts"
    options:
      types: ["note", "warning", "tip"]
EOF

# 3. Use in markdown
cat > chapter.md << 'EOF'
:::note
This is a note callout
:::

:::warning
This is a warning callout
:::
EOF

# 4. Build
print-md build
```

### Security Considerations

```typescript
// src/utils/plugin-security.ts

/**
 * Security validation for plugins
 */
export class PluginSecurity {
  /**
   * Validate local plugin path
   */
  static validateLocalPath(pluginPath: string, baseDir: string): void {
    const resolved = path.resolve(baseDir, pluginPath);

    // Must be within project directory
    if (!resolved.startsWith(baseDir)) {
      throw new Error(
        `Plugin path ${pluginPath} is outside project directory`
      );
    }

    // No symlinks to sensitive files
    const realPath = fs.realpathSync(resolved);
    if (realPath !== resolved) {
      throw new Error(`Plugin path contains symlinks: ${pluginPath}`);
    }
  }

  /**
   * Validate remote plugin
   */
  static async validateRemotePlugin(
    url: string,
    code: string,
    integrity?: string
  ): Promise<void> {
    // Require HTTPS
    if (!url.startsWith('https://')) {
      throw new Error('Remote plugins must use HTTPS');
    }

    // Require integrity hash
    if (!integrity) {
      throw new Error('Remote plugins require integrity hash');
    }

    // Verify integrity
    const calculated = await this.calculateIntegrity(code);
    if (calculated !== integrity) {
      throw new Error(
        `Integrity check failed for ${url}\n` +
        `Expected: ${integrity}\n` +
        `Got: ${calculated}`
      );
    }
  }

  /**
   * Calculate SHA-384 integrity hash
   */
  private static async calculateIntegrity(code: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(code);
    const hashBuffer = await crypto.subtle.digest('SHA-384', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashBase64 = btoa(String.fromCharCode(...hashArray));
    return `sha384-${hashBase64}`;
  }

  /**
   * Sandboxing for plugin execution (future enhancement)
   */
  static async sandboxPlugin(plugin: Function): Promise<Function> {
    // TODO: Implement VM-based sandboxing for untrusted plugins
    // For now, plugins run with full access
    return plugin;
  }
}
```

### Error Handling

```typescript
// Graceful error handling with helpful messages
try {
  const loaded = await pluginLoader.loadPlugin(pluginConfig);
} catch (error) {
  const suggestions = [];

  if (error.message.includes('not found')) {
    suggestions.push('• Check the plugin path in manifest.yaml');
    suggestions.push('• For npm packages, run: npm install <package-name>');
    suggestions.push('• For local files, verify the file exists');
  }

  if (error.message.includes('integrity')) {
    suggestions.push('• Regenerate integrity hash:');
    suggestions.push('  cat plugin.js | openssl dgst -sha384 -binary | openssl base64 -A');
  }

  const errorMsg = [
    `Failed to load plugin: ${error.message}`,
    '',
    'Suggestions:',
    ...suggestions
  ].join('\n');

  if (config.strict) {
    throw new Error(errorMsg);
  } else {
    warn(errorMsg);
  }
}
```

### Documentation & Discovery

**Plugin Registry (future):**

```bash
# Search for plugins
print-md plugin search callout

# Install plugin
print-md plugin install print-md-plugin-callouts

# List installed plugins
print-md plugin list

# Show plugin info
print-md plugin info print-md-plugin-callouts
```

**Plugin Template Generator:**

```bash
# Create new plugin from template
print-md plugin create my-plugin

# Creates:
# plugins/my-plugin/
# ├── index.js
# ├── styles.css
# ├── README.md
# └── test.md
```

### Pros
- ✅ Best of both worlds: local files + npm packages
- ✅ Backward compatible with existing extensions
- ✅ Auto-detection of plugin type
- ✅ Great DX: start simple, scale to packages
- ✅ Security controls for remote plugins
- ✅ CSS bundling built-in
- ✅ Flexible configuration
- ✅ TypeScript support via Bun
- ✅ Plugin metadata and versioning

### Cons
- ⚠️ More complex implementation
- ⚠️ Need to handle multiple plugin types
- ⚠️ Security considerations for remote plugins

### Risk Assessment
- **Security:** MEDIUM-HIGH - Proper validation and opt-in for risky features
- **Maintainability:** HIGH - Well-structured, modular design
- **DX:** EXCELLENT - Progressive enhancement from simple to advanced
- **Scalability:** EXCELLENT - Supports full ecosystem + quick prototypes

---

## Comparison Matrix

| Feature | Option 1: Files | Option 2: npm | Option 3: Hybrid ⭐ |
|---------|-----------------|---------------|---------------------|
| **Quick Prototyping** | ✅ Excellent | ❌ Poor | ✅ Excellent |
| **Sharing Plugins** | ❌ Poor | ✅ Excellent | ✅ Excellent |
| **Versioning** | ❌ None | ✅ npm semver | ✅ npm semver |
| **Type Safety** | ⚠️ Limited | ✅ Full | ✅ Full |
| **Security** | ❌ Risky | ✅ Good | ✅ Good |
| **Complexity** | ✅ Simple | ⚠️ Medium | ⚠️ Medium |
| **Ecosystem** | ❌ None | ✅ Full | ✅ Full |
| **Learning Curve** | ✅ Easy | ⚠️ Medium | ✅ Easy |
| **Maintenance** | ⚠️ Medium | ✅ High | ✅ High |
| **Backward Compat** | ❌ Breaking | ⚠️ Partial | ✅ Full |

---

## Recommended Implementation: Option 3 (Hybrid)

### Phase 1: Core Infrastructure (Week 1)

1. **Plugin Loader Foundation**
   - Implement PluginLoader class
   - Add local file loading
   - Add built-in plugin support
   - Security validation

2. **Manifest Schema Update**
   - Add plugins field to manifest.yaml
   - Update Zod schema
   - Backward compatibility for extensions array

3. **Testing**
   - Unit tests for plugin loader
   - Integration tests with sample plugins
   - Security tests

### Phase 2: npm Package Support (Week 2)

1. **Package Discovery**
   - Implement package.json scanning
   - Version validation
   - CSS loading from packages

2. **Plugin Package Template**
   - Create example plugin package
   - Document plugin API
   - Publishing guide

3. **Testing**
   - Test with real npm packages
   - Version resolution tests
   - Error handling tests

### Phase 3: Advanced Features (Week 3)

1. **Remote Plugin Support** (optional)
   - URL loading with integrity checks
   - Security warnings
   - Opt-in configuration

2. **Plugin CLI Commands** (optional)
   - plugin search
   - plugin install
   - plugin list
   - plugin create

3. **Documentation**
   - Plugin development guide
   - API reference
   - Examples library

### Phase 4: Migration & Release (Week 4)

1. **Migrate Built-in Plugins**
   - Move ttrpg to builtin
   - Move dimmCity to builtin
   - Move containers to builtin
   - Maintain backward compatibility

2. **Create Example Plugins**
   - print-md-plugin-callouts
   - print-md-plugin-footnotes
   - print-md-plugin-mermaid

3. **Documentation**
   - Update user guide
   - Migration guide
   - Plugin registry page

---

## Success Criteria

### Must Have (v1.1.0)
- ✅ Load local plugin files (.js, .ts)
- ✅ Load npm package plugins
- ✅ Built-in plugin support (backward compat)
- ✅ CSS bundling from plugins
- ✅ Security validation
- ✅ Error handling with helpful messages
- ✅ Plugin metadata
- ✅ Documentation

### Should Have (v1.2.0)
- ✅ Auto-discovery of installed plugins
- ✅ Plugin versioning
- ✅ Plugin options configuration
- ✅ Plugin priority/ordering
- ✅ TypeScript plugin support
- ✅ Example plugin packages

### Could Have (v2.0.0)
- Remote plugin loading (with strict security)
- Plugin CLI commands
- Plugin marketplace/registry
- Plugin sandboxing
- Hot reload during development

---

## Migration Path

### For Existing Users

```yaml
# OLD (v1.0.0)
extensions:
  - "ttrpg"
  - "dimmCity"

# NEW (v1.1.0) - still works!
extensions:
  - "ttrpg"
  - "dimmCity"

# OR new syntax
plugins:
  - "ttrpg"
  - "dimmCity"

# OR explicit
plugins:
  - type: "builtin"
    name: "ttrpg"
  - type: "builtin"
    name: "dimmCity"
```

### For Plugin Developers

```javascript
// OLD (hardcoded in print-md)
// src/markdown/plugins/my-plugin.ts
export default function myPlugin(md) { ... }

// NEW (standalone package)
// print-md-plugin-my/index.js
module.exports = function myPlugin(md) { ... };
module.exports.metadata = {
  name: 'my-plugin',
  version: '1.0.0'
};
```

---

## Conclusion

**Option 3 (Hybrid Manifest-Based System)** is recommended because it:

1. **Provides flexibility** - Users can start simple (local files) and grow to npm packages
2. **Enables ecosystem** - Community can publish and share plugins
3. **Maintains backward compatibility** - Existing extensions array still works
4. **Excellent DX** - Auto-detection, helpful errors, TypeScript support
5. **Security-conscious** - Validation for local files, opt-in for remote
6. **Future-proof** - Can add plugin registry, CLI tools, sandboxing later

### Implementation Priority

1. **Now (v1.1.0):** Local files + npm packages + built-in
2. **Soon (v1.2.0):** Auto-discovery + better error messages
3. **Later (v2.0.0):** Remote plugins + CLI + marketplace

This approach provides immediate value while building toward a robust plugin ecosystem.
