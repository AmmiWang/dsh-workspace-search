# Changelog

All notable changes to this project are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

[0.1.0]: https://github.com/AmmiWang/dsh-workspace-search/releases/tag/v0.1.0
