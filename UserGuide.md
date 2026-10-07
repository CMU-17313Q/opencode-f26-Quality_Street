# Quality Street User Guide

## Repository Overview Generator


### How to Use


### User Testing


### Automated Tests


---
## Cross-file Change Impact Analyzer


### How to Use


### User Testing


### Automated Tests


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

