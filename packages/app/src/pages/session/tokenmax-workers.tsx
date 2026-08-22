import { For, Show, createMemo, createResource, onCleanup } from "solid-js"
import { ServerConnection, useServer } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"

type Worker = {
  id: string
  parentSessionID: string
  childSessionID: string
  role: string
  provider: string
  model: string
  variant: string
  billing?: string
  progress?: string
  state: string
  fallbackFrom: string | null
  errorCategory: string | null
}

type Operation = {
  id: string
  type: string
  ownerSessionID: string | null
  state: string
  activeHandle: string | null
  lastProgressAt: string
}

function icon(state: string) {
  if (state === "completed") return "✓"
  if (state === "running" || state === "queued") return "●"
  if (state === "failed") return "!"
  return "↻"
}

export function TokenMaxWorkersBanner(props: { parentSessionID: string; onOpen: (childId: string) => void }) {
  const server = useServer()
  const conn = createMemo(() => server.list.find((item) => ServerConnection.key(item) === server.key))
  const [data, { refetch }] = createResource(
    () => props.parentSessionID,
    async (parent) => {
      const http = conn()?.http
      if (!http?.url) return { workers: [] as Worker[], operations: [] as Operation[] }
      const headers: Record<string, string> = {}
      if (http.password) {
        headers.Authorization = `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}`
      }
      const base = http.url.endsWith("/") ? http.url : `${http.url}/`
      const [workerResult, operationResult] = await Promise.all([
        fetch(new URL("/tokenmax/workers", base), { headers }),
        fetch(new URL("/tokenmax/operations", base), { headers }),
      ])
      const workers = workerResult.ok ? (((await workerResult.json()) as { workers?: Worker[] }).workers ?? []) : []
      const operations = operationResult.ok
        ? (((await operationResult.json()) as { operations?: Operation[] }).operations ?? [])
        : []
      return {
        workers: workers.filter((w) => w.parentSessionID === parent),
        operations: operations.filter((operation) => operation.ownerSessionID === parent),
      }
    },
  )
  const timer = setInterval(() => refetch(), 2000)
  onCleanup(() => clearInterval(timer))

  return (
    <Show when={(data()?.workers ?? []).length > 0 || (data()?.operations ?? []).length > 0}>
      <div
        data-component="tokenmax-workers"
        class="mx-4 mb-2 rounded-[8px] border border-[color-mix(in_oklch,var(--v2-text-text-base)_12%,transparent)] px-3 py-2 text-[12px] leading-5"
      >
        <div class="font-[530] mb-1">TokenMax · {(data()?.workers ?? []).length} workers</div>
        <For each={data()?.workers ?? []}>
          {(w) => (
            <div class="flex items-center gap-2 py-0.5">
              <span>{icon(w.state)}</span>
              <span class="capitalize">{w.role}</span>
              <span class="text-text-weak truncate">
                {w.provider}/{w.model}
                {w.variant ? `#${w.variant}` : ""} · {w.billing ?? ""}
              </span>
              <Show when={w.fallbackFrom}>
                <span class="text-text-weak">↻ fallback</span>
              </Show>
              <Show when={w.errorCategory}>
                <span>{w.errorCategory}</span>
              </Show>
              <Show when={w.childSessionID}>
                <button type="button" class="underline" onClick={() => props.onOpen(w.childSessionID)}>
                  打开
                </button>
              </Show>
            </div>
          )}
        </For>
        <For each={(data()?.operations ?? []).filter((operation) => !["COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED"].includes(operation.state))}>
          {(operation) => (
            <div class="flex items-center gap-2 py-0.5 text-text-weak">
              <span>◌</span>
              <span>Waiting · {operation.type}</span>
              <span class="truncate">{operation.activeHandle ?? operation.id}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
