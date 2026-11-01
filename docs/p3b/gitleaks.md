# Gitleaks CI check

## Purpose and scope

Gitleaks scans Git commits for secrets such as API keys, access tokens, and passwords. Our
repository is public, and a secret that is committed stays in Git history even after the file is
changed or deleted. This check stops new secrets from reaching `main`. It adds secret detection,
which the existing typecheck, unit, E2E, and Qlty checks do not cover.

## Installation and local use

The workflow downloads Gitleaks `v8.28.0` from the official GitHub release and checks its SHA-256
checksum before running it. Run the same scan locally with:

```sh
gitleaks git . --config .gitleaks.toml --gitleaks-ignore-path .gitleaksignore --redact
```

To scan only the commits on your branch:

```sh
gitleaks git . --config .gitleaks.toml --redact --log-opts="origin/main..HEAD"
```

## CI integration

Workflow: `.github/workflows/gitleaks.yml`

- **Triggers:** pull requests targeting `main`, pushes to `main`, and manual runs.
- **What is scanned:**
  - Pull request: every commit in the PR (`base..head`).
  - Push to `main`: the commits in the push (`before..after`).
  - Manual run: the full history of the repository.
- **Blocking:** Gitleaks exits with code 1 when it finds a secret, so the job fails and the PR
  should not be merged.
- **Logs:** `--redact` hides found secrets in the job logs, so a failed run does not leak the
  secret again. A JSON report is uploaded as the `gitleaks-report` artifact.
- The checkout uses `fetch-depth: 0` so Gitleaks can read every commit in the range.

## Rules and customization

- `.gitleaks.toml` uses the default Gitleaks rules (`useDefault = true`) and skips three groups
  of files:
  - `packages/http-recorder/test/`: fake keys used to test that recordings remove secrets.
  - `packages/console/app/src/i18n/*.ts`: translated UI text. Long translated sentences look
    like random keys to the `generic-api-key` rule.
  - `packages/sdk/js/src/v2/gen/`: code generated from the OpenAPI spec.
- `.gitleaksignore` lists the remaining 7 false alarms by fingerprint, each with a reason.

## Execution evidence

Full history scan with the default rules, before any customization:

```text
$ gitleaks git . --redact
46 commits scanned.
leaks found: 25
```

Full history scan after customization:

```text
$ gitleaks git . --config .gitleaks.toml --redact
46 commits scanned.
no leaks found
```

To check that the job fails, a test commit added a fake AWS access key and a fake GitHub token.
Gitleaks found 3 leaks (`aws-access-token`, `github-pat`, `generic-api-key`) and exited with code 1.
The secrets were shown as `REDACTED` in the output. After a second commit deleted the file, the
scan of the branch still reported the same 3 leaks, because the secret is still in history.

The green `gitleaks` job on this pull request is the CI evidence.

## Findings analysis

All 25 findings from the first scan came from the original OpenCode import commit (`f671a5b`).
None came from our team's commits. None of them were real secrets.

| Group | Count | Example | Type |
|---|---|---|---|
| Translated UI text | 13 | `i18n/en.ts` | False positive |
| Test fixtures | 4 | `http-recorder/test/record-replay.test.ts` | Irrelevant (fake keys on purpose) |
| Keyboard shortcuts | 2 | `keybind: "shift+alt+arrowup"` | False positive |
| Test IDs, type name, generated code | 3 | `prt_key_01_read`, `UiI18nPluralKey` | False positive |
| Docs placeholder | 1 | `Bearer YOUR_API_KEY` | False positive |
| Stripe publishable test key | 1 | `pk_test_...` in `package.json` | True match, but not a secret |
| DigitalOcean OAuth client ID | 1 | `DO_OAUTH_CLIENT_ID` | True match, but not a secret |

The Stripe publishable key and the OAuth client ID are real values, but they are meant to be
public. A publishable key is sent to the browser, and a client ID is not a password. They are
ignored with a reason in `.gitleaksignore`.

Most of the noise comes from the `generic-api-key` rule, which looks for random-looking strings
near words like "key" or "token". This rule is useful for catching unknown key formats, so we kept
it and skipped the specific files instead of turning it off.

## Limitations

- **False negatives:** Gitleaks uses patterns. It can miss secrets that do not match a known
  format or do not look random, such as a short or simple password (`ADMIN_PASSWORD=welcome1`).
  It also cannot check secrets stored outside the repository, such as GitHub Secrets.
- **Skipped paths:** a real secret added to a skipped folder would not be found. The skipped
  folders are small and only hold test data, translations, or generated code.
- **Fingerprints:** `.gitleaksignore` entries include the commit hash, so they only apply to
  the commits they name. A new copy of the same value in a later commit would be reported again.
  This also means `gitleaks dir` (which has no commit hashes) still reports these 7 findings,
  so the workflow uses `gitleaks git`.
- Gitleaks finds a secret after it is committed. A secret found in a PR is already public on
  GitHub, so it must be revoked and replaced, not only removed from the code.

## Difference from the P3A plan

The plan is the same: a pinned Gitleaks version in GitHub Actions, scanning PR commits, failing
on findings, redacted logs, `.gitleaks.toml` for safe files, and `.gitleaksignore` with reasons.

Changes after running it on the repository:

- We download the release binary and check its checksum instead of using `gitleaks-action`.
  `gitleaks-action` needs a license key for repositories owned by an organization, and our
  repository belongs to the `CMU-17313Q` organization.
- PR and push runs scan only the new commits. The 25 old findings are all in the upstream
  import commit, so scanning only new commits keeps the check focused on our changes. A manual
  run still scans the full history.
- We also skip generated SDK code and translation files, which were not in the original plan,
  because they caused 14 of the 25 false alarms.
