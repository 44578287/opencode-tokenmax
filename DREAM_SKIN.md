# Dream Skin 嫁接（独立分支）

这个分支叠在官方 [anomalyco/opencode](https://github.com/anomalyco/opencode) 的 `dev` 上，**只新增** `packages/desktop-dream-skin/`，不改 `packages/app`、`packages/desktop`、TUI。

基线：本 fork 的 `dev`（`ba72a6ff`，官方线 2026-08-21）。上游此刻是 `3a31c4ea`（2026-08-22）。合并前请先把本分支 rebase / merge 到你要的最新官方 `dev`。

不含桥本有菜等真人预设。壁纸请丢官方 Dream Skin ZIP，仓库里不提交大图。

## 包做什么

| 能力 | 说明 |
| --- | --- |
| 嫁接 | 官方 [Codex Dream Skin](https://github.com/Fei-Away/Codex-Dream-Skin) ZIP（`theme.json` + 壁纸 + 可选 `theme.css` / `manifest.json`）丢进皮肤工坊 |
| 转换 | Dream Skin → OpenCode `theme.json`，TUI / 桌面 / `opencode web` 都能 `/theme` |
| 移动端 | 独立手机壳（会话 / 工作区 / 连接 / 皮肤），含 safe-area，不是桌面三栏挤窄 |
| 远程同步 | 连 `opencode serve` / `opencode web`：健康检查、会话、`PATCH /config` 主题名。完整壁纸/CSS 需要主机实现 `GET|PUT /dream-skin/sync` |

## 怎么跑

```bash
bun install
bun --cwd packages/desktop-dream-skin dev
```

转换并安装到用户主题目录：

```bash
bun packages/desktop-dream-skin/src/cli.ts convert ./pack.zip --install
bun packages/desktop-dream-skin/src/cli.ts presets --install
```

默认写入 `~/.config/opencode/themes/<id>.json`。

## 合并建议

1. 不要从 `tokenmax/main` 或旧的 `desktop-dream-skin` 分支来。
2. 本分支可直接 merge / rebase 进你的工作分支。
3. 根 `package.json` 没改，避免和官方脚本冲突。需要的话自己加一行：

```json
"dev:dream-skin": "bun --cwd packages/desktop-dream-skin dev"
```

工作区是 `packages/*`，这个新包会自动进 bun workspaces。
