# k6 performance smoke test

`smoke.js` sends read-only requests (`/global/health`, `/api/health`, `/path`, `/project/current`, `/`) to a running OpenCode server with 3 virtual users for 30 seconds. It fails if more than 1% of requests fail, the 95th percentile response time is 1500 ms or more, or any endpoint does not return 200.

It runs in CI through `.github/workflows/k6.yml` on pull requests to `main` and pushes to `main`. The workflow starts a local server, installs a pinned k6 release, and uploads the summary, HTML report, and logs as the `k6-report` artifact.

To run it locally:

```sh
bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port 4096
k6 run tests/performance/smoke.js
```

Set `BASE_URL` to test a different server, for example `BASE_URL=https://example.com k6 run tests/performance/smoke.js`.
