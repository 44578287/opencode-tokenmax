# Upstream sync

This repository is a **fork** of [anomalyco/opencode](https://github.com/anomalyco/opencode).

| Remote | URL | Role |
| --- | --- | --- |
| `origin` | `https://github.com/44578287/opencode-tokenmax.git` | This fork. Push `tokenmax/main` and `feature/*` here. |
| `upstream` | `https://github.com/anomalyco/opencode.git` | Official OpenCode. Fetch only. Never force-push. |

Default upstream branch: **`dev`**.

Working branch on this fork: **`tokenmax/main`**.

## Rules

1. Do not rewrite Core business logic on `tokenmax/main` until fork CI is green.
2. TokenMax work lands on `feature/*` branches, then PR into `tokenmax/main`.
3. Sync from upstream regularly:

```bash
git fetch upstream
git checkout tokenmax/main
git merge upstream/dev
# resolve conflicts, run tokenmax-ci, push origin tokenmax/main
```

Prefer merge over rebase for `tokenmax/main` so Desktop artifact history stays linear and recoverable.

4. Do not copy anomalyco GitHub secrets (Azure Trusted Signing, Apple notarize, Sentry, `OPENCODE_APP_SECRET`). Fork CI is unsigned.

## CI

Upstream workflows (`test.yml`, `typecheck.yml`, `publish.yml`) target:

- `anomalyco/opencode` only (publish)
- `blacksmith-*` runners (not available on this fork)
- `push` to `dev` only

They are **left intact** and will skip or fail on the fork. Do not delete them; they are the template for later upstream PRs.

Fork-friendly workflow: **`.github/workflows/tokenmax-ci.yml`**

- Runners: `ubuntu-latest`, `windows-latest`
- Required jobs: typecheck, **tokenmax-tests** (must not use continue-on-error), unsigned Windows Desktop artifact
- Upstream unit tests: `continue-on-error` (known flakes on github-hosted runners; do not patch Core tests)
- TokenMax native flag: `experimental.tokenmax.enabled` (default off = upstream model selection)
- Triggers: `tokenmax/main`, `feature/**`, PRs, `workflow_dispatch`
- Signing: skipped when Azure credentials are absent (`electron-builder.config.ts` `signWindows` no-ops)

Windows Desktop artifact name: `opencode-desktop-windows`.

## Local remotes

```bash
git remote -v
# origin    https://github.com/44578287/opencode-tokenmax.git
# upstream  https://github.com/anomalyco/opencode.git
```
