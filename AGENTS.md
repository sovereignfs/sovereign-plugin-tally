# AGENTS.md — Tally

A Sovereign plugin (`fs.sovereign.tally`). This file is the canonical, agent-agnostic
guidance for working in this repository — see CLAUDE.md, which points here.

## What this is

Sovereign plugins are installable apps hosted by the Sovereign platform. This
plugin was scaffolded by `sv plugin new` / `npm create @sovereignfs/plugin`.
Full plugin development docs:
https://github.com/sovereignfs/sovereign/blob/main/docs/plugin-development.md

## Hard rules

- **SDK boundary**: import platform capabilities (auth, db, storage, etc.)
  only from `@sovereignfs/sdk`. Never reach into the host runtime's
  internals — this plugin runs inside the Sovereign platform, not standalone.
- **Design system**: use `@sovereignfs/ui` components and `--sv-*` CSS
  custom properties. Never hardcode colors — reference semantic tokens
  (`--sv-color-*`) so dark mode and instance theming work automatically.
- **Page layout**: wrap page content in `PageContainer` from
  `@sovereignfs/ui` for gutter/max-width — don't add local
  `padding`/`max-width` in `app/layout.tsx` or page CSS modules; that
  double-pads.
- **`manifest.json` is the source of truth for version**: bump `version`
  there, not in `package.json` — `package.json`'s `version` is unused
  workspace-tooling scaffolding and should stay `0.0.0`.
- **Permissions**: declare every platform capability this plugin needs in
  `manifest.json`'s `permissions` array — undeclared capabilities are
  denied at runtime.

## Structure

- `manifest.json` — plugin identity, permissions, routing (source of truth)
- `app/` — Next.js App Router page tree, composed into the host platform
- `package.json` — workspace tooling (deps/scripts) only
