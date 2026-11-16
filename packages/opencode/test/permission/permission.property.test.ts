import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { Cause, Effect, Exit, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Permission } from "../../src/permission"
import { ShellCommand } from "../../src/permission/command"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

// Property-based tests for the permission rules feature (traceability/halhajri.md).

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Permission.node, EventV2Bridge.node, CrossSpawnSpawner.node, InstanceStore.node]),
    [[InstanceStore.bootstrapNode, noopBootstrap]],
  ),
)

// ---------------------------------------------------------------------------
// Generators
//
// Everything is drawn from a small vocabulary on purpose. With random strings a
// rule would almost never match a command, and every property would pass
// without testing anything. With five command names and a few subcommands,
// rules and commands collide all the time, which is where the interviewees'
// worries were: overlapping rules (C-7, S-7, O-7), spacing (C-6, S-6, O-6),
// sudo and chained commands (C-3, S-3, O-3).
// ---------------------------------------------------------------------------

type Action = "allow" | "ask" | "deny"
type Rule = { permission: string; pattern: string; action: Action }

const action: fc.Arbitrary<Action> = fc.constantFrom("allow", "ask", "deny")
const name = fc.constantFrom("git", "rm", "npm", "curl", "ls")
// Subcommands and file names. "file.txt" has a "." to check it is not treated as a regex wildcard.
const word = fc.constantFrom("status", "push", "test", "origin", "build", "file.txt")
const option = fc.constantFrom("-s", "-rf", "-v", "--force")
// Quoted arguments with spaces inside: spacing inside quotes is data and must be kept.
const quoted = fc.constantFrom('"a  b"', "'x   y'", '"two words"')
const argument = fc.oneof({ weight: 4, arbitrary: word }, { weight: 2, arbitrary: option }, quoted)

// One command as a list of words, e.g. ["git", "push", "--force"].
const command = fc.tuple(name, fc.array(argument, { maxLength: 3 })).map(([head, rest]) => [head, ...rest])

// Rule patterns in the shapes users write: catch-all, "cmd *", "cmd sub *",
// an exact command, and patterns with a wildcard in the middle or a "?".
const prefixPattern = fc.oneof(
  name.map((head) => `${head} *`),
  fc.tuple(name, word).map(([head, sub]) => `${head} ${sub} *`),
)
const pattern = fc.oneof(
  { weight: 2, arbitrary: fc.constant("*") },
  { weight: 5, arbitrary: prefixPattern },
  { weight: 2, arbitrary: fc.tuple(name, word).map(([head, sub]) => `${head} ${sub}`) },
  { weight: 1, arbitrary: fc.tuple(name, option).map(([head, flag]) => `${head} * ${flag}`) },
  { weight: 1, arbitrary: name.map((head) => `${head} ?????`) },
)

// Rules mostly target "bash", with some "*" and "edit" rules mixed in so the
// permission name has to be matched too, not only the command pattern.
const rule: fc.Arbitrary<Rule> = fc.record({
  permission: fc.constantFrom("bash", "bash", "bash", "*", "edit"),
  pattern,
  action,
})
const ruleset = fc.array(rule, { maxLength: 6 })

// Ways to put sudo in front of a command, including options that take a value
// ("-u root") and environment assignments, which must not be read as the command.
const sudoPrefix = fc
  .tuple(
    fc.array(
      fc.constantFrom(
        ["-n"],
        ["-E"],
        ["-u", "root"],
        ["-g", "wheel"],
        ["--user=root"],
        ["--user", "root"],
        ["DEBUG=1"],
      ),
      { maxLength: 3 },
    ),
    fc.boolean(),
  )
  .map(([flags, dashes]) => ["sudo", ...flags.flat(), ...(dashes ? ["--"] : [])])

// Whitespace someone might type between two words: one space, several, or tabs.
const gap = fc.constantFrom(" ", "  ", "   ", "\t", " \t ")

// A command's words joined with irregular whitespace, plus leading/trailing space.
const spaced = (words: string[]) =>
  fc
    .tuple(fc.array(gap, { minLength: words.length, maxLength: words.length }), fc.constantFrom("", " ", "\t"))
    .map(([gaps, edge]) => edge + words.map((item, index) => (index === 0 ? item : gaps[index] + item)).join("") + edge)

// ---------------------------------------------------------------------------
// Reference model: a slow, obviously-correct version of rule matching.
// It walks the pattern one character at a time instead of building a regex.
// ---------------------------------------------------------------------------

function glob(text: string, pattern: string): boolean {
  if (pattern === "") return text === ""
  if (pattern[0] === "*") return glob(text, pattern.slice(1)) || (text !== "" && glob(text.slice(1), pattern))
  if (text === "") return false
  return (pattern[0] === "?" || pattern[0] === text[0]) && glob(text.slice(1), pattern.slice(1))
}

// A trailing " *" is optional: "git *" matches both "git" and "git status".
function matches(text: string, pattern: string) {
  return glob(text, pattern) || (pattern.endsWith(" *") && glob(text, pattern.slice(0, -2)))
}

// Go through the rules in order and remember the last one that matches. No match means "ask".
function model(permission: string, text: string, rules: Rule[]) {
  let result: Action = "ask"
  for (const item of rules) {
    if (matches(permission, item.permission) && matches(text, item.pattern)) result = item.action
  }
  return result
}

const decide = (text: string, ...rulesets: Rule[][]) => Permission.evaluate("bash", text, ...rulesets).action

describe("permission rules - property-based tests", () => {
  // R2: A deny rule blocks the command when it is run directly, with sudo in
  // front of it (with or without sudo options), or as one part of a longer
  // chained command. Each command in a chain is checked on its own.
  // Kind: invariant
  //
  // Generator: a chain of 1-4 commands. Other commands never use the denied
  // name, so the chain must be blocked exactly when the denied command was put
  // in. The denied command can sit at any position, can be wrapped in sudo
  // (also twice, and with value-taking options like "-u root"), and is spaced
  // irregularly. The patterns are built with ShellCommand.patterns, the same
  // function the shell tool calls for each command it finds in a chain, and
  // they go through the real Permission.ask.
  it.instance(
    "R2: a denied command is blocked directly, behind sudo, and inside a chain",
    () =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        // The property runs outside this Effect, so hand it the test instance's context.
        const context = yield* Effect.context<never>()

        const chain = name.chain((denied) => {
          const other = fc
            .tuple(
              name.filter((head) => head !== denied),
              fc.array(argument, { maxLength: 2 }),
            )
            .map(([head, rest]) => [head, ...rest])
          const wrapped = (words: fc.Arbitrary<string[]>) =>
            fc
              .tuple(fc.array(sudoPrefix, { maxLength: 2 }), words)
              .map(([prefixes, inner]) => [...prefixes.flat(), ...inner])
          const target = fc.array(argument, { maxLength: 2 }).map((rest) => [denied, ...rest])
          return fc
            .record({
              before: fc.array(wrapped(other), { maxLength: 2 }),
              target: fc.option(wrapped(target), { nil: undefined }),
              after: fc.array(wrapped(other), { maxLength: 2 }),
            })
            .filter((input) => input.target !== undefined || input.before.length + input.after.length > 0)
            .chain((input) => {
              const commands = [...input.before, ...(input.target ? [input.target] : []), ...input.after]
              return fc.record({
                denied: fc.constant(denied),
                blocked: fc.constant(input.target !== undefined),
                commands: fc.tuple(...commands.map((words) => spaced(words).map((text) => ({ text, words })))),
              })
            })
        })

        yield* Effect.promise(() =>
          fc.assert(
            fc.asyncProperty(chain, async (input) => {
              const exit = await Effect.runPromiseExit(
                permission
                  .ask({
                    sessionID: SessionID.make("session_property"),
                    permission: "bash",
                    patterns: input.commands.flatMap((item) => ShellCommand.patterns(item.text, item.words)),
                    metadata: {},
                    always: [],
                    ruleset: [
                      { permission: "bash", pattern: "*", action: "allow" },
                      { permission: "bash", pattern: `${input.denied} *`, action: "deny" },
                    ],
                  })
                  .pipe(Effect.provideContext(context)),
              )
              expect(Exit.isFailure(exit)).toBe(input.blocked)
              if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.DeniedError)
            }),
          ),
        )
      }),
    { git: true },
  )

  // R2 (same requirement): sudo options must never be mistaken for the command.
  // Kind: invariant
  //
  // Generator: any command with any sudo prefix in front, once or twice.
  test("R2: the command behind sudo is always found, whatever sudo options are used", () => {
    fc.assert(
      fc.property(fc.array(sudoPrefix, { minLength: 1, maxLength: 2 }), command, (prefixes, words) => {
        expect(ShellCommand.sudo([...prefixes.flat(), ...words]).at(-1)).toEqual(words)
        expect(ShellCommand.sudo(words)).toEqual([])
      }),
    )
  })

  // R3: The result for a command is decided by the last rule in the config
  // that matches it. A deny rule written after an allow rule always wins, even
  // when the allow rule is more specific.
  // Kind: model / oracle
  //
  // Generator: up to 6 overlapping rules and one command from the shared
  // vocabulary, compared against the slow reference model above.
  test("R3: evaluate agrees with the slow last-matching-rule model", () => {
    fc.assert(
      fc.property(ruleset, command, (rules, words) => {
        expect(decide(words.join(" "), rules)).toBe(model("bash", words.join(" "), rules))
      }),
    )
  })

  // R3 (same requirement): a deny rule that comes last always wins.
  // Kind: invariant
  //
  // Generator: any rules, then a deny rule built from the command itself so it
  // is guaranteed to match ("<name> *" or the catch-all "*").
  test("R3: a matching deny rule placed last always wins", () => {
    fc.assert(
      fc.property(ruleset, command, fc.boolean(), (rules, words, broad) => {
        const last: Rule = { permission: "bash", pattern: broad ? "*" : `${words[0]} *`, action: "deny" }
        expect(decide(words.join(" "), [...rules, last])).toBe("deny")
      }),
    )
  })

  // R3 (same requirement): Rules that do not match a command never change its
  // result, wherever they are placed in the config.
  // Kind: metamorphic
  //
  // Generator: a ruleset, a command, an extra rule, and a position to insert
  // it at. fc.pre keeps only extra rules that do not match the command.
  test("R3: inserting a rule that does not match the command never changes the result", () => {
    fc.assert(
      fc.property(ruleset, command, rule, fc.nat(), (rules, words, extra, position) => {
        const text = words.join(" ")
        fc.pre(!(matches("bash", extra.permission) && matches(text, extra.pattern)))
        const index = position % (rules.length + 1)
        expect(decide(text, [...rules.slice(0, index), extra, ...rules.slice(index)])).toBe(decide(text, rules))
      }),
    )
  })

  // R4: Extra spaces or tabs between the words of a command do not change
  // which rule the command matches.
  // Kind: metamorphic
  //
  // Generator: the same command written twice, once with single spaces and
  // once with irregular spaces and tabs between words and around the command.
  // ShellCommand.normalize is what the shell tool applies before matching.
  test("R4: extra spaces and tabs between words never change the decision", () => {
    fc.assert(
      fc.property(
        ruleset,
        command.chain((words) => fc.tuple(fc.constant(words), spaced(words))),
        (rules, [words, text]) => {
          expect(ShellCommand.normalize(text)).toBe(words.join(" "))
          expect(decide(ShellCommand.normalize(text), rules)).toBe(decide(words.join(" "), rules))
        },
      ),
    )
  })

  // R4 (same requirement): Extra options added after the words that a rule
  // ending in " *" names do not change which rule the command matches.
  // Kind: metamorphic
  //
  // Generator: rules are limited to "*" and prefix rules ("git *",
  // "git push *"), which is the form R4 is about; an exact rule such as
  // "git status" is meant to stop matching when anything is added.
  test("R4: adding options to the end of a command never changes the decision", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ permission: fc.constant("bash"), pattern: fc.oneof(fc.constant("*"), prefixPattern), action }),
          {
            maxLength: 6,
          },
        ),
        fc.tuple(name, fc.array(word, { maxLength: 2 })).map(([head, rest]) => [head, ...rest]),
        fc.array(option, { minLength: 1, maxLength: 3 }),
        (rules, words, extra) => {
          expect(decide([...words, ...extra].join(" "), rules)).toBe(decide(words.join(" "), rules))
        },
      ),
    )
  })

  // R5: When a rule is removed from the config, the next command is decided
  // exactly as if the rule had never been added, with no restart. Always-allow
  // choices are a separate layer on top of the config, so dropping that layer
  // also restores the config's own decision.
  // Kind: round-trip
  //
  // Generator: a config with unique patterns, one extra rule whose pattern is
  // not already in it, some always-allow choices, and a command. The rule is
  // added and removed through Permission.fromConfig, the function that turns
  // the user's config into rules.
  test("R5: adding a rule and removing it again restores every decision", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(pattern, action), { maxLength: 5, selector: (entry) => entry[0] }),
        fc.tuple(pattern, action),
        fc.array(prefixPattern, { maxLength: 2 }),
        command,
        (entries, extra, always, words) => {
          fc.pre(entries.every((entry) => entry[0] !== extra[0]))
          const text = words.join(" ")
          const original = Permission.fromConfig({ bash: Object.fromEntries(entries) })
          const before = decide(text, original)

          // Add the rule at the end of the config: it takes effect on the very next check.
          const added = Permission.fromConfig({ bash: Object.fromEntries([...entries, extra]) })
          if (matches(text, extra[0])) expect(decide(text, added)).toBe(extra[1])

          // Remove it again: back to the original decision, nothing is remembered.
          const config = Object.fromEntries([...entries, extra])
          delete config[extra[0]]
          expect(decide(text, Permission.fromConfig({ bash: config }))).toBe(before)

          // Always-allow choices are a later layer, so a matching one decides...
          const approved = always.map((item): Rule => ({ permission: "bash", pattern: item, action: "allow" }))
          if (always.some((item) => matches(text, item))) expect(decide(text, original, approved)).toBe("allow")
          // ...and once that layer is gone, the config decides again.
          expect(decide(text, original, [])).toBe(before)
        },
      ),
    )
  })
})
