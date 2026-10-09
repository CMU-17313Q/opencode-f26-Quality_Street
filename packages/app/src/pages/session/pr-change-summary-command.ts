import type { CommandOption } from "@/context/command"
import type { Prompt } from "@/context/prompt"

export const prChangeSummaryPrompt =
  "Use the pr_change_summary tool to summarize the changes on this branch. Show the tool result to me."

export function prChangeSummaryCommand(input: {
  category: string
  setPrompt: (prompt: Prompt, cursorPosition: number) => void
}): CommandOption {
  return {
    id: "pr-change-summary.generate",
    title: "Summarize PR Changes",
    description: "Insert a request to summarize what this branch changed",
    category: input.category,
    slash: "pr-change-summary",
    onSelect: () => {
      input.setPrompt(
        [{ type: "text", content: prChangeSummaryPrompt, start: 0, end: prChangeSummaryPrompt.length }],
        prChangeSummaryPrompt.length,
      )
    },
  }
}