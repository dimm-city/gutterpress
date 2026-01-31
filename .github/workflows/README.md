# GitHub Actions Workflows

This directory contains automated workflows for testing and validation of the print-md project.

## Available Workflows

### Windows Installation Test (`windows-install-test.yml`)

Tests the Windows PowerShell installation script to ensure end users can successfully install print-md.

**Purpose:**
- Validates the install script works on multiple Windows versions
- Ensures Bun and print-md are correctly installed
- Verifies all CLI commands function as expected
- Can be integrated into release validation pipelines

**Triggers:**
- **Manual**: Via GitHub Actions UI (workflow_dispatch)
- **Automatic**: On pull requests that modify:
  - `scripts/install.ps1`
  - `.github/workflows/windows-install-test.yml`
- **Reusable**: Can be called from other workflows (workflow_call)

**Test Matrix:**
- Windows Server 2022 (windows-latest)

**What It Tests:**
1. ✅ PowerShell script execution without errors
2. ✅ Bun runtime installation and availability
3. ✅ print-md global installation
4. ✅ Version commands (`print-md --version`)
5. ✅ Help commands (`print-md --help`)
6. ✅ Build command help (`print-md build --help`)
7. ✅ Preview command help (`print-md preview --help`)
8. ✅ Desktop shortcut creation
9. ✅ Debug log collection on failures

**Usage in Other Workflows:**

To use this workflow as part of a release validation pipeline:

```yaml
name: Release Validation
on:
  release:
    types: [published]

jobs:
  validate-windows-install:
    uses: ./.github/workflows/windows-install-test.yml
    with:
      script_ref: ${{ github.event.release.tag_name }}
```

**Manual Testing:**

1. Go to the "Actions" tab in GitHub
2. Select "Test Windows Installation Script"
3. Click "Run workflow"
4. (Optional) Specify a different branch/tag in `script_ref`
5. Click "Run workflow" to start the test

**Debugging Failed Tests:**

If tests fail, check:
- The workflow run logs for detailed error messages
- Uploaded debug log artifacts (available for 7 days)
- The specific step that failed in the workflow

Common issues:
- Network connectivity problems downloading Bun
- PATH environment variable not refreshing properly
- PowerShell execution policy restrictions

## Adding New Workflows

When adding new workflows:

1. Follow GitHub Actions best practices
2. Use descriptive names and comments
3. Include proper error handling and logging
4. Add matrix testing for cross-platform compatibility where applicable
5. Document the workflow in this README
6. Consider making workflows reusable with `workflow_call` trigger

## Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Workflow Syntax Reference](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)
- [Reusable Workflows](https://docs.github.com/en/actions/using-workflows/reusing-workflows)
