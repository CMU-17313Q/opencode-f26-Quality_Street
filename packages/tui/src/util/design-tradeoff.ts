import fs from "fs"
import path from "path"

export type Factor = "complexity" | "maintainability" | "testability" | "consistency" | "performance"
export type Rating = "favorable" | "mixed" | "unfavorable" | "unclear"

export type Approach = {
  name: string
  description: string
}

export type RepoContext = {
  languages: string[]
  dependencies: string[]
  testFramework?: string
  hasTests: boolean
}

export type FactorAssessment = {
  factor: Factor
  rating: Rating
  pros: string[]
  cons: string[]
}

export type ApproachAnalysis = {
  approach: Approach
  factors: FactorAssessment[]
  advantages: string[]
  disadvantages: string[]
}

export type TradeoffResult =
  | {
      status: "insufficient"
      decision: string
      problems: string[]
      hints: string[]
    }
  | {
      status: "ready"
      decision: string
      context: string[]
      approaches: ApproachAnalysis[]
      contrasts: string[]
      questions: string[]
    }

type Impact = {
  factor: Factor
  pro: boolean
  reason: string
}

type Signal = {
  pattern: RegExp
  impacts: Impact[]
}

export const FACTORS: Factor[] = ["complexity", "maintainability", "testability", "consistency", "performance"]

export const FACTOR_LABEL: Record<Factor, string> = {
  complexity: "Complexity",
  maintainability: "Maintainability",
  testability: "Testability",
  consistency: "Consistency with repo",
  performance: "Performance",
}

const MIN_DESCRIPTION_WORDS = 4
const MAX_APPROACHES = 4
const MAX_SCANNED_ENTRIES = 3000
const MAX_SCAN_DEPTH = 4
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", ".venv", "venv", "__pycache__", "target"])

const pro = (factor: Factor, reason: string): Impact => ({ factor, pro: true, reason })
const con = (factor: Factor, reason: string): Impact => ({ factor, pro: false, reason })

// Each signal links wording in an approach description to the software engineering
// factors it usually affects. Reasons explain *why*, so students can judge for themselves.
const SIGNALS: Signal[] = [
  {
    pattern: /\b(global|singleton|shared mutable|module-level state)\b/,
    impacts: [
      con("testability", "Global or shared state is hard to isolate and reset between tests."),
      con("maintainability", "Hidden shared state means a change in one place can affect distant code."),
      pro("complexity", "A single shared instance is quick to wire up."),
    ],
  },
  {
    pattern: /\b(dependency injection|inject(ed)?|pass(ed)? (it )?(in|as (an? )?(parameter|argument)))\b/,
    impacts: [
      pro("testability", "Dependencies can be replaced with fakes or stubs in tests."),
      con("complexity", "Callers must create and pass the dependency, which adds wiring code."),
    ],
  },
  {
    pattern: /\b(interface|abstract(ion)?|strategy pattern|plugin|adapter|factory)\b/,
    impacts: [
      pro("maintainability", "New variants can be added without changing the code that uses them."),
      con("complexity", "Adds a layer of indirection that readers must follow to understand behaviour."),
    ],
  },
  {
    pattern: /\b(inline|hard-?coded?|if[- ]else|switch statement|directly in)\b/,
    impacts: [
      pro("complexity", "Logic stays in one visible place and is fast to implement."),
      con("maintainability", "Every new case requires editing this code again."),
    ],
  },
  {
    pattern: /\b(copy|duplicate|copy-paste|copy and paste)\b/,
    impacts: [
      pro("complexity", "Avoids designing a shared abstraction up front."),
      con("maintainability", "Duplicated logic has to be kept in sync, so fixes can be missed in one copy."),
    ],
  },
  {
    pattern: /\b(new (library|dependency|package|framework)|install|third-party|external (library|service|api))\b/,
    impacts: [
      pro("complexity", "The library already solves the details, so less code is written by hand."),
      con("consistency", "Introduces a dependency the team must learn, review and keep updated."),
    ],
  },
  {
    pattern: /\b(reuse|existing|already (use|uses|have|has)|follows? the (existing|current)|same pattern)\b/,
    impacts: [
      pro("consistency", "Builds on code and patterns the project already has."),
      pro("maintainability", "Teammates will recognise the structure because it matches the rest of the codebase."),
    ],
  },
  {
    pattern: /\b(cache|caching|cached|memoi[sz](e|ation))\b/,
    impacts: [
      pro("performance", "Avoids repeating expensive work for the same input."),
      con("complexity", "Cache invalidation adds edge cases: when is stored data out of date?"),
      con("testability", "Cached state can leak between tests unless it is reset."),
    ],
  },
  {
    pattern: /\b(async|parallel|concurren(t|cy)|threads?|workers?|queue|background job)\b/,
    impacts: [
      pro("performance", "Work can run without blocking the caller."),
      con("complexity", "Ordering, retries and race conditions become part of the design."),
      con("testability", "Timing-dependent behaviour is harder to test deterministically."),
    ],
  },
  {
    pattern: /\b(database|sql|sqlite|postgres(ql)?|persist(ed|ent|ence)?|on disk)\b/,
    impacts: [
      pro("maintainability", "Data survives restarts and can be inspected or migrated later."),
      con("performance", "Each read or write is an I/O round trip."),
      con("complexity", "Requires a schema, migrations and error handling for storage failures."),
    ],
  },
  {
    pattern: /\bin[- ]memory\b/,
    impacts: [
      pro("performance", "Reads and writes are fast because no I/O is involved."),
      pro("complexity", "No storage setup is required."),
      con("maintainability", "Data is lost on restart and is not shared across processes."),
    ],
  },
  {
    pattern:
      /\b(pure functions?|separate (module|file|function|class)|split|smaller functions?|single responsibility|helper)\b/,
    impacts: [
      pro("testability", "Small, separated units can be tested in isolation."),
      pro("maintainability", "Each part has one job, so changes stay local."),
    ],
  },
  {
    pattern: /\b(one (big|large|single) (file|function|class)|all in one|god (class|object)|monolith(ic)?)\b/,
    impacts: [
      pro("complexity", "Everything is in one place, which is easy to find at first."),
      con("maintainability", "Large units grow tangled and become risky to change."),
      con("testability", "Behaviour cannot be tested piece by piece."),
    ],
  },
  {
    pattern: /\b(rewrite|refactor|replace the (existing|current)|migrate)\b/,
    impacts: [
      pro("maintainability", "Cleans up the design for future changes."),
      con("complexity", "Touches existing code, which makes the change larger and risks regressions."),
    ],
  },
  {
    pattern: /\b(unit tests?|tests?|mocks?|stubs?|fakes?)\b/,
    impacts: [pro("testability", "The approach already considers how it will be tested.")],
  },
  {
    pattern: /\b(events?|pub\/?sub|observer|callbacks?|listeners?)\b/,
    impacts: [
      pro("maintainability", "Decouples the code that produces changes from the code that reacts to them."),
      con("complexity", "Control flow is harder to trace because handlers run indirectly."),
    ],
  },
  {
    pattern: /\b(poll(ing)?|brute[- ]force|nested loops?|scan (everything|all|every))\b/,
    impacts: [
      pro("complexity", "The algorithm is simple to write and reason about."),
      con("performance", "Repeats work that grows with input size or time."),
    ],
  },
  {
    pattern: /\b(config(uration)?|environment variables?|feature flags?|settings?)\b/,
    impacts: [
      pro("maintainability", "Behaviour can change without editing code."),
      con("complexity", "Each option adds a code path that must be understood and tested."),
    ],
  },
]

// Well-known technologies. Mentioning one the repository does not use is a consistency signal.
const KNOWN_TECHNOLOGIES = [
  "redis",
  "express",
  "react",
  "vue",
  "angular",
  "svelte",
  "django",
  "flask",
  "fastapi",
  "mongodb",
  "mongoose",
  "graphql",
  "zod",
  "lodash",
  "axios",
  "redux",
  "jest",
  "vitest",
  "mocha",
  "pytest",
  "kafka",
  "rabbitmq",
  "prisma",
  "drizzle",
  "sequelize",
  "tailwind",
]

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".py": "Python",
  ".java": "Java",
  ".go": "Go",
  ".rs": "Rust",
  ".rb": "Ruby",
  ".cs": "C#",
  ".cpp": "C++",
  ".c": "C",
}

const TEST_FRAMEWORKS = ["vitest", "jest", "mocha", "pytest", "ava", "jasmine"]

/** Parses "Name: description" input. Falls back to the given name when no short prefix is present. */
export function parseApproach(input: string, fallbackName: string): Approach {
  const text = input.trim()
  const match = text.match(/^([^:\n]{1,40}):\s*([\s\S]+)$/)
  if (match) return { name: match[1].trim(), description: match[2].trim() }
  return { name: fallbackName, description: text }
}

export function explainTradeoffs(input: {
  decision: string
  approaches: Approach[]
  context?: RepoContext
}): TradeoffResult {
  const decision = input.decision.trim()
  const approaches = input.approaches
    .map((approach) => ({ name: approach.name.trim(), description: approach.description.trim() }))
    .filter((approach) => approach.description.length > 0)
    .slice(0, MAX_APPROACHES)

  const problems = validate(decision, approaches)
  if (problems.length > 0) return insufficient(decision, problems)

  const analyses = approaches.map((approach) => analyseApproach(approach, input.context))
  const vague = analyses.filter((analysis) => analysis.factors.every((factor) => factor.rating === "unclear"))
  if (vague.length > 0) {
    return insufficient(
      decision,
      vague.map(
        (analysis) =>
          `"${analysis.approach.name}" does not mention details that can be compared (for example how data is stored, how the code is structured, or whether new libraries are needed).`,
      ),
    )
  }

  return {
    status: "ready",
    decision,
    context: describeContext(input.context),
    approaches: analyses,
    contrasts: contrast(analyses),
    questions: questions(analyses, input.context),
  }
}

function validate(decision: string, approaches: Approach[]) {
  const problems: string[] = []
  if (decision.length === 0) problems.push("The decision you are trying to make is missing.")
  if (approaches.length < 2) problems.push("At least two approaches are needed to compare tradeoffs.")
  for (const approach of approaches) {
    if (wordCount(approach.description) < MIN_DESCRIPTION_WORDS) {
      problems.push(`"${approach.name}" is too short to analyse. Describe how it would work in a sentence.`)
    }
  }
  const seen = new Map<string, string>()
  for (const approach of approaches) {
    const key = normalise(approach.description)
    const previous = seen.get(key)
    if (previous) problems.push(`"${previous}" and "${approach.name}" describe the same approach.`)
    else seen.set(key, approach.name)
  }
  return problems
}

function insufficient(decision: string, problems: string[]): TradeoffResult {
  return {
    status: "insufficient",
    decision,
    problems,
    hints: [
      'State the decision as a question, e.g. "How should we store user sessions?"',
      'Give each approach a name and one or two sentences, e.g. "In-memory map: keep sessions in a Map inside the server".',
      "Mention concrete details: where state lives, how the code is split, libraries involved, and how it would be tested.",
    ],
  }
}

export function analyseApproach(approach: Approach, context?: RepoContext): ApproachAnalysis {
  const text = approach.description.toLowerCase()
  const impacts = SIGNALS.filter((signal) => signal.pattern.test(text)).flatMap((signal) => signal.impacts)
  if (context) impacts.push(...contextImpacts(text, context))

  const factors = FACTORS.map((factor): FactorAssessment => {
    const pros = unique(
      impacts.filter((impact) => impact.factor === factor && impact.pro).map((impact) => impact.reason),
    )
    const cons = unique(
      impacts.filter((impact) => impact.factor === factor && !impact.pro).map((impact) => impact.reason),
    )
    return { factor, rating: rate(pros.length, cons.length), pros, cons }
  })

  return {
    approach,
    factors,
    advantages: factors.flatMap((factor) => factor.pros.map((reason) => `${FACTOR_LABEL[factor.factor]}: ${reason}`)),
    disadvantages: factors.flatMap((factor) =>
      factor.cons.map((reason) => `${FACTOR_LABEL[factor.factor]}: ${reason}`),
    ),
  }
}

function contextImpacts(text: string, context: RepoContext): Impact[] {
  const impacts: Impact[] = []
  const dependencies = new Set(context.dependencies.map((dependency) => dependency.toLowerCase()))

  for (const dependency of dependencies) {
    if (dependency.length < 3 || !mentions(text, dependency)) continue
    impacts.push(pro("consistency", `Uses \`${dependency}\`, which this repository already depends on.`))
  }
  for (const technology of KNOWN_TECHNOLOGIES) {
    if (dependencies.has(technology) || !mentions(text, technology)) continue
    impacts.push(con("consistency", `Uses \`${technology}\`, which this repository does not depend on yet.`))
  }
  for (const language of new Set(Object.values(LANGUAGE_BY_EXTENSION))) {
    if (language.length < 3 || context.languages.includes(language) || context.languages.length === 0) continue
    if (!mentions(text, language.toLowerCase())) continue
    impacts.push(
      con("consistency", `Written in ${language}, while the repository mainly uses ${context.languages.join(", ")}.`),
    )
  }
  return impacts
}

function rate(pros: number, cons: number): Rating {
  if (pros === 0 && cons === 0) return "unclear"
  if (cons === 0) return "favorable"
  if (pros === 0) return "unfavorable"
  return "mixed"
}

function score(assessment: FactorAssessment) {
  return assessment.pros.length - assessment.cons.length
}

function contrast(analyses: ApproachAnalysis[]) {
  const lines: string[] = []
  const strengths = new Map<string, Factor[]>()

  for (const factor of FACTORS) {
    const scored = analyses
      .map((analysis) => ({ analysis, assessment: analysis.factors.find((item) => item.factor === factor)! }))
      .filter((item) => item.assessment.rating !== "unclear")
    if (scored.length === 0) continue
    const best = Math.max(...scored.map((item) => score(item.assessment)))
    const leaders = scored.filter((item) => score(item.assessment) === best)
    if (leaders.length === analyses.length || best <= 0) continue
    for (const leader of leaders) {
      const name = leader.analysis.approach.name
      strengths.set(name, [...(strengths.get(name) ?? []), factor])
    }
  }

  for (const analysis of analyses) {
    const factors = strengths.get(analysis.approach.name)
    if (!factors) continue
    lines.push(
      `Lean towards "${analysis.approach.name}" if ${joinWords(factors.map((factor) => FACTOR_LABEL[factor].toLowerCase()))} matter${factors.length === 1 ? "s" : ""} most.`,
    )
  }
  if (lines.length === 0) {
    lines.push(
      "No approach is clearly stronger on any single factor, so the choice depends on the project's priorities.",
    )
  }
  lines.push("This explainer does not pick a winner. Weigh these factors against your project's constraints.")
  return lines
}

function questions(analyses: ApproachAnalysis[], context?: RepoContext) {
  const result = ["Which matters more right now: delivering quickly, or making future changes easy?"]
  const unclear = FACTORS.filter((factor) =>
    analyses.some((analysis) => analysis.factors.find((item) => item.factor === factor)?.rating === "unclear"),
  )
  if (unclear.includes("testability")) result.push("How would you write a unit test for each approach?")
  if (unclear.includes("performance"))
    result.push("How much data or traffic will this code handle, and does speed matter here?")
  if (unclear.includes("consistency")) result.push("Is there similar code in the repository you could follow or reuse?")
  if (context && !context.hasTests) {
    result.push("No tests were detected in this repository. How will you verify whichever approach you choose?")
  }
  return result
}

function describeContext(context?: RepoContext) {
  if (!context) return ["Repository context was not available, so consistency is judged from the descriptions only."]
  const lines: string[] = []
  if (context.languages.length > 0) lines.push(`Languages: ${context.languages.join(", ")}`)
  if (context.dependencies.length > 0) {
    const shown = context.dependencies.slice(0, 8)
    const more = context.dependencies.length - shown.length
    lines.push(`Dependencies: ${shown.join(", ")}${more > 0 ? ` (+${more} more)` : ""}`)
  }
  lines.push(
    context.hasTests
      ? `Tests: found${context.testFramework ? ` (${context.testFramework})` : ""}`
      : "Tests: none detected",
  )
  return lines
}

/** Reads lightweight repository facts used to judge consistency with the existing codebase. */
export function collectRepoContext(directory: string): RepoContext {
  const dependencies = new Set<string>()
  const languages = new Map<string, number>()
  let hasTests = false
  let testFramework: string | undefined
  let scanned = 0

  const packageJson = readJson(path.join(directory, "package.json"))
  if (packageJson) {
    for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
      const section = packageJson[key]
      if (section && typeof section === "object") Object.keys(section).forEach((name) => dependencies.add(name))
    }
    const testScript = packageJson.scripts?.test
    if (typeof testScript === "string" && testScript.includes("bun test")) testFramework = "bun test"
  }
  for (const file of ["requirements.txt", "requirements-dev.txt"]) {
    const text = readText(path.join(directory, file))
    if (!text) continue
    for (const line of text.split(/\r?\n/)) {
      const name = line.trim().match(/^([A-Za-z0-9_.-]+)/)?.[1]
      if (name && !line.trim().startsWith("#")) dependencies.add(name.toLowerCase())
    }
  }

  const walk = (current: string, depth: number) => {
    if (depth > MAX_SCAN_DEPTH || scanned >= MAX_SCANNED_ENTRIES) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (scanned++ >= MAX_SCANNED_ENTRIES) return
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue
        if (["test", "tests", "__tests__", "spec"].includes(entry.name)) hasTests = true
        walk(path.join(current, entry.name), depth + 1)
        continue
      }
      if (/\.(test|spec)\.[jt]sx?$/.test(entry.name) || /^test_.*\.py$/.test(entry.name)) hasTests = true
      const language = LANGUAGE_BY_EXTENSION[path.extname(entry.name).toLowerCase()]
      if (language) languages.set(language, (languages.get(language) ?? 0) + 1)
    }
  }
  walk(directory, 0)

  testFramework ??= TEST_FRAMEWORKS.find((framework) => dependencies.has(framework))
  return {
    languages: [...languages.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([language]) => language),
    dependencies: [...dependencies].sort(),
    testFramework,
    hasTests: hasTests || testFramework !== undefined,
  }
}

function readText(file: string) {
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return undefined
  }
}

function readJson(file: string) {
  const text = readText(file)
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function mentions(text: string, word: string) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^a-z0-9@/-])${escaped}($|[^a-z0-9-])`).test(text)
}

function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length
}

function normalise(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function joinWords(words: string[]) {
  if (words.length <= 1) return words.join("")
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
}
