import path from "path"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Git } from "@/git"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import { analyzeChangeImpact, type ChangeImpact, type ImpactedFile } from "./change-impact"
import DESCRIPTION from "./pr-impact.txt"

const MATCH_LIMIT = 1000
const MODULE_EXTENSION = /\.(?:[cm]?[jt]sx?|py)$/

export type ImpactedArea = {
  path: string
  causedBy: string[]
  reasons: string[]
}

export type PrImpact = {
  changedFiles: string[]
  impacted: ImpactedArea[]
  tests: ImpactedArea[]
}

export function aggregateImpacts(changedFiles: string[], impacts: ChangeImpact[]): PrImpact {
  const changed = new Set(changedFiles)
  const impacted = new Map<string, ImpactedArea>()
  const tests = new Map<string, ImpactedArea>()

  for (const impact of impacts) {
    const groups: [ImpactedFile[], Map<string, ImpactedArea>][] = [
      [impact.reExports, impacted],
      [impact.dependents, impacted],
      [impact.references, impacted],
      [impact.tests, tests],
    ]
    for (const [files, bucket] of groups) {
      for (const file of files) {
        if (changed.has(file.path)) continue
        const area = bucket.get(file.path) ?? { path: file.path, causedBy: [], reasons: [] }
        if (!area.causedBy.includes(impact.target)) area.causedBy.push(impact.target)
        if (!area.reasons.includes(file.reason)) area.reasons.push(file.reason)
        bucket.set(file.path, area)
      }
    }
  }

  return {
    changedFiles: [...changedFiles].sort(),
    impacted: rank([...impacted.values()]),
    tests: rank([...tests.values()]),
  }
}

function rank(areas: ImpactedArea[]) {
  return areas.sort(
    (left, right) => right.causedBy.length - left.causedBy.length || left.path.localeCompare(right.path),
  )
}

export function formatPrImpact(impact: PrImpact) {
  const lines = ["# PR impact analysis", "", "## Changed in this PR"]
  if (impact.changedFiles.length === 0) lines.push("- No code changes were found against the base branch.")
  else lines.push(...impact.changedFiles.map((file) => `- \`${file}\``))

  lines.push("", "## Additional areas that may be affected")
  if (impact.impacted.length === 0 && impact.tests.length === 0) {
    lines.push("- No additional files outside this PR appear to be affected.")
    return lines.join("\n")
  }
  lines.push(...formatAreas(impact.impacted, "- No non-test files outside this PR appear to be affected."))
  lines.push("", "## Tests to re-run")
  lines.push(...formatAreas(impact.tests, "- No tests outside this PR reference the changed files."))
  return lines.join("\n")
}

function formatAreas(areas: ImpactedArea[], empty: string) {
  if (areas.length === 0) return [empty]
  return areas.flatMap((area) => [
    `- \`${area.path}\` — affected by ${area.causedBy.map((file) => `\`${file}\``).join(", ")}`,
    ...area.reasons.map((reason) => `  - ${reason}`),
  ])
}

function searchPattern(target: string) {
  const base = path.basename(target).replace(MODULE_EXTENSION, "")
  const name = base === "index" || base === "__init__" ? path.basename(path.dirname(target)) : base
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const PrImpactParameters = Schema.Struct({})

export const PrImpactTool = Tool.define<
  typeof PrImpactParameters,
  { changedFiles: number; impactedFiles: number },
  Git.Service | FSUtil.Service | Ripgrep.Service
>(
  "pr_impact",
  Effect.gen(function* () {
    const git = yield* Git.Service
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    return {
      description: DESCRIPTION,
      parameters: PrImpactParameters,
      execute: (_params, ctx) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const root = instance.worktree
          const fallback = yield* git.defaultBranch(root)
          const base = fallback?.ref ?? "main"
          const ref = (yield* git.mergeBase(root, base)) ?? base
          const items = yield* git.diff(root, ref)
          const targets = items
            .map((item) => item.file.replaceAll("\\", "/"))
            .filter((file) => MODULE_EXTENSION.test(file))

          if (targets.length > 0) {
            yield* ctx.ask({ permission: "grep", patterns: targets, always: ["*"], metadata: { path: root } })
          }

          const impacts: ChangeImpact[] = []
          for (const target of targets) {
            const content = yield* fs.readFileStringSafe(path.join(root, target))
            const matches = yield* ripgrep.grep({ cwd: root, pattern: searchPattern(target), limit: MATCH_LIMIT })
            impacts.push(
              analyzeChangeImpact({
                target,
                content,
                matches: matches.map((match) => ({ path: match.entry.path, line: match.line, text: match.text })),
              }),
            )
          }

          const impact = aggregateImpacts(targets, impacts)
          return {
            title: path.relative(instance.worktree, instance.directory) || ".",
            output: formatPrImpact(impact),
            metadata: {
              changedFiles: impact.changedFiles.length,
              impactedFiles: impact.impacted.length + impact.tests.length,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)