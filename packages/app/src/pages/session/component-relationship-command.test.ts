import { describe, expect, test } from "bun:test"
import { componentRelationshipCommand, componentRelationshipPrompt } from "./component-relationship-command"

describe("component relationship command", () => {
  test("registers a slash command that prepares a component_relationship request", () => {
    let received: unknown
    let cursor = -1
    const command = componentRelationshipCommand({
      category: "Session",
      setPrompt: (prompt, position) => {
        received = prompt
        cursor = position
      },
    })

    expect(command).toMatchObject({
      id: "component-relationship.generate",
      title: "Generate Component Relationship Map",
      slash: "component-relationships",
      category: "Session",
    })

    command.onSelect?.()

    expect(received).toEqual([
      { type: "text", content: componentRelationshipPrompt, start: 0, end: componentRelationshipPrompt.length },
    ])
    expect(cursor).toBe(componentRelationshipPrompt.length)
  })
})
