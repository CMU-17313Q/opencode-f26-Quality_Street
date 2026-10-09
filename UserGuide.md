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


### User Testing


### Automated Tests
