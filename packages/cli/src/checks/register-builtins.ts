/**
 * Central registration of the built-in checks (audit B5).
 *
 * The check registry (registry.ts) is a module-level Map populated purely as a
 * side effect of importing each category's index module. Those four imports
 * previously lived only in `lib/validation-exec.ts`, so `runChecks`/`getChecks`
 * reached any other way (a direct import of `checks/runner`, a reordering of the
 * package entry's re-exports) would see an EMPTY registry and silently validate
 * nothing. Importing THIS module makes the registry self-populating regardless
 * of who the first caller is; `runner.ts` imports it at load, so anything that
 * can reach `runChecks` has already registered the built-ins. ESM evaluates a
 * module once, so importing this from several places registers exactly once.
 */
import "./pdf/index";
import "./source/index";
import "./asset/index";
import "./heuristic/index";
