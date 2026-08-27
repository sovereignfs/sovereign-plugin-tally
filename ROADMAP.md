# Roadmap — Tally

Full requirements, data model, and screen design live in the spec docs
(`CONCEPT.md`, `SPEC.md`, `UI-FLOW.md`); **this doc is the source of truth
for build order and status.**

Status legend: 📋 not started · 🚧 in progress · ✅ shipped

Each task is sized to be one branch + one PR, per the platform's own "one
task = one branch = one PR" convention (once this plugin has a real repo —
see `SPEC.md` §11's naming/collision item). Tasks are sequenced — assume
each depends on the previous unless noted otherwise.

---

## MVP

| # | Task | Spec ref | Depends on | Status |
| - | ---- | -------- | ---------- | ------ |
| 1 | **Scaffold** — `manifest.json`, `package.json`, `icon.svg`, canonical `sv plugin new` skeleton, manifest hand-aligned to `SPEC.md` §2 (permissions, `group-owner`/`group-member` capabilities+roles, `shellConfig.mobileFooter: false`) | Manifest & permissions | — | ✅ |
| 2 | **Data model + migrations** — `app/_db/schema.ts` (sqlite-core, source of truth) + `app/_db/schema.postgres.ts` (pg-core mirror, `bigint` timestamps) for `groups`/`group_members`/`expenses`/`expense_payers`/`expense_splits`/`settlements`/`user_settings`; `drizzle-kit generate` for both dialects, `public.` FK-qualifier stripped per `docs/plugin-database.md`. Schema location corrected mid-task (task 6) to `app/_db/`, not the top-level `db/` originally used. | SPEC.md §3 | Task 1 | ✅ |
| 3 | **Core lib** — `app/_lib/balances.ts` (`netBalanceCents`, cross-group rollup, debt simplification, category/monthly aggregations), `app/_lib/rounding.ts` (deterministic remainder distribution), `app/_lib/ids.ts`. Unit tests (`vitest`) caught a real bug before it shipped: settlement `fromMemberId`/`toMemberId` signs were reversed, which would have made "settling up" widen the gap between two balances instead of closing it. | SPEC.md §4 | Task 2 | ✅ |
| 4 | **Authorization** — `app/_lib/membership.ts`'s `resolveGroupRole`/`requireGroupMember`/`requireGroupManage`/`hasOtherActiveOwner`/`hasNonZeroBalance`, `app/_lib/group-rules.ts`'s pure `GroupMemberRole`/`canManageGroup`. Corrected against real precedent before building: `sdk.authz`'s resource-grant mechanism is real but unused by any sibling plugin — Docs/Sheets both resolve roles via a direct query against their own membership table instead, so this does too. | SPEC.md §5 | Task 3 | ✅ |
| 5 | **Layout shell** — `app/(home)/layout.tsx` (`ThreeColumnLayout` + `TallySidebar`: Overview/Groups/People/Inbox nav, Settings pinned bottom), `@detail` parallel route for the 3rd-column detail pane, route skeleton per SPEC.md §9. No sibling plugin uses `ThreeColumnLayout`'s 3-column mode — verified live with placeholder data: select/switch/close all work, list stays visible, zero console errors. | UI-FLOW.md §2 | Task 4 | ✅ |
| 6 | **Groups: list, create, detail (Balances tab)** — filtered group list, `createGroupAction`, group detail page with real per-member `BalanceChip`s wired to Task 3's lib. Corrected against real precedent: create is a `Dialog` (matching Docs'/Sheets' own create dialogs), not the `/groups/new` route originally sketched. Also found and fixed a real build break: schema must live at `app/_db/schema.ts`, not the top-level `db/schema.ts` `docs/plugin-database.md` itself shows — only `app/` survives the generate step's copy into the runtime. Verified live end-to-end: created a real group, saw it in the list, opened detail, saw the real creator resolved via `sdk.directory` with a "Settled up" `BalanceChip`. | UI-FLOW.md §4 | Task 5 | ✅ |
| 7 | **Expenses: add** — expense form (`SplitMethodSelector`/`CurrencyInput`/`MemberMultiSelect`), `createExpenseAction`, real split persistence to `expense_payers`/`expense_splits` for all 4 split methods. Single payer per expense for v1 (`expense_payers` supports more; multi-payer input is deferred, tracked not dropped). Found and fixed two real bugs live: a `'use server'` file may only export async functions — `CATEGORY_OPTIONS` (a plain const) silently broke crossing into the Client Component, moved to its own `categories.ts`; and a real settlement-sign bug caught earlier by the unit tests (see task 3). Verified live end-to-end: added a real expense, correct split computed, balance stayed "Settled up" (mathematically correct for a single-member equal split). Edit/delete deferred — not in this task's live-verified scope. | SPEC.md §3/§6 | Task 6 | ✅ |
| 8 | **Settlements + debt-simplification suggestions** — `recordSettlementAction`, a `SettleUpButton` per simplified-debt suggestion (`app/_lib/balances.ts`'s `simplifyDebts`) in the Balances section — every field (from/to/amount/currency) is already resolved by the algorithm, so it's a single-click confirm, re-validated server-side rather than trusted. **Not live-tested with a real non-zero balance** — that needs a second group member, which needs the member-management UI (`resendGuestInviteAction`/add-member flow), explicitly scoped to Post-MVP item 1, not this task. Confidence instead comes from: `simplifyDebts`/settlement-sign unit tests (task 3, including the bug they caught), a clean typecheck/lint, and live confirmation that the section correctly renders nothing when balances are already zero (the only case reachable with the current single-member test data). | SPEC.md §4/§6 | Task 7 | ✅ |
| 9 | **Verify** — `pnpm typecheck`/`pnpm test`/`pnpm lint`/`pnpm exec prettier --check`/`pnpm generate` all clean across the whole plugin; live `pnpm dev` walkthrough re-confirmed after task 8's changes: Overview/Groups/People/Inbox/Settings all render, Roomies group + its expense survive a fresh navigation with no console errors (the accumulated `db/schema`/`CATEGORY_OPTIONS` errors seen mid-session were confirmed stale — the browser tool's console buffer persists old messages across navigations; a hard reload plus a stack-trace line-count check confirmed neither actually reproduces anymore). | — | Task 8 | ✅ |

**MVP-minus-chrome: done as of task 9**, with one honest gap — a user can
create a group, log an expense with any of the 4 split methods, and see
correct balances, all verified live against the real schema. "Settle up"
is built and verified by unit test + code review but not yet click-tested
live with a real non-zero balance, since that needs the member-management
UI (adding a second person) that Post-MVP item 1 owns. "Add members" to a
group beyond its creator is *also* blocked on that same item — so a
faithful reading of "add members" above isn't actually done yet either.
Post-MVP item 1 is the natural next task, both to close this gap and
because nothing past a single-member group is fully provable until it
exists.

---

## Post-MVP-minus-chrome (v1 scope, not yet scheduled into tasks)

Everything else `CONCEPT.md`/`UI-FLOW.md` already designed for v1, roughly
in priority order:

1. **Group settings** — name/description/currency/dates edit, member
   management (real-user search + guest add), guest email invite
   (`mailer:sendExternal`, `resendGuestInviteAction`) — UI-FLOW.md §8.
2. **People** — cross-group rollup list + detail tabs — UI-FLOW.md §4/§8.
3. **Overview** — headline per-currency rollup, groups-needing-attention,
   spend by category, monthly/yearly trend — UI-FLOW.md §3.
4. **Inbox** — merged activity/notification/action feed — UI-FLOW.md §5.
5. **Settings (account-level)** — Primary Currency — UI-FLOW.md §8.
6. **Mobile** — `ResponsiveSurface` fork, self-rendered `MobileFooter`,
   drill-down stack — UI-FLOW.md §6.
7. **Notifications + activity log wiring** — across every mutating action
   from tasks 6–8 above, not just the ones needed to prove the MVP slice —
   SPEC.md §6.
8. **Portability** — `provideExport`/`provideImport`/`provideDelete`,
   including the "block deletion with a non-zero balance is not actually
   enforceable today" finding from SPEC.md §7 (client-side warning only,
   pending a platform-level RFC for a real block).
9. **New icons** — `users`, `arrow-left-right`, `send`/`bell-ring` —
   UI-FLOW.md §7.
10. **Receipt image attach** — `sdk.storage` wiring per SPEC.md §8.

## Explicitly out of scope

See `CONCEPT.md` §6/§12 and `SPEC.md` §12 — AI receipt scanning, recurring
expenses, real currency conversion (dropped entirely, not just deferred —
`SPEC.md` §4), Splitwise data import, any paid/Pro tier.
