import path from "path"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./change-impact.txt"

const MATCH_LIMIT = 1000

const MODULE_EXTENSION = /\.(?:[cm]?[jt]sx?|py)$/

const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "coverage", "__pycache__"])

const TEST_FILE = [
  /(^|\/)(test|tests|__tests__|spec|e2e)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)test_[^/]*\.py$/,
  /_test\.py$/,
]

// Covers `from "x"`, `import "x"`, `import("x")`, `require("x")` and test-runner mocks like `vi.mock("x")`.
const JS_SPECIFIER = /(?:\bfrom|\bimport|\brequire|\.mock)\s*\(?\s*["']([^"']+)["']/g

export type ReferenceMatch = {
  path: string
  line: number
  text: string
}

export type Relation = "re-export" | "import" | "mock" | "reference"

export type ImpactedFile = {
  path: string
  relation: Relation
  lines: number[]
  symbols: string[]
  missing: string[]
  reason: string
}

export type ChangeImpact = {
  target: string
  exports: string[] | undefined
  reExports: ImpactedFile[]
  dependents: ImpactedFile[]
  tests: ImpactedFile[]
  references: ImpactedFile[]
}

type Usage = {
  relation: Relation
  symbols: string[]
  sideEffect: boolean
}

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: "Path to the changed file, absolute or relative to the current working directory",
  }),
})

export const ChangeImpactTool = Tool.define(
  "change_impact",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { filePath: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const absolute = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(instance.directory, params.filePath)
          const target = normalize(path.relative(instance.directory, absolute))
          if (target.startsWith("..")) throw new Error(`${params.filePath} is outside the current project`)

          yield* ctx.ask({
            permission: "grep",
            patterns: [target],
            always: ["*"],
            metadata: { path: absolute },
          })

          const content = yield* fs.readFileStringSafe(absolute)
          const matches = yield* ripgrep.grep({
            cwd: instance.directory,
            pattern: searchPattern(target),
            limit: MATCH_LIMIT,
          })
          const impact = analyzeChangeImpact({
            target,
            content,
            matches: matches.map((match) => ({ path: match.entry.path, line: match.line, text: match.text })),
          })

          return {
            title: target,
            output: formatChangeImpact(impact),
            metadata: {
              matches: matches.length,
              truncated: matches.length === MATCH_LIMIT,
              affectedFiles: affected(impact).length,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export function analyzeChangeImpact(input: {
  target: string
  content: string | undefined
  matches: ReferenceMatch[]
}): ChangeImpact {
  const target = normalize(input.target)
  const exports = input.content === undefined ? undefined : exportedSymbols(target, input.content)

  const usages = input.matches
    .map((match) => ({ ...match, path: normalize(match.path) }))
    .filter((match) => match.path !== target && !isExcluded(match.path))
    .flatMap((match) => lineUsages(match.path, match.text, target).map((usage) => ({ ...usage, match })))

  const files = [...Map.groupBy(usages, (usage) => usage.match.path)]
    .map(([filepath, entries]) => {
      const relation = strongest(entries.map((entry) => entry.relation))
      const symbols = [...new Set(entries.flatMap((entry) => entry.symbols))]
      const missing = exports ? symbols.filter((symbol) => symbol !== "*" && !exports.includes(symbol)) : []
      return {
        path: filepath,
        relation,
        lines: [...new Set(entries.map((entry) => entry.match.line))].sort((a, b) => a - b),
        symbols,
        missing,
        reason: explain({
          target,
          relation,
          symbols,
          missing,
          test: isTest(filepath),
          sideEffect: entries.every((entry) => entry.sideEffect),
        }),
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path))

  return {
    target,
    exports,
    reExports: files.filter((file) => file.relation === "re-export"),
    dependents: files.filter((file) => (file.relation === "import" || file.relation === "mock") && !isTest(file.path)),
    tests: files.filter((file) => (file.relation === "import" || file.relation === "mock") && isTest(file.path)),
    references: files.filter((file) => file.relation === "reference"),
  }
}

export function formatChangeImpact(impact: ChangeImpact) {
  const count = affected(impact).length
  return [
    `# Change impact: \`${impact.target}\``,
    "",
    formatExports(impact.exports),
    "",
    count === 0
      ? "No files directly import or reference this file. The change is likely local, but dynamic usages (string-based lookups, reflection, generated code) cannot be detected statically."
      : `Found ${count} directly affected ${count === 1 ? "file" : "files"}.`,
    "",
    "## Re-exports (impact propagates further)",
    formatFiles(impact.reExports),
    "",
    "## Direct dependents",
    formatFiles(impact.dependents),
    "",
    "## Tests to re-run",
    formatFiles(impact.tests),
    "",
    "## Other references",
    formatFiles(impact.references),
    "",
    "## Scope",
    "- Only direct impacts are listed. Files that depend on the files above may be affected indirectly; run this analysis on them to follow the chain.",
  ].join("\n")
}

export function exportedSymbols(target: string, content: string) {
  if (target.endsWith(".py")) {
    return unique([...content.matchAll(/^(?:async\s+def|def|class)\s+([A-Za-z]\w*)/gm)].map((match) => match[1]))
  }
  const declarations = [
    ...content.matchAll(
      /^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|class|const|let|var|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm,
    ),
  ].map((match) => match[1])
  const namespaces = [...content.matchAll(/^\s*export\s*\*\s*as\s+([A-Za-z_$][\w$]*)/gm)].map((match) => match[1])
  const lists = [...content.matchAll(/^\s*export\s+(?:type\s+)?\{([^}]*)\}/gm)].flatMap((match) =>
    namedList(match[1]).map((item) => item.exported),
  )
  const defaults = /^\s*export\s+default\b/m.test(content) ? ["default"] : []
  return unique([...declarations, ...namespaces, ...lists, ...defaults])
}

function lineUsages(importer: string, text: string, target: string): Usage[] {
  const line = text.trim()
  const imports = importer.endsWith(".py") ? pythonUsages(importer, line, target) : jsUsages(importer, line, target)
  if (imports.length > 0) return imports
  return mentions(line, target) ? [{ relation: "reference", symbols: [], sideEffect: false }] : []
}

function jsUsages(importer: string, line: string, target: string): Usage[] {
  return [...line.matchAll(JS_SPECIFIER)]
    .filter((match) => resolvesTo(importer, match[1], target))
    .map((match) => {
      if (match[0].startsWith(".mock")) return { relation: "mock" as const, symbols: [], sideEffect: false }
      if (/^export\b/.test(line)) return { relation: "re-export" as const, symbols: jsSymbols(line), sideEffect: false }
      return { relation: "import" as const, symbols: jsSymbols(line), sideEffect: /^import\s*["']/.test(line) }
    })
}

function jsSymbols(line: string) {
  if (/^(?:import|export)\s+(?:type\s+)?\*/.test(line)) return ["*"]
  const named = line.match(/\{([^}]*)\}/)
  const fallback = line.match(/^import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,|from\b)/)
  return [...(fallback ? ["default"] : []), ...(named ? namedList(named[1]).map((item) => item.local) : [])]
}

function namedList(list: string) {
  return list
    .split(",")
    .map((item) => item.trim().replace(/^type\s+/, ""))
    .filter((item) => item.length > 0)
    .map((item) => {
      const [local, exported] = item.split(/\s+as\s+/)
      return { local, exported: exported ?? local }
    })
}

function pythonUsages(importer: string, line: string, target: string): Usage[] {
  const from = line.match(/^from\s+(\.*[\w.]*)\s+import\s+\(?([^)#]*)/)
  if (from) {
    const names = from[2]
      .split(",")
      .map((name) => name.trim().split(/\s+as\s+/)[0])
      .filter((name) => /^[A-Za-z_*]\w*$|^\*$/.test(name))
    const separator = from[1].endsWith(".") || from[1] === "" ? "" : "."
    // `from pkg import mod` may import the changed module itself rather than a symbol from it.
    if (pythonResolvesTo(importer, from[1], target)) return [{ relation: "import", symbols: names, sideEffect: false }]
    return names.some((name) => pythonResolvesTo(importer, from[1] + separator + name, target))
      ? [{ relation: "import", symbols: ["*"], sideEffect: false }]
      : []
  }
  const plain = line.match(/^import\s+([\w.,\s]+?)\s*(?:#.*)?$/)
  if (!plain) return []
  return plain[1]
    .split(",")
    .map((name) => name.trim().split(/\s+as\s+/)[0])
    .some((name) => pythonResolvesTo(importer, name, target))
    ? [{ relation: "import", symbols: ["*"], sideEffect: false }]
    : []
}

function resolvesTo(importer: string, specifier: string, target: string) {
  if (specifier.startsWith("."))
    return moduleId(path.posix.join(path.posix.dirname(importer), specifier)) === moduleId(target)
  // Common path aliases such as `@/tool/tool` or `~/utils` point into a source root we cannot resolve without config,
  // so match them against the tail of the target path.
  if (!/^[@~#]\//.test(specifier)) return false
  const candidate = moduleId(specifier.slice(2))
  const module = moduleId(target)
  return module === candidate || module.endsWith(`/${candidate}`)
}

function pythonResolvesTo(importer: string, specifier: string, target: string) {
  const dots = specifier.match(/^\.*/)?.[0].length ?? 0
  const rest = specifier.slice(dots).replaceAll(".", "/")
  const module = moduleId(target)
  if (dots === 0) return module === rest || module.endsWith(`/${rest}`)
  const base = path.posix.join(path.posix.dirname(importer), ...Array<string>(dots - 1).fill(".."))
  return module === normalize(path.posix.join(base, rest))
}

function mentions(line: string, target: string) {
  if (line.includes(target)) return true
  const base = path.posix.basename(target)
  // Generic names like `index.ts` or `__init__.py` are only meaningful with their full path.
  if (/^(index|__init__)\./.test(base)) return false
  return new RegExp(`(^|[^\\w./-])${escape(base)}\\b`).test(line)
}

function explain(input: {
  target: string
  relation: Relation
  symbols: string[]
  missing: string[]
  test: boolean
  sideEffect: boolean
}) {
  const warning =
    input.missing.length > 0
      ? ` ${formatSymbols(input.missing)} ${input.missing.length === 1 ? "is" : "are"} no longer exported by the changed file, so this import is likely broken.`
      : ""
  if (input.relation === "reference")
    return "Mentions the changed file by name (for example in configuration, scripts, or documentation); update it if the file is renamed, moved, or its behavior changes."
  if (input.relation === "mock")
    return `Mocks the changed file; update the mock if exported names, signatures, or return values change.${warning}`
  if (input.relation === "re-export")
    return `Re-exports ${usedSymbols(input.symbols)} from the changed file, so the change reaches every file that imports this module.${warning}`
  if (input.sideEffect)
    return "Imports the changed file for its side effects; changes to top-level code will run differently here."
  if (input.test)
    return `Tests ${usedSymbols(input.symbols)} from the changed file; re-run it and update expectations if behavior intentionally changed.${warning}`
  return `Uses ${usedSymbols(input.symbols)} from the changed file; renaming, removing, or changing the signature or behavior of ${input.symbols.length === 1 && input.symbols[0] !== "*" ? "it" : "them"} may break this file.${warning}`
}

function usedSymbols(symbols: string[]) {
  if (symbols.includes("*")) return "the whole module"
  if (symbols.length === 0) return "one or more exports"
  return formatSymbols(symbols.map((symbol) => (symbol === "default" ? "default export" : symbol)))
}

function formatSymbols(symbols: string[]) {
  return symbols.map((symbol) => `\`${symbol}\``).join(", ")
}

function formatExports(exports: string[] | undefined) {
  if (exports === undefined)
    return "The changed file could not be read (it may have been deleted), so its exported symbols are unknown."
  if (exports.length === 0) return "No exported symbols were detected in the changed file."
  return `Exported symbols: ${formatSymbols(exports)}`
}

function formatFiles(files: ImpactedFile[]) {
  if (files.length === 0) return "- None found."
  return files
    .map(
      (file) =>
        `- \`${file.path}\` (${file.lines.length === 1 ? "line" : "lines"} ${file.lines.join(", ")}) — ${file.reason}`,
    )
    .join("\n")
}

function affected(impact: ChangeImpact) {
  return [...impact.reExports, ...impact.dependents, ...impact.tests, ...impact.references]
}

function strongest(relations: Relation[]) {
  return (
    (["re-export", "import", "mock", "reference"] as const).find((relation) => relations.includes(relation)) ??
    "reference"
  )
}

function searchPattern(target: string) {
  const module = moduleId(target)
  return `\\b${escape(path.posix.basename(module))}\\b`
}

function moduleId(filepath: string) {
  return normalize(filepath)
    .replace(MODULE_EXTENSION, "")
    .replace(/\/(index|__init__)$/, "")
}

function normalize(filepath: string) {
  return path.posix.normalize(filepath.replaceAll("\\", "/")).replace(/^\.\//, "").replace(/\/+$/, "")
}

function isExcluded(filepath: string) {
  return filepath.split("/").some((part) => EXCLUDED_DIRECTORIES.has(part))
}

function isTest(filepath: string) {
  return TEST_FILE.some((pattern) => pattern.test(filepath))
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function unique(values: string[]) {
  return [...new Set(values)]
}
