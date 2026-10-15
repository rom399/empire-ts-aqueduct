---
name: "aqueduct-review"
description: "Pre-PR review of changed files against Aqueduct's conventions - one class per file, filename matches the type, JSDoc on public members, no magic numbers, no new dependencies, tests per class. Use before opening a pull request, or when asked \"is this ready for PR\" or \"does this follow our conventions\"."
---

Check every changed file against the package's `AGENTS.md` and this repository's `CLAUDE.md`. Report findings; the user decides what to change.

## Checklist

- **One class, interface, or enum per file**, filename matching the type exactly. `I`-prefixed interfaces.
- **JSDoc on every public class, method and property**, explaining why, not what.
- **No magic numbers or strings** - named constants.
- **Dependencies:** `core` and `client` must have none at runtime; `server` may depend only on `empire-ts` and `empire-ts-aqueduct-core`. Flag any other `dependencies` entry for sign-off.
- **No queue code in the Empire repository**, and no import of `empire-ts` internals - only its public exports.
- **Flat, early-return code**; constructor injection only; anything needing a clock goes through the package's clock seam so tests control time.
- **A test per new or changed class**, mirroring its path under `tests/unit/`, covering failure cases as well as the golden path.
- **Examples actually run**, not just compile.
- **`npm run typecheck`, `npm test` and `npm run lint` pass** in each changed package. Suppress a lint finding only with a documented `// oxlint-disable-next-line <rule> -- <reason>`.
- **Docs follow the template:** a design doc under `doc/features/` keeps the `00-template-blueprint.md` headings.

## Output

Findings grouped by file, each naming the rule broken. If clean, say so plainly.
