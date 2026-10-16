# Changelog

All notable changes to this project are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.3] - 2026-10-15

### Added

- Match highlighting: every occurrence of the query inside a match line (and
  inside a matched file name) renders highlighted, in both plain and regular
  expression modes, honoring the case toggle.
- Clicking a match line now opens the file in better-sidebar's editor AND
  jumps to that line via `openTab({ type: "editor", path, line })` — the
  seed's `line` is a native 1-based editor navigation, so no workaround is
  needed. Clicking the file row opens the file without a line target;
  expanding/collapsing moved to the caret control.

## [0.1.2] - 2026-10-15

### Changed

- Search results now default to fully expanded (VS Code search behavior).
  Per-file collapse state is remembered only after the user manually toggles
  it; a fresh search resets every group to open.
- `node_modules` is no longer hard-skipped by the host walker. It is now
  excluded via the client's default exclude pattern (`node_modules` in the
  exclude box), so clearing the box searches vendored trees. A bare
  directory name in the exclude box now excludes same-named directories at
  any depth (VS Code semantics), not just top-level ones.

## [0.1.1] - 2026-10-15

### Fixed

- Host half failed to activate with `cannot get property "webServer" without
  inject`: `connection.rpc.handle()` rebinds the route-registration owner to
  dsh-client-connection's own fiber (inject `["credentials"]` only), so
  out-of-tree bundles can never register a channel route through it. The host
  half now serves `POST /workspace-search/search` as a plain webServer prefix
  route — the same pattern as dsh-side-panel and dsh-better-sidebar — with a
  loopback/origin trust fence, and the client half talks to it with
  same-origin `fetch` instead of `connection.rpc.call`. The browser symptom
  was `transport failure for /workspace-search/search: HTTP 405`.
- Dropped the unused `@deepseek-ai/cordis` peer dependency; the client half no
  longer depends on the `connection` service.

## [0.1.0] - 2026-10-15

### Added

- VS Code-style workspace keyword search for the dsh web GUI, registered as a
  Search tab inside `dsh-better-sidebar` (`ctx.betterSidebar.registerTab`).
- Host half: `/workspace-search` RPC channel (`search` endpoint) on the
  Connection's generic RPC registry, loopback authority.
- Search rules: file names and file contents, per-file grouped matches with
  line numbers; include/exclude glob patterns (`**`, `*`, `?`, `{a,b}`),
  regular-expression queries, case toggle; VS Code default excludes
  (hidden files, `.git`, `node_modules`, `dist`, `build`, `.next`, `target`).
- Honest truncation reporting: hard caps on scanned files, total matches, and
  reported line length, surfaced to the client.
- Click a match to open the file in better-sidebar's built-in editor.
- Configurable limits: `maxFiles`, `maxMatches`, `maxLineLength`,
  `maxFileBytes`.

[0.1.3]: https://github.com/AmmiWang/dsh-workspace-search/releases/tag/v0.1.3
[0.1.2]: https://github.com/AmmiWang/dsh-workspace-search/releases/tag/v0.1.2
[0.1.1]: https://github.com/AmmiWang/dsh-workspace-search/releases/tag/v0.1.1
[0.1.0]: https://github.com/AmmiWang/dsh-workspace-search/releases/tag/v0.1.0
