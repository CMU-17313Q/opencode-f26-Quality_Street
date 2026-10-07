import { describe, expect, test } from "bun:test"
import { learningReviewCommand, learningReviewPrompt } from "./learning-review-command"

describe("learning review command", () => {
  test("registers a slash command that prepares a learning_review request", () => {
    let received: unknown
    let cursor = -1
    const command = learningReviewCommand({
      category: "Session",
      setPrompt: (prompt, position) => {
        received = prompt
        cursor = position
      },
    })

    expect(command).toMatchObject({
      id: "learning-review.run",
      title: "Learning-Oriented Code Review",
      slash: "learning-review",
      category: "Session",
    })

    command.onSelect?.()

    expect(received).toEqual([
      { type: "text", content: learningReviewPrompt, start: 0, end: learningReviewPrompt.length },
    ])
    expect(cursor).toBe(learningReviewPrompt.length)
  })

  test("asks for the tool to review changes without rewriting the student's code", () => {
    expect(learningReviewPrompt).toContain("learning_review")
    expect(learningReviewPrompt).toContain("git diff")
    expect(learningReviewPrompt).toContain("do not rewrite my code")
  })
})
