# TokenMax Architecture

TokenMax is a **native OpenCode Core scheduler**, not a plugin wrapper.

This fork (`opencode-tokenmax`) implements multi-agent / multi-model dispatch inside OpenCode so Desktop users talk to one primary agent while the scheduler:

- discovers every connected provider, model, and reasoning variant
- routes work to the cheapest route that can still succeed
- uses child sessions for parallel workers
- keeps the ROOT session on the model the user picked in the UI
- fails over on 429 / quota / 5xx without burning PAYG by default

## Optimization objective

Not a fixed ladder `FREE → SUBSCRIPTION → PAYG`.

**Maximize capability, throughput, and speed under a quality bar, while minimizing new cash spend and quota waste.**

Every route (provider + model + reasoning variant) is scored together:

| Factor | Role |
| --- | --- |
| Task type / complexity | Required success probability |
| Route capability (prior + benchmark + history) | Can this route finish this class of work |
| Historical success (EMA) | Recent real work outweighs stale benchmark |
| Reasoning variant | Same model, different cost/success |
| Monetary cost | Only real cash (PAYG). Subscription list price is not cash. |
| Quota remaining + time-to-reset | High remaining + soon reset → use it. Low remaining + far reset → save for hard tasks |
| Latency / concurrency | Prefer faster routes when quality is equal |
| Availability / health | 429/5xx/auth are provider failures, not intelligence |

PAYG is allowed only when budget remains **and** it clearly raises success or speed versus the best non-PAYG option (or no non-PAYG route meets the quality bar). Default budgets are `0`.

## Route = provider × model × variant

Do not treat `provider/model` as the only entity. `opencode/hy3-free`, `opencode/hy3-free#high`, and `xai/grok-4.6#high` are different RouteProfiles.

Variants come from the live OpenCode catalog. Never assume every model has `low/medium/high/xhigh`.

## Zero-config discovery

TokenMax reads OpenCode’s connected catalog. New providers appear without a hand-maintained model pool.

Availability evidence is provider-shaped:

- API providers: official `/models` + runtime catalog + invocation
- OAuth/subscription: runtime catalog + auth session + invocation

States: `CATALOG_ONLY`, `PROVIDER_LISTED`, `VERIFIED_CALLABLE`, `VERIFIED_STALE`, `TEMP_UNAVAILABLE`, `MODEL_NOT_FOUND`, `STALE`.

`$0` cost → monetary FREE. Unknown cost stays `UNKNOWN`. Never invent remaining quota.

## Capability layers

1. **Prior** (low weight): family, tools, vision, context, pricing
2. **Mini-benchmark** (medium, decaying): objective fixtures, cheap on free routes, tiny on paid
3. **Real work history** (highest): success, retries, tests, latency, tokens, infra vs capability

No single IQ score. Per-class portraits: search, tool_calling, simple_code, debugging, architecture, …

Infra errors (`429`, `5xx`, timeout, auth, permission) must not lower capability EMA.

## Dispatch model

```
ROOT  = user-selected UI model (never rewritten for ordinary routing)
  ├─ child session  tokenmax-search   (catalog route)
  ├─ child session  tokenmax-exec     (catalog route)
  └─ child session  tokenmax-verify   (catalog route)
```

Ordinary routing **must** create real `parentID` child sessions (or native `subtask` / Task tool parts so Desktop shows the tree). ROOT failover is separate: only when the ROOT model itself hits 429/quota/5xx.

Short tasks: one child, no pipeline overhead.  
Long tasks: split, parallel children, checkpoint, replan, failover.

Strong models plan; cheap/free models do mechanical work.

## Persistence

SQLite under the OpenCode data dir. Schema migrations. Objectives, checkpoints, attempts, pipelines, usage, overrides.

On Desktop restart: unfinished objectives resume from **filesystem/git reality**, not stale checkpoints.

## Commands (deterministic)

`/tokenmax-status`, `/tokenmax-models`, `/tokenmax-stats`, `/tokenmax-route` compute from the DB. Default: **0 LLM calls**. `--analyze` / `--explain` may use a cheap model.

Never mutate the user’s original message to inject status.

## Privacy

Local telemetry only: model id, variant, timing, tokens, success, cost estimate, error class. No prompts, source, secrets, or repo content leave the machine via TokenMax.

## Non-goals

- Second credential store
- Forking or patching `oh-my-openagent` to implement TokenMax
- Hard-coding model pools
- Treating GitHub Copilot as missing just because it has no public `/v1/models`
