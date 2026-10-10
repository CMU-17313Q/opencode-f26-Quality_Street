import path from "path"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./test-failure.txt"

const ANSI = /\x1b\[[0-9;]*m/g

const TEST_FILE = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$/

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]

const MAX_LOCATIONS = 3

export type Frame = {
  file: string
  line: number
  fn?: string
}

export type FailureKind =
  | "assertion"
  | "type-error"
  | "reference-error"
  | "module-not-found"
  | "timeout"
  | "snapshot"
  | "exception"
  | "unknown"

export type TestFailure = {
  name: string
  file?: string
  line?: number
  kind: FailureKind
  message: string
  expected?: string
  received?: string
  frames: Frame[]
}

type Block = {
  name: string
  file?: string
  lines: string[]
}

const KIND_LABEL: Record<FailureKind, string> = {
  assertion: "Assertion failed",
  "type-error": "Type error",
  "reference-error": "Undefined name",
  "module-not-found": "Module not found",
  timeout: "Timeout",
  snapshot: "Snapshot mismatch",
  exception: "Error thrown",
  unknown: "Unrecognized failure",
}

const MEANING: Record<FailureKind, string> = {
  assertion: "An assertion in the test did not hold: the code ran, but its result is not what the test checks for.",
  "type-error":
    "A value was used in a way its type does not allow, most often reading a property of, or calling, something that is `undefined` or `null`. The code crashed before the test could check its result.",
  "reference-error":
    "The code uses a name (a variable, function, or import) that does not exist where it is used, so it crashed before the test could check its result.",
  "module-not-found": "A file or package could not be loaded, so the test, or the code it imports, never ran.",
  timeout: "The test did not finish within its time limit, usually because something it waits for never completes.",
  snapshot: "The output no longer matches the snapshot saved from an earlier run.",
  exception: "The code threw an error while the test was running, so the test failed before it could check its result.",
  unknown: "The test failed, but the output does not show a recognizable error message.",
}

// Hints are questions on purpose: the student should find the fix, not be handed one.
const HINTS: Record<FailureKind, string[]> = {
  assertion: [
    "Which function produced the received value? Work out by hand what it should return for the inputs the test passes in, then compare step by step.",
    'Is the expectation itself correct (ordering, rounding, or types such as `"5"` versus `5`)?',
    "Did a recent change to the code under test alter this behavior on purpose? If so, should the test change too?",
  ],
  "type-error": [
    "Which value is `undefined` or `null` at the line where the error was raised, and where should it have been set?",
    "Is a function called with missing or reordered arguments, or is something imported under the wrong name?",
  ],
  "reference-error": [
    "Is the name spelled the same, including case, where it is defined and where it is used?",
    "Is it defined or imported in the scope where it is used?",
  ],
  "module-not-found": [
    "Does the import path match the file's real location and name, including case and extension?",
    "If it is a package, is it listed in the project's dependencies and installed?",
  ],
  timeout: [
    "Is there a promise that never resolves, a missing `await`, or a callback that is never called?",
    "Does the test depend on a network request, file, or timer that is slow or never fires in the test environment?",
  ],
  snapshot: [
    "Did the output change on purpose? If yes, review and update the snapshot; if not, which recent change altered the output?",
  ],
  exception: [
    "What condition in the code makes it throw this error, and which input from the test triggers it?",
    "Should the code handle this case, or should the test expect the error?",
  ],
  unknown: [
    "Read the first error message in the output and follow the stack trace to the first file from your own project.",
  ],
}

export const Parameters = Schema.Struct({
  output: Schema.String.annotate({ description: "The full output of the failing test run" }),
})

export const TestFailureTool = Tool.define(
  "test_failure",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const readImports = Effect.fn("TestFailureTool.readImports")(function* (root: string, file: string) {
      const content = yield* fs.readFileStringSafe(path.join(root, file))
      if (content === undefined) return [file, []] as const
      const found = yield* Effect.forEach(importCandidates(file, content), (options) =>
        Effect.forEach(options, (option) => fs.isFile(path.join(root, option))).pipe(
          Effect.map((exists) => options[exists.indexOf(true)]),
        ),
      )
      return [file, [...new Set(found.filter((item) => item !== undefined))]] as const
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { output: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const failures = parseTestFailures(params.output, instance.directory)
          // Only test files inside the project are read, to find the code they import.
          const testFiles = [
            ...new Set(failures.flatMap((failure) => (failure.file && isInside(failure.file) ? [failure.file] : []))),
          ]
          if (testFiles.length > 0) {
            yield* ctx.ask({ permission: "read", patterns: testFiles, always: ["*"], metadata: {} })
          }
          const imports = Object.fromEntries(
            yield* Effect.forEach(testFiles, (file) => readImports(instance.directory, file)),
          )

          return {
            title: failures.length === 0 ? "No failures found" : plural(failures.length, "failing test"),
            output: formatTestFailureReport(failures, imports),
            metadata: { failures: failures.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export function parseTestFailures(output: string, root?: string): TestFailure[] {
  const lines = output.replace(ANSI, "").split(/\r?\n/)
  const blocks = [pytestBlocks, jestBlocks, vitestBlocks, bunBlocks]
    .map((find) => find(lines))
    .find((found) => found.length > 0)
  return (blocks ?? []).map((block) => toFailure(block, root))
}

export function formatTestFailureReport(failures: TestFailure[], imports: Record<string, readonly string[]> = {}) {
  if (failures.length === 0) {
    return [
      "# Test failure explanation",
      "",
      "No failing tests could be identified in this output.",
      "- Make sure the output includes the failure details, not only the summary line.",
      "- Supported formats are Bun, Jest, Vitest, and pytest. For other runners, read the first error message and follow the stack trace to the first file from your own project.",
    ].join("\n")
  }
  return [
    "# Test failure explanation",
    "",
    `Found ${plural(failures.length, "failing test")}.`,
    ...failures.flatMap((failure, index) => formatFailure(failure, index, imports[failure.file ?? ""] ?? [])),
    "",
    "## Scope",
    "- This explanation is based on the test output and the files the tests import. It points to where to look but does not change any code.",
  ].join("\n")
}

export function importCandidates(testFile: string, content: string) {
  const dir = path.posix.dirname(testFile)
  const js = [...content.matchAll(/(?:from|import|require)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)].map((match) => {
    const base = path.posix.join(dir, match[1]).replace(/\.[cm]?js$/, "")
    return [base, ...SOURCE_EXTENSIONS.map((ext) => base + ext), `${base}/index.ts`, `${base}/index.js`]
  })
  const python = testFile.endsWith(".py")
    ? [...content.matchAll(/^\s*(?:from\s+(\.*[\w.]*)\s+import|import\s+([\w.]+))/gm)].map((match) => {
        const spec = match[1] ?? match[2]
        const dots = spec.match(/^\.*/)?.[0].length ?? 0
        const rest = spec.slice(dots).replaceAll(".", "/")
        const base = dots === 0 ? rest : path.posix.join(dir, ...Array<string>(dots - 1).fill(".."), rest)
        return [`${base}.py`, `${base}/__init__.py`]
      })
    : []
  return [...js, ...python].map((options) => options.filter((file) => !isTestFile(file)))
}

function formatFailure(failure: TestFailure, index: number, imports: readonly string[]) {
  const locations = whereToLook(failure, imports)
  return [
    "",
    `## ${index + 1}. ${failure.name}`,
    ...(failure.file ? [`- **Test:** \`${failure.file}${failure.line ? `:${failure.line}` : ""}\``] : []),
    `- **Error:** ${KIND_LABEL[failure.kind]}${failure.message ? ` — \`${code(failure.message)}\`` : ""}`,
    ...(failure.expected !== undefined ? [`- **Expected:** \`${code(failure.expected)}\``] : []),
    ...(failure.received !== undefined ? [`- **Received:** \`${code(failure.received)}\``] : []),
    "",
    `**What this means:** ${meaning(failure)}`,
    "",
    "**Where to look:**",
    ...(locations.length > 0
      ? locations
      : [
          `- No implementation file could be identified from this output. Start from the test${failure.file ? ` in \`${failure.file}\`` : ""} and follow the function it calls.`,
        ]),
    "",
    "**Questions to investigate:**",
    ...HINTS[failure.kind].map((hint) => `- ${hint}`),
  ]
}

function whereToLook(failure: TestFailure, imports: readonly string[]) {
  const own = failure.frames.filter((frame) => !isTestFile(frame.file))
  const frames = own
    .filter(
      (frame, index) =>
        own.findIndex((other) => other.file === frame.file && other.line === frame.line && other.fn === frame.fn) ===
        index,
    )
    .slice(0, MAX_LOCATIONS)
  return [
    ...frames.map(
      (frame, index) =>
        `- \`${frame.file}:${frame.line}\`${frame.fn ? ` in \`${frame.fn}\`` : ""} — ${index === 0 ? "where the error was raised" : "called on the way to the error"}`,
    ),
    ...imports
      .filter((file) => !frames.some((frame) => frame.file === file))
      .map((file) => `- \`${file}\` — imported by the test, so it is likely the code under test`),
  ]
}

function meaning(failure: TestFailure) {
  if (failure.kind !== "assertion" || failure.expected === undefined || failure.received === undefined) {
    return MEANING[failure.kind]
  }
  return `The test expected \`${code(failure.expected)}\` but the code produced \`${code(failure.received)}\`. The code ran without crashing, but its result is not what the test checks for.`
}

function pytestBlocks(lines: string[]): Block[] {
  const files = new Map(
    lines.flatMap((line) => {
      const match = line.match(/^FAILED (\S+?\.py)::(\S+)/)
      return match ? [[match[2].split("::").pop() ?? match[2], match[1]] as const] : []
    }),
  )
  return sections(lines, /^_{3,} (.+?) _{3,}\s*$/, /^={3,}/).map((section) => ({
    name: section.match[1],
    file: files.get(section.match[1].split(".").pop() ?? section.match[1]),
    lines: section.lines,
  }))
}

function jestBlocks(lines: string[]): Block[] {
  return sections(lines, /^\s*● (.+?)\s*$/, /^\s*(PASS|FAIL)\s|^Test Suites:/).map((section) => ({
    name: section.match[1],
    file: lines
      .slice(0, section.index)
      .map((line) => line.match(/^\s*FAIL\s+(\S+)\s*$/)?.[1])
      .findLast((file) => file !== undefined),
    lines: section.lines,
  }))
}

function vitestBlocks(lines: string[]): Block[] {
  return sections(lines, /^\s*FAIL\s+(\S+)\s+>\s+(.+?)\s*$/, /⎯{3,}|^\s*Test Files\s/).map((section) => ({
    name: section.match[2],
    file: section.match[1],
    lines: section.lines,
  }))
}

// Bun prints the error details first and the `(fail) name` line after them.
function bunBlocks(lines: string[]): Block[] {
  const boundaries = lines.flatMap((line, index) =>
    /^\((pass|fail|skip|todo)\) |^\S+\.\w+:$/.test(line) ? [index] : [],
  )
  return lines.flatMap((line, index) => {
    const match = line.match(/^\(fail\) (.+?)(?: \[[\d.]+\s*m?s\])?\s*$/)
    if (!match) return []
    const start = Math.max(-1, ...boundaries.filter((boundary) => boundary < index)) + 1
    const file = lines
      .slice(0, index)
      .findLast((item) => /^\S+\.\w+:$/.test(item))
      ?.slice(0, -1)
    return [{ name: match[1], file, lines: lines.slice(start, index) }]
  })
}

function sections(lines: string[], header: RegExp, end: RegExp) {
  const starts = lines.flatMap((line, index) => {
    const match = line.match(header)
    return match ? [{ index, match }] : []
  })
  return starts.map((start, position) => {
    const body = lines.slice(start.index + 1, starts[position + 1]?.index ?? lines.length)
    const stop = body.findIndex((line) => end.test(line))
    return { ...start, lines: stop === -1 ? body : body.slice(0, stop) }
  })
}

function toFailure(block: Block, root?: string): TestFailure {
  const frames = block.lines.flatMap((line) => parseFrame(line, root))
  const message = findMessage(block.lines)
  const values = findValues(block.lines, message)
  const testFrame = frames.find((frame) => isTestFile(frame.file))
  const file = block.file ? relative(block.file, root) : testFrame?.file
  return {
    name: block.name,
    file,
    line: testFrame?.file === file ? testFrame?.line : undefined,
    kind: classify(message, values.expected),
    message,
    ...values,
    frames,
  }
}

function findMessage(lines: string[]) {
  const patterns = [
    /^\s*(?:error: )?(expect\(.+?)\s*$/,
    /^E\s+(.+?)\s*$/,
    /^\s*(?:error: )?((?:\w+\.)?\w*(?:Error|Exception)\b.*?)\s*$/,
    /^\s*(?:error|thrown): (.+?)\s*$/,
  ]
  return patterns.map((pattern) => lines.map((line) => line.match(pattern)?.[1]).find(Boolean)).find(Boolean) ?? ""
}

function findValues(lines: string[], message: string): { expected?: string; received?: string } {
  const expected = lines.map((line) => line.match(/^\s*Expected(?: value)?:\s*(.+?)\s*$/)?.[1]).find(Boolean)
  const received = lines.map((line) => line.match(/^\s*Received(?: value)?:\s*(.+?)\s*$/)?.[1]).find(Boolean)
  if (expected !== undefined || received !== undefined) return { expected, received }
  const vitest = message.match(/expected (.+?) to (?:be|equal|deeply equal|strictly equal) (.+?)(?:\s*\/\/.*)?$/)
  if (vitest) return { received: vitest[1], expected: vitest[2] }
  // pytest rewrites `assert actual == expected` with the evaluated values.
  const pytest = message.match(/^assert (.+?) == (.+)$/)
  if (pytest) return { received: pytest[1], expected: pytest[2] }
  return {}
}

function classify(message: string, expected?: string): FailureKind {
  if (/timed? ?out|exceeded timeout/i.test(message)) return "timeout"
  if (/snapshot/i.test(message)) return "snapshot"
  if (/cannot find (module|package)|module not found|ModuleNotFoundError|ImportError/i.test(message)) {
    return "module-not-found"
  }
  if (/^TypeError\b/.test(message)) return "type-error"
  if (/^(ReferenceError|NameError)\b/.test(message)) return "reference-error"
  if (/^(expect\(|AssertionError|assert\b)/.test(message) || expected !== undefined) return "assertion"
  if (/(Error|Exception)\b/.test(message)) return "exception"
  return "unknown"
}

function parseFrame(line: string, root?: string): Frame[] {
  const js =
    line.match(/^\s*at (?:(.*?) \()?([^()\s]+?):(\d+):\d+\)?\s*$/) ??
    line.match(/^\s*❯ (?:(\S+) )?(\S+?):(\d+):\d+\s*$/)
  const python = line.match(/^\s*File "(.+?)", line (\d+), in (\S+)/) ?? line.match(/^(\S+\.py):(\d+):(?: \w+)?\s*$/)
  const raw = js
    ? { file: js[2], line: Number(js[3]), fn: js[1] }
    : python
      ? { file: python[1], line: Number(python[2]), fn: python[3] }
      : undefined
  if (!raw || /node_modules|^(node|bun|internal):|^native$|<anonymous>/.test(raw.file)) return []
  const fn = raw.fn?.replace(/^async /, "")
  return [{ file: relative(raw.file, root), line: raw.line, fn: fn && !fn.includes("<anonymous>") ? fn : undefined }]
}

function relative(file: string, root?: string) {
  const normalized = file.replaceAll("\\", "/").replace(/^file:\/\//, "")
  const base = root?.replaceAll("\\", "/").replace(/\/+$/, "")
  if (base && normalized.startsWith(`${base}/`)) return normalized.slice(base.length + 1)
  return normalized.replace(/^\.\//, "")
}

function isTestFile(file: string) {
  return TEST_FILE.test(file)
}

function isInside(file: string) {
  return !path.isAbsolute(file) && !file.startsWith("..")
}

function code(text: string) {
  return text.replaceAll("`", "'").slice(0, 200)
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}
