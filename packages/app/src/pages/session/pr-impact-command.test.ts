import { describe, expect, test } from "bun:test"
import { prImpactCommand, prImpactPrompt } from "./pr-impact-command"

describe("prImpactCommand", () => {
  test("registers the /pr-impact slash command", () => {
    const command = prImpactCommand({ category: "Session", setPrompt: () => {} })
    expect(command.slash).toBe("pr-impact")
    expect(command.id).toBe("pr-impact.analyze")
    expect(command.category).toBe("Session")
  })

  test("inserts the analysis request into the prompt when selected", () => {
    let inserted: unknown
    let cursor = -1
    const command = prImpactCommand({
      category: "Session",
      setPrompt: (prompt, position) => {
        inserted = prompt
        cursor = position
      },
    })
    command.onSelect?.()
    expect(inserted).toEqual([{ type: "text", content: prImpactPrompt, start: 0, end: prImpactPrompt.length }])
    expect(cursor).toBe(prImpactPrompt.length)
  })

  test("asks the agent to use the pr_impact tool", () => {
    expect(prImpactPrompt).toContain("pr_impact")
  })
})