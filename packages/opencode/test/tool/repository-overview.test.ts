import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { InstanceRef } from "@/effect/instance-ref"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import {
  RepositoryOverviewTool,
  analyzeRepositoryFiles,
  formatRepositoryOverview,
} from "../../src/tool/repository-overview"

describe("repository overview", () => {
  test("identifies major components and important project files", () => {
    const overview = analyzeRepositoryFiles([
      "src/index.ts",
      "src/server.ts",
      "packages/ui/button.tsx",
      "tests/app.test.ts",
      "scripts/release.ts",
      "README.md",
      "package.json",
      "tsconfig.json",
      "turbo.json",
      "vite.config.ts",
      "playwright.config.ts",
    ])

    expect(overview.components).toEqual([
      { path: "packages", purpose: "Workspace packages" },
      { path: "scripts", purpose: "Development and build automation" },
      { path: "src", purpose: "Application source code" },
      { path: "tests", purpose: "Automated tests" },
    ])
    expect(overview.importantFiles).toEqual([
      { path: "package.json", purpose: "Project manifest and scripts" },
      { path: "playwright.config.ts", purpose: "Playwright test configuration" },
      { path: "README.md", purpose: "Project documentation" },
      { path: "tsconfig.json", purpose: "TypeScript compiler configuration" },
      { path: "turbo.json", purpose: "Turborepo build configuration" },
      { path: "vite.config.ts", purpose: "Vite build configuration" },
    ])
  })

  test("excludes generated and dependency directories", () => {
    const overview = analyzeRepositoryFiles([
      "src/index.ts",
      "desktop/main.ts",
      "node_modules/library/index.js",
      "dist/bundle.js",
      "coverage/lcov.info",
      ".git/config",
      ".turbo/cache.json",
      "__pycache__/main.pyc",
    ])

    expect(overview.components).toEqual([
      { path: "desktop", purpose: "Project component" },
      { path: "src", purpose: "Application source code" },
    ])
  })

  test("identifies conventional likely entry points", () => {
    const overview = analyzeRepositoryFiles(["src/main.tsx", "main.py", "package.json"])

    expect(overview.entryPoints).toEqual([
      { path: "main.py", purpose: "Python application entry point" },
      { path: "src/main.tsx", purpose: "TypeScript application entry point" },
    ])
  })

  test("renders a clear empty-repository overview", () => {
    const output = formatRepositoryOverview(analyzeRepositoryFiles([]))

    expect(output).toBe([
      "# Repository overview",
      "",
      "## Major components",
      "- No source components were found.",
      "",
      "## Important project files",
      "- No recognized configuration, build, or test files were found.",
      "",
      "## Likely entry points",
      "- No conventional entry points were found.",
    ].join("\n"))
  })

  test("renders the overview in structured sections", () => {
    const output = formatRepositoryOverview(analyzeRepositoryFiles(["src/index.ts", "package.json"]))

    expect(output).toContain("## Major components\n- `src` — Application source code")
    expect(output).toContain("## Important project files\n- `package.json` — Project manifest and scripts")
    expect(output).toContain("## Likely entry points\n- `src/index.ts` — TypeScript application entry point")
  })

  test("discovers the current repository through a bounded glob permission", async () => {
    const scans: Array<{ cwd: string; pattern: string; limit: number }> = []
    const layer = Layer.mergeAll(
      Layer.mock(Ripgrep.Service, {
        find: (input) =>
          Effect.sync(() => {
            scans.push({ cwd: input.cwd, pattern: input.pattern, limit: input.limit })
            return [
              { path: "src/index.ts" },
              { path: "package.json" },
              { path: "node_modules/library/index.js" },
              { path: "dist/bundle.js" },
            ] as any
          }),
      }),
      Layer.mock(Truncate.Service, {
        output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
      }),
      Layer.mock(Agent.Service, {
        get: () => Effect.succeed({ name: "build", permission: [] } as any),
      }),
    )
    const tool = await Effect.runPromise(RepositoryOverviewTool.pipe(Effect.flatMap(Tool.init), Effect.provide(layer)))
    const permissions: unknown[] = []
    const result = await Effect.runPromise(
      tool.execute({}, {
        sessionID: SessionID.make("ses_test"),
        messageID: MessageID.make("msg_test"),
        callID: "",
        agent: "build",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => Effect.void,
        ask: (request) => Effect.sync(() => permissions.push(request)),
      }).pipe(
        Effect.provideService(InstanceRef, {
          directory: "/repo",
          worktree: "/repo",
          project: {} as any,
        }),
      ),
    )

    expect(scans).toEqual([{ cwd: "/repo", pattern: "*", limit: 500 }])
    expect(permissions).toEqual([expect.objectContaining({ permission: "glob", patterns: ["**/*"] })])
    expect(result.output).toContain("- `src` — Application source code")
    expect(result.output).toContain("- `package.json` — Project manifest and scripts")
    expect(result.output).toContain("- `src/index.ts` — TypeScript application entry point")
    expect(result.output).not.toContain("node_modules")
    expect(result.output).not.toContain("dist")
    expect(result.metadata.scannedFiles).toBe(4)
  })
})
