# TokenMax — Vision

## What TokenMax is

TokenMax is not a "cheapest model first" router. It is an intelligent
multi-model execution runtime, natively integrated into OpenCode, that owns:

1. Provider/model resource discovery
2. Capability profiling
3. Model selection
4. Quota / billing / cost scheduling
5. Multi-agent / child-session scheduling
6. Long-task DAG execution
7. Fallback / retry / failover
8. Event-driven execution
9. Completion supervision
10. Runtime reliability
11. Long-term learning
12. Memory / skills
13. Multi-device sync
14. UI observability

The objective is not "minimize dollars spent." It is:

> Within the constraints of task quality and success rate, maximize
> utilization of resources the user already has, while minimizing
> additional cash cost, wait time, and failure rate.

## Why this exists

A user with a Claude subscription, a ChatGPT subscription, a few free-tier
API keys, and occasional pay-as-you-go budget is sitting on a pile of
under-utilized capacity. Today, using all of that well requires the user to
manually track quotas, remember which model is good at what, retry by hand
when a provider is down, and babysit long-running agent work. TokenMax's
job is to make that invisible: pick the right resource for the task, keep
using it reliably to completion, and learn from what happened.

## What "done" looks like for the user

The target experience (master brief §54) is that the user says something
like "fix this project" and the system, on its own:

```
analyze the task
  -> select a root
  -> search
  -> spin up children
  -> run them in parallel
  -> wait on real build/CI events (never sleep-and-poll)
  -> debug immediately on failure
  -> watch CI
  -> verify
  -> summarize
  -> learn (memory/skill)
```

The UI's job is narrow: let the user always answer four questions without
asking them out loud —

- Who is doing what right now?
- Why was this model chosen?
- What is it waiting on?
- If something failed, how is it recovering?

The user should almost never need to say "continue," "try a different
model," "retry," "wait," or "check CI status" themselves. Those are runtime
responsibilities, not user responsibilities.

## Design philosophy (master brief §55)

TokenMax is not "a model router with extra steps." It is OpenCode's
intelligent execution layer, and it is the thing responsible for answering:

- What model?
- Who executes?
- What can run in parallel?
- What are we waiting for?
- Has the task actually finished?
- What failed?
- How do we recover?
- What did we learn?
- What should we remember?

The end state: smarter, cheaper, faster, more reliable, more autonomous,
capable of learning, and able to continue work across devices.

## Non-goals (as important as the goals)

- **Not** a fork that drifts from upstream OpenCode. Every TokenMax
  capability is additive and narrowly integrated; upstream `dev` must
  always be mergeable into this line of work without surgery.
- **Not** "free at all costs." A hard capability gate always comes before
  economics — an incapable free model is never chosen over a capable paid
  one just because it's free or its quota is about to reset.
  See `TOKENMAX-DECISIONS.md` for the utility function this implies.
- **Not** built by patching the legacy `tokenmax/main` implementation.
  That branch is reference material only — see `TOKENMAX-DECISIONS.md`
  for what was reused, reimplemented, or dropped, and
  `TOKENMAX-RELIABILITY.md` for the specific failures it produced that this
  rebuild is required to never reproduce.
- **Not** delivered as one big-bang integration. TokenMax ships in phases
  (R0–R6, see `TOKENMAX-ROADMAP.md`), and each phase must stand on its own
  — later phases are never used as an excuse to ship an unstable one now.

## Where this document fits

This file states *why* TokenMax exists and what it should feel like to use.
It intentionally does not describe internal module boundaries (see
`TOKENMAX-ARCHITECTURE.md`), specific technical tradeoffs (see
`TOKENMAX-DECISIONS.md`), the phased build order (see
`TOKENMAX-ROADMAP.md`), or the reliability invariants and regression list
every phase is held to (see `TOKENMAX-RELIABILITY.md`).
