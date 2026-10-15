# dsh-workspace-search

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
[![npm version](https://img.shields.io/npm/v/dsh-workspace-search)](https://www.npmjs.com/package/dsh-workspace-search)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

VS Code-style workspace keyword search for the DeepSeek Harness (dsh) web GUI,
registered as a **Search tab** inside
[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar).

<img width="734" height="238" alt="image" src="https://github.com/user-attachments/assets/0aceb14e-b4f5-4ab4-bf1e-72da35d147b9" />


- Keyword search across the session workspace: file **names** and file
  **contents**, grouped per file with line numbers
- VS Code-style search rules: **files to include / files to exclude** glob
  patterns (comma-separated, supports `**`, `*`, `?`, `{a,b}`), regular
  expression queries (`.*` toggle), and case toggle (`Aa`)
- Click a match to open the file in better-sidebar's built-in editor
- VS Code default excludes: hidden files, `.git`, `node_modules`, `dist`,
  `build`, `.next`, `target` etc. are skipped; caps on files, matches, and
  line length are reported honestly as truncation

## Install

```sh
dsh plugin --profile web add dsh-workspace-search@latest
```

`web` 换成你自己的 profile 名。装完硬刷新浏览器（Cmd/Ctrl+Shift+R）即可看到
Search tab（client 改动热加载；仅 host 半更新时需要重启 DSH）。

也可以把下面这段提示词发给任意一个 DSH 会话，让它自己装：

```
帮我安装 dsh-workspace-search 插件（dsh-better-sidebar 的工作区搜索 tab），步骤：

1. 执行 dsh plugin --profile web add dsh-workspace-search@latest
2. 完成后提醒我硬刷新浏览器（Cmd/Ctrl+Shift+R）
```

**前置**：`dsh-better-sidebar` ≥ 0.4.0（依赖它暴露的 `ctx.betterSidebar`
服务），建议直接用 npm 安装让 peer 依赖自动解析。

**从源码安装 / 开发（可选）**：

```sh
1. git clone https://github.com/AmmiWang/dsh-workspace-search.git
2. ~/.dsh/profiles/web/package.json 的 dependencies 写
   "dsh-workspace-search": "link:<克隆目录绝对路径>"
3. ~/.dsh/profiles/web/cordis.patch.yml 追加：
   - insert:
       - id: workspace-search
         name: dsh-workspace-search
         inject: [webServer]
4. 在 ~/.dsh/profiles/web 执行 pnpm install
5. 硬刷新浏览器
```

**更新**：`dsh plugin --profile web add dsh-workspace-search@latest`，或把
profile 里 `package.json` 的版本号改高后 `pnpm install`。

## Configuration

All fields optional (profile patch layer):

```yaml
- id: workspace-search
  config:
    maxFiles: 5000       # hard cap on files scanned per search
    maxMatches: 300      # hard cap on total content matches
    maxLineLength: 300   # hard cap on one reported line
    maxFileBytes: 1048576  # files above this skip the content scan
```

## How it works

Dual-face bundle. The host half registers a Connection RPC channel
`/workspace-search` (loopback trust fence, same as the built-in `/api`).
The browser half registers a tab through `ctx.betterSidebar.registerTab`.
Search results open in the sidebar editor via `openTab({type: 'editor'})`.

## License

MIT
