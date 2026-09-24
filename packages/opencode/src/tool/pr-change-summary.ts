import path from "path"
import { Effect, Schema } from "effect"
import { Git } from "@/git"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./pr-change-summary.txt"

export type ChangeItem = {
  file: string
  status: "added" | "deleted" | "modified"
  additions: number
  deletions: number
}

export type AreaSummary = {
  area: string
  files: number
  additions: number
  deletions: number
}

export type ChangeSummary = {
  files: ChangeItem[]
  added: number
  deleted: number
  modified: number
  additions: number
  deletions: number
  areas: AreaSummary[]
  largest: ChangeItem[]
}

const LARGEST_LIMIT = 5

export function summarizeChanges(
  items: { file: string; status: "added" | "deleted" | "modified" }[],
  stats: { file: string; additions: number; deletions: number }[],
): ChangeSummary {
  const byFile = new Map(stats.map((stat) => [stat.file, stat]))
  const files = items
    .map((item) => ({
      file: item.file,
      status: item.status,
      additions: byFile.get(item.file)?.additions ?? 0,
      deletions: byFile.get(item.file)?.deletions ?? 0,
    }))
    .sort((left, right) => left.file.localeCompare(right.file))

  const areas = new Map<string, AreaSummary>()
  for (const file of files) {
    const name = area(file.file)
    const current = areas.get(name) ?? { area: name, files: 0, additions: 0, deletions: 0 }
    current.files += 1
    current.additions += file.additions
    current.deletions += file.deletions
    areas.set(name, current)
  }

  return {
    files,
    added: files.filter((file) => file.status === "added").length,
    deleted: files.filter((file) => file.status === "deleted").length,
    modified: files.filter((file) => file.status === "modified").length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    areas: [...areas.values()].sort((left, right) => left.area.localeCompare(right.area)),
    largest: [...files]
      .sort((left, right) => right.additions + right.deletions - (left.additions + left.deletions))
      .slice(0, LARGEST_LIMIT)
      .filter((file) => file.additions + file.deletions > 0),
  }
}

export function formatChangeSummary(summary: ChangeSummary) {
  if (summary.files.length === 0) {
    return ["# Change summary", "", "No changes were found against the base branch."].join("\n")
  }
  return [
    "# Change summary",
    "",
    "## Overview",
    `- ${summary.files.length} file(s) changed: ${summary.added} added, ${summary.modified} modified, ${summary.deleted} deleted`,
    `- ${summary.additions} line(s) added, ${summary.deletions} line(s) removed`,
    "",
    "## Areas touched",
    summary.areas
      .map((entry) => `- \`${entry.area}\` — ${entry.files} file(s), +${entry.additions} / -${entry.deletions}`)
      .join("\n"),
    "",
    "## Largest changes",
    summary.largest.length === 0
      ? "- No line-level changes were recorded."
      : summary.largest
          .map((file) => `- \`${file.file}\` (${file.status}) — +${file.additions} / -${file.deletions}`)
          .join("\n"),
    "",
    "## All changed files",
    summary.files.map((file) => `- \`${file.file}\` — ${file.status}`).join("\n"),
  ].join("\n")
}

function area(file: string) {
  const parts = file.replaceAll("\\", "/").split("/")
  if (parts.length === 1) return "(root)"
  if (parts[0] === "packages" && parts.length > 2) return `${parts[0]}/${parts[1]}`
  return parts[0]
}

const PrChangeSummaryParameters = Schema.Struct({})

export const PrChangeSummaryTool = Tool.define <
  typeof PrChangeSummaryParameters,
  { filesChanged: number; additions: number; deletions: number },
  Git.Service
>(
  "pr_change_summary",
  Effect.gen(function* () {
    const git = yield* Git.Service
    return {
      description: DESCRIPTION,
      parameters: PrChangeSummaryParameters,
      execute: (_params, _ctx) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const cwd = instance.directory
          const fallback = yield* git.defaultBranch(cwd)
          const base = fallback?.ref ?? "main"
          const ref = (yield* git.mergeBase(cwd, base)) ?? base
          const items = yield* git.diff(cwd, ref)
          const stats = yield* git.stats(cwd, ref)
          const summary = summarizeChanges(items, stats)
          return {
            title: path.relative(instance.worktree, cwd) || ".",
            output: formatChangeSummary(summary),
            metadata: {
              filesChanged: summary.files.length,
              additions: summary.additions,
              deletions: summary.deletions,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)