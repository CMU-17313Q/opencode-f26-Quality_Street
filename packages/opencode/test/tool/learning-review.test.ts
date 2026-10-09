import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { InstanceRef } from "@/effect/instance-ref"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import {
  LearningReviewTool,
  formatReview,
  parseUnifiedDiff,
  reviewFile,
  reviewFiles,
  toSourceFile,
} from "../../src/tool/learning-review"

function rules(path: string, code: string) {
  return reviewFile(toSourceFile(path, code)).map((finding) => finding.rule)
}

describe("learning review", () => {
  test("flags correctness problems in JavaScript/TypeScript", () => {
    const code = [
      "function check(value) {",
      "  if (value == null) return false",
      "  if (value = 3) return true",
      "  try {",
      "    run()",
      "  } catch (error) {}",
      "}",
    ].join("\n")

    const findings = reviewFile(toSourceFile("src/check.js", code))

    expect(findings.map((finding) => finding.rule)).toEqual(
      expect.arrayContaining(["loose-equality", "assignment-in-condition", "empty-catch"]),
    )
    expect(findings.filter((finding) => finding.rule === "empty-catch")[0]).toMatchObject({
      category: "correctness",
      severity: "high",
      line: 6,
    })
  })

  test("does not flag strict equality or comparisons", () => {
    const code = ["if (a === b) run()", "if (a !== b) run()", "if (a <= b) run()", "const same = a >= b"].join("\n")

    expect(rules("src/compare.ts", code)).toEqual([])
  })

  test("flags correctness problems in Python", () => {
    const code = ["try:", "    load()", "except:", "    retry()", "try:", "    save()", "except ValueError: pass"].join(
      "\n",
    )

    expect(rules("app/main.py", code)).toEqual(expect.arrayContaining(["bare-except", "swallowed-exception"]))
  })

  test("flags maintainability problems", () => {
    const code = [
      "var total = 0",
      "function parse(input: any) {",
      "  // TODO handle empty input",
      "  console.log(input)",
      "  return input.length * 86400",
      "}",
    ].join("\n")

    const findings = reviewFile(toSourceFile("src/parse.ts", code))

    expect(findings.map((finding) => finding.rule)).toEqual(
      expect.arrayContaining(["var-declaration", "explicit-any", "todo-comment", "debug-output", "magic-number"]),
    )
    expect(findings.every((finding) => finding.category === "maintainability")).toBe(true)
  })

  test("does not treat named constants as magic numbers", () => {
    expect(rules("src/limits.ts", "const SECONDS_PER_DAY = 86400")).not.toContain("magic-number")
  })

  test("flags deeply nested code", () => {
    const code = [
      "function nested() {",
      "  if (a) {",
      "    if (b) {",
      "      if (c) {",
      "        if (d) {",
      "          run()",
      "        }",
      "      }",
      "    }",
      "  }",
      "}",
    ].join("\n")

    expect(rules("src/nested.ts", code)).toContain("deep-nesting")
  })

  test("flags clarity problems", () => {
    const code = ["const x = compute()", "// oldCompute(x);", `const message = "${"a".repeat(130)}"`].join("\n")

    const findings = reviewFile(toSourceFile("src/clarity.ts", code))

    expect(findings.map((finding) => finding.rule)).toEqual(
      expect.arrayContaining(["single-letter-name", "commented-out-code", "long-line"]),
    )
    expect(findings.every((finding) => finding.category === "clarity")).toBe(true)
  })

  test("returns no findings for clean code", () => {
    const code = [
      "const MAX_RETRIES = 3",
      "",
      "export function shouldRetry(attempt: number) {",
      "  return attempt < MAX_RETRIES",
      "}",
    ].join("\n")

    expect(rules("src/retry.ts", code)).toEqual([])
  })

  test("every finding explains why it matters and gives guidance", () => {
    const findings = reviewFile(toSourceFile("src/bad.ts", "var x: any = 42\ntry { run() } catch (e) {}"))

    expect(findings.length).toBeGreaterThan(0)
    for (const finding of findings) {
      expect(finding.why.length).toBeGreaterThan(20)
      expect(finding.guidance.length).toBeGreaterThan(20)
    }
  })

  test("limits repeated findings of the same rule in one file", () => {
    const code = Array.from({ length: 20 }, (_, index) => `console.log(${index})`).join("\n")

    const debug = reviewFile(toSourceFile("src/noisy.ts", code)).filter((finding) => finding.rule === "debug-output")

    expect(debug).toHaveLength(5)
  })

  test("reviews only added lines from a unified diff", () => {
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 1111111..2222222 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -10,3 +10,4 @@ export function app() {",
      "   const ready = true",
      "-  if (ready === true) start()",
      "+  if (ready == true) start()",
      "+  console.log(ready)",
      "   return ready",
      "diff --git a/old.ts b/old.ts",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-var removed = 1",
    ].join("\n")

    const files = parseUnifiedDiff(diff)

    expect(files).toEqual([
      {
        path: "src/app.ts",
        lines: [
          { number: 11, text: "  if (ready == true) start()" },
          { number: 12, text: "  console.log(ready)" },
        ],
      },
    ])
    expect(reviewFiles(files).map((finding) => [finding.rule, finding.line])).toEqual([
      ["loose-equality", 11],
      ["debug-output", 12],
    ])
  })

  test("orders findings by category and severity", () => {
    const findings = reviewFiles([
      toSourceFile("src/order.ts", "const y = 1\nvar total = 2\ntry { go() } catch (e) {}"),
    ])

    expect(findings.map((finding) => finding.category)).toEqual(["correctness", "maintainability", "clarity"])
  })

  test("renders a structured review grouped by category", () => {
    const findings = reviewFile(toSourceFile("src/bad.ts", "try { run() } catch (e) {}\nvar count = 0"))
    const output = formatReview(findings, 1)

    expect(output).toContain("# Learning-oriented code review")
    expect(output).toContain("## Correctness")
    expect(output).toContain("## Maintainability")
    expect(output).not.toContain("## Clarity")
    expect(output).toContain("### [high] `src/bad.ts:1` — empty-catch")
    expect(output).toContain("- **Why it matters:**")
    expect(output).toContain("- **Try this:**")
    expect(output.indexOf("## Correctness")).toBeLessThan(output.indexOf("## Maintainability"))
  })

  test("renders encouraging guidance when nothing is found", () => {
    const output = formatReview([], 2)

    expect(output).toContain("Reviewed 2 files and found 0 points")
    expect(output).toContain("No common problems were detected")
  })

  test("applies language-specific rules only to matching files", () => {
    expect(rules("src/handler.js", "try:\nexcept:\n    pass")).not.toContain("bare-except")
    expect(rules("app/models.py", "var total = 0\nif value == None: pass")).not.toContain("var-declaration")
    expect(rules("app/models.py", "value: any = load()")).not.toContain("explicit-any")
  })

  test("applies language-independent rules to every file type", () => {
    expect(rules("app/models.py", "# TODO remove this\nprint(result)")).toEqual(
      expect.arrayContaining(["todo-comment", "debug-output"]),
    )
  })

  test("does not flag loose equality inside string literals", () => {
    expect(rules("src/message.ts", 'const hint = "use == carefully"')).not.toContain("loose-equality")
  })

  test("allows conventional short loop variable names", () => {
    expect(rules("src/loop.ts", "let i = 0\nconst e = error")).not.toContain("single-letter-name")
  })

  test("ignores a diff that only deletes lines", () => {
    const diff = ["--- a/src/old.ts", "+++ b/src/old.ts", "@@ -1,2 +1,1 @@", " keep()", "-var removed = 1"].join("\n")

    expect(parseUnifiedDiff(diff)).toEqual([])
  })

  test("tracks line numbers across multiple hunks and files", () => {
    const diff = [
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,2 @@",
      " first()",
      "+var one = 1",
      "@@ -20,1 +21,2 @@",
      " later()",
      "+var two = 2",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -5,0 +5,1 @@",
      "+var three = 3",
    ].join("\n")

    expect(parseUnifiedDiff(diff).map((file) => [file.path, file.lines.map((line) => line.number)])).toEqual([
      ["src/a.ts", [2, 22]],
      ["src/b.ts", [5]],
    ])
  })
})

describe("learning review tool", () => {
  const context = {
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("msg_test"),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
  }

  async function run(params: { paths?: string[]; diff?: string }, files: Record<string, string> = {}) {
    const permissions: Array<{ permission: string; patterns: string[] }> = []
    const layer = Layer.mergeAll(
      Layer.mock(FSUtil.Service, {
        readFileStringSafe: (filepath: string) => Effect.succeed(files[filepath]),
      } as any),
      Layer.mock(Truncate.Service, {
        output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
      }),
      Layer.mock(Agent.Service, {
        get: () => Effect.succeed({ name: "build", permission: [] } as any),
      }),
    )
    const tool = await Effect.runPromise(LearningReviewTool.pipe(Effect.flatMap(Tool.init), Effect.provide(layer)))
    const exit = await Effect.runPromiseExit(
      tool
        .execute(params, {
          ...context,
          ask: (request: any) => Effect.sync(() => permissions.push(request)),
        })
        .pipe(Effect.provideService(InstanceRef, { directory: "/repo", worktree: "/repo", project: {} as any })),
    )
    return { exit, permissions }
  }

  test("reviews requested files after asking for read permission", async () => {
    const { exit, permissions } = await run({ paths: ["src/app.ts"] }, { "/repo/src/app.ts": "var count = 0" })

    expect(exit._tag).toBe("Success")
    if (exit._tag !== "Success") return
    expect(permissions).toEqual([expect.objectContaining({ permission: "read", patterns: ["src/app.ts"] })])
    expect(exit.value.title).toBe("src/app.ts")
    expect(exit.value.output).toContain("var-declaration")
    expect(exit.value.metadata).toMatchObject({ filesReviewed: 1, findings: 1, skippedPaths: 0 })
  })

  test("reviews a diff without reading files", async () => {
    const diff = ["--- a/src/app.ts", "+++ b/src/app.ts", "@@ -1,0 +1,1 @@", "+console.log(debug)"].join("\n")
    const { exit, permissions } = await run({ diff })

    expect(exit._tag).toBe("Success")
    if (exit._tag !== "Success") return
    expect(permissions).toEqual([])
    expect(exit.value.output).toContain("`src/app.ts:1` — debug-output")
  })

  test("reviews at most ten files and reports the skipped ones", async () => {
    const paths = Array.from({ length: 12 }, (_, index) => `src/file${index}.ts`)
    const files = Object.fromEntries(paths.map((file) => [path.join("/repo", file), "export const ok = true"]))
    const { exit } = await run({ paths }, files)

    expect(exit._tag).toBe("Success")
    if (exit._tag !== "Success") return
    expect(exit.value.title).toBe("10 files")
    expect(exit.value.metadata).toMatchObject({ filesReviewed: 10, skippedPaths: 2 })
  })

  test("fails clearly when a requested file does not exist", async () => {
    const { exit } = await run({ paths: ["src/missing.ts"] })

    expect(exit._tag).toBe("Failure")
    expect(String(exit._tag === "Failure" ? exit.cause : "")).toContain("File not found")
  })

  test("fails clearly when nothing is given to review", async () => {
    const { exit } = await run({})

    expect(exit._tag).toBe("Failure")
    expect(String(exit._tag === "Failure" ? exit.cause : "")).toContain("Provide `paths`")
  })
})
