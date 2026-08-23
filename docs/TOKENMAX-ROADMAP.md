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

## R1 — Native Resource Core

Resource registry (provider/model/variant), availability engine, billing
classes, capability metadata, persistence, telemetry, native commands
(`/tokenmax-status` etc.), hot policy loading. Explicitly **no automatic
child dispatch** yet — R1 is about knowing what resources exist and their
state, not about using them.

## R2 — Native Child Routing

Native child sessions, model selection, context package construction,
child-to-root result flow, live model verification (the resource the
router picked must be the resource actually invoked — see
`TOKENMAX-RELIABILITY.md`'s "router selects A but invocation uses B"
anti-pattern), no user-message mutation, OmO compatibility (TokenMax
chooses resources for workers OmO already decomposed, it doesn't
re-decompose).

## R2.5 — Reliability + Event Runtime

Operation Manager, process/build events, GitHub CI watcher, watchdog, BUSY
invariant enforcement, Completion Gate, early-stop detection and recovery.
A reference prototype for this phase already exists (see
`TOKENMAX-DECISIONS.md` D-003) and is a candidate starting point, subject
to the same reuse criteria as anything else — it is not automatically
adopted wholesale.

## R3 — Intelligent Resource Scheduling

Capability learning from real outcomes, historical success weighting,
temporary quota weight, safe per-provider concurrency learning,
exploration/exploitation for new resources, specialist classification,
Resource HUD in the Desktop UI.

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
