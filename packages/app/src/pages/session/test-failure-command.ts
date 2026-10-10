import type { CommandOption } from "@/context/command"
import type { Prompt } from "@/context/prompt"

// The cursor is left at the end so the user only has to paste the output of the failing test run.
export const testFailurePrompt =
  "Use the test_failure tool to explain why my tests failed and where I should look. Test output: "

export function testFailureCommand(input: {
  category: string
  setPrompt: (prompt: Prompt, cursorPosition: number) => void
}): CommandOption {
  return {
    id: "test-failure.explain",
    title: "Explain Test Failure",
    description: "Insert a request to explain failing test output",
    category: input.category,
    slash: "explain-test-failure",
    onSelect: () => {
      input.setPrompt(
        [{ type: "text", content: testFailurePrompt, start: 0, end: testFailurePrompt.length }],
        testFailurePrompt.length,
      )
    },
  }
}
