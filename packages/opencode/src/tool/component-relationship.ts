import path from "path"
import { Effect, Schema } from "effect"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./component-relationship.txt"

const DISCOVERY_LIMIT = 500
const MATCH_LIMIT = 1000
const MODULE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/
const IMPORT_SPECIFIER = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "node_modules",
  "coverage",
  "dist",
  "build",
  "out",
])

export type Relationship = {
  source: string
  target: string
  imports: number
  reExports: number
}

export type ComponentRelationships = {
  relationships: Relationship[]
}

type ReferenceMatch = {
  path: string
  text: string
}

const Parameters = Schema.Struct({})

export const ComponentRelationshipTool = Tool.define(
  "component_relationship",
  Effect.gen(function* () {
    const ripgrep = yield* Ripgrep.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (_params, ctx) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          yield* ctx.ask({
            permission: "glob",
            patterns: ["**/*"],
            always: ["*"],
            metadata: { path: instance.directory },
          })

          const files = yield* ripgrep.find({ cwd: instance.directory, pattern: "*", limit: DISCOVERY_LIMIT })
          const matches = yield* ripgrep.grep({
            cwd: instance.directory,
            pattern: "(?:\\bfrom|\\bimport|\\brequire)\\s*\\(?\\s*[\"']",
            include: "*.{ts,tsx,js,jsx,mjs,cjs}",
            limit: MATCH_LIMIT,
          })
          const relationships = analyzeComponentRelationships({
            files: files.map((file) => file.path),
            matches: matches.map((match) => ({ path: match.entry.path, text: match.text })),
          })

          return {
            title: path.relative(instance.worktree, instance.directory) || ".",
            output: formatComponentRelationships(relationships),
            metadata: {
              scannedFiles: files.length,
              relationships: relationships.relationships.length,
              discoveryTruncated: files.length === DISCOVERY_LIMIT,
              matchesTruncated: matches.length === MATCH_LIMIT,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export function analyzeComponentRelationships(input: {
  files: string[]
  matches: ReferenceMatch[]
}): ComponentRelationships {
  const files = input.files.map(normalize).filter((file) => isModule(file) && !isExcluded(file))
  const modules = new Map(files.map((file) => [moduleID(file), file]))
  const knownComponents = new Set(files.flatMap(component))
  const relationships = new Map<string, Relationship>()

  for (const match of input.matches) {
    const sourceFile = normalize(match.path)
    const source = component(sourceFile)[0]
    if (!source || isExcluded(sourceFile)) continue

    for (const specifier of [...match.text.matchAll(IMPORT_SPECIFIER)].map((item) => item[1])) {
      const target = resolveComponent({ importer: sourceFile, specifier, modules, knownComponents })
      if (!target || target === source) continue

      const key = `${source}\u0000${target}`
      const existing = relationships.get(key) ?? { source, target, imports: 0, reExports: 0 }
      if (/^\s*export\b/.test(match.text)) existing.reExports += 1
      else existing.imports += 1
      relationships.set(key, existing)
    }
  }

  return { relationships: [...relationships.values()].sort(byRelationship) }
}

export function formatComponentRelationships(input: ComponentRelationships) {
  return [
    "# Component relationships",
    "",
    "## Major component interactions",
    input.relationships.length === 0
      ? "- No meaningful component relationships were found."
      : input.relationships.map(formatRelationship).join("\n"),
    "",
    "## Scope",
    "- Relationships are aggregated from resolvable TypeScript and JavaScript imports between major components.",
  ].join("\n")
}

function resolveComponent(input: {
  importer: string
  specifier: string
  modules: Map<string, string>
  knownComponents: Set<string>
}) {
  if (input.specifier.startsWith(".")) {
    const target = input.modules.get(moduleID(path.posix.join(path.posix.dirname(input.importer), input.specifier)))
    return target ? component(target)[0] : undefined
  }

  const workspacePackage = input.specifier.match(/^@opencode-ai\/([^/]+)/)?.[1]
  if (workspacePackage && input.knownComponents.has(`packages/${workspacePackage}`))
    return `packages/${workspacePackage}`

  if (!/^[@~#]\//.test(input.specifier)) return
  const candidate = moduleID(input.specifier.slice(2))
  const targets = [...input.modules.entries()]
    .filter(([module]) => module === candidate || module.endsWith(`/${candidate}`))
    .map(([, file]) => component(file)[0])
    .filter((item): item is string => item !== undefined)
  return targets.length === 1 ? targets[0] : undefined
}

function component(filepath: string) {
  const [first, second, ...rest] = filepath.split("/")
  if (!first || (rest.length === 0 && !second)) return []
  if ((first === "packages" || first === "apps") && second) return [`${first}/${second}`]
  return [first]
}

function moduleID(filepath: string) {
  return normalize(filepath)
    .replace(MODULE_EXTENSION, "")
    .replace(/\/index$/, "")
}

function isModule(filepath: string) {
  return MODULE_EXTENSION.test(filepath)
}

function isExcluded(filepath: string) {
  return filepath.split("/").some((part) => EXCLUDED_DIRECTORIES.has(part))
}

function normalize(filepath: string) {
  return path.posix.normalize(filepath.replaceAll("\\", "/")).replace(/^\.\//, "").replace(/\/+$/, "")
}

function byRelationship(left: Relationship, right: Relationship) {
  return left.source.localeCompare(right.source) || left.target.localeCompare(right.target)
}

function formatRelationship(relationship: Relationship) {
  const actions = [
    relationship.imports > 0 ? `${relationship.imports} import${relationship.imports === 1 ? "" : "s"}` : undefined,
    relationship.reExports > 0
      ? `${relationship.reExports} re-export${relationship.reExports === 1 ? "" : "s"}`
      : undefined,
  ]
    .filter((item): item is string => item !== undefined)
    .join(" and ")
  return `- \`${relationship.source}\` → \`${relationship.target}\` — ${actions} show that ${relationship.source} uses modules from ${relationship.target}.`
}
