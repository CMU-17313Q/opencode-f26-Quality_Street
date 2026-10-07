import type { CommandOption } from "@/context/command"
import type { Prompt } from "@/context/prompt"

export const repositoryOverviewPrompt =
  "Use the repository_overview tool to generate a structured overview of this repository. Show the tool result to me."

export function repositoryOverviewCommand(input: {
  category: string
  setPrompt: (prompt: Prompt, cursorPosition: number) => void
}): CommandOption {
  return {
    id: "repository-overview.generate",
    title: "Generate Repository Overview",
    description: "Insert a request to analyze the current repository",
    category: input.category,
    slash: "repository-overview",
    onSelect: () => {
      input.setPrompt(
        [{ type: "text", content: repositoryOverviewPrompt, start: 0, end: repositoryOverviewPrompt.length }],
        repositoryOverviewPrompt.length,
      )
    },
  }
}
