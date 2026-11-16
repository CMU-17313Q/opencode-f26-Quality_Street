export * as ShellCommand from "./command"

// sudo options whose value is the next token, e.g. `sudo -u root rm file`.
const SUDO_VALUE_FLAGS = new Set([
  "-C",
  "-D",
  "-R",
  "-T",
  "-U",
  "-g",
  "-h",
  "-p",
  "-r",
  "-t",
  "-u",
  "--chdir",
  "--chroot",
  "--close-from",
  "--command-timeout",
  "--group",
  "--host",
  "--other-user",
  "--prompt",
  "--role",
  "--type",
  "--user",
])

/**
 * Collapses whitespace between the words of a command into single spaces.
 * Quoted strings and escaped characters are left alone. Permission patterns
 * such as "git push *" are written with single spaces, so without this
 * `git  push` or `git<TAB>push` would not match the rule.
 */
export function normalize(text: string) {
  return text
    .trim()
    .replace(/"(?:\\[\s\S]|[^"\\])*"|'[^']*'|\\[\s\S]|\s+/g, (part) => (/^\s+$/.test(part) ? " " : part))
}

/**
 * The commands that `sudo` would run, outermost first. Empty when the tokens
 * are not a sudo call. `sudo -u root sudo rm x` gives [[sudo, rm, x], [rm, x]].
 */
export function sudo(tokens: string[]): string[][] {
  if (tokens[0] !== "sudo") return []
  const inner = sudoTarget(tokens.slice(1))
  if (inner.length === 0) return []
  return [inner, ...sudo(inner)]
}

/**
 * Every text a single shell command is checked against: the command as
 * written, plus the command behind any `sudo`, so a rule for `rm *` also
 * applies to `sudo rm`.
 */
export function patterns(text: string, tokens: string[]) {
  return [normalize(text), ...sudo(tokens).map((inner) => inner.join(" "))]
}

function sudoTarget(tokens: string[]): string[] {
  const head = tokens[0]
  if (head === undefined) return []
  if (head === "--") return tokens.slice(1)
  if (SUDO_VALUE_FLAGS.has(head)) return sudoTarget(tokens.slice(2))
  // Other options (-n, -E, --user=root) and VAR=value assignments stand alone.
  if (head.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) return sudoTarget(tokens.slice(1))
  return tokens
}
