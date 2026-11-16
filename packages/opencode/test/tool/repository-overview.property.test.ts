
import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import {
  analyzeRepositoryFiles,
  formatRepositoryOverview,
} from "../../src/tool/repository-overview"

describe("Repository Overview - Property-Based Tests", () => {
  // R3: The overview must exclude dependency directories
  // from its list of project components.
  // Kind: Invariant
  //
  // Generator rationale:
  // Different dependency directories and nested file paths are
  // combined to verify that excluded folders never appear as
  // project components. This includes .venv, which was identified
  // as a missing exclusion during initial testing.
  test("R3: dependency directories are excluded", () => {
    const excludedDirectory = fc.constantFrom(
      "node_modules",
      ".venv",
      "dist",
      "build",
      "coverage",
      "__pycache__",
    )

    const filePath = fc.constantFrom(
      "index.js",
      "lib/util.ts",
      "packages/module.py",
    )

    fc.assert(
      fc.property(excludedDirectory, filePath, (directory, file) => {
        const overview = analyzeRepositoryFiles([
          "src/index.ts",
          `${directory}/${file}`,
        ])

        expect(
          overview.components.map((component) => component.path),
        ).toEqual(["src"])
      }),
      { numRuns: 100 },
    )
  })

  // R4: Given the file paths returned by the latest repository scan,
  // the generated overview must reflect those paths without retaining
  // outdated paths from earlier scans.
  // Kind: Round-trip
  //
  // Generator rationale:
  // Random subsets of common source, test, package, and configuration
  // files represent different repository structures. A temporary
  // directory is added and removed to verify that the analyzer
  // returns to the original overview without stale references.
  //
  // This tests the analysis of successive file lists, not the
  // filesystem scanner or caching behavior itself.
  test("R4: adding and removing a directory restores the overview", () => {
    const baseFiles = fc.uniqueArray(
      fc.constantFrom(
        "src/index.ts",
        "src/utils.ts",
        "tests/app.test.ts",
        "packages/ui/button.tsx",
        "README.md",
        "package.json",
      ),
      { minLength: 1 },
    )

    fc.assert(
      fc.property(baseFiles, (files) => {
        const original = analyzeRepositoryFiles(files)

        const withTemporary = analyzeRepositoryFiles([
          ...files,
          "temp-feature/index.ts",
        ])

        const restored = analyzeRepositoryFiles(files)

        expect(
          withTemporary.components.some(
            (component) => component.path === "temp-feature",
          ),
        ).toBe(true)

        expect(restored).toEqual(original)
      }),
      { numRuns: 100 },
    )
  })

  // R5: The overview must reflect newly added project components
  // while keeping information about unaffected components consistent.
  // Kind: Metamorphic
  //
  // Generator rationale:
  // Different existing repository files are combined with newly
  // added documentation, script, or configuration directories.
  // These represent realistic additions that should update the
  // component list without changing unrelated descriptions,
  // important files, or entry points.
  test("R5: adding a directory preserves existing descriptions", () => {
    const additionalFiles = fc.uniqueArray(
      fc.constantFrom(
        "src/utils.ts",
        "tests/app.test.ts",
        "packages/ui/button.tsx",
        "README.md",
        "package.json",
      ),
    )

    const newFile = fc.constantFrom(
      "docs/guide.md",
      "scripts/run.ts",
      "config/settings.json",
    )

    fc.assert(
      fc.property(additionalFiles, newFile, (files, addedFile) => {
        const originalFiles = ["src/index.ts", ...files]

        const before = analyzeRepositoryFiles(originalFiles)
        const after = analyzeRepositoryFiles([
          ...originalFiles,
          addedFile,
        ])

        const addedDirectory = addedFile.split("/")[0]

        expect(
          after.components.some(
            (component) => component.path === addedDirectory,
          ),
        ).toBe(true)

        for (const component of before.components) {
          expect(after.components).toContainEqual(component)
        }

        expect(after.importantFiles).toEqual(before.importantFiles)
        expect(after.entryPoints).toEqual(before.entryPoints)
      }),
      { numRuns: 100 },
    )
  })

  // R6: The overview must provide accurate file and directory
  // references that users can verify against the repository.
  // Kind: Model / Oracle
  //
  // Generator rationale:
  // Random combinations of source files, test files, configuration
  // files, entry points, and dependency paths represent different
  // repository layouts. Sets of the generated input paths serve as
  // a simple reference model for checking the overview.
  //
  // Every reported path must exist in the supplied repository
  // structure. The test also verifies that known important paths
  // are included and that formatted output does not invent paths.
  test("R6: overview references correspond to actual paths", () => {
    const additionalFiles = fc.uniqueArray(
      fc.constantFrom(
        "src/utils.ts",
        "src/main.ts",
        "tests/app.test.ts",
        "packages/ui/button.tsx",
        "docs/guide.md",
        "scripts/build.ts",
        "README.md",
        "tsconfig.json",
        "main.py",
        "lib/client.ts",
        "node_modules/library/index.js",
      ),
      { maxLength: 10 },
    )

    fc.assert(
      fc.property(additionalFiles, (extraFiles) => {
        const files = ["src/index.ts", "package.json", ...extraFiles]
        const overview = analyzeRepositoryFiles(files)
        const output = formatRepositoryOverview(overview)

        const actualFiles = new Set(files)
        const actualDirectories = new Set(
          files
            .filter((file) => file.includes("/"))
            .map((file) => file.split("/")[0]),
        )

        for (const item of [
          ...overview.importantFiles,
          ...overview.entryPoints,
        ]) {
          expect(actualFiles.has(item.path)).toBe(true)
        }

        for (const component of overview.components) {
          expect(actualDirectories.has(component.path)).toBe(true)
        }

        expect(output).toContain("`package.json`")
        expect(output).toContain("`src/index.ts`")

        const displayedPaths = [
          ...output.matchAll(/`([^`]+)`/g),
        ].map((match) => match[1])

        for (const path of displayedPaths) {
          expect(
            actualFiles.has(path) || actualDirectories.has(path),
          ).toBe(true)
        }
      }),
      { numRuns: 100 },
    )
  })
})
