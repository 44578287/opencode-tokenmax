import { decide, type DecideContext } from "./router"
import type { RouteDecision, Task } from "./types"

export function schedule(task: Task, ctx: DecideContext): RouteDecision | null {
  return decide(task, ctx)
}
