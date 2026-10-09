import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { InstanceRef } from "@/effect/instance-ref"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { NonNegativeInt, PositiveInt, RelativePath } from "@opencode-ai/core/schema"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import {
  ComponentRelationshipTool,
  analyzeComponentRelationships,
  formatComponentRelationships,
} from "../../src/tool/component-relationship"

describe("component relationship", () => {
  test("aggregates imports between major workspace components", () => {
    const relationships = analyzeComponentRelationships({
      files: [
        "packages/app/src/main.tsx",
        "packages/app/src/session.ts",
        "packages/core/src/config.ts",
        "packages/ui/src/button.tsx",
      ],
      matches: [
        { path: "packages/app/src/main.tsx", text: 'import { config } from "@opencode-ai/core/config"' },
        { path: "packages/app/src/session.ts", text: 'import { config } from "@opencode-ai/core/config"' },
        { path: "packages/app/src/main.tsx", text: 'export { Button } from "../../ui/src/button"' },
      ],
    })

    expect(relationships.relationships).toEqual([
      { source: "packages/app", target: "packages/core", imports: 2, reExports: 0 },
      { source: "packages/app", target: "packages/ui", imports: 0, reExports: 1 },
    ])
  })

  test("ignores external, generated, and same-component imports", () => {
    const relationships = analyzeComponentRelationships({
      files: ["src/main.ts", "src/util.ts", "node_modules/pkg/index.js", "dist/output.js"],
      matches: [
        { path: "src/main.ts", text: 'import "./util"' },
        { path: "src/main.ts", text: 'import { Effect } from "effect"' },
        { path: "node_modules/pkg/index.js", text: 'import "../../src/main"' },
      ],
    })

    expect(relationships.relationships).toEqual([])
  })

  test("renders source, target, explanation, and an empty state", () => {
    const output = formatComponentRelationships({
      relationships: [{ source: "app", target: "core", imports: 1, reExports: 0 }],
    })

    expect(output).toContain("`app` → `core`")
    expect(output).toContain("app uses modules from core")
    expect(formatComponentRelationships({ relationships: [] })).toContain(
      "No meaningful component relationships were found.",
    )
  })

  test("discovers relationships through bounded repository scans", async () => {
    const layer = Layer.mergeAll(
      Layer.mock(Ripgrep.Service, {
        find: () =>
          Effect.succeed([
            FileSystem.Entry.make({ path: RelativePath.make("packages/app/src/main.ts"), type: "file" }),
            FileSystem.Entry.make({ path: RelativePath.make("packages/core/src/config.ts"), type: "file" }),
          ]),
        grep: () =>
          Effect.succeed([
            FileSystem.Match.make({
              entry: FileSystem.Entry.make({ path: RelativePath.make("packages/app/src/main.ts"), type: "file" }),
              line: PositiveInt.make(1),
              offset: NonNegativeInt.make(0),
              text: 'import "@opencode-ai/core/config"',
              submatches: [],
            }),
          ]),
      }),
      Layer.mock(Truncate.Service, {
        output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
      }),
      Layer.mock(Agent.Service, {
        get: () => Effect.succeed({ name: "build", permission: [] } as any),
      }),
    )
    const tool = await Effect.runPromise(
      ComponentRelationshipTool.pipe(Effect.flatMap(Tool.init), Effect.provide(layer)),
    )
    const permissions: unknown[] = []
    const result = await Effect.runPromise(
      tool
        .execute(
          {},
          {
            sessionID: SessionID.make("ses_test"),
            messageID: MessageID.make("msg_test"),
            callID: "",
            agent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => Effect.void,
            ask: (request) => Effect.sync(() => permissions.push(request)),
          },
        )
        .pipe(
          Effect.provideService(InstanceRef, {
            directory: "/repo",
            worktree: "/repo",
            project: {} as any,
          }),
        ),
    )

    expect(permissions).toEqual([expect.objectContaining({ permission: "glob", patterns: ["**/*"] })])
    expect(result.output).toContain("`packages/app` → `packages/core`")
    expect(result.metadata.scannedFiles).toBe(2)
  })
})
