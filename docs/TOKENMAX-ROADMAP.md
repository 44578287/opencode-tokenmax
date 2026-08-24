# TokenMax — Roadmap

Each phase must be independently stable. A phase is never shipped on the
assumption that "a later phase will fix it." No phase begins until the
previous phase's gate is reviewed and explicitly approved — this is a
process rule, not a suggestion (see `TOKENMAX-DECISIONS.md` D-003 for what
happened the one time it was skipped on this project).

## R0 — Clean Baseline (current phase)

**Scope:**
- New rebuild branch, cut from a verified-current upstream `dev`.
- The five `TOKENMAX-*.md` docs (this set).
- Windows Desktop baseline install/launch/uninstall, verified for real.
- Side-by-side TokenMax Dev identity (app id / product name / protocol),
  branding and packaging only.
- No TokenMax runtime logic of any kind.
- A regression pass proving the baseline itself doesn't exhibit the
  historical failure modes in `TOKENMAX-RELIABILITY.md`.

**Gate:**
```
UPSTREAM BASELINE:              PASS
WINDOWS DESKTOP INSTALL/LAUNCH: PASS
OFFICIAL SIDE-BY-SIDE:          PASS
```

**Reaffirmed during R2.5** (`packages/desktop/src/main/channel.ts` +
`channel.test.ts`, see `TOKENMAX-DECISIONS.md` D-013): the gate above was
previously verified only by the (real, but slow, workflow_dispatch-only)
Windows E2E confidence gate. The isolation mechanism itself -- every one
of the embedded server's four XDG directories rooted under a
tokenmax-dev-only path, not just Electron's own `userData` -- had no fast
CI coverage of its own. Extracted the pure derivation logic out of
`main/index.ts`'s Electron bootstrap and gave it dedicated tests, now
running on every relevant push via `tokenmax-native-tests.yml`, alongside
the existing `electron-builder.config.test.ts` (which also had no CI
coverage until now). Confirmed unaffected by every R1/R2/R2.5 change
landed so far, since none of that work touches packaging or the desktop
bootstrap -- it's all shared runtime code within `packages/opencode`.

## R1 — Native Resource Core (in progress)

Resource registry (provider/model/variant), availability engine, billing
classes, capability metadata, persistence, telemetry, native commands
(`/tokenmax-status` etc.), hot policy loading. Explicitly **no automatic
child dispatch** yet — R1 is about knowing what resources exist and their
state, not about using them.

**Landed** (`packages/opencode/src/tokenmax/`), real and test-covered:
- `registry.ts` — `TokenMaxRegistry.Service`, a thin composition layer over
  `Provider.Service` (deliberately not a reimplementation of provider/model
  discovery — see `TOKENMAX-DECISIONS.md`'s reuse criteria). Capability
  metadata and raw cost come straight from `Provider.Model`.
- `billing.ts` — price-TIER categorization (free/economy/standard/premium)
  computed from `Provider.Model`'s existing cost data, thresholds
  overridable via policy.
- `payment.ts` — payment-MODEL classification
  (`free`/`subscription_quota`/`promotional_credit`/`local`/`payg_token`/`unknown`),
  a distinct axis from the price tier (Architecture §"Billing
  classification"). The load-bearing distinction: `subscription_quota` (an
  oauth-authenticated subscription, already paid for — quota burn, no new
  cash) vs `payg_token` (a raw API key, real cash per call). Derived from
  cost + connection state + the provider's stored auth credential type
  (from `Auth.Service`) + a local-endpoint check. `promotional_credit` is
  never emitted (no reliable signal yet — documented, not faked). Surfaced
  on the CLI (a `(subscription)`/`(pay-as-you-go)`/… suffix) and the HTTP
  status resource.
- `policy.ts` — `TokenMaxPolicy.Service`: TokenMax's own `tokenmax.json[c]`
  file (not an extension of OpenCode's own config schema — same isolation
  principle as R0's D-005), reusing `ConfigPaths`' existing project/global
  directory discovery. "Hot": re-read from disk on every `get()` call, no
  restart needed. Supports per-provider and per-model `enabled` overrides,
  billing threshold overrides, and (R2) `router.enabled`.
- `opencode tokenmax` (`src/cli/cmd/tokenmax.ts`) — the first user-visible
  surface: prints every connected model, its billing class, and whether
  policy has it enabled. Manually verified against a real project directory
  (not just unit tests).

- `GET /tokenmax/status` (`src/server/routes/instance/httpapi/groups/tokenmax.ts`
  + `handlers/tokenmax.ts`) — the HTTP equivalent of `opencode tokenmax`,
  reusing the exact same three services (registry/policy/telemetry) and
  reusing existing schemas (`Provider.Model`'s capability/cost field
  schemas, `TokenMaxTelemetry.Event`) rather than redeclaring parallel
  shapes. Wired into the real `InstanceHttpApi`/`app` service graph in
  `server.ts`, not test-only. Test-covered end to end through the actual
  server app (`test/server/httpapi-tokenmax.test.ts`), not just the
  handler function in isolation.

- `availability.ts` + registry catalog (`registry.list({ includeCatalog })`)
  — availability is now a distinct per-resource state
  (`catalog_only`/`provider_listed`/… — Architecture §"Availability,
  separate from capability"), and the registry can surface the full
  not-yet-connected ModelsDev catalog (what a user *could* configure) as
  `catalog_only`, mapped through the same `Provider.fromModelsDevProvider`
  the provider service itself uses. Reachable from both surfaces:
  `opencode tokenmax --catalog` and `GET /tokenmax/status?catalog=true`.
  Default behavior on both stays connected-only, byte-identical to before.

**Not yet done** (tracked, not silently skipped):
- Only `catalog_only` and `provider_listed` availability states are ever
  emitted yet — `verified_callable` needs a real probe call, and
  `throttled`/`auth_invalid`/… need an observed failure. The full enum
  exists so the shape doesn't change when a later verification slice
  starts producing them.
- Availability history over time is not tracked (only the current state).

## R2 — Native Child Routing (first slice landed, ahead of R1 completing)

Native child sessions, model selection, context package construction,
child-to-root result flow, live model verification (the resource the
router picked must be the resource actually invoked — see
`TOKENMAX-RELIABILITY.md`'s "router selects A but invocation uses B"
anti-pattern), no user-message mutation, OmO compatibility (TokenMax
chooses resources for workers OmO already decomposed, it doesn't
re-decompose).

Started before R1 fully finished per explicit user direction (full
autonomy granted, D-009) prioritizing genuinely usable automatic model
selection over remaining R1 polish. Native child sessions already existed
upstream (`tool/task.ts`'s subagent dispatch) -- not rebuilt, just given
real model selection at the one point it previously had none.

**Landed**, real and test-covered:
- `router.ts` — `TokenMaxRouter.Service`: rule-based selection (capability
  filtering + cheapest-eligible-first from `TokenMaxRegistry`), not learned
  -- historical-outcome weighting is R3's job, not this one. Always returns
  a usable selection; never fails subagent dispatch even with zero eligible
  resources (falls back to the caller-supplied model with a stated reason).
- Wired into `tool/task.ts` at the exact point that previously just copied
  the parent conversation's model onto every subagent with no logic at all.
  Gated on `tokenmax.json`'s `router.enabled` (default off) -- this file is
  shared runtime code across every channel, so behavior for anyone who
  hasn't opted in must stay byte-for-byte identical to upstream. See
  `TOKENMAX-DECISIONS.md` D-010.
- "Live model verification" is asserted directly in
  `test/tool/task.test.ts`: the test captures what the actual downstream
  prompt call received and checks it against the router's selection, not
  just the router's return value in isolation -- and a companion test
  proves behavior is unchanged with routing off.
- `telemetry.ts` — `TokenMaxTelemetry.Service`: records which resource
  actually handled each subagent run and its outcome (success/error),
  reusing `Storage.Service` rather than new persistence. Recording starts
  now, ahead of any reader, so R3's "historical success weighting" doesn't
  start from zero history. Wired into `tool/task.ts`'s `runTask` (both
  success and failure paths record; a storage failure never blocks
  dispatch). Fully test-covered including the failure path.

**Not yet done**:
- Context package construction and child-to-root result flow beyond what
  `tool/task.ts` already did upstream.
- OmO-compatibility verification (no OmO integration exists yet to test
  against).
- Per-agent capability requirements are currently a single hardcoded
  `requireToolCall: true` for every subagent, not derived from what the
  specific agent actually declares it needs.

## R2.5 — Reliability + Event Runtime

Operation Manager, process/build events, GitHub CI watcher, watchdog, BUSY
invariant enforcement, Completion Gate, early-stop detection and recovery.
A reference prototype for this phase already exists (see
`TOKENMAX-DECISIONS.md` D-003) and is a candidate starting point, subject
to the same reuse criteria as anything else — it is not automatically
adopted wholesale.

**Finding (narrows this phase's real scope)** — checked the D-001 reuse
criteria's "is there already an upstream primitive" question against the
prototype's BUSY invariant enforcement before porting anything, and the
answer is yes: upstream's `SessionRunState`/`Runner`
(`src/effect/runner.ts`) already wraps every run with `Effect.onExit(...)`,
which fires on success, failure, AND interruption alike. There is no code
path in the current architecture that leaves a session "finished" without
also transitioning it back to idle — a stronger, structural guarantee than
the prototype's own approach (reactively detecting "BUSY with zero active
operations" after the fact and correcting it). See D-011.
`test/session/run-state.test.ts` is the enforceable regression test for
this (regression 3.6, "mid-run permanent BUSY" from
`TOKENMAX-RELIABILITY.md`) against the real mechanism — 3 tests: idle
after success, idle after a failed run, idle after a shell run cancelled
mid-flight. All pass against upstream as-is; nothing needed fixing. Also
found, while writing these tests: `SessionRunState.ensureRunning` (used by
`SessionPrompt`'s main turn/subagent loop) does not itself call the
Runner's `onBusy` hook — only `SessionRunState.startShell` (used by
`SessionPrompt.shell`) does. `ensureRunning`'s Idle case calls `startRun`
directly; whatever flips status to busy for the main loop happens at a
higher level than `SessionRunState` itself. Not a bug — just means the
"busy while running" assertion needed a `startShell`-based test, not an
`ensureRunning`-based one.

Net effect: the frozen prototype's `busy-invariant.ts`/`operation-manager.ts`
are **not** being ported — that problem is already solved upstream, more
strongly than the prototype solved it. This phase's real remaining scope is
the parts of the prototype that are genuinely new relative to upstream:
Completion Gate (multi-step DAG completion detection), GitHub CI watcher,
watchdog, and early-stop detection/recovery — each still subject to the
same reuse check before porting.

**Landed** (`packages/opencode/src/tokenmax/completion-gate.ts`), real and
test-covered:
- Ported from the frozen prototype after the reuse check: pure, no
  dependency on the not-ported `operation-manager.ts`, no existing
  upstream equivalent (OpenCode's session loop trusts a model's own
  `finish_reason` as-is today, with no requirement-based gate).
- `evaluateStop()` — the sole authority for a `TERMINAL` "DONE" outcome,
  gated only on caller-supplied `RunRequirement`s (dag/operation/worker/
  verification/objective sources), never on model text. Regression 3.7
  in `TOKENMAX-RELIABILITY.md`.
- `detectEarlyStop()` / `EarlyStopTracker` — the separate, secondary
  heuristic that recognizes a model announcing intent ("I'll now start
  Agent A...", "接下来我会...") with zero tool calls and no observed
  progress, and walks a fixed, non-repeating escalation ladder (request
  tool action -> stronger instruction -> root fallback -> explicit
  failure). Advisory only — cannot itself fail or complete a run.
- 13/13 ported tests pass unchanged; 0 typecheck errors, 0 lint warnings.

**Also landed** (`poll-watcher.ts`, `watchdog.ts`), real and test-covered:
- `poll-watcher.ts` — `watchUntilDone()`, the bounded backoff-poll
  primitive regression 3.8 requires (event-driven waiting, never a
  model-driven "sleep, then check" loop). Reimplemented from the
  prototype's own `poll-watcher.ts` as an Effect-native function rather
  than porting its hand-rolled Promise+Clock class — Effect's structured
  concurrency already gives interruption for free (interrupting the
  fiber interrupts an in-flight `Effect.sleep` automatically), so no
  AbortSignal plumbing was needed. This is the primitive a GitHub CI
  watcher would poll a workflow run's status with.
- `watchdog.ts` — `sweep()`, adapted (not ported) from the prototype's
  `Watchdog` class: decoupled from `OperationManager` (not ported per
  D-011) into a pure function generic over any `{ id, lastActivityAt }`
  snapshot. Finds everything stalled past a threshold, as of a given
  `now`.
- 10/10 new tests pass (4 poll-watcher, 6 watchdog); 0 typecheck errors,
  0 lint warnings.

**Not yet done**:
- No wiring into `SessionPrompt`'s actual turn loop yet — nothing today
  constructs real `RunRequirement`s from live DAG/worker/verification
  state, or calls `evaluateStop()`/`detectEarlyStop()` against a real
  model turn. This slice is the decision logic in isolation, matching how
  `router.ts`/`telemetry.ts` landed ahead of their own downstream wiring.
- GitHub CI watcher's actual Octokit wiring: no GitHub credential source
  is plumbed into this app for "poll a workflow run from an ordinary
  session" — the existing octokit usage in `cli/cmd/github.handler.ts` is
  the opposite direction (OpenCode running *as* a GitHub Action
  responding to webhook events, not polling GitHub's API itself). The
  polling primitive it needs (`poll-watcher.ts`) is built; the
  GitHub-specific caller is not.
- Watchdog's live source: no active-run registry with per-run
  last-activity timestamps exists yet for `sweep()` to run against.

## R3 — Intelligent Resource Scheduling (first slice landed)

Capability learning from real outcomes, historical success weighting,
temporary quota weight, safe per-provider concurrency learning,
exploration/exploitation for new resources, specialist classification,
Resource HUD in the Desktop UI.

**Landed** (`packages/opencode/src/tokenmax/reliability.ts`, wired into
`router.ts`), real and test-covered:
- `reliability.ts` — `score()`/`isUnreliable()`: pure, rule-based (not a
  learned model) historical success weighting from `TokenMaxTelemetry`'s
  recorded outcomes. A resource with no history scores as fully trusted
  (cold start — a new or rarely-used resource must stay selectable, or it
  could never accumulate the history needed to prove itself). A single
  bad run is never enough signal (`minSampleSize` default 3); below that,
  even a 100% failure rate doesn't count against a resource yet.
- Wired into `router.ts`'s `select()`: candidates with enough recent
  history AND a poor success rate (`minSuccessRate` default 0.5) are
  excluded before the existing cost-based sort runs — but never if
  exclusion would remove every candidate; an unreliable resource still
  strictly beats no dispatch at all, same "always returns a usable
  selection" guarantee R2's router already had. `Selection.reason` notes
  how many resources were excluded, for observability.
- 9/9 new `reliability.ts` tests, 3/3 new router integration tests (a
  flaky-but-cheap resource loses to a pricier reliable one once it has
  enough failures; a single failure doesn't exclude anything; reliability
  filtering never empties the candidate pool). 0 typecheck errors, 0 lint
  warnings; all pre-existing router/task tests unaffected.

**Not yet done**:
- No recency weighting — `select()` currently scores a resource against
  its *entire* recorded history, not a recent window, so an old bad
  patch a resource has since recovered from still counts today.
- Temporary quota weight, safe per-provider concurrency learning,
  exploration/exploitation for new resources, specialist classification,
  and the Desktop UI's Resource HUD are all still unstarted.

## R4 — Long Task Runtime

Persistent DAG execution, checkpointing, restart/resume, nested workers up
to depth 2, multi-hour autonomous tasks, root-level provider failover
(distinct from child failover) — live-verified, not just implemented.

## R5 — Memory / Skills

Project and global memory, procedural skills, retrieval, reflection,
validation, and adapters for external memory providers (Mem0, OpenMemory,
Zep, or equivalents) behind the provider-agnostic interface described in
`TOKENMAX-ARCHITECTURE.md`.

## R6 — Cloud / Multi-device

Central authoritative sync, device identity, project-memory sync,
skill sync, resource-knowledge sync, event relay, and web/mobile client
support.

## Non-negotiable ordering rules

- R1 does not begin until R0's gate is reviewed and approved.
- The Router (R1/R2) is never implemented before R0's baseline is proven
  stable — see master brief §52: "不要一上来实现 Router."
- Reliability primitives (R2.5) are not skipped or rushed ahead of R0/R1/R2
  just because a prototype already exists for them.
