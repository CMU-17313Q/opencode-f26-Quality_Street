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
1. Open a session for the repository you are working in.
2. Open the command palette and select **Analyze Change Impact**, or type `/change-impact` in the composer.
3. Type the path of the file you plan to change after the inserted request (for example `src/cart/pricing.ts`) and submit it. OpenCode invokes the built-in `change_impact` tool. The timeline shows a **Change impact** row with the file path; expand it to see the full report, and the model summarizes it below.

You can also ask in plain language, for example "I'm about to change `src/cart/pricing.ts`. What other files could this affect?", and the model will call `change_impact` itself.

The result lists the changed file's exported symbols and groups the files that directly depend on it:
- **Re-exports**: files that re-export the changed file, so the impact spreads to whatever imports them.
- **Direct dependents**: files that import it, with the symbols each one uses.
- **Tests to re-run**: test files that import or mock it.
- **Other references**: configuration, scripts, or docs that mention it by name.

Each file comes with a short reason. If a file imports a symbol the changed file no longer exports, the reason says the import is likely broken. When nothing depends on the file, the result says so instead of showing empty sections. Relative imports, `index` files, `@/` and `~/` aliases, and Python imports are resolved, so files that only share a name are not reported. Only direct impacts are listed; run the analysis again on an affected file to follow the chain.

### User Testing
1. Create a small project with `src/cart/pricing.ts` exporting `subtotal`, `applyDiscount`, `withTax`, and `TAX_RATE`; `src/api/checkout.ts` importing three of them; `src/cart/index.ts` re-exporting from `./pricing`; `test/pricing.test.ts` importing it; a `README.md` that mentions `src/cart/pricing.ts`; and an unrelated `src/api/shipping.ts`.
2. Open the project in OpenCode, run **Analyze Change Impact** (or `/change-impact`), enter `src/cart/pricing.ts`, and submit.
3. Confirm that `index.ts` appears under re-exports, `checkout.ts` under direct dependents with the symbols it uses, the test under tests to re-run, `README.md` under other references, and that `shipping.ts` is not listed.
4. Rename `applyDiscount` in `pricing.ts`, run the command again, and confirm that `checkout.ts` and the test are flagged because `applyDiscount` is no longer exported.
5. Run it on a file nothing imports and confirm the "No files directly import or reference this file" message.

### Automated Tests
- `packages/opencode/test/tool/change-impact.test.ts` covers the analysis: export detection for TypeScript and Python; relative, alias, dynamic `import()`, and `require` imports; files that only share a name being ignored; re-exports, tests, mocks, and references being grouped separately; imports of symbols that are no longer exported; repeated imports from one file being merged; `index` file and Python import resolution; the structured output and the unreadable-file message. It also runs the real tool with Ripgrep on a temporary project, checks the permission request, and checks that files outside the project are refused before any search.
- `packages/opencode/test/tool/registry.test.ts` verifies that `change_impact` is registered as a built-in tool.
- `packages/app/src/pages/session/change-impact-command.test.ts` verifies that the UI command is registered with the `/change-impact` slash alias and inserts the request that invokes the tool, with the cursor ready for a file path.

Together, these tests map to each acceptance criterion of #15: analyzing a chosen file, finding related files through imports and references, explaining why each one is affected, leaving out unrelated files, presenting the result in a structured format, and the user-facing command.

---
## Learning-Oriented Code Reviewer

### How to Use
1. Open a session for the project you are working on.
2. Type `/learning-review` in the message box, or open the command palette and choose **Learning-Oriented Code Review**.
3. Send the inserted request. OpenCode runs the built-in `learning_review` tool on your uncommitted changes (`git diff`), or on your recently edited files if there are no changes, and shows the review in the session.

The review is grouped into **Correctness**, **Maintainability** and **Clarity**. Each point shows the file and line, a severity (high / medium / low), **why it matters**, and a **try this** hint. It does not rewrite your code, so you fix the problem yourself. If nothing is found, it says so and suggests questions to check yourself (edge cases, readability).

You can also ask for it in chat, for example "review src/app.ts with learning_review".

### User Testing
In an OpenCode session, run `/learning-review` and check that the request is inserted into the message box. Send it after making a few changes that include problems (for example `==`, an empty `catch {}`, a leftover `console.log`, a `TODO` comment) and check that each one appears under the right category with an explanation and a hint. Then run it on a clean file and check that the "no common problems" message is shown.

### Automated Tests
- `packages/opencode/test/tool/learning-review.test.ts` (25 tests) covers each rule category for JavaScript/TypeScript and Python, rules that only apply to one language, cases that should not be flagged (strict equality, `==` inside strings, named constants, short loop variables), the limit of 5 repeated findings per rule, diff parsing (only added lines, delete-only diffs, multiple hunks and files), output formatting, and running the tool itself (read permission, diff mode, the 10-file limit, missing file and empty input errors).
- `packages/opencode/test/tool/registry.test.ts` checks that `learning_review` is registered as a built-in tool.
- `packages/app/src/pages/session/learning-review-command.test.ts` checks that the `/learning-review` command is registered and inserts the request that calls the tool.

Together these cover the reviewer's analysis, its error handling, and the new command in the UI.


---
## PR Change Summarizer

### How to Use
1. Check out the branch you want to summarize, for example a teammate's pull request branch.
2. Open the command palette and select **Summarize PR Changes**, or type `/pr-change-summary` in the composer.
3. Submit the inserted request. OpenCode invokes the built-in `pr_change_summary` tool and displays the result in the session timeline.

The result shows how many files changed and their status, total lines added and removed, which areas of the repository were touched, the largest changes, and a full list of changed files. If the branch has no changes against the base branch, it says so explicitly.

### User Testing
On a branch with a few committed changes, run `/pr-change-summary` and confirm the counts match `git diff --stat` against main, the areas reflect the folders you changed, and the largest file appears first under "Largest changes". Then run it on a branch identical to main and confirm the "No changes were found" message appears.

### Automated Tests
`packages/opencode/test/tool/pr-change-summary.test.ts` verifies status counting, line totals, grouping by area, ranking the largest changes, files with no line statistics, the empty state, and the formatted output sections. `packages/opencode/test/tool/registry.test.ts` verifies that `pr_change_summary` is registered as a built-in tool. `packages/app/src/pages/session/pr-change-summary-command.test.ts` verifies the `/pr-change-summary` command is registered and inserts the request that invokes the tool.

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
1. Start OpenCode in the terminal from your project (for this repo: `bun dev`).
2. Type `/tradeoff` (or `/tradeoffs`), or open the command palette and choose **Explain design tradeoffs**.
3. Fill in the four steps, pressing Enter after each one:
   - **Step 1:** the decision you are making, e.g. "How should we store user sessions?"
   - **Steps 2–3:** approach A and approach B, written as `Name: how it works`, e.g. `In-memory map: keep a global in-memory map of sessions in the server`
   - **Step 4:** an optional approach C (leave it empty to skip)
4. A comparison dialog opens. For each approach it rates **complexity, maintainability, testability, consistency with the repo, and performance** as ▲ favorable, ◆ mixed, ▼ unfavorable, or · not enough detail, and lists the + and − reasons for each rating.
5. Below that, **How they compare** says which approach to lean towards depending on what matters most, and **Questions to help you decide** gives things to think about. The explainer does not pick a winner.
6. Press Enter to go back and edit your inputs, or Esc to close.

The explainer also looks at the repository (dependencies in `package.json` / `requirements.txt`, main languages, and whether tests exist). For example, it points out when an approach adds a library the project does not use yet.

If there is not enough information (fewer than two approaches, a description that is too short or vague, or two identical approaches), it shows a **"Not enough information for a meaningful comparison"** message with tips on what to add.

Tip: mention concrete details such as where data is stored, how the code is split, which libraries are used, and how it would be tested. The more concrete the description, the more useful the comparison.

### User Testing
Run `/tradeoff` and try these scenarios:
- **Storing sessions:** "In-memory map: keep a global in-memory map of sessions in the server" vs. "Redis: install redis as a new dependency and persist sessions there". The in-memory approach should be favorable for complexity and performance but unfavorable for testability, and Redis should be flagged as a dependency this repo does not use yet.
- **Adding export formats:** "Switch: add a switch statement directly in the export function" vs. "Strategy: define an exporter interface with a separate module per format and unit tests". The switch should be simpler but less maintainable, and the strategy approach more maintainable and testable.
- **Not enough information:** enter only one approach and check that the "Not enough information" message appears, then press Enter and check that you return to step 1 with your inputs kept.

### Automated Tests
- `packages/tui/test/util/design-tradeoff.test.ts` (18 tests) covers parsing approach names, the session-storage and export-format scenarios (factor ratings, pros and cons, comparing three approaches, never picking a winner), repository context (crediting a dependency the repo already has, flagging a new library or a different language, asking about verification when no tests exist), the not-enough-information cases (missing decision, fewer than two approaches, too-short or identical descriptions, vague approaches), and reading repository context from a temporary folder.
- `packages/tui/test/component/dialog-design-tradeoff.test.tsx` (2 tests) renders the real UI, goes through the four input steps, and checks the comparison screen; it also checks the not-enough-information screen and that Enter returns to the first step.

Run them with `cd packages/tui && bun test test/util/design-tradeoff.test.ts test/component/dialog-design-tradeoff.test.tsx`. Together they cover every acceptance criterion in issue #20, including the UI ones.
