# Security Policy

## Overview

While print-md is primarily designed as a single-user local application, we take security seriously. This document outlines our security practices, how to report vulnerabilities, and recommendations for secure usage.

## Supported Versions

We actively support the latest stable version with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

**Note**: As this project is in active development (pre-1.0), we recommend always using the latest version.

## Reporting a Vulnerability

We appreciate responsible disclosure of security vulnerabilities. While this is a single-user local application, security issues can still affect users.

### How to Report

**For non-critical issues:**
- Open a GitHub issue: https://github.com/dimm-city/print-md/issues
- Label it with `security` tag
- Provide detailed reproduction steps

**For critical vulnerabilities:**
- Email the maintainer directly (avoid public disclosure initially)
- See package.json for maintainer contact information
- Provide:
  - Detailed description of the vulnerability
  - Steps to reproduce
  - Potential impact assessment
  - Suggested fix (if available)

### Response Timeline

- **Initial Response**: Within 72 hours
- **Status Update**: Within 7 days
- **Fix Timeline**:
  - Critical: Within 7 days
  - High: Within 14 days
  - Medium: Next release cycle
  - Low: Addressed in regular updates

### What to Expect

1. **Acknowledgment**: We'll confirm receipt of your report
2. **Investigation**: We'll investigate and validate the issue
3. **Fix Development**: If confirmed, we'll develop a fix
4. **Release**: Security fixes are released promptly
5. **Credit**: We'll credit you in the CHANGELOG (unless you prefer anonymity)

## Security Best Practices

### For Users

1. **Keep Updated**
   ```bash
   # Check your version
   print-md --version

   # Update to latest
   bun update -g @dimm-city/print-md
   ```

2. **Trusted Content Only**
   - Only process markdown files from trusted sources
   - Review content before building PDFs
   - Be cautious with user-submitted markdown (XSS risk in HTML output)

3. **File System Access**
   - print-md reads markdown files from your file system
   - Preview mode serves files from specified directories
   - Ensure you trust the directory you're previewing

4. **Network Security (Preview Mode)**
   - Preview server binds to localhost by default (safe)
   - Only expose to network if you trust all network users
   - Use `--port` to choose specific ports (avoid privileged ports <1024)

5. **Environment Variables**
   - Review `.env` files before use
   - Never commit sensitive data to version control
   - Use `.env.example` as a template

### For Contributors

1. **Code Review**
   - All changes require review before merging
   - Security-sensitive changes need extra scrutiny
   - Follow [CONTRIBUTING.md](./CONTRIBUTING.md) guidelines

2. **Dependency Management**
   - Keep dependencies updated (see [CONTRIBUTING.md](./CONTRIBUTING.md#security-and-dependency-management))
   - Review Dependabot PRs promptly
   - Run `bun audit` before committing

3. **Input Validation**
   - Validate all user inputs (file paths, configuration values)
   - Use path validation utilities (`src/utils/path-validation.ts`)
   - Sanitize markdown content if generating HTML for web display

4. **Secure Coding**
   - No hardcoded secrets or credentials
   - Use parameterized commands (avoid shell injection)
   - Follow TypeScript strict mode (enabled in tsconfig.json)
   - Avoid `eval()`, `Function()`, or unsafe code execution

## Dependency Security

We use automated tools to maintain dependency security:

### Automated Scanning

- **GitHub Dependabot**: Weekly dependency updates
- **CI Security Audit**: Runs on every commit
- **Lock File Integrity**: Enforced in CI pipeline

### Manual Audits

Contributors should run before submitting PRs:

```bash
# Check for vulnerabilities
bun audit

# Get detailed report
bun audit --json

# Update vulnerable packages
bun update [package-name]
```

See [CONTRIBUTING.md - Security and Dependency Management](./CONTRIBUTING.md#security-and-dependency-management) for complete guidelines.

## Known Security Considerations

### 1. Local File System Access

**Risk**: print-md reads files from your file system
**Mitigation**:
- Path traversal protection implemented (`src/utils/path-validation.ts`)
- Validation prevents accessing files outside specified directories
- Preview mode restricts access to home directory subdirectories

### 2. Preview Server

**Risk**: Local web server exposes directory contents
**Mitigation**:
- Binds to localhost only (not exposed to network)
- CORS disabled (same-origin policy)
- Comprehensive input validation on API endpoints
- Path security checks on all file operations

### 3. Markdown Processing

**Risk**: Malicious markdown could inject HTML/JavaScript
**Mitigation**:
- markdown-it used with safe defaults
- HTML sanitization when needed
- PDF output via Prince XML (isolated subprocess)
- Preview mode uses iframe isolation

### 4. Dependency Vulnerabilities

**Risk**: Third-party packages may have security issues
**Mitigation**:
- Automated dependency scanning (Dependabot + CI)
- Regular security audits
- Prompt updates for security patches
- Lock file integrity checks

### 5. PDF Generation (Prince XML)

**Risk**: Subprocess execution for PDF generation
**Mitigation**:
- Input validation before passing to Prince
- Timeout limits to prevent resource exhaustion
- No JavaScript execution in PDF generation
- Output validation

## Security Features

Current security measures in place:

- ✅ **Path Traversal Protection**: Prevents directory traversal attacks
- ✅ **Input Validation**: All user inputs validated
- ✅ **TypeScript Strict Mode**: Compile-time type safety
- ✅ **Dependency Scanning**: Automated vulnerability detection
- ✅ **Lock File Integrity**: Prevents supply chain attacks
- ✅ **Localhost Binding**: Preview server not exposed to network
- ✅ **Timeout Limits**: Prevents infinite loops and DoS
- ✅ **Error Handling**: Secure error messages (no sensitive data leaks)

## Security Roadmap

Future security enhancements being considered:

- [ ] HTML sanitization option for markdown output
- [ ] Content Security Policy (CSP) headers in preview mode
- [ ] Optional preview server authentication
- [ ] Sandboxed build environment
- [ ] Security audit logging

## Resources

- **Security Documentation**: This file
- **Contributing Guidelines**: [CONTRIBUTING.md](./CONTRIBUTING.md)
- **Code of Conduct**: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) (if available)
- **Issue Tracker**: https://github.com/dimm-city/print-md/issues
- **Discussions**: https://github.com/dimm-city/print-md/discussions

## Acknowledgments

We thank all security researchers and contributors who help keep print-md secure.

## License

This security policy is part of the print-md project and licensed under [CC-BY-4.0](./LICENSE).

---

**Last Updated**: 2025-11-19
**Policy Version**: 1.0
