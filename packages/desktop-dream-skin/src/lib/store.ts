import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "./utils";
import { seedFiles, type VFile } from "./workspace";
import { DEFAULT_THEME_ID, DREAM_SKIN_CATALOG, THEME_CATALOG, type Appearance, type CatalogEntry, type OpenCodeThemeFile } from "./theme";
import {
  DEFAULT_CONNECTION,
  DEFAULT_SYNC_FLAGS,
  type Connection,
  type HostHealth,
  type SyncBundle,
  type SyncFlags,
} from "./remote/types";

export type AgentMode = "build" | "plan";
export type RailId = "sessions" | "files" | "search" | "git";
export type RightView = "editor" | "diff";
export type MobileTab = "chat" | "workspace" | "link" | "skin";

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, string>;
  result?: string;
  status: "running" | "ok" | "error";
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  tools?: ToolCall[];
  createdAt: number;
};

export type Session = {
  id: string;
  title: string;
  mode: AgentMode;
  model: string;
  status: "idle" | "running" | "error";
  messages: ChatMessage[];
  updatedAt: number;
};

export type CustomTheme = CatalogEntry;

export const MODELS = [
  { id: "default", label: "主机默认", hint: "跟随远程 OpenCode" },
  { id: "fast", label: "快速", hint: "更短回复" },
] as const;

const SEED_VERSION = 5;

function demoSessions(): Session[] {
  const now = Date.now();
  return [
    {
      id: "sess-logger",
      title: "给 logger 加上请求耗时",
      mode: "build",
      model: "default",
      status: "idle",
      updatedAt: now - 1000 * 60 * 12,
      messages: [
        {
          id: "m1",
          role: "user",
          content: "给 harbor 的 logger 中间件补上请求耗时，并在 README 里提一句。",
          createdAt: now - 1000 * 60 * 14,
        },
        {
          id: "m2",
          role: "assistant",
          content: "先看现有中间件和入口，确认现在怎么打日志。",
          tools: [
            {
              id: "t1",
              name: "read_file",
              args: { path: "harbor/src/middleware/logger.ts" },
              result: "8 行 · 已读取",
              status: "ok",
            },
            {
              id: "t2",
              name: "read_file",
              args: { path: "harbor/src/index.ts" },
              result: "16 行 · 已读取",
              status: "ok",
            },
          ],
          createdAt: now - 1000 * 60 * 13,
        },
        {
          id: "m3",
          role: "assistant",
          content:
            "已在 `logger` 里记录 `Date.now()` 差值，并在 README 的 Scripts 下补了一句约定。构建模式直接改了工作区文件，右侧差异里可以核对。",
          tools: [
            {
              id: "t3",
              name: "write_file",
              args: { path: "harbor/src/middleware/logger.ts" },
              result: "已写入 · +2 / −1",
              status: "ok",
            },
            {
              id: "t4",
              name: "write_file",
              args: { path: "harbor/README.md" },
              result: "已写入 · +1",
              status: "ok",
            },
          ],
          createdAt: now - 1000 * 60 * 12,
        },
      ],
    },
    {
      id: "sess-new",
      title: "新会话",
      mode: "plan",
      model: "default",
      status: "idle",
      updatedAt: now,
      messages: [],
    },
  ];
}

function demoFiles(): Record<string, VFile> {
  const files = seedFiles();
  files["harbor/src/middleware/logger.ts"] = {
    ...files["harbor/src/middleware/logger.ts"],
    content: `import type { Middleware } from "../types.ts";\n\nexport const logger: Middleware = async (req, _res, next) => {\n  const start = Date.now();\n  await next();\n  const ms = Date.now() - start;\n  console.log(\`\${req.method} \${req.url} \${ms}ms\`);\n};\n`,
  };
  files["harbor/README.md"] = {
    ...files["harbor/README.md"],
    content: `# Harbor\n\nA tiny TypeScript HTTP router. Used as the OpenCode desktop workspace.\n\n## Scripts\n\n- \`npm test\` — run unit tests\n- \`npm run dev\` — start the sample server\n\nLogger prints method, URL, and elapsed milliseconds per request.\n`,
  };
  return files;
}

function bump(set: (partial: Partial<AppState>) => void, extra: Partial<AppState> = {}) {
  set({ localRevisedAt: Date.now(), ...extra });
}

type AppState = {
  seedVersion: number;
  themeId: string;
  appearance: Appearance;
  customThemes: CustomTheme[];
  sessions: Session[];
  activeSessionId: string;
  files: Record<string, VFile>;
  openFile: string;
  rail: RailId;
  rightView: RightView;
  commandOpen: boolean;
  themeOpen: boolean;
  settingsOpen: boolean;
  terminalOpen: boolean;
  mobileTab: MobileTab;
  searchQuery: string;
  connection: Connection;
  syncFlags: SyncFlags;
  host: HostHealth | null;
  lastSyncAt: number | null;
  lastSyncNote: string | null;
  localRevisedAt: number;
  syncing: boolean;
  setTheme: (id: string) => void;
  setAppearance: (a: Appearance) => void;
  addCustomTheme: (theme: CustomTheme) => void;
  setRail: (rail: RailId) => void;
  setRightView: (view: RightView) => void;
  setMobileTab: (tab: MobileTab) => void;
  setCommandOpen: (open: boolean) => void;
  setThemeOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setTerminalOpen: (open: boolean) => void;
  setSearchQuery: (q: string) => void;
  setOpenFile: (path: string) => void;
  setFileContent: (path: string, content: string) => void;
  applyFiles: (next: Record<string, VFile>) => void;
  setActiveSession: (id: string) => void;
  newSession: () => void;
  closeSession: (id: string) => void;
  patchSession: (id: string, patch: Partial<Session>) => void;
  appendMessage: (sessionId: string, message: ChatMessage) => void;
  replaceMessage: (sessionId: string, message: ChatMessage) => void;
  setMode: (mode: AgentMode) => void;
  setModel: (model: string) => void;
  setConnection: (patch: Partial<Connection>) => void;
  setSyncFlags: (patch: Partial<SyncFlags>) => void;
  setHost: (host: HostHealth | null) => void;
  setSyncing: (syncing: boolean) => void;
  markSynced: (note: string) => void;
  applyBundle: (bundle: SyncBundle) => void;
  snapshot: () => SyncBundle;
  touch: () => void;
};

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      seedVersion: SEED_VERSION,
      themeId: DEFAULT_THEME_ID,
      appearance: "dark",
      customThemes: [],
      sessions: demoSessions(),
      activeSessionId: "sess-new",
      files: demoFiles(),
      openFile: "harbor/src/middleware/logger.ts",
      rail: "sessions",
      rightView: "diff",
      commandOpen: false,
      themeOpen: false,
      settingsOpen: false,
      terminalOpen: false,
      mobileTab: "chat",
      searchQuery: "",
      connection: DEFAULT_CONNECTION,
      syncFlags: DEFAULT_SYNC_FLAGS,
      host: null,
      lastSyncAt: null,
      lastSyncNote: null,
      localRevisedAt: Date.now(),
      syncing: false,
      setTheme: (id) => {
        const catalog = [...get().customThemes, ...DREAM_SKIN_CATALOG, ...THEME_CATALOG];
        const next = catalog.find((t) => t.id === id);
        if (!next) {
          bump(set, { themeId: id });
          return;
        }
        if (next.appearance === "dark") bump(set, { themeId: id, appearance: "dark" });
        else if (next.appearance === "light") bump(set, { themeId: id, appearance: "light" });
        else bump(set, { themeId: id });
      },
      setAppearance: (appearance) => bump(set, { appearance }),
      addCustomTheme: (theme) => {
        const next: Partial<AppState> = {
          customThemes: [theme, ...get().customThemes.filter((t) => t.id !== theme.id)],
          themeId: theme.id,
        };
        if (theme.appearance === "dark") next.appearance = "dark";
        else if (theme.appearance === "light") next.appearance = "light";
        bump(set, next);
      },
      setRail: (rail) => set({ rail }),
      setRightView: (rightView) => set({ rightView }),
      setMobileTab: (mobileTab) => set({ mobileTab }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      setThemeOpen: (themeOpen) => set({ themeOpen }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setOpenFile: (openFile) => set({ openFile, rightView: "editor" }),
      setFileContent: (path, content) =>
        bump(set, {
          files: { ...get().files, [path]: { ...get().files[path], path, content, original: get().files[path]?.original ?? content } },
        }),
      applyFiles: (next) => bump(set, { files: next }),
      setActiveSession: (activeSessionId) => set({ activeSessionId }),
      newSession: () => {
        const session: Session = {
          id: uid("sess"),
          title: "新会话",
          mode: get().sessions.find((s) => s.id === get().activeSessionId)?.mode ?? "build",
          model: get().sessions.find((s) => s.id === get().activeSessionId)?.model ?? "default",
          status: "idle",
          messages: [],
          updatedAt: Date.now(),
        };
        bump(set, { sessions: [session, ...get().sessions], activeSessionId: session.id });
      },
      closeSession: (id) => {
        const next = get().sessions.filter((s) => s.id !== id);
        const sessions = next.length ? next : demoSessions().slice(1);
        const activeSessionId = get().activeSessionId === id ? sessions[0].id : get().activeSessionId;
        bump(set, { sessions, activeSessionId });
      },
      patchSession: (id, patch) =>
        bump(set, {
          sessions: get().sessions.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s)),
        }),
      appendMessage: (sessionId, message) =>
        bump(set, {
          sessions: get().sessions.map((s) =>
            s.id === sessionId ? { ...s, messages: [...s.messages, message], updatedAt: Date.now() } : s,
          ),
        }),
      replaceMessage: (sessionId, message) =>
        bump(set, {
          sessions: get().sessions.map((s) =>
            s.id === sessionId
              ? { ...s, messages: s.messages.map((m) => (m.id === message.id ? message : m)), updatedAt: Date.now() }
              : s,
          ),
        }),
      setMode: (mode) => {
        const id = get().activeSessionId;
        bump(set, { sessions: get().sessions.map((s) => (s.id === id ? { ...s, mode } : s)) });
      },
      setModel: (model) => {
        const id = get().activeSessionId;
        bump(set, { sessions: get().sessions.map((s) => (s.id === id ? { ...s, model } : s)) });
      },
      setConnection: (patch) => set({ connection: { ...get().connection, ...patch } }),
      setSyncFlags: (patch) => set({ syncFlags: { ...get().syncFlags, ...patch } }),
      setHost: (host) => set({ host }),
      setSyncing: (syncing) => set({ syncing }),
      markSynced: (note) => set({ lastSyncAt: Date.now(), lastSyncNote: note, syncing: false }),
      applyBundle: (bundle) =>
        set({
          themeId: bundle.themeId || get().themeId,
          appearance: bundle.appearance || get().appearance,
          customThemes: bundle.customThemes ?? get().customThemes,
          sessions: (bundle.sessions as Session[]) || get().sessions,
          activeSessionId: bundle.activeSessionId || get().activeSessionId,
          files: bundle.files && Object.keys(bundle.files).length ? bundle.files : get().files,
          localRevisedAt: bundle.updatedAt,
        }),
      snapshot: () => ({
        version: 1,
        updatedAt: get().localRevisedAt,
        themeId: get().themeId,
        appearance: get().appearance,
        customThemes: get().customThemes,
        sessions: get().sessions,
        activeSessionId: get().activeSessionId,
        files: get().files,
      }),
      touch: () => bump(set),
    }),
    {
      name: "opencode-desktop-v5",
      partialize: (s) => ({
        themeId: s.themeId,
        appearance: s.appearance,
        customThemes: s.customThemes,
        sessions: s.sessions,
        activeSessionId: s.activeSessionId,
        connection: { ...s.connection, password: s.connection.kind === "remote" ? s.connection.password : "" },
        syncFlags: s.syncFlags,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<AppState> | undefined;
        if (!p) return current;
        return {
          ...current,
          themeId: p.themeId ?? current.themeId,
          appearance: p.appearance ?? current.appearance,
          customThemes: p.customThemes ?? current.customThemes,
          sessions: p.sessions?.length ? p.sessions : current.sessions,
          activeSessionId: p.activeSessionId ?? current.activeSessionId,
          connection: p.connection ?? current.connection,
          syncFlags: p.syncFlags ?? current.syncFlags,
        };
      },
    },
  ),
);

export function allThemes(): CatalogEntry[] {
  const custom = useApp.getState().customThemes;
  return [...custom, ...DREAM_SKIN_CATALOG, ...THEME_CATALOG];
}

export function findTheme(id: string): CatalogEntry {
  return allThemes().find((t) => t.id === id) ?? DREAM_SKIN_CATALOG[0];
}

export function fileFromCatalog(id: string): OpenCodeThemeFile {
  return findTheme(id).file;
}
