import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import {
  calledFunctions,
  formatTestFailureReport,
  parseTestFailures,
  type FailureKind,
  type TestFailure,
} from "../../src/tool/test-failure"

// Property-based tests for the Test Failure Explainer (Project 4B, aiyusuf).
// Requirement IDs and wording come from traceability/aiyusuf.md.
//
// Two kinds of input are generated:
//   * `failureList` builds TestFailure objects directly. This reaches every failure kind, with and
//     without a file, line, expected/received values, stack frames and imports. Values can contain
//     backticks, quotes and brackets, which are the characters most likely to break the markdown.
//   * `bunRun` renders a realistic Bun test run from a model (which tests failed, which passed, which
//     line each assertion is on). The model is the oracle: we know what the report should contain
//     because we wrote the run ourselves.

const ALL_KINDS: FailureKind[] = [
  "assertion",
  "type-error",
  "reference-error",
  "module-not-found",
  "timeout",
  "snapshot",
  "exception",
  "unknown",
]

// ---------- generators ----------

// Single-line text with no `*` (so it can never forge a `**Label:**`) and no newline.
// It does include backticks, quotes and brackets on purpose.
const text = fc.stringMatching(/^[A-Za-z0-9 _'"`.,:()[\]{}<>=+/#-]{1,30}$/)

// File names come from a small pool so that two failures sometimes share a file.
const testPath = fc.constantFrom("test/a.test.ts", "test/b.test.ts", "tests/test_c.py", "src/d.test.js")
const sourcePath = fc.constantFrom("src/a.ts", "src/b/c.ts", "lib/util.js", "app/billing.py", "src/x.tsx")

const frame = fc.record({
  file: sourcePath,
  line: fc.integer({ min: 1, max: 500 }),
  fn: fc.option(fc.constantFrom("parse", "total", "run", "handler"), { nil: undefined }),
})

const failure: fc.Arbitrary<TestFailure> = fc.record({
  name: text,
  file: fc.option(testPath, { nil: undefined }),
  line: fc.option(fc.integer({ min: 1, max: 500 }), { nil: undefined }),
  kind: fc.constantFrom(...ALL_KINDS),
  message: fc.oneof(text, fc.constant("")),
  expected: fc.option(text, { nil: undefined }),
  received: fc.option(text, { nil: undefined }),
  frames: fc.array(frame, { maxLength: 3 }),
})

// Between 1 and 5 failures with distinct names (a report lists each test once).
const failureList = fc.uniqueArray(failure, { minLength: 1, maxLength: 5, selector: (item) => item.name })

// For each failure file, 0 to 3 imported implementation files.
const importsFor = (failures: TestFailure[]) =>
  fc
    .tuple(...failures.map(() => fc.uniqueArray(sourcePath, { maxLength: 3 })))
    .map((lists) =>
      Object.fromEntries(failures.flatMap((item, i) => (item.file ? [[item.file, lists[i]] as const] : []))),
    )

const failuresWithImports = failureList.chain((failures) =>
  importsFor(failures).map((imports) => ({ failures, imports }) as const),
)

// ---------- helpers that read a report ----------

// The report text for each failure entry, without the trailing "## Scope" section.
function entries(report: string): string[] {
  const body = report.split("\n## Scope")[0]
  return body.split(/\n(?=## \d+\. )/).slice(1)
}

function section(entry: string, start: string, end?: string): string[] {
  const lines = entry.split("\n")
  const from = lines.findIndex((line) => line.startsWith(start))
  const to = end ? lines.findIndex((line) => line.startsWith(end)) : lines.length
  return lines.slice(from + 1, to).filter((line) => line.startsWith("- "))
}

const whereToLook = (entry: string) => section(entry, "**Where to look:**", "**Questions to investigate:**")
const questions = (entry: string) => section(entry, "**Questions to investigate:**")

// How the report shows a raw value inside backticks: backticks inside it become quotes, long values are cut.
const inline = (value: string) => value.replaceAll("`", "'").slice(0, 200)

// ---------- R1 ----------

// Bun output for a run where every case is a failing `expect(...)` assertion.
type Case = {
  name: string
  fn: string
  form: "plain" | "await" | "method"
  args: string
  expected: string
  received: string
}

const fnName = fc.stringMatching(/^[a-z][a-zA-Z0-9]{2,8}$/).map((id) => `${id}Fn`)
const testCase = fc.record({
  name: fc.stringMatching(/^[a-z][a-z0-9 ]{2,14}[a-z0-9]$/),
  fn: fnName,
  form: fc.constantFrom<Case["form"]>("plain", "await", "method"),
  args: fc.constantFrom("", "1", "[1, 2]", "roster, 's3'"),
  expected: fc.constantFrom("4", '"B"', "[1, 2]", "null"),
  received: fc.constantFrom("5", '"C"', "[]", "undefined"),
})

const call = (c: Case) =>
  c.form === "method"
    ? `grades.${c.fn}(${c.args})`
    : c.form === "await"
      ? `await ${c.fn}(${c.args})`
      : `${c.fn}(${c.args})`

const scenario = fc.record({
  module: fc.constantFrom("grades", "cart", "billing"),
  cases: fc.uniqueArray(testCase, { minLength: 1, maxLength: 3, selector: (c) => c.fn }),
  start: fc.integer({ min: 3, max: 30 }),
  gaps: fc.array(fc.integer({ min: 3, max: 8 }), { minLength: 3, maxLength: 3 }),
  otherImports: fc.integer({ min: 0, max: 2 }),
})

describe("Test Failure Explainer properties", () => {
  // R1: For an assertion failure, "Where to look" names the function the test called, not only its file,
  //     so the student knows what to read.
  // Kind: model / oracle (the oracle is the test source we generated: we know which function each failing
  //       line calls)
  //
  // Generator rationale: assertion lines are placed at random line numbers in a generated test file, and the
  // Bun run reports each failure at that line. The call is written three ways (plain, awaited, and as a
  // method on an imported namespace) because each puts the function name in a different place on the line.
  // 1 to 3 failing assertions per file checks that each failure gets its own function and not a neighbour's.
  // The imports always include the implementation file plus 0 to 2 unrelated files, so the function name
  // has to be reported next to the right kind of entry and not attached to every import.
  test("R1: where to look names the function the failing assertion called", () => {
    fc.assert(
      fc.property(scenario, ({ module, cases, start, gaps, otherImports }) => {
        const testFile = `test/${module}.test.ts`
        const lines = cases.map((_, i) => start + gaps.slice(0, i + 1).reduce((a, b) => a + b, 0))
        const source = Array.from({ length: Math.max(...lines) + 2 }, (_, i) => {
          const index = lines.indexOf(i + 1)
          return index === -1 ? `// line ${i + 1}` : `  expect(${call(cases[index])}).toBe(${cases[index].expected})`
        }).join("\n")

        const output = [
          `${testFile}:`,
          ...cases.flatMap((c, i) => [
            `${lines[i]} |   expect(${call(c)}).toBe(${c.expected})`,
            "                       ^",
            "error: expect(received).toBe(expected)",
            "",
            `Expected: ${c.expected}`,
            `Received: ${c.received}`,
            "",
            `      at <anonymous> (/repo/${testFile}:${lines[i]}:23)`,
            `(fail) ${module} > ${c.name} [0.21ms]`,
          ]),
        ].join("\n")

        const failures = parseTestFailures(output, "/repo")
        expect(failures.map((item) => item.line)).toEqual(lines)

        const implementation = `src/${module}.ts`
        const unrelated = Array.from({ length: otherImports }, (_, i) => `src/other${i}.ts`)
        const imports = { [testFile]: [implementation, ...unrelated] }
        const report = formatTestFailureReport(failures, imports, calledFunctions(failures, { [testFile]: source }))

        entries(report).forEach((entry, i) => {
          const locations = whereToLook(entry)
          const naming = locations.filter((line) => line.includes(`\`${cases[i].fn}\``))
          // The function is named...
          expect(naming).not.toEqual([])
          // ...next to the test line that calls it...
          expect(naming.some((line) => line.includes(`\`${testFile}:${lines[i]}\``))).toBe(true)
          // ...and it still lists the implementation file.
          expect(locations.some((line) => line.includes(`\`${implementation}\``))).toBe(true)
          // It never names a different failing test's function.
          for (const other of cases.filter((_, j) => j !== i)) {
            expect(locations.some((line) => line.includes(`\`${other.fn}\``))).toBe(false)
          }
        })
      }),
      { numRuns: 200 },
    )
  })

  // R2: The report describes the failure and asks questions. It never gives replacement code, and it does
  //     not explain how the student's code works.
  // Kind: invariant (true for every failure of every kind)
  //
  // Generator rationale: all 8 failure kinds, with and without expected/received values, frames and
  // imports. Text fields include backticks, quotes and brackets, because user text is what could smuggle a
  // code fence or an unexpected code span into the report.
  test("R2: no code blocks, only expected inline code, and the hints are questions", () => {
    // Fixed words the report itself puts in backticks (they come from the report's own explanation text).
    const fixedInline = new Set(["undefined", "null", '"5"', "5", "await"])
    fc.assert(
      fc.property(failuresWithImports, ({ failures, imports }) => {
        const called = Object.fromEntries(
          failures.flatMap((item) =>
            item.kind === "assertion" && item.file && item.line
              ? [[`${item.file}:${item.line}`, "someFn"] as const]
              : [],
          ),
        )
        const report = formatTestFailureReport(failures, imports, called)

        // No fenced code block anywhere (a fence starts a line; a backtick in a test name inside a
        // "## 1. name" heading is the user's own text and is allowed).
        expect(report).not.toMatch(/^\s*```/m)

        // Every inline code span is a value that came from the failing run, or one of the fixed words.
        const allowed = new Set<string>([...fixedInline, "someFn"])
        for (const item of failures) {
          if (item.file) allowed.add(item.file).add(`${item.file}:${item.line}`)
          if (item.line === undefined && item.file) allowed.add(item.file)
          allowed.add(inline(item.message))
          if (item.expected !== undefined) allowed.add(inline(item.expected))
          if (item.received !== undefined) allowed.add(inline(item.received))
          for (const f of item.frames) {
            allowed.add(`${f.file}:${f.line}`)
            if (f.fn) allowed.add(f.fn)
          }
        }
        for (const file of Object.values(imports).flat()) allowed.add(file)
        const withoutHeadings = report
          .split("\n")
          .filter((line) => !line.startsWith("## "))
          .join("\n")
        const spans = [...withoutHeadings.matchAll(/`([^`]*)`/g)].map((match) => match[1])
        expect(spans.filter((span) => !allowed.has(span))).toEqual([])

        // Every hint poses a question, so the student has to work out the fix. (A hint may add a short
        // instruction after its question, such as "work out by hand what it should return".)
        for (const entry of entries(report)) {
          const hints = questions(entry)
          expect(hints).not.toEqual([])
          expect(hints.filter((hint) => !hint.includes("?"))).toEqual([])
        }
      }),
      { numRuns: 300 },
    )
  })

  // R3: Every failing test gets an entry with the same sections in the same order, and the same input
  //     always gives the same report.
  // Kind: invariant
  //
  // Generator rationale: the same arbitrary failure lists as R2, so entries differ in which optional lines
  // they have (Test, Expected, Received). Order is checked by position in the entry, so a section that moves
  // or disappears for one combination of optional fields fails.
  test("R3: every entry has the same sections in the same order", () => {
    fc.assert(
      fc.property(failuresWithImports, ({ failures, imports }) => {
        const report = formatTestFailureReport(failures, imports)
        const found = entries(report)
        expect(found).toHaveLength(failures.length)

        found.forEach((entry, i) => {
          const item = failures[i]
          const at = (label: string) => entry.indexOf(`- **${label}:**`)
          const bold = (label: string) => entry.indexOf(`**${label}:**`)
          // Expected sections, in order. Optional ones are present exactly when the failure has them.
          const expectedLabels = [
            ...(item.file ? [at("Test")] : []),
            at("Error"),
            ...(item.expected !== undefined ? [at("Expected")] : []),
            ...(item.received !== undefined ? [at("Received")] : []),
            bold("What this means"),
            bold("Where to look"),
            bold("Questions to investigate"),
          ]
          expect(expectedLabels.every((index) => index >= 0)).toBe(true)
          expect([...expectedLabels].sort((a, b) => a - b)).toEqual(expectedLabels)
          if (!item.file) expect(at("Test")).toBe(-1)
          if (item.expected === undefined) expect(at("Expected")).toBe(-1)
          if (item.received === undefined) expect(at("Received")).toBe(-1)
          expect(entry.startsWith(`## ${i + 1}. ${item.name}`)).toBe(true)
        })

        // Same input, same report.
        expect(formatTestFailureReport(failures, imports)).toBe(report)
      }),
      { numRuns: 300 },
    )
  })

  // R3 (completeness half): a run's failing tests each get exactly one entry, and passing or skipped tests
  //     never get one.
  // Kind: model / oracle (the oracle is the list of results we used to render the run)
  //
  // Generator rationale: pass, fail, skip and todo results are interleaved in random order, so a failure
  // block that follows a passing test (or a skip) is parsed with the right boundaries.
  test("R3: lists every failing test exactly once and never a passing or skipped one", () => {
    const result = fc.record({
      status: fc.constantFrom("pass", "fail", "fail", "skip", "todo"),
      thrown: fc.boolean(),
    })
    fc.assert(
      fc.property(fc.array(result, { maxLength: 8 }), (results) => {
        const named = results.map((r, i) => ({ ...r, name: `case number ${i}` }))
        const output = [
          "test/run.test.ts:",
          ...named.flatMap((r) =>
            r.status === "fail"
              ? [
                  r.thrown ? "error: something broke" : "error: expect(received).toBe(expected)",
                  ...(r.thrown ? [] : ["", "Expected: 1", "Received: 2"]),
                  "",
                  `      at <anonymous> (/repo/test/run.test.ts:${5 + r.name.length}:3)`,
                  `(fail) run > ${r.name} [0.10ms]`,
                ]
              : [`(${r.status}) run > ${r.name} [0.05ms]`],
          ),
        ].join("\n")

        const failing = named.filter((r) => r.status === "fail")
        const report = formatTestFailureReport(parseTestFailures(output, "/repo"))
        const headings = [...report.matchAll(/^## \d+\. run > (case number \d+)$/gm)].map((match) => match[1])
        expect(headings).toEqual(failing.map((r) => r.name))
        for (const r of named.filter((item) => item.status !== "fail")) expect(report).not.toContain(r.name)
      }),
      { numRuns: 200 },
    )
  })

  // R6: The report says what it is based on, marks its pointers as likely and not certain, and says plainly
  //     when it could not identify the code under test.
  // Kind: invariant
  //
  // Generator rationale: failures with and without imports and stack frames. The cases that matter are the
  // empty ones (no frames and no imports), where the report has nothing to point at and must say so
  // instead of staying silent.
  test("R6: states its scope, marks imports as likely, and admits when it found nothing", () => {
    fc.assert(
      fc.property(failuresWithImports, ({ failures, imports }) => {
        const report = formatTestFailureReport(failures, imports)

        const scope = report.split("\n## Scope\n")[1]
        expect(scope).toContain("based on the test output and the files the tests import")
        expect(scope).toContain("does not change any code")

        entries(report).forEach((entry, i) => {
          const item = failures[i]
          const own = item.frames.filter((f) => !/(^|\/)(test|tests)\/|\.test\.|(^|\/)test_/.test(f.file))
          const frameFiles = new Set(own.slice(0, 3).map((f) => f.file))
          const listed = (item.file ? (imports[item.file] ?? []) : []).filter((file) => !frameFiles.has(file))
          const locations = whereToLook(entry)

          // Every import is marked as likely, not certain.
          for (const file of listed) {
            const line = locations.find((l) => l.startsWith(`- \`${file}\``))
            expect(line).toContain("imported by the test, so it is likely the code under test")
          }
          // With nothing to point at, the report says so, and says where to start.
          if (own.length === 0 && listed.length === 0) {
            expect(locations).toHaveLength(1)
            expect(locations[0]).toContain("No implementation file could be identified from this output.")
          } else {
            expect(locations.join("\n")).not.toContain("No implementation file could be identified")
          }
        })
      }),
      { numRuns: 300 },
    )
  })

  // R6 (second half): adding an imported file to a failure only adds one "imported by the test" line to its
  //     "Where to look". Nothing else in the report changes.
  // Kind: metamorphic (a known change to the input gives a known change to the output)
  //
  // Generator rationale: the failure always starts with at least one import so the change is purely
  // "one more line", never "the 'No implementation file' message turns into a list".
  test("R6: one more import adds exactly one line and changes nothing else", () => {
    const extra = "extra/added_module.ts"
    fc.assert(
      fc.property(
        failureList.chain((failures) =>
          fc.uniqueArray(sourcePath, { minLength: 1, maxLength: 3 }).map((files) => ({ failures, files })),
        ),
        ({ failures, files }) => {
          const target = { ...failures[0], file: "test/a.test.ts" }
          const all = [
            target,
            ...failures.slice(1).map((item) => ({ ...item, file: item.file === target.file ? undefined : item.file })),
          ]
          const before = formatTestFailureReport(all, { [target.file]: files })
          const after = formatTestFailureReport(all, { [target.file]: [...files, extra] })

          const added = after.split("\n").filter((line) => line.includes(`\`${extra}\``))
          expect(added).toHaveLength(1)
          expect(added[0]).toContain("imported by the test, so it is likely the code under test")
          expect(
            after
              .split("\n")
              .filter((line) => !line.includes(`\`${extra}\``))
              .join("\n"),
          ).toBe(before)
        },
      ),
      { numRuns: 200 },
    )
  })
})
