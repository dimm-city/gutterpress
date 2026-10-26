# AGENTS.md

## Gutterpress Primary Goals

> VERY IMPORTANT: All changes to this repo MUST comply with these goals.
> All changes must REDUCE complexity unless it can be properly justified.

- Create a way for non-technical writers to easily publish print materials using markdown and modern CSS
- Allow most authors to write and perform layout using simple markdown syntax
- Allow non-technical users to style their projects by setting CSS custom properties
- Make handling page layout trivial
- Allow authors to convert markdown and CSS into print ready PDFs
- Simplify the process of creating

## Work habits

- Read relevant code, tests, and docs before editing. Search AKM first (`curate` → `show`),
  then record useful outcomes with `feedback`.
- State consequential assumptions; clarify ambiguity that affects scope or correctness.
  Define the expected outcome and how to verify it.
- Choose the smallest complete solution. Reuse existing patterns; justify added complexity.
- Keep changes focused and preserve others' work. Remove what your changes make obsolete;
  report unrelated cleanup separately.
- Reproduce bugs and test observable behavior. Understand failures before changing expectations.
- Run checks appropriate to the affected behavior. Report what changed, actual verification
  results, and remaining limitations.
- Update authoritative docs where behavior changes. Link existing guidance instead of copying it;
  keep this file short and free of implementation details or session history.

## Read as needed

- Setup, commands, and contribution practices: [CONTRIBUTING.md](./CONTRIBUTING.md).
  Required automated checks: [CI workflow](./.github/workflows/ci.yml).
- Architectural constraints: [architecture rules](./docs/architecture-rules.md).
- Rendering: [engine design rules](./docs/engine/DESIGN-RULES.md),
  [preview/print parity](./docs/native-parity-gate.md), and [render regression checks](./docs/render-parity-gate.md).
- Desktop: [development guide](./packages/desktop/README.md) and [UX contract](./docs/ux-design-contract.md).
