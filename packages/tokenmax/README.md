# @opencode-ai/tokenmax

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
| 3.6 mid-run permanent BUSY                | `busy-invariant.ts`: ORPHAN_BUSY detection + auto-correction |
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
  a deadline enforced by a single scheduled timer, and an `await()` that
  always resolves with the final snapshot — callers read `.state`, so
  there's no catch block to accidentally treat as success.
- **`completion-gate.ts`** — enforces `finish_reason: "stop" != done`.
  `evaluateStop()` only reaches the `DONE` terminal state once every
  caller-supplied `RunRequirement` is satisfied. `detectEarlyStop()` +
  `EarlyStopTracker` catch "I will start three agents..." followed by zero
  tool calls, and walk a fixed, non-repeating escalation ladder (request
  tool action → stronger instruction → root model fallback → explicit
  failure) so a stuck model can never loop forever.
- **`watchdog.ts`** — `sweep()` is pure (given "now", which Operations have
  gone silent past a threshold) so it's fully unit-testable without waiting;
  `start()` wraps it as an optional periodic supervisory tick for
  production. It never resolves an Operation itself — only
  `progress()/complete()/fail()/timeout()` do that.
- **`busy-invariant.ts`** — `Session.state === BUSY` must imply at least
  one active Operation for that owner. `enforceBusyInvariant()` detects and
  corrects the alternative.
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
- **Not yet wired into OpenCode core.** This is intentionally a standalone,
  narrowly-scoped module (per the master brief's "TokenMax module + narrow
  integration hooks" principle) — integrating it with actual sessions,
  tool execution, and the OpenCode process/event system is follow-up work,
  not part of this change.

## Testing

```sh
bun --cwd packages/tokenmax test
bun --cwd packages/tokenmax typecheck
```

Every timing-sensitive test uses `FakeClock` and asserts exact virtual-time
behavior; `file-watcher.test.ts` additionally has one real-`fs.watch` smoke
test to prove the OS wiring itself works, kept separate from the (fully
deterministic) directory-diff classification tests.
