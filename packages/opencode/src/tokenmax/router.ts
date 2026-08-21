import type { Route, RouteDecision, Task } from "./types"
import { routeKey } from "./types"
import type { TokenMaxPolicy } from "./policy.seed"
import { POLICY_SEED } from "./policy.seed"

export interface DecideContext {
  enabled: boolean
  routes: Route[]
  policy?: TokenMaxPolicy
}

export function decide(task: Task, ctx: DecideContext): RouteDecision | null {
  if (!ctx.enabled) return null
  const policy = ctx.policy ?? POLICY_SEED
  const required = task.requiredSuccess ?? policy.scoring.requiredSuccess
  const scored = ctx.routes
    .map((route) => {
      const capabilityFit = route.health
      const historicalConfidence = 0
      const quotaPressure = route.quotaPressure
      const estimatedMarginalCost =
        route.billing === "PAYG_TOKEN" && route.inputPerMtok != null
          ? route.inputPerMtok
          : route.billing === "FREE" || route.billing === "LOCAL"
            ? 0
            : null
      const quality = capabilityFit
      const miss = Math.max(0, required - quality)
      const money = estimatedMarginalCost ?? 0
      const score = quality - miss * policy.scoring.missPenalty - money * policy.scoring.moneyWeight
      const reason = `utility quality=${quality.toFixed(2)} billing=${route.billing} variant=${route.variant || "default"}`
      return {
        route,
        score,
        decision: {
          provider: route.providerId,
          model: route.modelId,
          variant: route.variant,
          billing: route.billing,
          capabilityFit,
          historicalConfidence,
          providerHealth: route.health,
          quotaPressure,
          estimatedMarginalCost,
          reason,
          key: routeKey(route.providerId, route.modelId, route.variant),
        } satisfies RouteDecision,
      }
    })
    .sort((a, b) => b.score - a.score)
  return scored[0]?.decision ?? null
}
