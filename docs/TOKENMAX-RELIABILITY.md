# TokenMax — Reliability

Every entry below is a real historical failure, turned into an invariant
and a required regression test. None of these are "nice to have" — a phase
that reintroduces one of them is not done, regardless of what feature work
it also shipped. `PASS` always means "verified by a real test, actually
run," never "the code looks right." Distinguish, always:

```
code exists
unit test pass
integration test pass
packaged app pass
actual live provider pass
```

## The regression list

### 3.1 — Legacy plugin vs. native core collision

A legacy `tokenmax-router` plugin running at the same time as a native
TokenMax integration caused duplicate interception, invalid
`SubtaskPart`s, prompt failures, permanent first-turn Thinking, and
failover recursion.

**Invariant:** Native TokenMax ON implies the legacy plugin MUST NOT
execute. Data may be migrated from the legacy path; there is never
double-write or double-execution.
**R0 status:** no TokenMax runtime exists yet, so this can't yet fail —
verified by grep that no legacy plugin path is loaded (see the R0 report).
Becomes independently testable starting R1/R2.

### 3.2 — `InvalidDurableEvent` / malformed `SubtaskPart`

A `SubtaskPart` injected without `id`/`sessionID`/`messageID` produced
`EventV2.InvalidDurableEvent` and could interrupt a session between the
user message being created and the assistant message being created.

**Invariant:** every durable part is schema-validated before it's
persisted; an invalid part never kills the whole session; a plugin hook
failure is isolated, never fatal. First-turn behavior is covered by an
automated regression (see below), not assumed safe.

### 3.3 — First-turn permanent Thinking

```
USER_CREATED -> no ASSISTANT_CREATED -> UI stuck on Thinking forever
```

recoverable only by the user sending a second "continue" message.

**Invariant:** a fresh session's first prompt always reaches an assistant
message and a terminal state without a second user turn. This is the
single most load-bearing R0 regression test — see "R0 regression pass"
below.

### 3.4 — Electron/Bun runtime boundary violation

TokenMax persistence once imported `bun:sqlite` directly into the Electron
main (Node) process, breaking the packaged app at launch.

**Invariant:** Electron main never directly imports a Bun-only module.
Bun-only core stays in the Bun runtime/sidecar; Desktop and Core talk
through a real API/IPC/HTTP boundary. A packaged bundle is scanned for
Bun-only imports as part of the Desktop E2E gate.

### 3.5 — Windows installer identity

CI reported "build PASS" while the actual installed artifact identified
itself as `@opencode-ai desktop` — wrong name, wrong identity.

**Invariant:** `build PASS != Desktop PASS`. A real Desktop PASS is:

```
PACKAGE -> INSTALL -> VERIFY REGISTRY/PATH/NAME/PROTOCOL -> LAUNCH -> READY
        -> UNINSTALL -> VERIFY OFFICIAL OPENCODE STILL WORKS
```

with every step actually executed and its output actually inspected, not
inferred from exit code 0 on the packaging step alone.

### 3.6 — Mid-run permanent BUSY (ORPHAN_BUSY)

A task would run, then go quiet with no further output while the UI stayed
BUSY forever; "Continue" did nothing; only Stop then Continue recovered it.

**Invariant:** if a session is BUSY, it must have at least one active
processor or active Operation. Zero of both while BUSY is `ORPHAN_BUSY`
and must be detected and auto-corrected, never left permanently pending.
(Formalized as `busy-invariant.ts` in the R2.5 prototype — see
`TOKENMAX-DECISIONS.md` D-003 — pending real integration in a later phase.)

### 3.7 — Model early-stop

A model announces "I'll now start Agents A/B/C..." and then stops with
`finish_reason: "stop"`, having called zero tools and started nothing.

**Invariant:** `finish_reason: "stop" != task complete`. A Completion Gate
checks caller-supplied requirements (DAG state, Operation state, worker
registration, verifier results, objective state) before accepting a claimed
stop as `DONE` — never model prose. Repeated early-stops without progress
escalate through a fixed ladder (stronger instruction -> require immediate
tool action -> root model fallback -> explicit failure), never an infinite
self-retry loop.

### 3.8 — Busy-wait / sleep-based waiting

A model would kick off a build, `sleep(120)`, then check — even when the
build failed at second 3.

**Invariant:** every wait is event-driven. A process wait resolves the
instant `exit` fires; a provider stream wait resolves on real
first-byte/inactivity/total timeouts; unavoidable polling (e.g. GitHub CI
before a webhook integration exists) uses a bounded, backed-off schedule
that the model is never inside of. No LLM sleep, no LLM delay, no LLM
busy-wait, period.

## R0 regression pass

Required before R0's gate is signed off, run against the clean baseline
(no TokenMax runtime present, so this is really "does upstream OpenCode
itself, as configured for TokenMax Dev, hold up"):

```
FIRST TURN            x20
SHORT PROMPT           x20
CODING PROMPT (tool)  x10
LONGER TOOL CHAIN      xN  (multi-step, exercises follow-through)
```

None of these may produce:

```
InvalidDurableEvent
prompt_async failed
permanent Thinking (no ASSISTANT_CREATED reached)
permanent BUSY
```

Desktop-specific, on Windows:

```
PACKAGE, INSTALL, LAUNCH, FIRST PROMPT, TOOL EXECUTION,
NORMAL COMPLETION, EXIT, UNINSTALL
```

each independently verified, plus:

```
official OpenCode install, before TokenMax Dev install: works
official OpenCode, after TokenMax Dev install:          works, untouched
official OpenCode, after TokenMax Dev uninstall:         works, untouched
```

See the R0 completion report (posted alongside this doc set) for the
actual, currently-observed results of this pass — including anything
marked UNVERIFIED and why, rather than assumed passing.

## Anti-patterns (never acceptable, any phase)

```
fake user "continue"
appending internal/system context into the user's own message
session.abort used as a normal control-flow mechanism
LLM-generated /status output
LLM polling CI itself (sleep + check, model-driven)
sleep-based build waiting
infinite retry
a capability score penalty caused by a provider outage
      (that's an Availability change, not a Capability change)
fake child bubbles instead of real child sessions
router selects resource A but the actual invocation uses resource B
native TokenMax and legacy TokenMax running simultaneously
a shared writable database between the official app and a TokenMax dev build
cloud-syncing a raw SQLite file via a file-sync product
```

## When a bug is found (any phase, forever)

Do not keep stacking features on top of it. Answer, in order:

```
ROOT CAUSE
EXACT STALL/FAIL POINT
WHY IT HAPPENED
WHY RECOVERY WORKED
FIX
REGRESSION TEST
```

Every bug becomes an automated test before the fix is considered done.
