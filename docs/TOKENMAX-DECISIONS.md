# TokenMax — Decisions

A running log of concrete decisions made while building TokenMax, and why.
Newest first. This is not a design document (see `TOKENMAX-ARCHITECTURE.md`)
or a status report (see the R0 completion report in the PR/commit history)
— it exists so a later contributor (human or agent) can see *why* a choice
was made instead of re-litigating it.

## R0

### D-004: No legacy `tokenmax/main` branch exists in this repository

There is no prior TokenMax implementation checked into
`44578287/opencode-tokenmax` — `dev` is a clean upstream OpenCode fork. The
"legacy implementation" referenced throughout the master brief (duplicate
plugin interception, `InvalidDurableEvent` from malformed `SubtaskPart`,
first-turn permanent Thinking, `bun:sqlite` in the Electron main process,
Windows installer identity mismatches, permanent BUSY, model early-stop,
busy-wait build polling) is documented from the master brief's own
regression list (§3), not recovered from git history, because there is no
git history to recover it from. Every regression in that list is treated as
real and mandatory to guard against regardless of source — see
`TOKENMAX-RELIABILITY.md` for how each one maps to a concrete invariant or
test.

**Reuse**: nothing (no prior code exists).
**Reimplement**: the regression list itself, as documented invariants.
**Drop**: nothing to drop.

### D-003: The R2.5 event runtime prototype (`packages/tokenmax/`) is reference-only, frozen, and NOT part of R0

Before this rebuild returned to the master brief's actual phase order, an
earlier pass on this same line of work built a standalone
`@opencode-ai/tokenmax` package implementing an event-driven execution
runtime (Operation Manager, Completion Gate, Watchdog, BUSY invariant,
process/stream/poll/file watchers) directly against the master brief's
§17–§27, skipping the R0 gate. That was a process violation: R0 must land
and be gate-approved before any TokenMax runtime code, including the event
runtime, is written.

Decision: keep that package as a candidate reference implementation for a
future R2.5 phase, but:

- it is **not copied into `tokenmax-rebuild/main`**,
- it is **not integrated into OpenCode core**,
- it receives **no further scope expansion** — four real API issues found
  in review were fixed (busy-invariant checking only Operations and not
  processors; `await()`'s reject/resolve contract being implemented but
  undocumented; completion-gate's regex intent detection needing an
  explicit "advisory only, never authoritative" contract; listener
  exceptions being isolated but silently swallowed with no observability
  hook) and then the package was frozen.

**Reuse** (later, if R2.5 picks it up): the Operation Manager state
machine, the Clock abstraction for deterministic timer testing, and the
watcher designs (process exit-is-authoritative-with-drain-grace,
stream first-byte/inactivity/total timeouts, adaptive CI polling backoff).
**Reimplement**: whatever integration surface R1/R2 end up needing that
this standalone prototype didn't anticipate (it was built with zero
knowledge of the real Resource Registry/Router/Scheduler, which didn't
exist yet).
**Drop**: nothing from the prototype itself — it stays as-is, unmerged,
for future reference.

### D-002: R0 ships with `TOKENMAX RUNTIME = NONE`

Per master brief §52/§56: do not implement the Router first. R0's only job
is proving the baseline itself — a clean OpenCode fork, plus the TokenMax
identity/branding and process scaffolding around it — is stable before any
TokenMax decision-making logic exists. Concretely, R0 adds:

- the five `docs/TOKENMAX-*.md` files,
- a side-by-side Desktop dev identity (app id, product name, protocol —
  branding and packaging only, no runtime behavior change),
- a regression test pass proving the baseline itself doesn't exhibit the
  historical failure modes from `TOKENMAX-RELIABILITY.md`,

and nothing else. No Resource Registry, no Router, no Scheduler, no
Operation Manager, no Completion Gate ships in R0 — those begin at R1 and
R2.5 per `TOKENMAX-ROADMAP.md`, and only after this gate is reviewed and
approved.

### D-001: New work happens on `tokenmax-rebuild/main`, branched from clean `dev`

Originally branched from `origin/dev @ ba72a6f` (this fork's own `dev`,
mistakenly treated as authoritative — see D-006, which corrects this: the
branch was rebased onto the real `anomalyco/opencode` upstream). This is a
distinct line from `claude/event-driven-execution-model-ge98zn`, which
stays parked as the R2.5 prototype reference per D-003. Rationale: the
master brief is explicit that TokenMax must not be built by continuing to
patch a prior implementation, and must always remain mergeable with
upstream `dev` — starting genuinely clean is the only way to guarantee
that from day one, rather than retrofitting it later.

## Standing criteria for reusing anything from a prior TokenMax pass

Before reusing any code, module, or design from a previous attempt (this
one or any future one), it must answer yes to all of:

1. Does it match OpenCode's current native architecture?
2. Would it break an upstream `dev` merge?
3. Is there already an upstream primitive that does this?
4. Does it have tests?
5. Does it correctly respect the Electron/Bun runtime boundary (no
   Bun-only import reaching the Electron main/Node process)?

No large-scale cherry-picking. Each module is evaluated individually.

### D-005: TokenMax Dev gets its own NSIS install directory (scoped to TokenMax only)

Discovered via real Windows CI (`tokenmax-desktop-e2e.yml` run #7): after
installing "dev" then "tokenmax-dev", TokenMax Dev's install directory
still contained the official app's `.exe` — both channels had installed
into the identical directory (regression 3.5, root-caused — see
`TOKENMAX-RELIABILITY.md` 3.5). Fixed with `resources/installer.nsh` (an
NSIS `customInit` macro) that forces `$INSTDIR` to a path derived from
`PRODUCT_FILENAME`.

**Revised after R0 review**: the fix is wired in via `nsis.include` on the
`tokenmax-dev` case only, not the shared base `nsis` config. The same
electron-builder default affects dev/beta/prod's own mutual side-by-side
installs too, and fixing it there would be a real improvement — but R0's
job is to prove TokenMax isolates itself, not to change official OpenCode
channels' installer behavior as a side effect. `dev`/`beta`/`prod` keep
exactly electron-builder's upstream-default `nsis` config
(`electron-builder.config.test.ts` asserts this). If the general fix is
wanted for dev/beta/prod, it belongs in a separate, explicit change (or an
upstream issue/PR against `anomalyco/opencode`), not folded into TokenMax
R0.

### D-006: R0 upstream baseline corrected to the real anomalyco/opencode `dev`, not this fork's stale mirror

R0 review caught that `origin/dev` (`44578287/opencode-tokenmax`, this
fork) was 17 commits behind the actual authoritative upstream,
`anomalyco/opencode` `dev` — material commits, touching
`provider/provider.ts`, `provider/transform.ts`, `account/account.ts`,
`session/prompt.ts`, and `test/session/prompt.test.ts`. Treating a fork's
own `dev` as authoritative upstream merely because it happens to mirror an
older upstream commit was the mistake; the fork is not the source of
truth. Corrected by adding `anomalyco/opencode` as a git remote, freezing
`R0_UPSTREAM_BASELINE_SHA = 3a31c4ea801915c0b050df4b3842997ea62b6e93`
(upstream `dev`'s HEAD at review time — deliberately not chased further
if upstream moves again mid-verification), and rebasing every TokenMax R0
commit onto it with `git rebase --onto`. The rebase applied cleanly (no
conflicts); all local and CI-verified tests were re-run and re-verified
against the corrected baseline.

### D-007: The authoritative Windows side-by-side E2E pair is prod + TokenMax Dev, not dev + TokenMax Dev

R0 review correctly identified that "dev" (`ai.opencode.desktop.dev`,
"OpenCode Dev") is a distinct pre-release channel, not "official OpenCode"
(`ai.opencode.desktop`, "OpenCode", the `prod` channel) — so a dev +
TokenMax Dev side-by-side pass does not prove official/prod safety.
`scripts/e2e/windows-e2e.ps1` now runs its full install → verify → launch
→ uninstall → cross-check sequence for **prod + TokenMax Dev first, as the
authoritative pass**, then repeats it for dev + TokenMax Dev as secondary,
additional coverage (not a substitute).

This also surfaced a real, previously-latent bug: the script's DisplayName
matcher (`"$productName *" -like`, to tolerate NSIS's version suffix) is
unsafe once "OpenCode" (prod) is one of the product names being matched,
since "OpenCode " is *also* a literal prefix of "OpenCode Dev ..." and
"OpenCode TokenMax Dev ..." — a prod lookup could match the wrong
channel's registry entry whenever more than one is installed at once.
Fixed by comparing the DisplayName with exactly one trailing " <version>"
token stripped, rather than prefix-matching forward.

### D-008: Poll for NSIS install/uninstall registry effects instead of a fixed sleep

Confidence-gate run (attempt 3 of 3, same commit as D-006/D-007) failed on
`Uninstall-Channel`'s post-uninstall check: the Add/Remove Programs entry
was still present 2 seconds after the uninstaller process exited. The
other two attempts passed — a real, if intermittent, race, not a flake to
wave off. Root cause: NSIS's silent (oneClick) installer/uninstaller
commonly copies itself to a temp location and hands off to that copy to
finish the actual work (including self-deleting), so the originally
launched process exiting is not proof its registry/filesystem effects
have landed. A fixed `Start-Sleep` before checking just picks a delay that
usually — not always — wins that race.

Replaced every fixed-sleep-then-check in `windows-e2e.ps1` (post-install
registry-entry-appears, post-uninstall registry-entry-gone, post-uninstall
install-directory-gone) with `Wait-Until`, a short poll loop with a 30s
timeout — the same pattern `Wait-ForReady` already used for launch
readiness, now applied consistently everywhere the script waits on an
NSIS side effect.

The very next confidence-gate run (all 3 attempts, same fix) failed
immediately and identically on all three: `'Get-UninstallEntry' is not
recognized as a name of a cmdlet`. Cause: the condition scriptblocks were
built with `.GetNewClosure()`, which detaches a scriptblock from its
lexical parent scope and gives it an independent snapshot of *variables*
only -- it does not carry along script-scope *functions*, so
`Get-UninstallEntry` (defined at the top of the script) became
unreachable from inside the closure. `Wait-Until` is always invoked
synchronously, in the same call stack, so no detachment was ever needed:
a plain scriptblock literal already closes over its defining lexical
scope (the same mechanism every `Where-Object { ... }` in this script
already relies on to see enclosing variables). Removed `.GetNewClosure()`
from all three call sites.

### D-009: R0 gate accepted; full autonomy granted for R1 onward

R0's corrected report (commit `183d46f`, all 3 review blockers fixed, 3/3
confidence-gate CI passes) was accepted. The user then explicitly
delegated ongoing development of the entire roadmap (R1 through R6) with
full autonomy over planning and testing, rather than requiring gate
approval before each phase as the original process rules specified — a
deliberate, explicit relaxation of that process by the person who set it,
not something assumed. The non-negotiable ordering rules in
`TOKENMAX-ROADMAP.md` (baseline before Router, R2.5 not skipped ahead)
still hold; what changed is who reviews each gate, not the gate sequence
itself. Work continues in the same style as R0: real code, real tests,
real CI, honest "not yet done" over inflated status.

### D-010: Automatic subagent model selection is opt-in via policy, not a default behavior change

The user explicitly asked for genuinely working automatic model selection
and sub-conversation dispatch -- not a status readout, not a copy of
OpenCode, not an MCP wrapper -- built natively into OpenCode's own
subagent mechanism (`tool/task.ts`'s existing `TaskTool`, which already
spawns child sessions; R2 did not need to build that part).

`task.ts` is shared runtime code across every Desktop channel (dev, beta,
prod, tokenmax-dev all run the same compiled server) -- unlike R0's
installer-level changes, there's no per-channel branch point here to keep
the change scoped to TokenMax Dev alone. The isolation principle from
R0/D-005 still applies, just through a different mechanism: the router
only replaces the previous naive "copy the parent's model" fallback when
`tokenmax.json`'s `router.enabled` is explicitly `true`. No policy file,
or a policy file without that flag, means byte-for-byte the same behavior
official OpenCode has always had -- verified by a dedicated regression
test (`test/tool/task.test.ts`: "execute keeps the parent's model when
TokenMax routing is not enabled by policy") alongside the positive case
proving the router's selection is what's actually invoked.

### D-011: R2.5's BUSY invariant enforcement is not ported from the frozen prototype -- upstream already has a stronger guarantee

Before starting R2.5, checked the D-001 reuse criteria's "is there already
an upstream primitive" question against the frozen prototype's
`busy-invariant.ts`/`operation-manager.ts` (the R2.5 reference prototype
noted in D-003). Traced `SessionRunState`/`Runner`
(`src/session/run-state.ts`, `src/effect/runner.ts`) and found every run
is wrapped in `Effect.onExit(...)`, which fires on success, failure, and
interruption alike -- there is no code path in the current architecture
that leaves a session "finished" without also transitioning it back to
idle. This is stronger than the prototype's own approach, which detects
"BUSY with zero active operations" reactively, after the fact, and
corrects it -- the upstream architecture simply cannot reach that state
in the first place.

Wrote `test/session/run-state.test.ts` as the enforceable regression test
for regression 3.6 ("mid-run permanent BUSY",
`TOKENMAX-RELIABILITY.md`) against upstream's real mechanism, not a
reimplemented invariant checker: idle after a successful run, idle after
a run that fails (via `Effect.die`, since `ensureRunning`'s work carries
no typed error channel -- a real failure surfaces as a defect), and idle
after a shell run is cancelled mid-flight. All three passed against
upstream as-is on the first working version; nothing needed fixing.

Also found, incidentally, while writing these tests: `ensureRunning`
(used by `SessionPrompt`'s main turn/subagent loop) does not itself call
the `Runner`'s `onBusy` hook -- only `startShell` (used by
`SessionPrompt.shell`) does; `ensureRunning`'s Idle case calls `startRun`
directly, and whatever flips status to busy for the main loop happens at
a higher level than `SessionRunState` itself. This is not a bug -- both
paths still call `onIdle` on completion via the same `Effect.onExit`, so
the orphan-BUSY guarantee holds either way -- it just meant the "busy
while running" assertion needed a `startShell`-based test rather than an
`ensureRunning`-based one, since only `startShell` exercises the
onBusy -> onIdle cycle end to end.

Decision: the frozen prototype's `busy-invariant.ts`/`operation-manager.ts`
are not ported, wholesale or otherwise -- porting them would duplicate a
guarantee upstream already provides more strongly. R2.5's real remaining
scope narrows to what's genuinely new relative to upstream: Completion
Gate (multi-step DAG completion detection), GitHub CI watcher, watchdog,
and early-stop detection/recovery -- each still subject to the same reuse
check before anything from the prototype is ported.

### D-012: Completion Gate ported from the frozen prototype (unlike busy-invariant)

Ran the same D-001 reuse check against the prototype's
`completion-gate.ts` that D-011 ran against `busy-invariant.ts`, and it
came out the opposite way. `completion-gate.ts` is pure (`evaluateStop`,
`detectEarlyStop`, `EarlyStopTracker` take/return plain data, no Effect,
no service dependency), its only external type (`RunTerminalState`) is a
four-value string union trivial to inline rather than pulling in the
not-ported `operation-manager.ts`, it is fully test-covered (13 tests),
and -- unlike BUSY-state tracking -- there genuinely is no existing
upstream primitive: OpenCode's `SessionPrompt` loop trusts a model's own
`finish_reason: "stop"` as-is today, with no requirement-based gate
between that signal and treating a turn as done. Ported it verbatim into
`packages/opencode/src/tokenmax/completion-gate.ts` with its full test
suite (`test/tokenmax/completion-gate.test.ts`), only adapting doc
references (`docs/TOKENMAX-RELIABILITY.md` 3.7 in place of the
prototype's own "master brief §17/§18" comments) and inlining
`RunTerminalState` locally instead of importing the prototype's
`types.ts` (which also declares `OperationState`/`OperationSnapshot` --
concepts tied to the not-ported Operation Manager, out of scope here).

This is deliberately landed as a pure, tested, standalone slice with no
wiring into `SessionPrompt`'s actual turn loop yet -- same pattern as
`router.ts`/`telemetry.ts` in R2, which also shipped their decision logic
ahead of downstream integration. Constructing real `RunRequirement`s from
live DAG/worker/verification state, and actually calling
`evaluateStop()`/`detectEarlyStop()` against a real model turn, is
tracked as "not yet done" in `TOKENMAX-ROADMAP.md`'s R2.5 section rather
than silently assumed.

### D-013: side-by-side data isolation gets fast unit coverage, not just the Windows E2E gate

Prompted by an explicit user check-in on coexistence ("繼續，以及到時候編譯出來版本，要可以與原本的OPENCODE可以並存(就是互不影響)" --
"continue, and the compiled build needs to be able to coexist with the
original OpenCode, i.e. not affect each other"). Re-verified the R0 gate
end to end rather than assuming it still held: confirmed
`electron-builder.config.test.ts` (app id/product name/protocol per
channel) still passes unaffected by every R1/R2/R2.5 change so far, since
none of it touches packaging.

Went one level deeper while re-verifying and found a real, previously
untested gap: `packages/core/src/global.ts` hardcodes its XDG app
directory name to `"opencode"` regardless of channel, so
`Global.Path.data`/`.config`/`.cache`/`.state` -- and everything built on
them, including `Storage.Service` (TokenMax's own telemetry) and
`Database.node` -- resolve to the SAME OS-default XDG paths for every
channel unless something overrides all four `XDG_*_HOME` env vars before
the embedded server starts. `main/index.ts` already does override all
four, correctly, for `CHANNEL === "tokenmax-dev"` (rooting them under
`app.getPath("appData")/{tokenmax appId}/xdg/*`) -- this was already
built in R0, it just had zero automated test coverage. The only
verification of it was the Windows E2E confidence gate
(`tokenmax-desktop-e2e.yml`), which is real but slow and
`workflow_dispatch`-gated, not part of the fast pass that runs on every
push. `docs/TOKENMAX-RELIABILITY.md`'s anti-pattern list already names
exactly the failure mode this logic prevents: "a shared writable database
between the official app and a TokenMax dev build."

Extracted the pure directory-derivation logic (`tokenmaxXdgDirs()`) out
of `main/index.ts`'s Electron bootstrap into a new, Electron-import-free
`main/channel.ts` (the rest of the previous `constants.ts` -- `APP_IDS`,
`APP_NAMES`, `CHANNEL`, `PROTOCOL_SCHEMES` -- moved alongside it for the
same reason; only `UPDATER_ENABLED`, which genuinely needs
`app.isPackaged`, stays in `constants.ts`, now just re-exporting the rest
for backward compatibility). `main/constants.ts` itself imports
`"electron"` at module scope, which throws under plain `bun test` outside
a real Electron process -- that's why this logic had no unit test before:
it wasn't unit-testable in its original location. `channel.test.ts`
covers: every derived dir is rooted under the tokenmax-dev app id (never
the bare `appData` path); all four dirs are mutually distinct; a
different app id (e.g. the official prod channel's) produces entirely
disjoint paths; the function is pure (same inputs -> same outputs); and
paths use the platform separator (Windows correctness, since this code
runs on Windows in the real packaged app).

Wired both `channel.test.ts` and the previously-uncovered
`electron-builder.config.test.ts` into a new `desktop-unit-tests` job in
`tokenmax-native-tests.yml` -- fast (`ubuntu-latest`, no Windows or actual
Electron runtime needed), runs on every relevant push, and does not
replace the Windows E2E gate (still the authoritative real-install
verification) but catches a regression in the isolation *logic* far
earlier and far cheaper than a full Windows E2E run would.

### D-014: GitHub CI watcher and watchdog adapted, not ported -- Effect-native over hand-rolled, decoupled from the not-ported OperationManager

Continuing R2.5's remaining scope after D-011/D-012 (GitHub CI watcher,
watchdog). Ran the D-001 reuse check against the prototype's
`poll-watcher.ts` and `watchdog.ts`, and both needed real adaptation
rather than a verbatim port -- unlike `completion-gate.ts` (D-012), which
ported cleanly as-is.

**poll-watcher.ts**: the prototype's `watchUntilDone()` is a hand-rolled
Promise class with its own `Clock` abstraction and manual `AbortSignal`
wiring for cancellation. This codebase is Effect-native throughout, and
Effect's structured concurrency already gives interruption for free --
interrupting the fiber running `watchUntilDone` interrupts an in-flight
`Effect.sleep` automatically, with no signal plumbing needed. Reused the
*behavior* (bounded exponential-then-flat backoff: 2s/4s/8s/15s/30s then
holds, resolves the instant the poll reports done, times out past
`maxTotalMs`) as a plain Effect-returning function, not the class it
shipped in -- "does it match current native architecture" (D-001) said
no to the class shape, yes to the algorithm. This is the primitive
regression 3.8 (`TOKENMAX-RELIABILITY.md`, "busy-wait / sleep-based
waiting") requires: the model never participates in a sleep-then-check
loop, runtime code owns one bounded poll and hands back a single Effect
to await. Test-covered with real (tiny) `Effect.sleep` delays via
`it.live`, not `it.effect`'s `TestClock` -- `TestClock` needs explicit
time advancement to resolve a suspended sleep, which would need careful
fiber-interleaving control for no real benefit here, since the actual
default backoff values are already plainly visible as `DEFAULT_INTERVALS`
in the source; what the tests need to prove (attempt sequencing,
resolving the instant `done` is reported, timing out, interrupting
cleanly) doesn't need the literal schedule numbers to be slow-and-exact.

**watchdog.ts**: the prototype's `Watchdog` class wraps
`OperationManager.listActive()` directly -- but D-011 already decided
`OperationManager` isn't being ported (upstream's `SessionRunState`/
`Runner` already structurally prevents the specific failure it mainly
existed to catch, orphan BUSY). Porting `Watchdog` verbatim would have
meant porting `OperationManager` too, just to have something for it to
wrap. What's actually reusable is the stall-detection computation itself:
given a list of "active thing with a last-activity timestamp", find
what's gone stalled past a threshold. Extracted that as `sweep()` --
pure, generic over any `{ id, lastActivityAt }`-shaped snapshot, no
dependency on any specific active-thing registry. Same "port the decision
logic, not the class hierarchy" treatment `completion-gate.ts` got.

Both land as pure/Effect-native primitives only, same pattern as
`completion-gate.ts`: no live wiring yet, tracked honestly in
`TOKENMAX-ROADMAP.md`'s R2.5 section. `poll-watcher.ts` has no real
Octokit-calling GitHub CI watcher built on it yet -- no GitHub credential
source is plumbed into this app for polling GitHub's API from an ordinary
session (the existing `@octokit/rest` usage in `cli/cmd/github.handler.ts`
is the opposite direction: OpenCode running *as* a GitHub Action
responding to webhook events). `watchdog.ts`'s `sweep()` has no live
source to sweep -- no active-run registry in this codebase currently
tracks a per-run last-activity timestamp for in-flight subagent runs.
Building real credential plumbing or a new activity-tracking registry
speculatively, without a concrete caller that needs them yet, would be
scope creep beyond what R2.5 asked for; both are named explicitly as
"not yet done" rather than silently assumed complete.

### D-015: R3's first slice -- historical success weighting in the router

R2's `router.ts` named this out of scope for itself on purpose ("building
that here would be getting ahead of the roadmap's own ordering") and R2's
`telemetry.ts` started recording outcomes specifically so this phase
wouldn't start from zero history. With R2.5's primitives landed (D-011
through D-014), moved on to R3 -- "Intelligent Resource Scheduling" --
using that history.

Added `reliability.ts`: `score()` computes a success rate from a
resource's recorded `TokenMaxTelemetry` outcomes; `isUnreliable()` flags
it only once it has enough samples to be a real signal. Two design
choices, both deliberate:

- **Cold start = full trust.** A resource with zero recorded history
  scores exactly as trustworthy as one with a perfect record. The
  alternative (treating "no data" as suspicious) would make a
  newly-connected or rarely-used resource permanently unable to prove
  itself, since it can only accumulate history by actually being
  selected.
- **A minimum sample size gates the penalty, not just the rate.** One
  failed run must never tank a resource's eligibility -- `minSampleSize`
  defaults to 3, so even a resource with a 100% failure rate stays fully
  eligible until it has that much history. This mirrors the same
  "don't overreact to a single bad signal" principle
  `completion-gate.ts`'s `EarlyStopTracker` already applies to early-stop
  detection (D-012), just for a different signal.

Wired into `router.ts`'s `select()` as an exclusion filter that runs
*before* the existing cost-based sort, with one hard guarantee carried
over from R2: reliability filtering is never applied if it would remove
every remaining candidate. An unreliable resource is still strictly
better than failing subagent dispatch outright -- same reasoning as R2's
"always returns a usable selection, never a 'no resource' error."

Testing this needed a new precaution beyond what R2's router tests
already knew: `TokenMaxTelemetry`'s storage is process-wide (already
known, see `telemetry.ts`'s and `telemetry.test.ts`'s own comments), but
it also accumulates *per resource key* (`providerID`/`modelID`), not per
session ID -- a unique session ID prefix per test is not enough on its
own if two tests both record telemetry against the same provider/model,
since those records add up rather than overwrite. Discovered this the
concrete way: a new "single failure doesn't exclude anything" test failed
because an earlier test in the same file had already recorded 3 failures
against the same `providerID`/`modelID` pair, and process-wide storage
carried that history into the later test. Fixed by giving each new
reliability test in `router.test.ts` its own entirely distinct
provider/model pair (via a `makeReliabilityConfig()` helper), so no two
tests' recorded histories can ever mix -- the same isolation discipline
`enabled_providers` allowlisting already applied to ambient
credential leakage (R2), now applied to cross-test telemetry leakage too.
