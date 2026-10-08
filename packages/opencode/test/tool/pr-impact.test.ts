import { describe, expect, test } from "bun:test"
import type { ChangeImpact, ImpactedFile } from "../../src/tool/change-impact"
import { aggregateImpacts, formatPrImpact } from "../../src/tool/pr-impact"

const file = (path: string, reason: string): ImpactedFile => ({
  path,
  relation: "import",
  lines: [1],
  symbols: [],
  missing: [],
  reason,
})

const impact = (target: string, parts: Partial<ChangeImpact> = {}): ChangeImpact => ({
  target,
  exports: [],
  reExports: [],
  dependents: [],
  tests: [],
  references: [],
  ...parts,
})

describe("pr impact", () => {
  test("excludes files that are already changed in the PR", () => {
    const result = aggregateImpacts(
      ["src/a.ts", "src/b.ts"],
      [impact("src/a.ts", { dependents: [file("src/b.ts", "imports a"), file("src/c.ts", "imports a")] })],
    )
    expect(result.impacted.map((area) => area.path)).toEqual(["src/c.ts"])
  })

  test("merges a file affected by several changed files", () => {
    const result = aggregateImpacts(
      ["src/a.ts", "src/b.ts"],
      [
        impact("src/a.ts", { dependents: [file("src/c.ts", "imports a")] }),
        impact("src/b.ts", { dependents: [file("src/c.ts", "imports b")] }),
      ],
    )
    expect(result.impacted).toEqual([
      { path: "src/c.ts", causedBy: ["src/a.ts", "src/b.ts"], reasons: ["imports a", "imports b"] },
    ])
  })

  test("ranks files affected by more changed files first", () => {
    const result = aggregateImpacts(
      ["src/a.ts", "src/b.ts"],
      [
        impact("src/a.ts", { dependents: [file("src/x.ts", "imports a"), file("src/y.ts", "imports a")] }),
        impact("src/b.ts", { dependents: [file("src/y.ts", "imports b")] }),
      ],
    )
    expect(result.impacted.map((area) => area.path)).toEqual(["src/y.ts", "src/x.ts"])
  })

  test("separates tests from other affected files", () => {
    const result = aggregateImpacts(
      ["src/a.ts"],
      [impact("src/a.ts", { dependents: [file("src/c.ts", "imports a")], tests: [file("test/a.test.ts", "tests a")] })],
    )
    expect(result.impacted.map((area) => area.path)).toEqual(["src/c.ts"])
    expect(result.tests.map((area) => area.path)).toEqual(["test/a.test.ts"])
  })

  test("includes re-exports and references as affected areas", () => {
    const result = aggregateImpacts(
      ["src/a.ts"],
      [
        impact("src/a.ts", {
          reExports: [file("src/index.ts", "re-exports a")],
          references: [file("docs/a.md", "mentions a")],
        }),
      ],
    )
    expect(result.impacted.map((area) => area.path)).toEqual(["docs/a.md", "src/index.ts"])
  })

  test("renders a clear state when nothing else is affected", () => {
    const output = formatPrImpact(aggregateImpacts(["src/a.ts"], [impact("src/a.ts")]))
    expect(output).toContain("## Changed in this PR\n- `src/a.ts`")
    expect(output).toContain("No additional files outside this PR appear to be affected.")
  })

  test("renders PR changes separately from affected areas", () => {
    const output = formatPrImpact(
      aggregateImpacts(
        ["src/a.ts"],
        [impact("src/a.ts", { dependents: [file("src/c.ts", "imports a")], tests: [file("test/a.test.ts", "tests a")] })],
      ),
    )
    expect(output).toContain("## Changed in this PR\n- `src/a.ts`")
    expect(output).toContain("## Additional areas that may be affected\n- `src/c.ts` — affected by `src/a.ts`\n  - imports a")
    expect(output).toContain("## Tests to re-run\n- `test/a.test.ts` — affected by `src/a.ts`\n  - tests a")
  })
})