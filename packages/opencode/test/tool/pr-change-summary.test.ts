import { describe, expect, test } from "bun:test"
import { summarizeChanges, formatChangeSummary } from "../../src/tool/pr-change-summary"

describe("pr change summary", () => {
  const items = [
    { file: "packages/opencode/src/tool/new-tool.ts", status: "added" as const },
    { file: "packages/opencode/src/tool/registry.ts", status: "modified" as const },
    { file: "packages/ui/src/old.tsx", status: "deleted" as const },
    { file: "README.md", status: "modified" as const },
  ]

  const stats = [
    { file: "packages/opencode/src/tool/new-tool.ts", additions: 120, deletions: 0 },
    { file: "packages/opencode/src/tool/registry.ts", additions: 4, deletions: 0 },
    { file: "packages/ui/src/old.tsx", additions: 0, deletions: 45 },
    { file: "README.md", additions: 2, deletions: 1 },
  ]

  test("counts files by status", () => {
    const summary = summarizeChanges(items, stats)
    expect(summary.files).toHaveLength(4)
    expect(summary.added).toBe(1)
    expect(summary.modified).toBe(2)
    expect(summary.deleted).toBe(1)
  })

  test("totals additions and deletions", () => {
    const summary = summarizeChanges(items, stats)
    expect(summary.additions).toBe(126)
    expect(summary.deletions).toBe(46)
  })

  test("groups changes by area", () => {
    const summary = summarizeChanges(items, stats)
    expect(summary.areas).toEqual([
      { area: "(root)", files: 1, additions: 2, deletions: 1 },
      { area: "packages/opencode", files: 2, additions: 124, deletions: 0 },
      { area: "packages/ui", files: 1, additions: 0, deletions: 45 },
    ])
  })

  test("ranks the largest changes first", () => {
    const summary = summarizeChanges(items, stats)
    expect(summary.largest[0].file).toBe("packages/opencode/src/tool/new-tool.ts")
    expect(summary.largest[1].file).toBe("packages/ui/src/old.tsx")
  })

  test("handles files with no recorded line stats", () => {
    const summary = summarizeChanges([{ file: "binary.png", status: "added" as const }], [])
    expect(summary.files[0].additions).toBe(0)
    expect(summary.files[0].deletions).toBe(0)
    expect(summary.largest).toEqual([])
  })

  test("renders an empty summary when nothing changed", () => {
    const output = formatChangeSummary(summarizeChanges([], []))
    expect(output).toBe(["# Change summary", "", "No changes were found against the base branch."].join("\n"))
  })

  test("renders structured sections", () => {
    const output = formatChangeSummary(summarizeChanges(items, stats))
    expect(output).toContain("## Overview")
    expect(output).toContain("4 file(s) changed: 1 added, 2 modified, 1 deleted")
    expect(output).toContain("126 line(s) added, 46 line(s) removed")
    expect(output).toContain("## Areas touched")
    expect(output).toContain("## Largest changes")
    expect(output).toContain("## All changed files")
  })
})