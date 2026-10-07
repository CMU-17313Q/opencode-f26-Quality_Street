import { afterAll, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import {
  analyseApproach,
  collectRepoContext,
  explainTradeoffs,
  parseApproach,
  type RepoContext,
  type TradeoffResult,
} from "../../src/util/design-tradeoff"

const nodeRepo: RepoContext = {
  languages: ["TypeScript"],
  dependencies: ["express", "zod"],
  testFramework: "vitest",
  hasTests: true,
}

function ready(result: TradeoffResult) {
  if (result.status !== "ready") throw new Error(`expected ready result, got: ${JSON.stringify(result)}`)
  return result
}

function rating(result: ReturnType<typeof ready>, approach: number, factor: string) {
  return result.approaches[approach].factors.find((item) => item.factor === factor)?.rating
}

describe("design tradeoff explainer", () => {
  describe("parseApproach", () => {
    test("splits a short name prefix from the description", () => {
      expect(parseApproach("In-memory map: keep sessions in a Map", "Approach A")).toEqual({
        name: "In-memory map",
        description: "keep sessions in a Map",
      })
    })

    test("falls back to the default name when there is no prefix", () => {
      expect(parseApproach("  store everything in one big file  ", "Approach B")).toEqual({
        name: "Approach B",
        description: "store everything in one big file",
      })
    })
  })

  describe("scenario: storing user sessions", () => {
    const result = ready(
      explainTradeoffs({
        decision: "How should we store user sessions?",
        approaches: [
          { name: "In-memory map", description: "Keep a global in-memory map of sessions in the server process" },
          { name: "Redis", description: "Install redis as a new dependency and persist sessions there" },
        ],
        context: nodeRepo,
      }),
    )

    test("compares both approaches across the software engineering factors", () => {
      expect(result.approaches).toHaveLength(2)
      for (const analysis of result.approaches) {
        expect(analysis.factors.map((factor) => factor.factor)).toEqual([
          "complexity",
          "maintainability",
          "testability",
          "consistency",
          "performance",
        ])
      }
    })

    test("explains advantages and disadvantages of each approach", () => {
      for (const analysis of result.approaches) {
        expect(analysis.advantages.length).toBeGreaterThan(0)
        expect(analysis.disadvantages.length).toBeGreaterThan(0)
      }
      expect(rating(result, 0, "testability")).toBe("unfavorable")
      expect(rating(result, 0, "performance")).toBe("favorable")
    })

    test("uses repository context to judge consistency", () => {
      const consistency = result.approaches[1].factors.find((factor) => factor.factor === "consistency")!
      expect(consistency.rating).toBe("unfavorable")
      expect(consistency.cons.some((reason) => reason.includes("`redis`"))).toBe(true)
      expect(result.context).toContain("Tests: found (vitest)")
    })

    test("does not choose a winner but explains when each approach fits", () => {
      expect(result.contrasts.at(-1)).toContain("does not pick a winner")
      expect(result.contrasts.some((line) => line.includes('"In-memory map"'))).toBe(true)
      expect(result.questions.length).toBeGreaterThan(0)
    })
  })

  describe("scenario: adding new export formats", () => {
    const result = ready(
      explainTradeoffs({
        decision: "How should we support new export formats?",
        approaches: [
          { name: "Switch", description: "Add a switch statement directly in the export function for each format" },
          {
            name: "Strategy",
            description: "Define an exporter interface with one separate module per format and unit tests for each",
          },
          { name: "Copy", description: "Copy the existing CSV exporter and duplicate it for each new format" },
        ],
        context: nodeRepo,
      }),
    )

    test("supports comparing three approaches", () => {
      expect(result.approaches.map((analysis) => analysis.approach.name)).toEqual(["Switch", "Strategy", "Copy"])
    })

    test("captures the simplicity versus maintainability tradeoff", () => {
      expect(rating(result, 0, "complexity")).toBe("favorable")
      expect(rating(result, 0, "maintainability")).toBe("unfavorable")
      expect(rating(result, 1, "maintainability")).toBe("favorable")
      expect(rating(result, 1, "complexity")).toBe("unfavorable")
      expect(rating(result, 1, "testability")).toBe("favorable")
    })

    test("credits reuse of existing code for consistency", () => {
      expect(rating(result, 2, "consistency")).toBe("favorable")
    })
  })

  test("credits approaches that use a dependency the repository already has", () => {
    const analysis = analyseApproach(
      { name: "Zod", description: "Validate the request body with zod schemas before saving" },
      nodeRepo,
    )
    const consistency = analysis.factors.find((factor) => factor.factor === "consistency")!
    expect(consistency.rating).toBe("favorable")
    expect(consistency.pros[0]).toContain("`zod`")
  })

  test("flags an approach written in a language the repository does not use", () => {
    const analysis = analyseApproach(
      { name: "Script", description: "Write a separate python script that the server calls" },
      nodeRepo,
    )
    const consistency = analysis.factors.find((factor) => factor.factor === "consistency")!
    expect(consistency.cons.some((reason) => reason.includes("Python"))).toBe(true)
  })

  test("asks how the result will be verified when the repository has no tests", () => {
    const result = ready(
      explainTradeoffs({
        decision: "Where should validation live?",
        approaches: [
          { name: "Inline", description: "Hardcode the checks inline in the request handler" },
          { name: "Helper", description: "Move the checks into a separate helper module of pure functions" },
        ],
        context: { languages: ["JavaScript"], dependencies: [], hasTests: false },
      }),
    )
    expect(result.questions.some((question) => question.includes("No tests were detected"))).toBe(true)
  })

  describe("insufficient information", () => {
    test("requires at least two approaches", () => {
      const result = explainTradeoffs({
        decision: "How should we cache results?",
        approaches: [
          { name: "Cache", description: "Cache results in memory for five minutes" },
          { name: "Empty", description: "   " },
        ],
      })
      expect(result.status).toBe("insufficient")
      if (result.status !== "insufficient") return
      expect(result.problems).toContain("At least two approaches are needed to compare tradeoffs.")
      expect(result.hints.length).toBeGreaterThan(0)
    })

    test("requires a decision", () => {
      const result = explainTradeoffs({
        decision: "",
        approaches: [
          { name: "A", description: "Cache results in memory with a map" },
          { name: "B", description: "Persist results in the database table" },
        ],
      })
      expect(result.status).toBe("insufficient")
      if (result.status !== "insufficient") return
      expect(result.problems[0]).toContain("decision")
    })

    test("rejects descriptions that are too short or identical", () => {
      const result = explainTradeoffs({
        decision: "Which approach?",
        approaches: [
          { name: "A", description: "use redis" },
          { name: "B", description: "Use a global cache object" },
          { name: "C", description: "use a GLOBAL cache object!" },
        ],
      })
      expect(result.status).toBe("insufficient")
      if (result.status !== "insufficient") return
      expect(result.problems.some((problem) => problem.includes('"A" is too short'))).toBe(true)
      expect(result.problems.some((problem) => problem.includes('"B" and "C"'))).toBe(true)
    })

    test("reports approaches that contain nothing comparable", () => {
      const result = explainTradeoffs({
        decision: "How should we build the feature?",
        approaches: [
          { name: "A", description: "Do it the way that seems best to us" },
          { name: "B", description: "Keep a global in-memory map of items" },
        ],
      })
      expect(result.status).toBe("insufficient")
      if (result.status !== "insufficient") return
      expect(result.problems).toHaveLength(1)
      expect(result.problems[0]).toContain('"A"')
    })
  })

  describe("collectRepoContext", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tradeoff-"))
    afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))

    test("reads languages, dependencies and test setup from the repository", () => {
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({ dependencies: { express: "^4" }, devDependencies: { vitest: "^1" } }),
      )
      fs.mkdirSync(path.join(directory, "src"))
      fs.writeFileSync(path.join(directory, "src", "server.ts"), "export {}")
      fs.writeFileSync(path.join(directory, "src", "server.test.ts"), "export {}")
      fs.mkdirSync(path.join(directory, "node_modules", "ignored"), { recursive: true })
      fs.writeFileSync(path.join(directory, "node_modules", "ignored", "index.py"), "")

      expect(collectRepoContext(directory)).toEqual({
        languages: ["TypeScript"],
        dependencies: ["express", "vitest"],
        testFramework: "vitest",
        hasTests: true,
      })
    })

    test("returns an empty context for a missing directory", () => {
      expect(collectRepoContext(path.join(directory, "missing"))).toEqual({
        languages: [],
        dependencies: [],
        testFramework: undefined,
        hasTests: false,
      })
    })
  })
})
