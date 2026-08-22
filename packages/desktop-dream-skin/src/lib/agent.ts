import type { VFile } from "./workspace"

export type AgentFile = { path: string; content: string }

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; args: Record<string, string>; result: string; status: "ok" | "error" }

export type AgentRequest = {
  prompt: string
  history: { role: "user" | "assistant"; content: string }[]
  files: AgentFile[]
  mode: "build" | "plan"
  model: string
}

export type AgentResponse = { ok: true; events: AgentEvent[]; files: AgentFile[] } | { ok: false; error: string }

/** Local demo turn. Real coding goes through the connected OpenCode host. */
export async function runAgentTurn(data: AgentRequest): Promise<AgentResponse> {
  const mode = data.mode === "plan" ? "规划" : "构建"
  return {
    ok: true,
    events: [
      {
        type: "text",
        text: [
          `这是 Dream Skin 远程客户端的${mode}演示回复。`,
          "把官方 Dream Skin ZIP 丢进「皮肤」页即可嫁接；导出的 theme.json 也能给 OpenCode TUI / 桌面端 /theme 使用。",
          "连上 `opencode serve` 或 `opencode web` 之后，主题名、会话列表和工作区会按连接页的开关同步。",
        ].join("\n"),
      },
    ],
    files: data.files,
  }
}

export function filesToAgent(files: Record<string, VFile>): AgentFile[] {
  return Object.values(files).map((f) => ({ path: f.path, content: f.content }))
}
