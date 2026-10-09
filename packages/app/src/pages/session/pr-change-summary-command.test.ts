import { describe, expect, test } from "bun:test"
import { prChangeSummaryCommand, prChangeSummaryPrompt } from "./pr-change-summary-command"

describe("prChangeSummaryCommand", () => {
  test("registers the /pr-change-summary slash command", () => {
    const command = prChangeSummaryCommand({ category: "Session", setPrompt: () => {} })
    expect(command.slash).toBe("pr-change-summary")
    expect(command.id).toBe("pr-change-summary.generate")
    expect(command.category).toBe("Session")
  })

  test("inserts the summary request into the prompt when selected", () => {
    let inserted: unknown
    let cursor = -1
    const command = prChangeSummaryCommand({
      category: "Session",
      setPrompt: (prompt, position) => {
        inserted = prompt
        cursor = position
      },
    })
    command.onSelect?.()
    expect(inserted).toEqual([
      { type: "text", content: prChangeSummaryPrompt, start: 0, end: prChangeSummaryPrompt.length },
    ])
    expect(cursor).toBe(prChangeSummaryPrompt.length)
  })

  test("asks the agent to use the pr_change_summary tool", () => {
    expect(prChangeSummaryPrompt).toContain("pr_change_summary")
  })
})