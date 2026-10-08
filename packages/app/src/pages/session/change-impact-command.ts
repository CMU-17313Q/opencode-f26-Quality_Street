import type { CommandOption } from "@/context/command"
import type { Prompt } from "@/context/prompt"

// The cursor is left at the end so the user only has to type the path of the file they plan to change.
export const changeImpactPrompt =
  "Use the change_impact tool to show which files could be affected if I change this file and why: "

export function changeImpactCommand(input: {
  category: string
  setPrompt: (prompt: Prompt, cursorPosition: number) => void
}): CommandOption {
  return {
    id: "change-impact.analyze",
    title: "Analyze Change Impact",
    description: "Insert a request to find files affected by changing a file",
    category: input.category,
    slash: "change-impact",
    onSelect: () => {
      input.setPrompt(
        [{ type: "text", content: changeImpactPrompt, start: 0, end: changeImpactPrompt.length }],
        changeImpactPrompt.length,
      )
    },
  }
}
