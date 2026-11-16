# Traceability: Abdulrahman Al-Marri (ammarri)

**Target feature:** PR Impact Analyzer (`/pr-impact`)

**Main source files:**
- `packages/opencode/src/tool/pr-impact.ts`
- `packages/app/src/pages/session/pr-impact-command.ts`

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4B? | Property (kind) | Test |
|---|---|---|---|---|---|---|
| R1 | S-2, S-3, O-2: "I checked if any other files were gonna be affected" / "I checked whether it touched the leaderboard or lobby code" | The tool reports affected files before the PR is merged, comparing the PR branch to the default branch. | On a branch where `a.ts` changed and `b.ts` imports `a.ts`, running `/pr-impact` without merging lists `b.ts` under "Additional areas that may be affected". | No | Not tested in P4B | — |
| R2 | S-4, O-3, O-4, C-9: "It only knew the files it had" / "it listed files that weren't even imported by what I changed" | Every file the import analysis finds depending on a changed file is listed under "Additional areas that may be affected", and no file outside that analysis is listed. | If the analysis of changed `a.ts` finds `c.ts` importing it, `c.ts` is listed with `a.ts` as its cause, even if `c.ts` was never opened. `z.ts`, which the analysis does not find, is not listed. | Yes | Model / oracle: affected files and their causes match a simple model built from the analysis results. | `packages/opencode/test/tool/pr-impact.property.test.ts` |
| R3 | O-7, O-8, O-10: "The files hit by the most changes should be at the top" | Affected files are ranked by how many changed files they depend on, highest first. | If `x.ts` imports both changed files `a.ts` and `b.ts`, and `y.ts` imports only `a.ts`, then `x.ts` appears above `y.ts`. | No | Invariant: each listed file is affected by at least as many changed files as the one after it. | `packages/opencode/test/tool/pr-impact.property.test.ts` |
| R4 | S-6, S-7, C-5, C-6, O-6: "If I undo a change, the list of affected files should be the same as before" | Merged into R5 (it had the same wording). | See R5. | Yes | — | — |
| R5 | S-6, S-7, C-5, C-6, O-6: "If I undo a change, the list of affected files should be the same as before" | If a PR's changes are fully reverted, the tool shows the no-impact message. | On a branch where a change to `a.ts` was committed and then reverted (no net diff), the report says no files changed and nothing else is affected. | No | Not tested in P4B (covered by the existing unit test "renders a clear state when nothing else is affected") | — |
| R6 | C-4, S-3: "If a file is already in my PR, I don't need it listed again" | A file changed in the PR is never listed under "Additional areas that may be affected". | If `a.ts` and `b.ts` both changed and `b.ts` imports `a.ts`, `b.ts` appears only under "Changed in this PR". | No | Invariant: no changed file appears in the affected areas or tests. | `packages/opencode/test/tool/pr-impact.property.test.ts` |
| R7 | C-8: "The order I list the changed files in shouldn't change what's affected" | The report doesn't depend on the order of the changed files. | Running the analysis on changed files `[a.ts, b.ts]` and `[b.ts, a.ts]` gives identical reports. | No | Metamorphic: shuffling the changed files (and their analysis results) gives an identical formatted report. | `packages/opencode/test/tool/pr-impact.property.test.ts` |

Properties written or suggested by an AI tool: R2, R3, R6, R7. The properties and generators were drafted with Claude, then run, reviewed, and checked against the requirements by me.

## Requirement changes

| ID | Original requirement (P4A) | Revised requirement | Why it changed |
|---|---|---|---|
| R2 | Affected files are exactly the files in the repository that import a changed file. Files with no dependency are not listed, and unmentioned dependents are not missed. | Every file the import analysis finds depending on a changed file is listed under "Additional areas that may be affected", and no file outside that analysis is listed. | Not feasible as written. The tool finds dependents with a text search capped at 1,000 matches, so it cannot guarantee finding every importer (for example, dynamically built import paths, or very large repositories). What users needed was no invented files and no dropped results; the revised wording keeps that and makes it checkable against the analysis results. |
| R4 | If a PR's changes are fully reverted, the tool shows the no-impact message. | Merged into R5. | R4 and R5 had identical wording and acceptance criteria, so R4 could not be checked separately. The interview evidence is kept under R5. |

R1, R3, R5, R6, and R7 were kept because they describe concrete, testable behavior that the feature can support.

## Test Execution and Triage

Four properties were written with `fast-check` for R2, R3, R6, and R7, using three kinds: invariant, model / oracle, and metamorphic.

**R7 failed** on the first run. Shrunk counterexample: changed files `[src/b.ts, src/a.ts, src/c.ts]`, where `docs/a.md` is affected by both `src/b.ts` and `src/a.ts`. Analyzing the files in the order `[src/a.ts, src/b.ts, src/c.ts]` produced the same affected files, but `docs/a.md` was listed as "affected by `src/b.ts`, `src/a.ts`" in one order and "affected by `src/a.ts`, `src/b.ts`" in the other.

**Triage: code bug.** The requirement and the property were both correct: the same PR should always give the same report. `aggregateImpacts` built each file's `causedBy` and `reasons` lists in the order the changed files were processed, which follows the git diff order. **Fix:** `rank` in `pr-impact.ts` now sorts each area's `causedBy` and `reasons` lists before ranking.

R2, R3, and R6 passed on the first run. After the fix, all 4 properties and all 7 existing `pr-impact` unit tests pass.
