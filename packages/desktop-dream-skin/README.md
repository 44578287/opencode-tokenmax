# OpenCode Desktop Dream Skin

独立 Web 客户端：把 [Codex Dream Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 主题包接到 OpenCode，桌面 IDE + 移动端远程壳。

放在 `packages/desktop-dream-skin/`，**不改** OpenCode 的 `dev` / `main`，也不覆盖 `packages/desktop` / `packages/app`。

## 这版做什么

- **嫁接**：官方 Dream Skin ZIP（`theme.json` + `background.webp|jpg|png` + 可选 `theme.css` / `manifest.json`）直接丢进主题工坊
- **转换**：Dream Skin ↔ OpenCode `theme.json` 双向；Safe CSS 十二段（`root, sidebar, main, header, home, home-hero, project-list, thread, message, composer, composer-toolbar, dialog`）
- **移动端**：独立壳（会话 / 工作区 / 连接 / 皮肤），不是桌面布局挤窄
- **远程同步**：演示主机全量（主题 + 会话 + 工作区文件）；真机 `opencode serve` / `opencode web` 走健康检查、会话列表、`PATCH /config` 主题名。完整壁纸/CSS 需要主机实现 `GET|PUT /dream-skin/sync`

Auth / 数据库关闭。默认皮肤：Gothic Void Crusade（不含桥本有菜）。

## 本地跑

```bash
cd packages/desktop-dream-skin
npm install
npm run dev
```

浏览器打开开发服务器。主题工坊可导入官方 ZIP，或导出 OpenCode JSON / Dream Skin ZIP。

## 接到真 OpenCode 主机

1. 本机或远端跑 `opencode serve`（或 `opencode web`）
2. 客户端「连接」页填主机地址；可选 Basic 认证
3. 勾选要同步的：主题 / 会话 / 工作区
4. 未实现 `/dream-skin/sync` 时，壁纸与 Safe CSS 只留在本客户端

## 目录

```
src/lib/theme/     适配器、ZIP、Safe CSS、导入导出
src/lib/remote/    演示主机 + 真远程 HTTP
src/components/app 桌面壳、移动壳、主题工坊、连接页
public/dream-skin/ 五套示例壁纸（本分支若缺图，丢官方包即可）
```

本包是 App Builder 独立 UI，不是 anomalyco/opencode 桌面端的替换件。
