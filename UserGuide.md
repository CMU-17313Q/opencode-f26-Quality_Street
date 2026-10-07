# Quality Street User Guide

## Repository Overview Generator

### How to Use
1. Open a session for the repository you want to inspect.
2. Open the command palette and select **Generate Repository Overview**, or type `/repository-overview` in the composer.
3. Submit the inserted request. OpenCode invokes the built-in `repository_overview` tool and displays the structured result in the session timeline.

The result groups major top-level components, recognized project files, and likely entry points. Directories such as `node_modules`, build output, and `.git` are excluded. If a category has no discoverable items, the result shows an explicit “No … were found” message instead of a blank section.

### User Testing
In an OpenCode session, invoke **Generate Repository Overview** from the command palette (or `/repository-overview`) and verify that the composer receives the repository-analysis request. Submit it and confirm that the timeline renders the repository overview with the three sections above. Repeat in a repository with no conventional source, configuration, or entry-point files and confirm the empty-state messages are visible.

### Automated Tests
`packages/opencode/test/tool/repository-overview.test.ts` verifies repository discovery, excluded-directory handling, structured Markdown output, and empty repository output. `packages/opencode/test/tool/registry.test.ts` verifies that `repository_overview` is registered as a built-in tool. `packages/app/src/pages/session/repository-overview-command.test.ts` verifies that the UI command is registered with the expected slash alias and inserts the exact request that invokes the tool.
Together, these tests cover the feature's core analysis behavior, built-in tool integration, empty-state handling, and the new user-facing command integration.

---
## Cross-file Change Impact Analyzer


### How to Use


### User Testing


### Automated Tests


---
## Learning-Oriented Code Reviewer


### How to Use


### User Testing


### Automated Tests


---
## PR Change Summarizer


### How to Use


### User Testing


### Automated Tests


---
## Component Relationship Mapper

### How to Use

1. Open a session for the repository you want to inspect.
2. Choose **Generate Component Relationship Map** from the command palette, or type `/component-relationships` in the composer.
3. Submit the inserted request. OpenCode invokes `component_relationship` and displays the relationship map in the session timeline.

The map aggregates resolvable TypeScript and JavaScript imports between major components. Each relationship names its source and target components and explains how the source uses the target. Imports within the same component and external packages are excluded to keep the result high level.

### User Testing

Run the command in a repository containing imports between two top-level components. Confirm the timeline identifies both components, the import or re-export evidence, and a plain-language explanation. Repeat in a repository with only isolated files or same-component imports and confirm the clear no-relationship state appears.

### Automated Tests

`packages/opencode/test/tool/component-relationship.test.ts` verifies relationship aggregation, import filtering, source and target presentation, explanations, and the no-relationship state. `packages/opencode/test/tool/registry.test.ts` verifies that `component_relationship` is registered. `packages/app/src/pages/session/component-relationship-command.test.ts` verifies that the UI command inserts the correct tool request.

---
## PR Impact Analyzer


### How to Use


### User Testing


### Automated Tests


---
## Test Failure Explainer


### How to Use


### User Testing


### Automated Tests


---
## Design Tradeoff Explainer


### How to Use


### User Testing


### Automated Tests
