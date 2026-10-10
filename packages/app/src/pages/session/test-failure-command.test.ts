import { describe, expect, test } from "bun:test"
import { testFailureCommand, testFailurePrompt } from "./test-failure-command"

describe("test failure command", () => {
  test("registers a slash command that prepares a test_failure request", () => {
    let received: unknown
    let cursor = -1
    const command = testFailureCommand({
      category: "Session",
      setPrompt: (prompt, position) => {
        received = prompt
        cursor = position
      },
    })

    expect(command).toMatchObject({
      id: "test-failure.explain",
      title: "Explain Test Failure",
      slash: "explain-test-failure",
      category: "Session",
    })

    command.onSelect?.()

    expect(received).toEqual([{ type: "text", content: testFailurePrompt, start: 0, end: testFailurePrompt.length }])
    expect(cursor).toBe(testFailurePrompt.length)
  })

  test("asks for the test_failure tool and leaves the cursor ready for test output", () => {
    expect(testFailurePrompt).toContain("test_failure")
    expect(testFailurePrompt.endsWith(": ")).toBe(true)
  })
})
