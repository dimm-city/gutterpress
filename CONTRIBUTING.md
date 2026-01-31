# Contributing to print-md

Thank you for your interest in contributing to print-md! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Release Process](#release-process)

## Development Setup

### Prerequisites

- **Bun** v1.0.0 or later - [Install Bun](https://bun.sh)
- **Git** - Version control
- **Node.js** (optional) - For compatibility testing

### Initial Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/dimm-city/print-md.git
   cd print-md
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Verify setup**
   ```bash
   # Run tests
   bun test

   # Build the project
   bun run build

   # Try the CLI
   bun run src/cli.ts --help
   ```

### Development Workflow

```bash
# Run from source (for development)
bun run src/cli.ts preview ./examples/my-book

# Watch mode for tests
bun test --watch

# Lint your code
bun run lint

# Format code
bun run format

# Type check
bun run type-check
```

## Project Structure

```
print-md/
├── src/
│   ├── cli.ts              # CLI entry point
│   ├── types.ts            # TypeScript type definitions
│   ├── constants.ts        # Application constants
│   ├── build/              # Build orchestration
│   │   ├── build.ts        # Main build function
│   │   ├── watch.ts        # File watching
│   │   └── formats/        # Output format strategies
│   ├── markdown/           # Markdown processing
│   │   ├── markdown.ts     # Main processor
│   │   ├── core/           # Core directives
│   │   └── plugins/        # Extension plugins
│   ├── preview/            # Preview server
│   │   └── routes.ts       # API routes
│   ├── config/             # Configuration management
│   ├── utils/              # Utility functions
│   └── assets/             # CSS, fonts, scripts
├── tests/
│   └── integration/        # Integration tests
├── examples/               # Example projects
└── docs/                   # Documentation

```

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

We use **ESLint** and **Prettier** for consistent code style:

```bash
# Check for lint errors
bun run lint

# Auto-fix lint errors
bun run lint:fix

# Check formatting
bun run format:check

# Auto-format code
bun run format
```

**ESLint Rules:**
- No unused variables (prefix with `_` if intentional)
- Explicit function return types (when not obvious)
- No floating promises
- Always use `===` instead of `==`
- Prefer `const` over `let`

**Prettier Configuration:**
- 100 character line width
- 2 space indentation
- Semicolons required
- Double quotes for strings
- Trailing commas in ES5 contexts

### Best Practices

1. **Error Handling**
   - Use custom error classes (`BuildError`, `ConfigError`)
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

```
tests/
├── integration/            # Integration tests
│   ├── cli-build.test.ts
│   └── markdown-processing.test.ts
└── unit/                   # Unit tests (in src/ alongside code)
    ├── config/config-state.test.ts
    └── utils/manifest-writer.test.ts
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
   # Run all tests
   bun test

   # Run specific test file
   bun test tests/integration/cli-build.test.ts

   # Watch mode
   bun test --watch

   # Run tests with coverage (if available)
   bun test --coverage
   ```

## Security and Dependency Management

### Dependency Security

The project uses automated tools to monitor and update dependencies securely:

1. **Automated Vulnerability Scanning**
   - **CI Security Audit**: Every push and pull request runs `bun audit` to check for known vulnerabilities
   - **Dependabot**: Automatically creates PRs for dependency updates weekly
   - **Lock File Integrity**: CI verifies `bun.lockb` hasn't been tampered with

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

   # Install dependency
   bun add [package-name]

   # Run security audit
   bun audit

   # Commit updated lock file
   git add bun.lockb package.json
   git commit -m "chore(deps): add [package-name]"
   ```

5. **Lock File Management**
   - **Always commit** `bun.lockb` with dependency changes
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
   - Follow the process outlined in [SECURITY.md](./SECURITY.md)
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
   bun run lint          # Check for lint errors
   bun run type-check    # TypeScript compilation
   bun test              # Run test suite
   bun run format:check  # Check code formatting
   ```

2. **Update documentation**
   - Update README.md for user-facing changes
   - Add JSDoc comments for new APIs
   - Update CHANGELOG.md (if exists)

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
4. **Publish to npm**
   ```bash
   bun run prepublishOnly  # Build
   npm publish
   ```

## Getting Help

- **Issues**: [GitHub Issues](https://github.com/dimm-city/print-md/issues)
- **Discussions**: [GitHub Discussions](https://github.com/dimm-city/print-md/discussions)
- **Documentation**: [/docs](./docs)

## License

By contributing to print-md, you agree that your contributions will be licensed under the [CC-BY-4.0 License](./LICENSE).

---

Thank you for contributing to print-md! 🎉
