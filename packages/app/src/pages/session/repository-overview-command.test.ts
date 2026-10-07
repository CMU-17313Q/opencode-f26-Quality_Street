import { describe, expect, test } from "bun:test"
import { repositoryOverviewCommand, repositoryOverviewPrompt } from "./repository-overview-command"

describe("repository overview command", () => {
  test("registers a slash command that prepares a repository_overview request", () => {
    let received: unknown
    let cursor = -1
    const command = repositoryOverviewCommand({
      category: "Session",
      setPrompt: (prompt, position) => {
        received = prompt
        cursor = position
      },
    })

    expect(command).toMatchObject({
      id: "repository-overview.generate",
      title: "Generate Repository Overview",
      slash: "repository-overview",
      category: "Session",
    })

    command.onSelect?.()

    expect(received).toEqual([
      { type: "text", content: repositoryOverviewPrompt, start: 0, end: repositoryOverviewPrompt.length },
    ])
    expect(cursor).toBe(repositoryOverviewPrompt.length)
  })
})
