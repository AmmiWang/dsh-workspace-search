# Changelog

All notable changes to this project are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

[0.1.1]: https://github.com/AmmiWang/dsh-workspace-search/releases/tag/v0.1.1
[0.1.0]: https://github.com/AmmiWang/dsh-workspace-search/releases/tag/v0.1.0
