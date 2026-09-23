import path from "path"
import { Effect, Schema } from "effect"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./repository-overview.txt"

const DISCOVERY_LIMIT = 500

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".cache",
  ".idea",
  ".vscode",
  "node_modules",
  "bower_components",
  "coverage",
  "dist",
  "build",
  "out",
  "target",
  "__pycache__",
])

const COMPONENT_PURPOSE: Record<string, string> = {
  src: "Application source code",
  app: "Application code",
  packages: "Workspace packages",
  test: "Automated tests",
  tests: "Automated tests",
  e2e: "End-to-end tests",
  scripts: "Development and build automation",
  docs: "Project documentation",
  public: "Static assets",
  config: "Project configuration",
}

const IMPORTANT_FILES: Record<string, string> = {
  "package.json": "Project manifest and scripts",
  "tsconfig.json": "TypeScript compiler configuration",
  "turbo.json": "Turborepo build configuration",
  "vite.config.ts": "Vite build configuration",
  "vite.config.js": "Vite build configuration",
  "jest.config.js": "Jest test configuration",
  "jest.config.ts": "Jest test configuration",
  "playwright.config.ts": "Playwright test configuration",
  "bun.lock": "Bun dependency lockfile",
  "bun.lockb": "Bun dependency lockfile",
  "dockerfile": "Container build instructions",
  makefile: "Build automation",
  "readme.md": "Project documentation",
}

const ENTRYPOINTS = new Map([
  ["src/index.ts", "TypeScript application entry point"],
  ["src/index.tsx", "TypeScript application entry point"],
  ["src/main.ts", "TypeScript application entry point"],
  ["src/main.tsx", "TypeScript application entry point"],
  ["src/index.js", "JavaScript application entry point"],
  ["src/main.js", "JavaScript application entry point"],
  ["index.ts", "TypeScript application entry point"],
  ["index.js", "JavaScript application entry point"],
  ["main.py", "Python application entry point"],
])

export type RepositoryComponent = {
  path: string
  purpose: string
}

export type RepositoryOverview = {
  components: RepositoryComponent[]
  importantFiles: RepositoryComponent[]
  entryPoints: RepositoryComponent[]
}

const Parameters = Schema.Struct({})

export const RepositoryOverviewTool = Tool.define(
  "repository_overview",
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
          const discoveryTruncated = files.length === DISCOVERY_LIMIT
          const overview = analyzeRepositoryFiles(files.map((file) => file.path))

          return {
            title: path.relative(instance.worktree, instance.directory) || ".",
            output: formatRepositoryOverview(overview),
            metadata: {
              scannedFiles: files.length,
              discoveryTruncated,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export function analyzeRepositoryFiles(paths: string[]): RepositoryOverview {
  const files = paths
    .map(normalize)
    .filter((filepath) => filepath.length > 0)
    .filter((filepath) => !isExcluded(filepath))

  const components = [...new Set(files.flatMap((filepath) => component(filepath)))].sort().map((directory) => ({
    path: directory,
    purpose: COMPONENT_PURPOSE[directory] ?? "Project component",
  }))

  const importantFiles = files
    .filter((filepath) => !filepath.includes("/"))
    .flatMap((filepath) => {
      const purpose = IMPORTANT_FILES[filepath.toLowerCase()]
      return purpose ? [{ path: filepath, purpose }] : []
    })
    .sort(byPath)

  const entryPoints = files
    .flatMap((filepath) => {
      const purpose = ENTRYPOINTS.get(filepath.toLowerCase())
      return purpose ? [{ path: filepath, purpose }] : []
    })
    .sort(byPath)

  return { components, importantFiles, entryPoints }
}

export function formatRepositoryOverview(overview: RepositoryOverview) {
  return [
    "# Repository overview",
    "",
    "## Major components",
    formatItems(overview.components, "No source components were found."),
    "",
    "## Important project files",
    formatItems(overview.importantFiles, "No recognized configuration, build, or test files were found."),
    "",
    "## Likely entry points",
    formatItems(overview.entryPoints, "No conventional entry points were found."),
  ].join("\n")
}

function normalize(filepath: string) {
  return filepath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "")
}

function isExcluded(filepath: string) {
  return filepath.split("/").some((part) => EXCLUDED_DIRECTORIES.has(part))
}

function component(filepath: string) {
  const [directory, ...rest] = filepath.split("/")
  return rest.length > 0 ? [directory] : []
}

function byPath(left: RepositoryComponent, right: RepositoryComponent) {
  return left.path.localeCompare(right.path)
}

function formatItems(items: RepositoryComponent[], empty: string) {
  if (items.length === 0) return `- ${empty}`
  return items.map((item) => `- \`${item.path}\` — ${item.purpose}`).join("\n")
}
