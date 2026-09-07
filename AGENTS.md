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
- **Page layout**: Tally owns a full-bleed `ThreeColumnLayout` shell
  (`data-plugin-fullbleed` on `(home)/layout.tsx`), which is the one case
  `docs/design-system.md` exempts from `PageContainer` — the columns pad
  their own content in their page CSS modules instead. Don't add
  `PageContainer` on top of that (it would double-pad), and keep every
  inset a `--sv-space-*` token.
- **Money is integer minor units ×100 everywhere** (`CurrencyInput`'s
  contract), formatted only through `formatMoney` (`Intl.NumberFormat`,
  ISO code display). Never `toFixed(2)` an amount in UI code.
- **Every ledger mutation goes through `runGuarded` + `requireGroupMember`
  (+ `requireGroupOpen` for writes)** in `app/_lib/membership.ts`, and
  multi-row writes run inside `db.transaction`. A closed group is
  read-only until an owner reopens it.
- **"Who owes whom" is mode-aware per group.** Always go through
  `counterpartiesForGroup` / `suggestedPaymentsForGroup` (`balances.ts`),
  never `resolveCounterparties` directly — they honour the group's
  `simplifyDebts` setting (off = pairwise, the default).
- **Account deletion (`deleteTallyData`) never removes ledger rows.** It
  ends the user's zero-balance memberships, promotes a successor owner
  where they were the only one, and deletes their settings row — see the
  comment block in `app/_lib/portability.ts`.
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
