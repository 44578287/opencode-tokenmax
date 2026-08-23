# @opencode-ai/tokenmax

> **Status: R2.5 EVENT RUNTIME PROTOTYPE.** Candidate implementation for a
> future R2.5 phase, kept on this branch for reference. **Not integrated
> into OpenCode core** and not scheduled to be from this branch — see
> `docs/TOKENMAX-ROADMAP.md` on `tokenmax-rebuild/main` for the actual R0→R6
> plan. Do not extend this package's scope; further work on this runtime
> belongs to whichever phase picks it up for real integration.
>
> - PRIMITIVES: PASS (all 4 known API issues below fixed)
> - UNIT TESTS: PASS (79/79, deterministic — see Testing below)
> - OPENCODE INTEGRATION: UNVERIFIED (intentionally — nothing here is wired up)
> - LIVE EXECUTION: UNVERIFIED (never run against a real session/provider/process)

TokenMax's **event-driven execution runtime**: the reliability layer that
tracks work to a real terminal state instead of trusting model prose or
sleeping and hoping. This package implements master-brief sections §17–§27
as a standalone, dependency-free TypeScript module — no coupling to any
Resource Registry, Router, or Scheduler, which don't exist yet.

## Why this exists

The master brief documents eight real historical failure modes in the
legacy TokenMax implementation (§3). Every module here closes one:

| Regression (§3)                          | Closed by                                      |
| ----------------------------------------- | ----------------------------------------------- |
| 3.2 invalid event kills the session       | `OperationManager`: terminal transitions and listener errors are isolated, never thrown |
| 3.6 mid-run permanent BUSY                | `busy-invariant.ts`: ORPHAN_BUSY detection (processor AND operation both zero) + auto-correction |
| 3.7 model announces work but never acts   | `completion-gate.ts`: `evaluateStop` + `detectEarlyStop` + `EarlyStopTracker` |
| 3.8 busy-wait / sleep-based build waiting | `process-watcher.ts`, `poll-watcher.ts`: every wait is a real event or a bounded, backed-off timer, never a blind sleep |
| §22 Windows grandchild holds the pipe open | `process-watcher.ts`: exit is authoritative, bounded drain grace, then forced detach |
| §26 nothing to look at when work stalls   | `watchdog.ts`: on-demand `sweep()` produces a STUCK SNAPSHOT with caller-supplied diagnostics |
| §27 silent success on an empty stream     | `stream-watcher.ts`: a normal finish with zero tokens/tools/reasoning is classified `"empty-success"`, never `"completed"` |
| §24 estimated-time waits for files/transfers | `file-watcher.ts`: real `fs.watch` events + an explicit STARTED/PROGRESS/COMPLETED/FAILED transfer lifecycle |

## Modules

- **`operation-manager.ts`** — the core primitive. Every unit of tracked
  work (tool call, child session turn, build, CI wait, file transfer) is an
  `Operation` with an owner, a lifecycle
  (`CREATED → RUNNING ⇄ WAITING_EVENT → {COMPLETED,FAILED,TIMED_OUT,CANCELLED}`),
  a deadline enforced by a single scheduled timer, and an `await()` whose
  contract has two parts: the operation *outcome* never rejects (read
  `.state` — FAILED/TIMED_OUT/CANCELLED resolve same as COMPLETED), but
  awaiting an *unknown id* does reject, with `UnknownOperationError` — that's
  a programmer error, not an outcome. A throwing listener is isolated
  (never bubbles) but not silenced: pass `onListenerError` to the
  constructor to observe it (operation id/type/event kind + the caught
  error — never the Operation's own result/error payload).
- **`completion-gate.ts`** — enforces `finish_reason: "stop" != done`.
  `evaluateStop()` is the ONLY function that can reach a TERMINAL outcome,
  and it never looks at model text — it only inspects caller-supplied
  `RunRequirement`s, each carrying a `source: "dag" | "operation" | "worker"
  | "verification" | "objective"` (a closed union with no
  `"model-text"`/`"regex"` option, by design). `detectEarlyStop()` +
  `EarlyStopTracker` are a separate, secondary heuristic: they catch "I
  will start three agents..." followed by zero tool calls and recommend a
  fixed, non-repeating escalation (request tool action → stronger
  instruction → root model fallback → explicit failure) — but they never
  construct a `RunRequirement` and never gate DONE themselves. Regex is
  advisory input to escalation, never the completion state machine.
- **`watchdog.ts`** — `sweep()` is pure (given "now", which Operations have
  gone silent past a threshold) so it's fully unit-testable without waiting;
  `start()` wraps it as an optional periodic supervisory tick for
  production. It never resolves an Operation itself — only
  `progress()/complete()/fail()/timeout()` do that.
- **`busy-invariant.ts`** — `Session.state === BUSY` must imply at least
  one active processor OR active Operation for that owner — both halves of
  that OR are checked (via caller-supplied `BusyOwner.activeProcessorCount()`
  and `OperationManager.listActive()`); ORPHAN_BUSY requires BOTH to be
  zero, so a session mid-stream with a live processor but no Operation
  registered yet is never misjudged as orphaned. `enforceBusyInvariant()`
  detects and corrects the real case.
- **`process-watcher.ts`** — wraps any duck-typed child process handle.
  Resolves the instant `exit` fires (never a fixed sleep), and treats exit
  as authoritative: a bounded "drain grace" window lets buffered
  stdout/stderr flush, after which collectors are force-detached so a
  grandchild holding the pipe open on Windows can never hang the Operation.
- **`stream-watcher.ts`** — first-byte timeout, inactivity timeout (reset
  per chunk), and a bounded total timeout for provider streams, plus the
  empty-stream-is-not-success rule.
- **`poll-watcher.ts`** — `watchUntilDone()` is the one legitimate place a
  wait loop lives: an adaptive 2s/4s/8s/15s/30s(hold) backoff for polling
  external state with no push channel (e.g. a GitHub Actions run before a
  webhook integration exists). The model is never in this loop — it just
  awaits the Operation.
- **`file-watcher.ts`** — `watchDirectory()` turns real OS filesystem
  events into FILE_CREATED/CHANGED/RENAMED/DELETED (classification is a
  pure, independently-tested function — see `diffDirectorySnapshot`).
  `TransferWatcher` is the equivalent STARTED/PROGRESS/COMPLETED/FAILED
  lifecycle for uploads/downloads, with no filesystem coupling.

## Design choices worth knowing

- **No runtime dependencies, no `effect`.** Everything else in this
  monorepo uses the Effect library; this package deliberately doesn't, so
  it stays trivially embeddable in a Node/Electron host without pulling in
  a full Effect runtime, and satisfies the master brief's Electron/Bun
  boundary rule (§3.4) by construction — nothing here imports a
  Bun-only or Node-only API through anything but a type-only or
  universally-available (`node:fs`, `node:path`) surface.
- **Every timer goes through an injectable `Clock`** (`clock.ts`). Tests
  use `test/support/fake-clock.ts` to assert real deadline/backoff/grace
  behavior deterministically, in milliseconds, instead of actually
  sleeping — see the test suite for how each timing-sensitive module is
  exercised without flakiness.
- **Not yet wired into OpenCode core, and not going to be from this
  branch.** This is intentionally a standalone, narrowly-scoped module (per
  the master brief's "TokenMax module + narrow integration hooks"
  principle). It stays a prototype: candidate reference for a future R2.5,
  picked up (if at all) only after R0/R1/R2 land for real on
  `tokenmax-rebuild/main`.

## Prototype review fixes (4 API issues, closed)

A review pass after the initial prototype found four real API problems.
All four are fixed and covered by tests; this package is frozen at that
point — no further scope additions.

1. **`busy-invariant.ts` checked only Operations, not processors**, despite
   documenting "BUSY ⇒ active processor OR active Operation". A normal
   in-flight turn with a live processor but no Operation yet would have
   been misjudged ORPHAN_BUSY. Fixed: `BusyOwner.activeProcessorCount()`
   is now part of the contract; ORPHAN_BUSY requires both counts to be
   zero. See `test/busy-invariant.test.ts`.
2. **`OperationManager.await()`'s contract was implemented but not
   documented precisely.** Now explicit and tested: the operation outcome
   itself never rejects; an unknown id rejects with a named
   `UnknownOperationError` (programmer error, not an outcome). See
   `test/operation-manager.test.ts`.
3. **Completion Gate's regex-based intent detection could have drifted
   into being the completion state machine.** `RunRequirement` now
   requires a `source` from a closed union (`dag`/`operation`/`worker`/
   `verification`/`objective`) with no "model text" option, and the module
   docstring states explicitly that `detectEarlyStop`/`EarlyStopTracker`
   are secondary and advisory-only. See `test/completion-gate.test.ts`.
4. **Listener exceptions were isolated but silently swallowed** in both
   `OperationManager` and `TransferWatcher`. Both now accept an optional
   error sink (`onListenerError`) reporting operation/transfer id, event
   kind, and the caught error — never the Operation's own result/error
   payload — so failures are observable instead of vanishing. The sink
   itself is isolated too (a throwing sink can't break emission). See the
   `isolation is not silence` tests in `test/operation-manager.test.ts`
   and `test/file-watcher.test.ts`.

## Testing

```sh
bun --cwd packages/tokenmax test
bun --cwd packages/tokenmax typecheck
```

Every timing-sensitive test uses `FakeClock` and asserts exact virtual-time
behavior; `file-watcher.test.ts` additionally has one real-`fs.watch` smoke
test to prove the OS wiring itself works, kept separate from the (fully
deterministic) directory-diff classification tests.
