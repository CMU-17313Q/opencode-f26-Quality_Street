# Dependency Cruiser CI check

## Purpose and scope

Dependency Cruiser statically analyzes JavaScript and TypeScript module dependencies. This check
cruises `packages/opencode/src` to prevent circular imports and production code importing
test-only code. It complements the existing typecheck, unit, E2E, and Qlty checks instead of
repeating them.

## Installation and local use

The root development dependency is `dependency-cruiser@18.7.0`; its exact resolution is tracked
in `bun.lock`. Run the check locally with:

```sh
bun run depcruise
```

The script uses `.dependency-cruiser.cjs`. Its TypeScript project is resolved with an absolute
path from the configuration file because Dependency Cruiser otherwise resolves a relative
`tsConfig.fileName` from the cruised directory rather than from the repository root in this
monorepo.

## Rules and customization

- `no-circular` fails on circular dependencies in `packages/opencode/src`.
- `no-production-to-test` fails when production source depends on
  `packages/opencode/test`.
- The configuration uses `packages/opencode/tsconfig.json` so the `@/*` path alias is resolved.
- `includeOnly` limits this initial implementation to `packages/opencode/src`, as planned.

The GitHub Actions workflow runs on pull requests targeting `main`, pushes to `main`, and manual
dispatches. It installs dependencies through the repository's shared Bun setup action and fails
the job whenever `bun run depcruise` reports an error.

## Execution evidence

On 2026-10-29, after installation and configuration, this command completed successfully:

```text
$ bun run depcruise
✔ no dependency violations found (411 modules, 847 dependencies cruised)
```

The pull request's green `dependency-cruiser` GitHub Actions job is the CI execution evidence.

## Findings and limitations

The first run reported 124 one-module circular dependencies. Investigation showed each was
OpenCode's intentional self namespace-export convention, e.g. `export * as Worktree from "."`.
Dependency Cruiser labels that self re-export an `export` dependency and a circular edge. The
`no-circular` rule therefore ignores only circular edges with dependency type `export`; ordinary
import cycles still fail. This is a targeted irrelevant-true-positive adjustment, not a baseline
or a path exclusion.

The check can miss dependencies formed from computed dynamic import strings, runtime plugin
loading, or TypeScript type-only imports (the default mode analyzes runtime dependencies). It can
also report a real static cycle that is harmless at runtime, which should be evaluated case by
case rather than suppressed broadly. This initial source-only scope intentionally does not enforce
cross-workspace package layering; that requires a separately validated monorepo-wide graph.

## Difference from the P3A plan

The P3A baseline remains: static dependency analysis, circular-dependency detection,
architecture-boundary enforcement, and blocking GitHub Actions integration. The only adjustment
is excluding intentional self namespace re-exports after measuring the repository; without it,
the check would report 124 irrelevant one-node cycles and obscure new import cycles.
