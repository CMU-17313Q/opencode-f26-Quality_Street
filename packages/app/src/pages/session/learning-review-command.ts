import type { CommandOption } from "@/context/command"
import type { Prompt } from "@/context/prompt"

export const learningReviewPrompt =
  "Use the learning_review tool to review my recent changes: run `git diff` and pass its output as `diff` " +
  "(if there are no uncommitted changes, review the files I edited most recently with `paths`). " +
  "Show the tool result to me and do not rewrite my code."

export function learningReviewCommand(input: {
  category: string
  setPrompt: (prompt: Prompt, cursorPosition: number) => void
}): CommandOption {
  return {
    id: "learning-review.run",
    title: "Learning-Oriented Code Review",
    description: "Insert a request to review your recent changes with explanations and hints",
    category: input.category,
    slash: "learning-review",
    onSelect: () => {
      input.setPrompt(
        [{ type: "text", content: learningReviewPrompt, start: 0, end: learningReviewPrompt.length }],
        learningReviewPrompt.length,
      )
    },
  }
}
