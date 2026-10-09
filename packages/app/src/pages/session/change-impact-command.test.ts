import { describe, expect, test } from "bun:test"
import { changeImpactCommand, changeImpactPrompt } from "./change-impact-command"

describe("change impact command", () => {
  test("registers a slash command that prepares a change_impact request", () => {
    let received: unknown
    let cursor = -1
    const command = changeImpactCommand({
      category: "Session",
      setPrompt: (prompt, position) => {
        received = prompt
        cursor = position
      },
    })

    expect(command).toMatchObject({
      id: "change-impact.analyze",
      title: "Analyze Change Impact",
      slash: "change-impact",
      category: "Session",
    })

    command.onSelect?.()

    expect(received).toEqual([{ type: "text", content: changeImpactPrompt, start: 0, end: changeImpactPrompt.length }])
    expect(cursor).toBe(changeImpactPrompt.length)
  })

  test("asks for the change_impact tool and leaves the cursor ready for a file path", () => {
    expect(changeImpactPrompt).toContain("change_impact")
    expect(changeImpactPrompt.endsWith(": ")).toBe(true)
  })
})
