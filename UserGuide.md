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


### User Testing


### Automated Tests


---
## PR Impact Analyzer

### How to Use
1. Check out the branch whose changes you want to analyze, for example a teammate's pull request branch.
2. Open the command palette and select **Analyze PR Impact**, or type `/pr-impact` in the composer.
3. Submit the inserted request. OpenCode invokes the built-in `pr_impact` tool and displays the result in the session timeline.

The result has three sections: the files changed in this PR, additional areas that may be affected, and tests to re-run. Each affected file lists which changed files cause the impact and why. Files already changed by the PR are excluded from the additional areas, so the output only shows impact beyond the PR itself. If nothing outside the PR is affected, the result says so explicitly.

### User Testing
On a branch that changes a module imported elsewhere, run `/pr-impact` and confirm the importing files appear under "Additional areas that may be affected" with a reason, while the changed module appears only under "Changed in this PR". Then run it on a branch whose changes are not imported anywhere and confirm the "No additional files outside this PR appear to be affected" message appears.

### Automated Tests
`packages/opencode/test/tool/pr-impact.test.ts` verifies the impact aggregation: excluding files already changed in the PR, merging a file affected by several changed files, ranking files affected by more changes first, separating tests from other affected files, including re-exports and references, the no-impact state, and the structured output sections. `packages/app/src/pages/session/pr-impact-command.test.ts` verifies that the `/pr-impact` command is registered and inserts the request that invokes the tool. The per-file analysis reuses `analyzeChangeImpact` from the Cross-file Change Impact Analyzer, which has its own tests. The tool's git and filesystem wiring was verified by running `/pr-impact` in a live session.
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
