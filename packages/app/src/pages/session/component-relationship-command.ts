import type { CommandOption } from "@/context/command"
import type { Prompt } from "@/context/prompt"

export const componentRelationshipPrompt =
  "Use the component_relationship tool to map the meaningful relationships between major components in this repository. Show the tool result to me."

export function componentRelationshipCommand(input: {
  category: string
  setPrompt: (prompt: Prompt, cursorPosition: number) => void
}): CommandOption {
  return {
    id: "component-relationship.generate",
    title: "Generate Component Relationship Map",
    description: "Insert a request to map major component relationships",
    category: input.category,
    slash: "component-relationships",
    onSelect: () => {
      input.setPrompt(
        [{ type: "text", content: componentRelationshipPrompt, start: 0, end: componentRelationshipPrompt.length }],
        componentRelationshipPrompt.length,
      )
    },
  }
}
