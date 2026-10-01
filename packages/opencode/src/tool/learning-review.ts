import path from "path"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./learning-review.txt"

const MAX_FILES = 10
const MAX_FINDINGS_PER_RULE = 5
const LONG_LINE = 120
const DEEP_NESTING = 4

export type Category = "correctness" | "maintainability" | "clarity"
export type Severity = "high" | "medium" | "low"

export type SourceLine = {
  /** 1-indexed line number in the reviewed file */
  number: number
  text: string
}

export type SourceFile = {
  path: string
  lines: SourceLine[]
}

export type Finding = {
  rule: string
  category: Category
  severity: Severity
  path: string
  line: number
  snippet: string
  why: string
  guidance: string
}

type Rule = {
  id: string
  category: Category
  severity: Severity
  languages?: Language[]
  match: (line: string, context: { indentUnit: number }) => boolean
  why: string
  guidance: string
}

type Language = "js" | "python" | "other"

const CATEGORY_ORDER: Category[] = ["correctness", "maintainability", "clarity"]

const CATEGORY_TITLE: Record<Category, string> = {
  correctness: "Correctness — could this behave differently than you expect?",
  maintainability: "Maintainability — will this be easy to change later?",
  clarity: "Clarity — will a teammate understand this quickly?",
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

// Each rule explains *why* something may be a problem and gives a hint or
// question instead of a rewritten solution, so the student fixes it themselves.
const RULES: Rule[] = [
  {
    id: "loose-equality",
    category: "correctness",
    severity: "medium",
    languages: ["js"],
    match: (line) => /[^=!<>]==[^=]|!=[^=]/.test(stripStrings(line)),
    why: "`==` and `!=` perform type coercion, so values like `0 == \"\"` or `null == undefined` compare as equal.",
    guidance:
      "Decide whether you really want coercion here. Which types can each side hold, and what should happen when they differ?",
  },
  {
    id: "assignment-in-condition",
    category: "correctness",
    severity: "high",
    languages: ["js"],
    match: (line) => /\b(if|while)\s*\([^=!<>]*[^=!<>]=[^=>][^)]*\)/.test(stripStrings(line)),
    why: "A single `=` inside a condition assigns instead of comparing, so the branch depends on the assigned value.",
    guidance: "Was this meant to be a comparison? If the assignment is intentional, consider moving it to its own line.",
  },
  {
    id: "empty-catch",
    category: "correctness",
    severity: "high",
    languages: ["js"],
    match: (line) => /catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line),
    why: "An empty `catch` silently swallows errors, which hides bugs and makes failures very hard to debug.",
    guidance:
      "What should happen when this fails? Consider logging, rethrowing, or handling the specific error you expect.",
  },
  {
    id: "bare-except",
    category: "correctness",
    severity: "high",
    languages: ["python"],
    match: (line) => /^\s*except\s*:/.test(line),
    why: "A bare `except:` also catches `KeyboardInterrupt` and `SystemExit`, and hides which errors you actually expect.",
    guidance: "Which specific exception types can this block raise? Try naming them explicitly.",
  },
  {
    id: "swallowed-exception",
    category: "correctness",
    severity: "medium",
    languages: ["python"],
    match: (line) => /^\s*except\b.*:\s*pass\s*$/.test(line),
    why: "Catching an exception and doing nothing hides failures from you and from the caller.",
    guidance: "Should the caller know this failed? Think about logging it or letting it propagate.",
  },
  {
    id: "var-declaration",
    category: "maintainability",
    severity: "low",
    languages: ["js"],
    match: (line) => /^\s*var\s+\w/.test(line),
    why: "`var` is function-scoped and hoisted, which can cause surprising behavior inside loops and blocks.",
    guidance: "Does this value ever change after it is set? Consider which of `let` or `const` expresses your intent.",
  },
  {
    id: "explicit-any",
    category: "maintainability",
    severity: "medium",
    languages: ["js"],
    match: (line) => /(:\s*any\b|<any>|as\s+any\b)/.test(stripStrings(line)),
    why: "`any` turns off type checking, so the compiler can no longer catch mistakes involving this value.",
    guidance: "What shape does this value actually have? Try describing it with a specific type or `unknown`.",
  },
  {
    id: "todo-comment",
    category: "maintainability",
    severity: "low",
    match: (line) => /(\/\/|#|\/\*)\s*(TODO|FIXME|HACK|XXX)\b/i.test(line),
    why: "Unfinished work left in comments tends to be forgotten and can hide known bugs.",
    guidance: "Can you finish this now, or track it as an issue on the project board so it is not lost?",
  },
  {
    id: "debug-output",
    category: "maintainability",
    severity: "low",
    match: (line) => /^\s*(console\.(log|debug)|print)\s*\(/.test(line),
    why: "Leftover debug output adds noise for users and teammates and may leak internal data.",
    guidance: "Is this output part of the feature, or was it for debugging? If it is needed, is there a proper logger?",
  },
  {
    id: "magic-number",
    category: "maintainability",
    severity: "low",
    match: (line) => {
      const code = stripStrings(stripComment(line))
      if (/^\s*(export\s+)?(const|final|static|readonly)\b/.test(code)) return false
      if (/^\s*[A-Z][A-Z0-9_]*\s*=/.test(code)) return false
      return /(?<![\w.$\[])(\d{2,}|\d+\.\d+)(?![\w.\]])/.test(code)
    },
    why: "Unnamed numbers hide their meaning, and changing them later means hunting down every copy.",
    guidance: "What does this number represent? Consider giving it a descriptive constant name.",
  },
  {
    id: "deep-nesting",
    category: "maintainability",
    severity: "medium",
    match: (line, context) => {
      if (line.trim().length === 0) return false
      const indent = line.length - line.trimStart().length
      return indent >= context.indentUnit * (DEEP_NESTING + 1)
    },
    why: "Deeply nested code is hard to follow and to test, because each level adds another condition to track.",
    guidance: "Could early returns, guard clauses, or a small helper function flatten this logic?",
  },
  {
    id: "long-line",
    category: "clarity",
    severity: "low",
    match: (line) => line.length > LONG_LINE,
    why: `Lines longer than ${LONG_LINE} characters are hard to read and review, especially side by side in diffs.`,
    guidance: "Is this line doing several things at once? Consider splitting it or naming intermediate values.",
  },
  {
    id: "single-letter-name",
    category: "clarity",
    severity: "low",
    match: (line) =>
      /^\s*(let|const|var)\s+([a-df-hl-z])\s*[=:]/.test(line) || /^\s*def\s+\w+\(([a-df-hl-z])[,)]/.test(line),
    why: "Single-letter names outside short loops force readers to guess what the value means.",
    guidance: "What does this value hold? A descriptive name documents your intent for free.",
  },
  {
    id: "commented-out-code",
    category: "clarity",
    severity: "low",
    match: (line) => /^\s*(\/\/|#)\s*[\w.]+\s*(\(.*\)\s*;?|=\s*.+;)\s*$/.test(line),
    why: "Commented-out code confuses readers about what is actually used; version control already keeps old code.",
    guidance: "Is this code still needed? If not, it is safe to rely on git history instead.",
  },
]

export const Parameters = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: `Files to review (absolute or relative to the project). At most ${MAX_FILES} files.`,
  }),
  diff: Schema.optional(Schema.String).annotate({
    description: "A unified diff (for example the output of `git diff`). Only added lines are reviewed.",
  }),
})

export const LearningReviewTool = Tool.define(
  "learning_review",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const files: SourceFile[] = []

          if (params.diff) files.push(...parseUnifiedDiff(params.diff))

          const requested = (params.paths ?? []).slice(0, MAX_FILES)
          for (const input of requested) {
            const filepath = path.isAbsolute(input) ? input : path.resolve(instance.directory, input)
            const relative = path.relative(instance.worktree, filepath)
            yield* ctx.ask({ permission: "read", patterns: [relative], always: ["*"], metadata: {} })
            const text = yield* fs.readFileStringSafe(filepath)
            if (text === undefined) return yield* Effect.fail(new Error(`File not found: ${filepath}`))
            files.push(toSourceFile(relative, text))
          }

          if (files.length === 0) {
            return yield* Effect.fail(new Error("Provide `paths` to review files or `diff` to review recent changes."))
          }

          const findings = reviewFiles(files)
          return {
            title: files.length === 1 ? files[0].path : `${files.length} files`,
            output: formatReview(findings, files.length),
            metadata: {
              filesReviewed: files.length,
              findings: findings.length,
              skippedPaths: Math.max(0, (params.paths?.length ?? 0) - MAX_FILES),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export function toSourceFile(filepath: string, text: string): SourceFile {
  return {
    path: filepath,
    lines: text.split(/\r?\n/).map((line, index) => ({ number: index + 1, text: line })),
  }
}

/** Extracts the added lines of a unified diff, keeping their line numbers in the new file. */
export function parseUnifiedDiff(diff: string): SourceFile[] {
  const files: SourceFile[] = []
  let current: SourceFile | undefined
  let lineNumber = 0

  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("+++ ")) {
      const target = raw.slice(4).trim().replace(/^b\//, "")
      current = target === "/dev/null" ? undefined : { path: target, lines: [] }
      if (current) files.push(current)
      continue
    }
    if (raw.startsWith("--- ") || raw.startsWith("diff ") || raw.startsWith("index ")) continue
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      lineNumber = Number(hunk[1])
      continue
    }
    if (!current) continue
    if (raw.startsWith("+")) {
      current.lines.push({ number: lineNumber, text: raw.slice(1) })
      lineNumber++
    } else if (raw.startsWith(" ")) {
      lineNumber++
    }
  }

  return files.filter((file) => file.lines.length > 0)
}

export function reviewFiles(files: SourceFile[]): Finding[] {
  return files.flatMap(reviewFile).sort(
    (left, right) =>
      CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category) ||
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      left.path.localeCompare(right.path) ||
      left.line - right.line,
  )
}

export function reviewFile(file: SourceFile): Finding[] {
  const language = detectLanguage(file.path)
  const context = { indentUnit: detectIndentUnit(file.lines) }
  const counts = new Map<string, number>()
  const findings: Finding[] = []

  for (const line of file.lines) {
    for (const rule of RULES) {
      if (rule.languages && !rule.languages.includes(language)) continue
      if ((counts.get(rule.id) ?? 0) >= MAX_FINDINGS_PER_RULE) continue
      if (!rule.match(line.text, context)) continue
      counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1)
      findings.push({
        rule: rule.id,
        category: rule.category,
        severity: rule.severity,
        path: file.path,
        line: line.number,
        snippet: line.text.trim().slice(0, 80),
        why: rule.why,
        guidance: rule.guidance,
      })
    }
  }

  return findings
}

export function formatReview(findings: Finding[], filesReviewed: number) {
  const header = [
    "# Learning-oriented code review",
    "",
    `Reviewed ${filesReviewed} file${filesReviewed === 1 ? "" : "s"} and found ${findings.length} point${findings.length === 1 ? "" : "s"} worth a closer look.`,
    "The goal is to help you improve the code yourself, so each point explains *why* it matters and gives a hint instead of a rewritten solution.",
  ]

  if (findings.length === 0) {
    return [
      ...header,
      "",
      "No common problems were detected. Automated checks cannot catch everything, so still ask yourself:",
      "- Which inputs or edge cases have I not tested yet?",
      "- Would a teammate understand this code without me explaining it?",
    ].join("\n")
  }

  const sections = CATEGORY_ORDER.flatMap((category) => {
    const items = findings.filter((finding) => finding.category === category)
    if (items.length === 0) return []
    return [
      "",
      `## ${CATEGORY_TITLE[category]}`,
      ...items.flatMap((finding) => [
        "",
        `### [${finding.severity}] \`${finding.path}:${finding.line}\` — ${finding.rule}`,
        `> \`${finding.snippet}\``,
        `- **Why it matters:** ${finding.why}`,
        `- **Try this:** ${finding.guidance}`,
      ]),
    ]
  })

  return [
    ...header,
    ...sections,
    "",
    "## Next steps",
    "- Start with the high-severity correctness points, then work down.",
    "- After each change, re-run your tests to confirm the behavior is still what you expect.",
  ].join("\n")
}

function detectLanguage(filepath: string): Language {
  const extension = path.extname(filepath).toLowerCase()
  if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(extension)) return "js"
  if (extension === ".py") return "python"
  return "other"
}

function detectIndentUnit(lines: SourceLine[]) {
  const indents = lines
    .map((line) => line.text)
    .filter((text) => text.trim().length > 0 && !text.startsWith("\t"))
    .map((text) => text.length - text.trimStart().length)
    .filter((indent) => indent > 0)
  const smallest = Math.min(...indents)
  return Number.isFinite(smallest) && smallest >= 2 ? smallest : 2
}

function stripStrings(line: string) {
  return line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""')
}

function stripComment(line: string) {
  return line.replace(/\/\/.*$|#.*$/, "")
}
