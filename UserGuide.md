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

