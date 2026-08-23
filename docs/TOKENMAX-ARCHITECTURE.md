# TokenMax — Architecture

> Status: this describes the target architecture for TokenMax once it is
> built out through the phases in `TOKENMAX-ROADMAP.md`. As of R0, **none**
> of the modules below exist in this codebase — R0 is a clean OpenCode
> baseline with TokenMax runtime = NONE. See `TOKENMAX-DECISIONS.md` for the
> one exception: an unintegrated reference prototype for the event runtime
> layer lives on a separate branch, not merged here.

## System diagram

```
OpenCode TokenMax
|
+- OpenCode Core                     (upstream, unmodified except narrow hooks)
|
+- TokenMax Runtime
|  +- Resource Registry              provider/model/variant discovery
|  +- Capability Engine              multi-dimensional capability profiles
|  +- Availability Engine            CATALOG_ONLY .. VERIFIED_CALLABLE .. AUTH_INVALID
|  +- Billing / Quota Engine         FREE / SUBSCRIPTION_QUOTA / PROMOTIONAL_CREDIT / LOCAL / PAYG_TOKEN
|  +- Model Profiler                 real work history > synthetic benchmark > external benchmark > metadata > override
|  +- Router                         utility-based selection (capability gate first, economics last)
|  +- Scheduler                      concurrency, exploration/exploitation
|  +- DAG Runtime                    PENDING/RUNNABLE/RUNNING/WAITING_EVENT/COMPLETED/FAILED/BLOCKED/CANCELLED
|  +- Completion Gate                finish_reason=stop != done; DONE/BLOCKED/NEEDS_USER/FAILED
|  +- Operation Manager              lifecycle + deadline for every tracked unit of work
|  +- Reliability Supervisor         watchdog, busy invariant, stuck diagnostics
|  +- Telemetry                      redacted, secret-safe
|  +- Memory Manager                 working/session/project/global/resource/procedural memory
|  +- Persistence                    hot-reloadable policy, atomic config swap
|
+- Native Child Sessions             OpenCode's own child/task/session primitives, no fake bubbles
|
+- Desktop UI
|  +- Worker Tree                    role, provider/model#variant, billing_class, state, session_id
|  +- Resource HUD                   quota KNOWN/ESTIMATED/UNKNOWN, honest not fabricated
|  +- Operation Status
|  +- Diagnostics
|
+- Server API
   +- Desktop
   +- Web
   +- future Mobile
```

## Resource unit

The atomic thing TokenMax reasons about is `provider/model#variant` — not
just `provider/model`. Different reasoning variants (e.g. a model run with
extended thinking vs. without) are learned and scored independently,
because their capability and reliability profiles genuinely differ.

## Billing classification

```
FREE
SUBSCRIPTION_QUOTA
PROMOTIONAL_CREDIT
LOCAL
PAYG_TOKEN
UNKNOWN
```

`SUBSCRIPTION_QUOTA != PAYG`. A subscription is already paid for — using it
has an opportunity cost (quota burn, reset timing) but not a new cash cost.
PAYG is the only class that adds new cash cost. Getting this distinction
wrong is exactly how a router ends up needlessly avoiding resources the
user already paid for, or needlessly favoring exhausted-soon subscription
quota over a trivial PAYG call.

## Routing: utility, not a fixed waterfall

TokenMax does not implement `FREE -> SUBSCRIPTION -> PAYG` as a rigid
waterfall. Conceptually:

```
Utility =
    CapabilityFit
  x HistoricalSuccess
  x Reliability
  x TaskSuitability
  x TemporaryResourceWeight
  x LatencyValue
  - MonetaryCost
  - ScarcityCost
  - FailureRisk
```

Evaluated strictly in this order:

1. Capability hard gate (a model that can't do the task is never selected,
   free or not)
2. Task suitability
3. Reliability / history
4. Resource economics
5. Availability / latency

An incapable free model must never be strong-armed into a task just
because it's free or its quota is about to expire.

## Dynamic temporary weight vs. capability score

Quota state is a *temporary* modifier, not a *capability* fact. If Claude
quota is at 80% with a reset in 40 minutes, that's a temporary boost to use
it now. If weekly quota is at 7% with a reset in 5 days, that's a scarcity
penalty. Neither should ever mutate the model's underlying capability
score — the two are tracked as separate numbers:

```
Capability Score            (persists across quota state)
Resource Temporary Weight   (quota-driven, decays/resets on its own schedule)
```

## Exploration vs. exploitation

New providers/models/variants are marked `NEW / UNPROFILED` on discovery,
never silently ignored because history is empty. Unknown resources are
preferentially routed to low-risk work (search, summarize, mechanical
verification) while their profile builds up — never to high-risk
production changes until proven.

## Capability profile (multi-dimensional)

There is no single "model ranking." Each resource route carries a vector:

```
coding, debugging, architecture, reasoning, search, instruction_following,
tool_use, structured_output, vision, OCR, long_context, multilingual,
autonomy, persistence, tool_follow_through, completion_reliability,
long_task_reliability, early_stop_rate, no_progress_stop_rate,
busy_wait_tendency, execution_efficiency
```

Plus hard modality/context gates: `context_window`, `output_limit`,
supported modalities (text/image/audio/video/pdf), and supported
capabilities (tools/vision/structured_output/reasoning). A task that
exceeds context or needs an unsupported modality is a hard reject, not a
low score.

Data source priority for capability values: real task outcomes first,
TokenMax's own synthetic benchmark second, external benchmarks third,
provider metadata fourth, human override last resort — with real work
history meant to dominate over time.

## Availability, separate from capability

Availability is its own state machine, independent of the capability score:

```
CATALOG_ONLY, PROVIDER_LISTED, VERIFIED_CALLABLE, THROTTLED,
TEMP_UNAVAILABLE, AUTH_INVALID, MODEL_NOT_FOUND, STALE, UNKNOWN
```

An auth failure or a 429 changes availability, never capability. A model
with `Capability: 0.94` and `Availability: AUTH_INVALID` is still a 0.94
capability model — it's just not currently callable.

## Native child sessions

Workers are OpenCode's real child/task/session primitives — never synthetic
chat bubbles. Each worker exposes role, `provider/model#variant`,
billing_class, state, session_id, fallback_count, and `source: TokenMax`,
and is clickable into its own session. If OpenCode/OmO has already
decomposed a task into subagents, TokenMax's job is choosing which resource
each existing worker actually runs on — not re-decomposing. Default
`MAX_DEPTH=1`, complex tasks may go to `MAX_DEPTH=2`; cycles are never
allowed.

## DAG runtime

Complex tasks are not allowed to live only in a model's natural-language
plan. Each DAG node has: `dependencies`, `owner worker`, `operation`,
`result`, and a state from
`PENDING/RUNNABLE/RUNNING/WAITING_EVENT/COMPLETED/FAILED/BLOCKED/CANCELLED`.

## Completion Gate

Core invariant: `finish_reason == "stop"` does not mean the run is done. A
Run has exactly four terminal states: `DONE`, `BLOCKED`, `NEEDS_USER`,
`FAILED`. If there is a pending DAG node, a promised-but-unstarted worker,
an un-run verifier, or an unmet user objective, the run is `CONTINUE`
internally — never resolved by fabricating a user "continue" message. See
`TOKENMAX-RELIABILITY.md` for the early-stop detection and escalation
ladder this pairs with.

## Operation Manager

The unifying lifecycle primitive underneath everything above:

```
operation_id, type, owner_session, owner_run, owner_worker, owner_dag_node
state: CREATED, RUNNING, WAITING_EVENT, COMPLETED, FAILED, TIMED_OUT, CANCELLED
started_at, last_progress_at, deadline, result, error, active_handle

API: start(), subscribe(), progress(), complete(), fail(), cancel(),
     timeout(), await(), resume()
```

Every unit of tracked work — a tool call, a child session turn, a build, a
CI wait, a file transfer — is an Operation. If a session can be `BUSY`,
that BUSY state must be backed by at least one active processor or active
Operation, or it is an `ORPHAN_BUSY` bug (see `TOKENMAX-RELIABILITY.md`).

## Event-driven execution

No LLM sleep, no LLM delay, no LLM busy-wait. If an event is observable
(process exit, stream chunk, file change, CI status), the runtime reacts to
it; it never blind-sleeps and re-checks. Process/build waits, provider
streams, filesystem/transfer waits, and unavoidable polling (e.g. GitHub CI
before a webhook exists) are all covered by dedicated watchers with real
timeouts, never estimated-time waits. See `TOKENMAX-RELIABILITY.md`.

## Native commands

`/tokenmax-status`, `/tokenmax-models`, `/tokenmax-route`, `/tokenmax-stats`
are zero-LLM by default — structured/native UI only. A model is invoked
only when the user explicitly passes `--explain` or `--analyze`.

## Memory and skills

Layered scopes: Working, Session, Project, Global, Resource, and Procedural
(Skills) memory, behind a provider-agnostic interface
(`remember/search/update/forget/invalidate/promote/sync`) so no single
memory backend (Mem0, OpenMemory, Zep, TokenMax Cloud, ...) is load-bearing.
Memory answers "what do we know"; Skills answer "how do we do it" — skills
are versioned, provenance-tracked, and only created for genuinely
non-obvious, repeatable procedures, not duplicated freely. A redaction
layer sits in front of all of it: memory, telemetry, and logs must never
retain passwords, API keys, OAuth tokens, cookies, or authorization
headers.

## Desktop side-by-side identity

A TokenMax-enabled dev build must install, run, and uninstall alongside the
official OpenCode app without touching its install path, its user data, or
its config/session state. Concretely: distinct app id
(`ai.opencode.tokenmax.dev`), distinct product name
(`OpenCode TokenMax Dev`), distinct protocol scheme
(`opencode-tokenmax://`), and distinct writable state on every platform.
Auth/config may be one-time copied in for developer convenience, but never
shared as live writable state, and logging out of the dev build must never
log out the official one.

## Cloud sync (future)

Not "sync a SQLite file with Dropbox." A central authoritative store with
local caches, keyed by `user_id`/`project_id`/`device_id`/`version`, with
real conflict resolution and incremental sync — this is a later-phase
concern (see `TOKENMAX-ROADMAP.md`, R6) and is out of scope through R0–R5.
