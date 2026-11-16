import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import type { ChangeImpact, ImpactedFile } from "../../src/tool/change-impact"
import { aggregateImpacts, formatPrImpact } from "../../src/tool/pr-impact"

// Generator rationale:
// File paths come from a small pool so the interesting cases happen often:
// a dependent that is also changed in the PR (R6), a file hit by several
// changed files (R3), and the same file reached through different lists.
// Each changed file gets one ChangeImpact (as the tool builds them), with
// random dependents, re-exports, references, and tests drawn from the pool.
const PATHS = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/index.ts", "lib/e.ts", "docs/a.md"]
const TEST_PATHS = ["test/a.test.ts", "test/b.test.ts", "src/c.spec.ts"]

const impactedFile = (paths: string[]) =>
  fc
    .tuple(fc.constantFrom(...paths), fc.constantFrom("imports it", "re-exports it", "mentions it", "tests it"))
    .map(
      ([path, reason]): ImpactedFile => ({ path, relation: "import", lines: [1], symbols: [], missing: [], reason }),
    )

const fileList = (paths: string[]) =>
  fc.uniqueArray(impactedFile(paths), { selector: (file) => file.path, maxLength: 4 })

const impactFor = (target: string) =>
  fc
    .record({
      reExports: fileList(PATHS),
      dependents: fileList(PATHS),
      references: fileList(PATHS),
      tests: fileList(TEST_PATHS),
    })
    .map((parts): ChangeImpact => ({ target, exports: [], ...parts }))

// A PR: 0-4 changed files, each with its own analysis result.
const pr = fc
  .uniqueArray(fc.constantFrom(...PATHS), { maxLength: 4 })
  .chain((changed) => fc.tuple(fc.constant(changed), fc.tuple(...changed.map(impactFor))))

describe("PR Impact Analyzer - property-based tests", () => {
  // R6: A file changed in the PR is never listed under "Additional areas that may be affected".
  // Kind: Invariant
  test("R6: changed files never appear as affected areas or tests", () => {
    fc.assert(
      fc.property(pr, ([changed, impacts]) => {
        const result = aggregateImpacts(changed, impacts)
        for (const area of [...result.impacted, ...result.tests]) expect(changed).not.toContain(area.path)
      }),
    )
  })

  // R3: Affected files are ranked by how many changed files they depend on, highest first.
  // Kind: Invariant
  test("R3: affected files are ranked by number of changed files, highest first", () => {
    fc.assert(
      fc.property(pr, ([changed, impacts]) => {
        const result = aggregateImpacts(changed, impacts)
        for (const list of [result.impacted, result.tests]) {
          for (let i = 0; i + 1 < list.length; i++) {
            expect(list[i].causedBy.length).toBeGreaterThanOrEqual(list[i + 1].causedBy.length)
          }
        }
      }),
    )
  })

  // R2 (revised): Every file the import analysis finds depending on a changed file is listed,
  // and no file outside that analysis is listed.
  // Kind: Model / oracle
  // The model is a simple loop: for each non-test result of each changed file's analysis,
  // record which changed file caused it, skipping files that are in the PR.
  test("R2: affected files match a simple model of the analysis results", () => {
    fc.assert(
      fc.property(pr, ([changed, impacts]) => {
        const model = new Map<string, Set<string>>()
        for (const impact of impacts) {
          for (const file of [...impact.reExports, ...impact.dependents, ...impact.references]) {
            if (changed.includes(file.path)) continue
            if (!model.has(file.path)) model.set(file.path, new Set())
            model.get(file.path)!.add(impact.target)
          }
        }
        const result = aggregateImpacts(changed, impacts)
        expect(result.impacted.map((area) => area.path).sort()).toEqual([...model.keys()].sort())
        for (const area of result.impacted) {
          expect([...area.causedBy].sort()).toEqual([...model.get(area.path)!].sort())
        }
      }),
    )
  })

  // R7: The report doesn't depend on the order of the changed files.
  // Kind: Metamorphic
  // The tool analyzes changed files in diff order, so a different order means the same
  // analysis results arrive in a different order. Both are shuffled together.
  test("R7: reordering the changed files gives the same report", () => {
    const prAndShuffle = pr.chain(([changed, impacts]) =>
      fc.tuple(
        fc.constant(changed),
        fc.constant(impacts),
        fc.shuffledSubarray(
          changed.map((_, i) => i),
          { minLength: changed.length, maxLength: changed.length },
        ),
      ),
    )
    fc.assert(
      fc.property(prAndShuffle, ([changed, impacts, order]) => {
        const original = formatPrImpact(aggregateImpacts(changed, impacts))
        const reordered = formatPrImpact(
          aggregateImpacts(
            order.map((i) => changed[i]),
            order.map((i) => impacts[i]),
          ),
        )
        expect(reordered).toEqual(original)
      }),
    )
  })
})
