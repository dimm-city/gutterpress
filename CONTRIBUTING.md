# Contributing to Gutterpress

Thank you for your interest in contributing to Gutterpress! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Release Process](#release-process)

## Development Setup

### Prerequisites

- **Bun** v1.3.1 or later - [Install Bun](https://bun.sh)
- **Git** - Version control

### Initial Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/dimm-city/gutterpress.git
   cd gutterpress
   ```

2. **Install dependencies**

   Run `bun install` at the **repo root** — Bun workspace installs all
   packages at once. Do not run `bun install` inside individual package
   directories; it is not needed and will create duplicate `node_modules`.

   ```bash
   bun install
   ```

3. **Verify setup**
   ```bash
   # Run CLI from source
   bun packages/cli/src/cli.ts --help

   # Run CLI tests
   bun --filter gutterpress test

   # Launch desktop app (browser UI, no Electron)
   bun run desktop:dev
   ```

### Development Workflow

Root-level scripts delegate to the relevant workspace package:

```bash
# Run CLI from source (pass any CLI command after --)
bun run cli -- preview ./examples/my-book
bun run cli -- build ./examples/my-book

# Run all tests (CLI package)
bun run test

# Type-check all packages
bun run typecheck

# Launch desktop app (SvelteKit dev server, browser at http://localhost:5173)
bun run desktop:dev

# Launch desktop app with Electron
bun run desktop:electron
```

Working inside a single package:

```bash
# CLI package
cd packages/cli
bun test --watch
bun run typecheck

# Desktop package
cd packages/desktop
bun run dev          # SvelteKit dev server only
bun run electron:dev # Full Electron + SvelteKit
```

## Project Structure

```
gutterpress/                     # Workspace root (private)
├── packages/
│   ├── cli/                     # gutterpress — library + CLI (all runtime logic + the gutterpress command)
│   │   ├── src/
│   │   │   ├── cli.ts           # CLI entry point (bin)
│   │   │   ├── index.ts         # Library entry (exports)
│   │   │   ├── api/index.ts     # Library API (runBuild, startPreviewServer, …)
│   │   │   ├── commands/        # CLI command implementations
│   │   │   ├── lib/             # Core libraries (markdown, preview, PDF, lint)
│   │   │   ├── checks/          # Validation check system
│   │   │   └── preview/         # Headless preview server (node:http + ws + chokidar)
│   │   └── tests/               # Bun test suite
│   └── desktop/                 # @dimm-city/gutterpress-desktop — Electron + SvelteKit desktop app
│       ├── electron/            # Electron main process
│       └── src/                 # SvelteKit UI + server routes
├── examples/                    # Example projects
├── docs/                        # Documentation
└── package.json                 # Workspace root (private Bun workspace)
```

### Key architectural boundaries

- **`packages/cli/src/`** — No bundlers at runtime (see the "No bundlers at
  runtime" rule in `CLAUDE.md` §1). Use `node:http` + `ws` for any server
  needs (see `packages/cli/src/preview/http-server.ts`), not Vite/Rollup/esbuild
  and not `Bun.serve` — the lib runtime must stay Node-compatible so Electron's
  bundled Node can run it in-process.
- **`packages/desktop/`** — Vite/Rollup are intentional here (SvelteKit build).
  `gutterpress` is SSR-external so it is never bundled by Vite.
- **Plugin API** — Plugins are plain `(md, options) => void` markdown-it
  functions. No Gutterpress-specific plugin API. See [User Guide: Chapter 5 — Plugins](./examples/gutterpress-user-guide/05-plugins.md).

## Coding Standards

### TypeScript Guidelines

1. **Strict Type Safety**
   - No `any` types in production code
   - Use `unknown` for truly unknown values
   - Enable all strict compiler options

2. **Naming Conventions**
   - Files: `kebab-case.ts`
   - Classes: `PascalCase`
   - Functions/variables: `camelCase`
   - Constants: `UPPER_SNAKE_CASE`
   - Types/Interfaces: `PascalCase`

3. **Code Organization**
   - One exported class/function per file (exceptions for utilities)
   - Group related functionality in directories
   - Keep files under 500 lines

4. **Documentation**
   - JSDoc comments for all public APIs
   - Inline comments for complex logic
   - Update README.md for user-facing changes

### Code Style

The enforced gates are TypeScript and the test suite — run both before opening a PR:

```bash
# Type-check every package
bun run typecheck

# Run all tests
bun test
```

Follow these conventions (not auto-enforced, but expected in review):
- No unused variables (prefix with `_` if intentional)
- Explicit function return types when not obvious; no floating promises
- Always use `===` instead of `==`; prefer `const` over `let`
- 100-character line width, 2-space indentation, semicolons, double quotes
- Match the style of the surrounding code

### Best Practices

1. **Error Handling**
   - Use custom error classes where one exists for the failure kind
     (`BuildError` for pipeline failures, `UsageError` for bad CLI
     invocations — see `packages/cli/src/lib/build-error.ts` and
     `packages/cli/src/lib/cli-args.ts`)
   - Provide helpful error messages
   - Include suggestions for fixing errors

2. **Async/Await**
   - Always await promises
   - Handle errors with try/catch
   - Use async/await over promise chains

3. **Logging**
   - Use the logger utility (`src/utils/logger.ts`)
   - Log at appropriate levels (DEBUG, INFO, WARN, ERROR)
   - No `console.log` in production code

4. **Constants**
   - Extract magic numbers to `constants.ts`
   - Use `as const` for type-safe enums
   - Group related constants in objects

## Testing

### Test Structure

Most tests are **colocated** with the source file they cover, as
`*.test.ts` next to the implementation:

```
packages/cli/src/
├── lib/
│   ├── manifest.ts
│   ├── manifest.test.ts        # unit tests for manifest.ts
│   ├── build-runner.ts
│   └── build-runner.test.ts
└── commands/
    ├── validate.ts
    └── validate.test.ts
```

A separate `tests/` tree holds cross-cutting suites that don't belong to one
source file:

```
packages/cli/tests/
├── compat/                 # Playwright/print-safety compat probes
│   └── preview-smoke.pw.ts
└── integration/            # End-to-end / platform-specific integration tests
    └── preview-server-windows.test.ts
```

### Writing Tests

We use **Bun's built-in test runner**:

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

describe('Feature name', () => {
  beforeEach(async () => {
    // Setup test fixtures
  });

  afterEach(async () => {
    // Cleanup
  });

  test('should do something specific', async () => {
    // Arrange
    const input = 'test';

    // Act
    const result = processInput(input);

    // Assert
    expect(result).toBe('expected');
  });
});
```

### Test Guidelines

1. **Test Organization**
   - One `describe` block per module/class
   - Descriptive test names: `should [expected behavior] when [condition]`
   - Arrange-Act-Assert pattern

2. **Test Coverage**
   - Aim for 80%+ code coverage
   - Test happy paths and error cases
   - Test edge cases and boundary conditions

3. **Test Isolation**
   - Each test should be independent
   - Use `beforeEach`/`afterEach` for setup/cleanup
   - Create unique temp directories for file operations

4. **Running Tests**
   ```bash
   # Run CLI tests (from repo root)
   bun --filter gutterpress test

   # Run specific test file
   bun test packages/cli/tests/integration/cli-build.test.ts

   # Watch mode (from packages/cli)
   cd packages/cli && bun test --watch

   # Run tests with coverage
   bun test --coverage
   ```

## Security and Dependency Management

### Dependency Security

The project uses automated tools to monitor and update dependencies securely:

1. **Automated Vulnerability Scanning**
   - **CI Security Audit**: Every push and pull request runs `bun audit` to check for known vulnerabilities
   - **Dependabot**: Automatically creates PRs for dependency updates weekly
   - **Lock File Integrity**: CI verifies `bun.lock` hasn't been tampered with

2. **Manual Security Audits**
   ```bash
   # Check for vulnerabilities
   bun audit

   # Get detailed JSON report
   bun audit --json

   # Update vulnerable dependencies
   bun update [package-name]
   ```

3. **Dependency Update Process**
   - **Automated Updates**: Dependabot creates PRs every Monday at 9:00 AM
   - **Review Process**:
     - Check PR description for breaking changes
     - Review CHANGELOG of updated packages
     - Run full test suite locally
     - Merge if tests pass and no breaking changes
   - **Security Updates**: High-priority, merge as soon as verified
   - **Grouped Updates**: Minor/patch updates grouped to reduce PR noise

4. **Adding New Dependencies**

   Before adding a new dependency:
   ```bash
   # Check package health
   - npm view [package-name]        # Verify it's maintained
   - Check GitHub stars/activity    # Ensure active development
   - Review security advisories     # Check for known issues

   # Install dependency (run from repo root or the relevant package dir)
   bun add [package-name]

   # Run security audit
   bun audit

   # Commit updated lock file
   git add bun.lock package.json
   git commit -m "chore(deps): add [package-name]"
   ```

5. **Lock File Management**
   - **Always commit** `bun.lock` with dependency changes
   - **Never manually edit** the lock file
   - **CI enforces** `--frozen-lockfile` to prevent inconsistencies
   - **Resolve conflicts** by running `bun install` after merging

6. **Security Update Priority**
   - **Critical**: Immediate update required (vulnerabilities with known exploits)
   - **High**: Update within 7 days (publicly disclosed vulnerabilities)
   - **Medium**: Update in next release cycle (low-risk vulnerabilities)
   - **Low**: Update during regular maintenance

7. **Reporting Vulnerabilities**

   If you discover a security vulnerability:
   - **Do not** create a public GitHub issue for critical vulnerabilities
   - Report it privately via the repository's GitHub Security Advisories
     ("Report a vulnerability" under the **Security** tab)
   - Email maintainers directly for critical issues
   - Provide detailed reproduction steps
   - Allow reasonable time for fix before disclosure

### GitHub Actions Security

The CI/CD pipeline includes security measures:

- **Frozen lockfile**: Ensures consistent dependencies across environments
- **Automated audits**: Runs on every commit to catch new vulnerabilities
- **Minimal permissions**: GitHub Actions use least-privilege principle
- **Audit logging**: All security audit results logged in CI output

## Submitting Changes

### Before Submitting

1. **Run quality checks**
   ```bash
   bun run typecheck   # TypeScript compilation (all packages)
   bun run test        # Run test suite
   ```

2. **Update documentation**
   - Update README.md for user-facing changes
   - Add JSDoc comments for new APIs
   - Update CHANGELOG.md

3. **Test your changes**
   - Add tests for new functionality
   - Verify existing tests still pass
   - Test manually with example projects

### Commit Messages

Follow **Conventional Commits** format:

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Build process, dependencies, etc.

**Examples:**
```
feat(build): add support for custom page sizes

fix(markdown): handle escaped special characters correctly

docs(readme): update installation instructions

test(config): add tests for manifest validation
```

### Pull Request Process

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Write code following our standards
   - Add tests
   - Update documentation

3. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat(scope): description"
   ```

4. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

5. **Create Pull Request**
   - Provide clear description of changes
   - Reference related issues
   - Ensure CI checks pass

### Code Review

- Be open to feedback
- Respond to review comments
- Make requested changes
- Keep discussions focused and professional

## Release Process

*(For maintainers only)*

1. **Update version in package.json**
2. **Update CHANGELOG.md**
3. **Create git tag**
   ```bash
   git tag -a v0.2.0 -m "Release v0.2.0"
   git push origin v0.2.0
   ```
4. **Publish to npm** (via GitHub Actions OIDC trusted publisher)
   - Tag push triggers the release workflow automatically.
   - The workflow cross-compiles CLI binaries on `ubuntu-latest` and uploads
      them to GitHub Releases alongside the Gutterpress desktop package.

## Getting Help

- **Issues**: [GitHub Issues](https://github.com/dimm-city/gutterpress/issues)
- **Discussions**: [GitHub Discussions](https://github.com/dimm-city/gutterpress/discussions)
- **Documentation**: [/docs](./docs)

## License

By contributing to Gutterpress, you agree that your contributions will be licensed under the [MPL-2.0 License](./LICENSE).
