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

Branched from `origin/dev @ ba72a6f` (verified against upstream immediately
before branching — no drift). This is a distinct line from
`claude/event-driven-execution-model-ge98zn`, which stays parked as the
R2.5 prototype reference per D-003. Rationale: the master brief is explicit
that TokenMax must not be built by continuing to patch a prior
implementation, and must always remain mergeable with upstream `dev` —
starting genuinely clean is the only way to guarantee that from day one,
rather than retrofitting it later.

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
