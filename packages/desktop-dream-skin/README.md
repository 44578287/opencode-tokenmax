# OpenCode Dream Skin

独立包，叠在官方 [anomalyco/opencode](https://github.com/anomalyco/opencode) 最新 `dev` 上。

不改 `packages/app` / `packages/desktop` / TUI。你之后把这个分支合并进自己的改动即可。

## 这包做什么

| 能力 | 说明 |
| --- | --- |
| **嫁接** | 官方 [Codex Dream Skin](https://github.com/Fei-Away/Codex-Dream-Skin) ZIP（`theme.json` + 壁纸 + 可选 `theme.css`）直接丢进皮肤工坊 |
| **转换** | Dream Skin → OpenCode `theme.json`（TUI / 桌面 / `opencode web` 都能 `/theme`） |
| **移动端** | 手机壳：会话 / 工作区 / 连接 / 皮肤，含 safe-area |
| **远程同步** | 连 `opencode serve` / `opencode web`：健康检查、会话列表、`PATCH /config` 主题名。完整壁纸/CSS 需要主机实现 `GET|PUT /dream-skin/sync` |

## 转换给官方 OpenCode 用

把 Dream Skin 包转成官方会读的 JSON，写到用户主题目录：

```bash
bun packages/desktop-dream-skin/src/cli.ts convert ./gothic-void-crusade.zip --install
```

默认写到 `~/.config/opencode/themes/<id>.json`。然后在 TUI 或桌面执行 `/theme`。

导出内置五套（Gothic Void Crusade / 夜雨楼台 / 朱门夜雨 / 金殿 / 巷雨）：

```bash
bun packages/desktop-dream-skin/src/cli.ts presets --install
```

只出文件、不安装：

```bash
bun packages/desktop-dream-skin/src/cli.ts convert ./pack.zip --out ./themes
```

## 远程客户端（含移动端）

```bash
bun install
bun run --cwd packages/desktop-dream-skin dev
```

浏览器打开提示的地址。手机宽度下是底栏四页，不是桌面三栏挤窄。

连真机：

1. 主机跑 `opencode serve` 或 `opencode web`
2. 客户端「连接」页填地址，可选 Basic 认证
3. 勾选要同步的：主题 / 会话 / 工作区

未实现 `/dream-skin/sync` 时，壁纸和 Safe CSS 只留在本客户端；主题 **名字** 仍会 `PATCH /config`。

## 目录

```
src/lib/theme/      适配器、ZIP、Safe CSS、导入导出
src/lib/remote/     演示主机 + 真远程 HTTP
src/components/app  桌面壳、移动壳、主题工坊、连接页
src/cli.ts          Dream Skin ↔ OpenCode theme.json
themes/             预导出的官方格式 JSON（presets）
```

Safe CSS 十二段：`root, sidebar, main, header, home, home-hero, project-list, thread, message, composer, composer-toolbar, dialog`。

不含桥本有菜等真人预设。
