import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Agent } from "@/agent/agent"
import { Truncate } from "@/tool/truncate"
import { MessageID, SessionID } from "../../src/session/schema"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import {
  ChangeImpactTool,
  analyzeChangeImpact,
  exportedSymbols,
  formatChangeImpact,
} from "../../src/tool/change-impact"

const MATH = [
  "export function add(a: number, b: number) {",
  "  return a + b",
  "}",
  "export const PI = 3.14",
  "export default class Calculator {}",
].join("\n")

const it = testEffect(
  LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, FSUtil.node, Ripgrep.node, Truncate.node, Agent.node])),
)

describe("change impact", () => {
  test("detects exported symbols from TypeScript and Python files", () => {
    expect(exportedSymbols("src/math.ts", MATH)).toEqual(["add", "PI", "default"])
    expect(
      exportedSymbols(
        "src/index.ts",
        ['export * as Session from "./session"', "const a = 1", "export { a, a as b }", "export type { Info }"].join(
          "\n",
        ),
      ),
    ).toEqual(["Session", "a", "b", "Info"])
    expect(
      exportedSymbols("app/models.py", "class User:\n    def save(self): ...\ndef _hidden(): ...\ndef load(): ..."),
    ).toEqual(["User", "load"])
  })

  test("identifies files that import the changed file through relative paths and aliases", () => {
    const impact = analyzeChangeImpact({
      target: "src/math.ts",
      content: MATH,
      matches: [
        { path: "src/app.ts", line: 1, text: 'import Calculator, { add } from "./math"\n' },
        { path: "src/ui/panel.tsx", line: 4, text: 'import { PI } from "../math.js"' },
        { path: "src/lazy.ts", line: 9, text: 'const math = await import("./math")' },
        { path: "src/legacy.js", line: 2, text: 'const math = require("./math")' },
        { path: "src/alias.ts", line: 3, text: 'import { add } from "@/math"' },
      ],
    })

    expect(impact.dependents.map((file) => [file.path, file.symbols])).toEqual([
      ["src/alias.ts", ["add"]],
      ["src/app.ts", ["default", "add"]],
      ["src/lazy.ts", []],
      ["src/legacy.js", []],
      ["src/ui/panel.tsx", ["PI"]],
    ])
    expect(impact.dependents.find((file) => file.path === "src/app.ts")?.reason).toContain("`default export`, `add`")
  })

  test("ignores unrelated files that only share the module name", () => {
    const impact = analyzeChangeImpact({
      target: "src/math.ts",
      content: MATH,
      matches: [
        { path: "src/other.ts", line: 1, text: 'import { add } from "./lib/math"' },
        { path: "src/calc.ts", line: 1, text: 'import math from "mathjs"' },
        { path: "src/notes.ts", line: 7, text: "// do the math here" },
        { path: "node_modules/pkg/index.js", line: 1, text: 'require("../../src/math")' },
        { path: "src/math.ts", line: 3, text: 'import "./math"' },
      ],
    })

    expect(formatChangeImpact(impact)).toContain("No files directly import or reference this file.")
  })

  test("separates re-exports, tests, mocks, and other references", () => {
    const impact = analyzeChangeImpact({
      target: "src/math.ts",
      content: MATH,
      matches: [
        { path: "src/index.ts", line: 2, text: 'export { add } from "./math"' },
        { path: "src/all.ts", line: 1, text: 'export * from "./math"' },
        { path: "test/math.test.ts", line: 1, text: 'import { add } from "../src/math"' },
        { path: "src/app.test.ts", line: 3, text: 'vi.mock("./math")' },
        { path: "package.json", line: 8, text: '"main": "src/math.ts",' },
        { path: "README.md", line: 12, text: "See math.ts for the calculator helpers." },
      ],
    })

    expect(impact.reExports.map((file) => file.path)).toEqual(["src/all.ts", "src/index.ts"])
    expect(impact.reExports[0].reason).toContain("the whole module")
    expect(impact.tests.map((file) => [file.path, file.relation])).toEqual([
      ["src/app.test.ts", "mock"],
      ["test/math.test.ts", "import"],
    ])
    expect(impact.tests[1].reason).toContain("re-run it")
    expect(impact.references.map((file) => file.path)).toEqual(["package.json", "README.md"])
    expect(impact.dependents).toEqual([])
  })

  test("flags imports of symbols the changed file no longer exports", () => {
    const impact = analyzeChangeImpact({
      target: "src/math.ts",
      content: "export function sum(a: number, b: number) { return a + b }",
      matches: [{ path: "src/app.ts", line: 1, text: 'import { add } from "./math"' }],
    })

    expect(impact.dependents[0].missing).toEqual(["add"])
    expect(impact.dependents[0].reason).toContain("`add` is no longer exported by the changed file")
  })

  test("merges multiple references from the same file", () => {
    const impact = analyzeChangeImpact({
      target: "src/math.ts",
      content: MATH,
      matches: [
        { path: "src/app.ts", line: 10, text: 'import { PI } from "./math"' },
        { path: "src/app.ts", line: 2, text: 'import { add } from "./math"' },
      ],
    })

    expect(impact.dependents).toHaveLength(1)
    expect(impact.dependents[0].lines).toEqual([2, 10])
    expect(impact.dependents[0].symbols).toEqual(["PI", "add"])
  })

  test("resolves index files through their directory", () => {
    const impact = analyzeChangeImpact({
      target: "src/utils/index.ts",
      content: "export const clamp = () => 0",
      matches: [
        { path: "src/app.ts", line: 1, text: 'import { clamp } from "./utils"' },
        { path: "src/utils/other.ts", line: 1, text: 'import { clamp } from "."' },
      ],
    })

    expect(impact.dependents.map((file) => file.path)).toEqual(["src/app.ts", "src/utils/other.ts"])
  })

  test("resolves Python absolute, relative, and module imports", () => {
    const impact = analyzeChangeImpact({
      target: "app/services/billing.py",
      content: "def charge(): ...\nclass Invoice: ...",
      matches: [
        { path: "app/api.py", line: 1, text: "from app.services.billing import charge, Invoice" },
        { path: "app/services/jobs.py", line: 2, text: "from .billing import charge" },
        { path: "app/cli.py", line: 3, text: "from app.services import billing" },
        { path: "app/worker.py", line: 1, text: "import app.services.billing as billing" },
        { path: "tests/test_billing.py", line: 1, text: "from app.services.billing import charge" },
        { path: "app/other.py", line: 1, text: "from app.payments.billing import charge" },
      ],
    })

    expect(impact.dependents.map((file) => [file.path, file.symbols])).toEqual([
      ["app/api.py", ["charge", "Invoice"]],
      ["app/cli.py", ["*"]],
      ["app/services/jobs.py", ["charge"]],
      ["app/worker.py", ["*"]],
    ])
    expect(impact.tests.map((file) => file.path)).toEqual(["tests/test_billing.py"])
  })

  test("renders a structured report", () => {
    const output = formatChangeImpact(
      analyzeChangeImpact({
        target: "src/math.ts",
        content: MATH,
        matches: [
          { path: "src/app.ts", line: 1, text: 'import { add } from "./math"' },
          { path: "test/math.test.ts", line: 1, text: 'import { add } from "../src/math"' },
        ],
      }),
    )

    expect(output).toContain("# Change impact: `src/math.ts`")
    expect(output).toContain("Exported symbols: `add`, `PI`, `default`")
    expect(output).toContain("Found 2 directly affected files.")
    expect(output).toContain("## Re-exports (impact propagates further)\n- None found.")
    expect(output).toContain("## Direct dependents\n- `src/app.ts` (line 1) — Uses `add` from the changed file")
    expect(output).toContain("## Tests to re-run\n- `test/math.test.ts` (line 1) — Tests `add`")
    expect(output).toContain("## Scope")
  })

  test("reports when the changed file cannot be read", () => {
    const output = formatChangeImpact(analyzeChangeImpact({ target: "src/gone.ts", content: undefined, matches: [] }))

    expect(output).toContain("could not be read")
  })

  it.instance("analyzes a real project behind a grep permission", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        Promise.all([
          Bun.write(path.join(test.directory, "src/math.ts"), MATH),
          Bun.write(path.join(test.directory, "src/app.ts"), 'import { add } from "./math"\nconsole.log(add(1, 2))\n'),
          Bun.write(path.join(test.directory, "src/index.ts"), 'export * from "./math"\n'),
          Bun.write(path.join(test.directory, "test/math.test.ts"), 'import { add, subtract } from "../src/math"\n'),
          Bun.write(path.join(test.directory, "src/unrelated.ts"), "const math = 1\n"),
        ]),
      )
      const info = yield* ChangeImpactTool
      const tool = yield* info.init()
      const permissions: unknown[] = []
      const result = yield* tool.execute(
        { filePath: "src/math.ts" },
        {
          sessionID: SessionID.make("ses_test"),
          messageID: MessageID.make("msg_test"),
          callID: "",
          agent: "build",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: () => Effect.void,
          ask: (request) => Effect.sync(() => permissions.push(request)),
        },
      )

      expect(permissions).toEqual([expect.objectContaining({ permission: "grep", patterns: ["src/math.ts"] })])
      expect(result.title).toBe("src/math.ts")
      expect(result.output).toContain("- `src/index.ts` (line 1) — Re-exports the whole module")
      expect(result.output).toContain("- `src/app.ts` (line 1) — Uses `add` from the changed file")
      expect(result.output).toContain("`subtract` is no longer exported by the changed file")
      expect(result.output).not.toContain("unrelated")
      expect(result.metadata.affectedFiles).toBe(3)
    }),
  )
})
