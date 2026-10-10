import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Agent } from "@/agent/agent"
import { Truncate } from "@/tool/truncate"
import { MessageID, SessionID } from "../../src/session/schema"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import {
  TestFailureTool,
  formatTestFailureReport,
  importCandidates,
  parseTestFailures,
} from "../../src/tool/test-failure"

const it = testEffect(
  LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, FSUtil.node, Truncate.node, Agent.node])),
)

const BUN_OUTPUT = [
  "test/math.test.ts:",
  "3 | import { add } from '../src/math'",
  "4 | test('adds numbers', () => {",
  "5 |   expect(add(2, 2)).toBe(4)",
  "                       ^",
  "error: expect(received).toBe(expected)",
  "",
  "Expected: 4",
  "Received: 5",
  "",
  "      at <anonymous> (/repo/test/math.test.ts:5:23)",
  "(fail) math > adds numbers [0.42ms]",
  "(pass) math > subtracts numbers [0.10ms]",
].join("\n")

const JEST_OUTPUT = [
  " FAIL  src/cart.test.js",
  "  ● cart › computes the total",
  "",
  "    TypeError: Cannot read properties of undefined (reading 'price')",
  "",
  "      3 | export function total(items) {",
  "    > 4 |   return items.reduce((sum, item) => sum + item.product.price, 0)",
  "        |                                                         ^",
  "",
  "      at price (src/cart.js:4:57)",
  "      at Array.reduce (<anonymous>)",
  "      at total (src/cart.js:4:16)",
  "      at Object.<anonymous> (src/cart.test.js:7:12)",
  "",
  "Test Suites: 1 failed, 1 total",
].join("\n")

const VITEST_OUTPUT = [
  "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
  "",
  " FAIL  src/format.test.ts > format > pads the number",
  "AssertionError: expected '7' to be '07' // Object.is equality",
  "",
  " ❯ src/format.test.ts:6:24",
  "",
  "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯",
].join("\n")

const PYTEST_OUTPUT = [
  "=================================== FAILURES ===================================",
  "___________________________________ test_charge ___________________________________",
  "",
  "    def test_charge():",
  ">       assert charge(10) == 11",
  "",
  "tests/test_billing.py:4: ",
  "_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _",
  "",
  "    def charge(amount):",
  ">       return amount * TAX_RATE",
  "E       NameError: name 'TAX_RATE' is not defined",
  "",
  "app/billing.py:2: NameError",
  "=========================== short test summary info ============================",
  "FAILED tests/test_billing.py::test_charge - NameError: name 'TAX_RATE' is not defined",
].join("\n")

describe("test failure explainer", () => {
  test("reads a Bun assertion failure with expected and received values", () => {
    const [failure] = parseTestFailures(BUN_OUTPUT, "/repo")

    expect(failure).toMatchObject({
      name: "math > adds numbers",
      file: "test/math.test.ts",
      line: 5,
      kind: "assertion",
      message: "expect(received).toBe(expected)",
      expected: "4",
      received: "5",
    })
  })

  test("reads a Jest type error and the implementation frames it came from", () => {
    const [failure] = parseTestFailures(JEST_OUTPUT)

    expect(failure).toMatchObject({
      name: "cart › computes the total",
      file: "src/cart.test.js",
      line: 7,
      kind: "type-error",
      message: "TypeError: Cannot read properties of undefined (reading 'price')",
    })
    expect(failure.frames.map((frame) => `${frame.file}:${frame.line}`)).toEqual([
      "src/cart.js:4",
      "src/cart.js:4",
      "src/cart.test.js:7",
    ])
  })

  test("reads a Vitest assertion and its expected and received values from the message", () => {
    const [failure] = parseTestFailures(VITEST_OUTPUT)

    expect(failure).toMatchObject({
      name: "format > pads the number",
      file: "src/format.test.ts",
      line: 6,
      kind: "assertion",
      expected: "'07'",
      received: "'7'",
    })
  })

  test("reads a pytest failure raised inside the implementation", () => {
    const [failure] = parseTestFailures(PYTEST_OUTPUT)

    expect(failure).toMatchObject({
      name: "test_charge",
      file: "tests/test_billing.py",
      line: 4,
      kind: "reference-error",
      message: "NameError: name 'TAX_RATE' is not defined",
    })
    expect(failure.frames).toContainEqual({ file: "app/billing.py", line: 2, fn: undefined })
  })

  test("classifies timeouts, missing modules, and pytest assertions", () => {
    const timeout = parseTestFailures('error: Test "loads data" timed out after 5000ms\n(fail) loads data [5001.00ms]')
    const missing = parseTestFailures(
      "error: Cannot find module './pricing' from '/repo/src/cart.ts'\n(fail) cart > totals [0.20ms]",
    )
    const assertion = parseTestFailures(
      "___ test_add ___\n>       assert add(2, 2) == 4\nE       assert 5 == 4\nFAILED tests/test_math.py::test_add",
    )

    expect(timeout[0].kind).toBe("timeout")
    expect(missing[0].kind).toBe("module-not-found")
    expect(assertion[0]).toMatchObject({ kind: "assertion", received: "5", expected: "4" })
  })

  test("ignores colors, passing tests, and dependency frames", () => {
    const failures = parseTestFailures(
      [
        "\x1b[31m(pass)\x1b[0m sums [0.10ms]",
        "error: boom",
        "      at run (/repo/node_modules/lib/index.js:1:1)",
        "      at parse (/repo/src/parse.ts:9:3)",
        "\x1b[31m(fail)\x1b[0m parses input [0.30ms]",
      ].join("\n"),
      "/repo",
    )

    expect(failures).toHaveLength(1)
    expect(failures[0].frames).toEqual([{ file: "src/parse.ts", line: 9, fn: "parse" }])
  })

  test("explains the failure and points to the code without giving a fix", () => {
    const output = formatTestFailureReport(parseTestFailures(JEST_OUTPUT), { "src/cart.test.js": ["src/cart.js"] })

    expect(output).toContain("## 1. cart › computes the total")
    expect(output).toContain("- **Test:** `src/cart.test.js:7`")
    expect(output).toContain(
      "- **Error:** Type error — `TypeError: Cannot read properties of undefined (reading 'price')`",
    )
    expect(output).toContain("**What this means:** A value was used in a way its type does not allow")
    expect(output).toContain("- `src/cart.js:4` in `price` — where the error was raised")
    expect(output).toContain("- `src/cart.js:4` in `total` — called on the way to the error")
    expect(output).toContain("**Questions to investigate:**")
    expect(output).not.toContain("imported by the test")
  })

  test("uses expected and received values in the explanation", () => {
    const output = formatTestFailureReport(parseTestFailures(BUN_OUTPUT, "/repo"), {
      "test/math.test.ts": ["src/math.ts"],
    })

    expect(output).toContain("The test expected `4` but the code produced `5`.")
    expect(output).toContain("- `src/math.ts` — imported by the test, so it is likely the code under test")
  })

  test("says when no implementation file can be identified", () => {
    const output = formatTestFailureReport(parseTestFailures("error: boom\n(fail) does something [0.10ms]"))

    expect(output).toContain("No implementation file could be identified from this output.")
  })

  test("shows a clear state when no failure can be found", () => {
    const output = formatTestFailureReport(parseTestFailures("12 pass\n0 fail\nRan 12 tests across 3 files."))

    expect(output).toContain("No failing tests could be identified in this output.")
    expect(output).toContain("Supported formats are Bun, Jest, Vitest, and pytest.")
  })

  test("lists implementation files a test may import", () => {
    expect(
      importCandidates(
        "test/math.test.ts",
        'import { add } from "../src/math"\nimport { helper } from "./helpers.test"',
      ),
    ).toEqual([
      [
        "src/math",
        "src/math.ts",
        "src/math.tsx",
        "src/math.js",
        "src/math.jsx",
        "src/math.mjs",
        "src/math.cjs",
        "src/math/index.ts",
        "src/math/index.js",
      ],
      [],
    ])
    expect(importCandidates("tests/test_billing.py", "from app.billing import charge\nimport os")).toEqual([
      ["app/billing.py", "app/billing/__init__.py"],
      ["os.py", "os/__init__.py"],
    ])
  })

  it.instance("reads the failing test file to find the code under test", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      yield* Effect.promise(() =>
        Promise.all([
          Bun.write(
            path.join(instance.directory, "src/math.ts"),
            "export const add = (a: number, b: number) => a + b + 1\n",
          ),
          Bun.write(
            path.join(instance.directory, "test/math.test.ts"),
            'import { add } from "../src/math"\ntest("adds", () => expect(add(2, 2)).toBe(4))\n',
          ),
        ]),
      )
      const info = yield* TestFailureTool
      const tool = yield* info.init()
      const permissions: unknown[] = []
      const result = yield* tool.execute(
        { output: BUN_OUTPUT.replaceAll("/repo", instance.directory) },
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

      expect(permissions).toEqual([expect.objectContaining({ permission: "read", patterns: ["test/math.test.ts"] })])
      expect(result.title).toBe("1 failing test")
      expect(result.output).toContain("- `src/math.ts` — imported by the test, so it is likely the code under test")
      expect(result.metadata.failures).toBe(1)
    }),
  )
})
