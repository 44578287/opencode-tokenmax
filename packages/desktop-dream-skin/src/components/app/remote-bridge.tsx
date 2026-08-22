import { useEffect, useRef } from "react";
import { useApp } from "@/lib/store";
import { probeConnection, pullBundle, pushBundle } from "@/lib/remote/client";
import { mergeBundles, slimBundle } from "@/lib/remote/merge";

export async function runSync(direction: "pull" | "push" | "boot") {
  const state = useApp.getState();
  if (state.connection.kind === "offline") return;
  state.setSyncing(true);
  try {
    const health = await probeConnection(state.connection);
    state.setHost(health);
    if (!health.ok) {
      state.markSynced(health.error ?? "未连接");
      return;
    }
    if (direction === "push") {
      await pushBundle(state.connection, slimBundle(state.snapshot(), state.syncFlags));
      state.markSynced(`已推送到 ${health.label}`);
      return;
    }
    const remote = await pullBundle(state.connection);
    const merged = mergeBundles(state.snapshot(), remote, state.syncFlags);
    useApp.getState().applyBundle(merged.bundle);
    if (direction === "boot") {
      await pushBundle(state.connection, slimBundle(useApp.getState().snapshot(), state.syncFlags));
    }
    state.markSynced(merged.notes[0] ?? `已与 ${health.label} 同步`);
  } catch (err) {
    state.setHost({
      ok: false,
      kind: state.connection.kind,
      version: "",
      label: state.connection.kind === "demo" ? "演示主机" : state.connection.url,
      error: err instanceof Error ? err.message : "同步失败",
    });
    state.markSynced(err instanceof Error ? err.message : "同步失败");
  }
}

export function RemoteBridge() {
  const connection = useApp((s) => s.connection);
  const themeId = useApp((s) => s.themeId);
  const appearance = useApp((s) => s.appearance);
  const localRevisedAt = useApp((s) => s.localRevisedAt);
  const applying = useRef(false);
  const timer = useRef<number | null>(null);
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    applying.current = true;
    void runSync("boot").finally(() => {
      applying.current = false;
    });
  }, []);

  useEffect(() => {
    if (!booted.current || applying.current) return;
    if (connection.kind === "offline") return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void runSync("push");
    }, 700);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [themeId, appearance, localRevisedAt, connection.kind, connection.url]);

  return null;
}
