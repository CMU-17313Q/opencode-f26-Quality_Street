import type { CommandOption } from "@/context/command"
import type { Prompt } from "@/context/prompt"

export const prImpactPrompt =
  "Use the pr_impact tool to analyze how the changes on this branch affect the rest of the repository. Show the tool result to me."

export function prImpactCommand(input: {
  category: string
  setPrompt: (prompt: Prompt, cursorPosition: number) => void
}): CommandOption {
  return {
    id: "pr-impact.analyze",
    title: "Analyze PR Impact",
    description: "Insert a request to analyze what this branch's changes affect",
    category: input.category,
    slash: "pr-impact",
    onSelect: () => {
      input.setPrompt(
        [{ type: "text", content: prImpactPrompt, start: 0, end: prImpactPrompt.length }],
        prImpactPrompt.length,
      )
    },
  }
}