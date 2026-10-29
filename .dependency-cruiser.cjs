/** @type {import("dependency-cruiser").IConfiguration} */
const path = require("node:path")

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment:
        "Circular imports make module initialization order and refactoring harder to reason about. " +
        'Ignore OpenCode\'s intentional self namespace re-exports (export * as X from ".").',
      severity: "error",
      from: { path: "^packages/opencode/src/" },
      to: { circular: true, dependencyTypesNot: ["export"] },
    },
    {
      name: "no-production-to-test",
      comment: "Production code must not depend on test-only helpers or fixtures.",
      severity: "error",
      from: { path: "^packages/opencode/src/" },
      to: { path: "^packages/opencode/test/" },
    },
  ],
  options: {
    includeOnly: "^packages/opencode/src/",
    tsConfig: {
      fileName: path.join(__dirname, "packages/opencode/tsconfig.json"),
    },
  },
}
