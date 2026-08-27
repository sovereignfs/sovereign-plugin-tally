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

**MVP-minus-chrome: done as of task 9**, with one remaining gap — "add
members" to a group beyond its creator is still blocked on the
member-management UI (Post-MVP item 1), so a faithful reading of "add
members" in task 6 isn't actually done yet.

Task 8's "settle up not yet click-tested live" gap is now closed —
`scripts/seed.ts` (see "Dev tooling" below) inserts groups with multiple
real members directly at the DB layer, sidestepping the member-management
UI blocker entirely. Live-tested against the seeded "Roomies" group: the
Balances section rendered correct per-member `BalanceChip`s and debt-
simplified "Settle up" suggestions for 4 real members across all 4 split
methods, and clicking a real "Settle up" button correctly moved that
member's chip to "Settled up" and reduced the group owner's owed total by
exactly the settled amount, confirming `recordSettlementAction` end-to-end
for the first time. Also confirmed against the seeded "Bali Trip" group:
guest members resolve and display correctly (`Sam Rivera`/`Jordan Lee`,
no crash/placeholder), a guest as an expense's payer computes correctly,
and a guest settling up is reflected correctly in both that guest's own
balance and the debt-simplification suggestions for the other members.
Data reset to a pristine state (`pnpm seed -- --reset`) after this
verification so the settle-up click isn't left applied for the next
person who runs the seed script.

Post-MVP item 1 (member management) is still the natural next task —
nothing about a *user's own* ability to add a second person is provable
until it exists, seed data or not.

## Dev tooling

`scripts/seed.ts` — idempotent dev-only seed script, not part of the MVP
task list above. Inserts 2 groups directly at the DB layer (bypassing the
member-management UI gap noted above): "Roomies" (USD, the 4 well-known
`@sovereign.local` dev accounts, all 4 split methods, one settlement) and
"Bali Trip" (EUR, 2 real accounts + 2 guest members, a guest as payer
twice, a guest settling up). Reuses `app/_lib/rounding.ts`'s
`distributeByWeights`/`distributeEvenly` for split math rather than
reimplementing it, so seeded splits are guaranteed consistent with what
the real create-expense form would produce. `pnpm seed` / `pnpm seed --
--reset`. Mirrors `sovereign-plugin-kanban.local/scripts/seed.ts`'s
established pattern (direct `@libsql/client` connection to the dev sqld
namespace, dev accounts looked up by email rather than hardcoded ids).

---

## Post-ship enhancements

Real requests against already-shipped tasks, not new roadmap items.

**2026-08-27 — Groups list: per-group balance + counterparty preview, group description field.**
Two changes to task 6's Groups list (`groups/page.tsx`), requested directly
against a Splitwise reference screenshot: each group row now shows the
current user's own balance in that group (a `BalanceChipStack`, reusing
Overview's multi-currency component) plus up to 3 other members with a
non-zero balance relative to the user, each as a name + `BalanceChip` —
mirroring Splitwise's own Groups tab, which shows exactly this per group
tile. A settled group shows a plain "Settled up" label instead. Also added
an optional `description` field to `CreateGroupDialog` (`Textarea`,
wired through `createGroupAction`) — the column already existed on
`groups` and was already surfaced by `getGroupDetail`, just never
settable from the create form.

Real refactor, not just new UI: the per-group balance/counterparty
computation is identical to what `getOverviewData()` already does per
group (bucket expenses/payers/splits/settlements by group,
`computeNetBalances` once per group, then derive "who's unsettled with
me" from `simplifyDebts`'s suggestions). Extracted the shared, genuinely
tricky part — `resolveCounterparties()` (`app/_lib/balances.ts`) — so
Overview's People breakdown and the Groups list's per-group preview route
debt identically instead of drifting apart; `pushTo()`'s bucket-by-key
helper moved to a new `app/_lib/collections.ts` for the same reason.
`listGroupsForUser()` (`app/_lib/groups.ts`) now returns `memberCount`,
`myBalances: CurrencyAmount[]`, and `counterparties:
GroupCounterpartyView[]` per group instead of just id/name/currency.
`BalanceChipStack` itself moved out of Overview's `page.tsx` into
`app/_components/` so both pages import the same component rather than
each having their own copy — the exact kind of drift the multi-currency
bug (this file's Overview entry above) came from in the first place.

Verified live: created a real group with a description, confirmed it
persisted correctly by querying the dev database directly (not just
trusting the form's success state), then deleted the test row so it
doesn't pollute `scripts/seed.ts`'s dataset. Groups list re-verified
against the seeded data — "Roomies" shows the owner's own `Owed USD
1632.93` next to the group name and three counterparty rows (Dev User,
Dev Auditor, Dev Admin) each with their own chip; "Bali Trip" shows one
counterparty (Dev Admin) in EUR. `@detail/groups/page.tsx` (unchanged)
re-confirmed still working after the `balances.ts`/`groups.ts` refactor.
`pnpm typecheck`/`eslint`/`prettier --check`/`design:tokens:check`/`pnpm
test` all clean.

**2026-08-27 — Group detail: month-grouped activity feed, balance summary, general "Record settlement".**
Replaced `@detail/groups/page.tsx`'s flat "Expenses" list with a real
Activity feed (UI-FLOW.md §4), requested directly with example phrasing
("You paid John 20 EUR", "Alex paid you 30 EUR"): expenses and settlements
merged into one timeline, grouped by month (most recent first), each row
showing a date, a category tag (the expense's real category, or the
literal string `'Settlement'` for a settlement row — one uniform slot
rather than a special case), a natural-language description, and the
amount. New `app/_lib/activity.ts` (with its own `__tests__/activity.test.ts`,
8 cases) holds the pure describe/group functions: `describeExpenseActivity`
always names the expense's actual payer ("You paid USD 52.00 for Pizza
night" / "Dev Admin paid USD 60.00 for..."), `describeSettlementActivity`
phrases the reader as "You"/"you" depending on which side of the payment
they're on. **Deliberately simplified away from one requested example**:
"Kasun fully settled up with Thulana" implies detecting when a settlement
zeroes the pairwise balance between exactly two people — not well-defined
here (only a *group's* net position per member is unambiguous; pairwise
attribution is `simplifyDebts`'s own allocation choice, not a ledger
fact, per `resolveCounterparties`'s existing doc comment) — so every
settlement uses the same "X paid Y {amount}" phrasing regardless.

Also added: a "Balance summary" headline above the existing per-member
Balances list (`GroupDetail.myBalances`, the same per-group balance
`listGroupsForUser` already computes, just for one group); and
`RecordSettlementDialog`, a general "record a payment" CTA next to "Add
expense" — complements rather than replaces the existing auto-suggested
`SettleUpButton`s (a suggestion covers the common case; this covers a
partial payment, a pairing the simplification didn't suggest, or
backdating). Required threading an optional `settledOn` through
`recordSettlementAction` (previously always `now()`) — `SettleUpButton`'s
existing hidden-input form still omits it and gets today's date,
unchanged.

`getGroupDetail` (`app/_lib/groups.ts`) now fetches each expense's payer
and each settlement's `note`/`settledOn` (neither read before) to build
the activity list; `GroupExpenseListItem`/`recentExpenses` removed
entirely (no longer had any consumer once the activity feed replaced the
flat list). `BalanceChipStack` gained an `align?: 'start' | 'end'` prop
(default unchanged) since the new standalone Balance summary block reads
wrong right-aligned, the way it's used for a row's trailing edge
elsewhere.

Verified live: both seeded groups' full activity feeds read correctly
end-to-end, including the guest-payer and guest-settlement cases in "Bali
Trip" ("Jordan Lee paid you EUR 150.00", "Sam Rivera paid EUR 156.80 for
Dinner at Locavore") and a real `RecordSettlementDialog` submission (paid
Sam Rivera EUR 25.00, with a note) — confirmed it created a *new* "August
2026" month group above July's, and correctly moved both parties' raw
ledger balances (not just the simplified suggestion view). Reset the seed
data afterward (`pnpm seed -- --reset`) so the test payment doesn't linger.
`pnpm typecheck`/`eslint`/`prettier --check`/`design:tokens:check`/`pnpm
test` (30 tests) all clean.

**2026-08-27 — People: list + summary + per-person detail with a joint-only timeline.**
Built out `people/page.tsx` (previously a stub) and a new `@detail/people`
slot, both requested directly. List page: a headline "You're owed"/"You
owe" summary (same shape as Overview's, `CurrencyStack` reused), then
*every* person the user shares a group with — not just non-zero balances
like Overview's capped breakdown — sorted non-zero-balance first (largest
first), settled people after (alphabetically). Each row deliberately keeps
name + balance together on the left rather than pushing the balance to a
trailing right edge the way Groups/Overview rows do — a requested,
intentional difference for this page. Clicking a person opens the third
column: a balance summary, then an activity timeline in the *same*
month-grouped shape as a group's own Activity feed ("timeline as groups"),
via the newly-shared `ActivityFeed` component.

**The person timeline is narrower than "everything in every shared
group"**: only expenses where *both* the user and that person are
participants (payer or split share) and settlements directly between the
two. Implemented as a per-expense participant-set check
(`payersByGroup`/`splitsByGroup` unioned per `expenseId`), not a
group-wide feed — a third member's unrelated purchase in a shared
four-person group doesn't belong in "me and this person's" history.
Verified live against a real, deliberately-crafted seed-data edge case:
the seeded "Bali Trip" group has one expense ("Beach club day pass")
whose split explicitly excludes Jordan Lee (`scripts/seed.ts`'s own
comment: "Jordan skipped this one") — confirmed it's the one Bali Trip
expense *absent* from Jordan's timeline while every other joint
expense (including two paid by third parties, Sam Rivera and Dev Admin,
correctly labeled as such rather than attributed to Jordan) appears
correctly. Also verified the multi-group case (Dev Admin, shared across
both seeded groups): balance summary correctly stacks both currencies
(`Owes USD 497.38` / `Owed EUR 46.67`), and the activity feed's rows each
carry a `· <group name>` suffix (`ActivityFeed`'s new `showGroupName`
prop) so it's clear which group each entry happened in.

**Real refactor alongside the feature, not just new code**: this is the
*third* independent place (`overview.ts`, `groups.ts`'s
`listGroupsForUser`, now `people.ts`) that needed "fetch every group the
user belongs to, bucket expenses/payers/splits/settlements/members by
groupId" — extracted into `app/_lib/group-data.ts`'s `fetchMyGroupsData`,
with `overview.ts`/`groups.ts` refactored to call it instead of each
keeping an independent copy. `largestMagnitude` (a tiny sort-key helper)
moved from `overview.ts` to `balances.ts` for the same reason — now used
by `people.ts` too. `CurrencyStack` (the headline/stat card's plain-text
currency-line renderer) extracted from Overview's `page.tsx` into
`app/_components/`, parallel to the earlier `BalanceChipStack` extraction,
since the People page's summary block needed the identical rendering.
Verified live after each refactor step (not just via typecheck) that
Overview's and the Groups list's numbers were byte-identical to before.

Deferred, not shipped: "detail tabs" (UI-FLOW.md's original phrasing
implied multiple tabs/views on the detail pane) — built as a single
balance-summary-plus-timeline view instead, matching what was actually
asked for. Overview's People breakdown rows were also made clickable
(`Link` to `/tally/people?p=...`) as part of this work — they rendered as
plain non-interactive `<li>`s before, which would have been a dead end
once a real People detail page existed to link to.

**2026-08-27 — Inbox: cross-group activity feed (partial — see item 4 above).**
Checked in with a scope question before building, since UI-FLOW.md §5's
full spec turned out to depend on features that don't exist yet: guest
email invites (for a `[Resend]` action on a bounced invite) and a
"remind" nudge action, plus no mutating action in this plugin calls
`sdk.activity.log()`/`sdk.notifications.send()` today, so there's no real
Notification Center data to tie an unread badge to either. Scoped to just
the buildable half: `app/_lib/inbox.ts`'s `getInboxFeed()` merges every
expense/settlement across every group (reusing `describeExpenseActivity`/
`describeSettlementActivity` so the same event reads identically here and
on the Group/Person pages), flattened — not month-grouped, unlike those
other two feeds — and sorted most-recent first, capped at 50 with a note
if truncated (no pagination). New `formatRelativeTime` (`activity.ts`, 6
new test cases) renders "2h ago"/"yesterday"/"3d ago", falling back to the
existing `formatActivityDate` beyond a week, matching UI-FLOW.md §5's own
mockup density (relative time + inline group name, no date column, no
category tag) rather than reusing `ActivityFeed`'s month-grouped layout
verbatim — a deliberately different presentation of the same underlying
data. `CATEGORY_LABEL_BY_VALUE` (previously redefined locally in both
`groups.ts` and `people.ts`) moved to `categories.ts` and exported, since
`inbox.ts` needed it a third time. Verified live: both seeded groups'
transactions interleave correctly into one chronological feed (e.g.
"Dev Auditor paid you USD 50.00 — Partial payback via Venmo · Roomies ·
2d ago" ahead of older Bali Trip entries dated by absolute day).
`pnpm typecheck`/`eslint`/`prettier --check`/`design:tokens:check`/`pnpm
test` (36 tests) all clean.

Deferred, not shipped: actionable rows (`[Resend]`/`[Remind]`), the
Notification Center unread-count tie-in, and the sidebar's unread badge —
all genuinely blocked on the prerequisites named above, not scoped out
for convenience. Building those is Post-MVP item 7 territory
(notifications + activity log wiring across every mutating action) plus
Post-MVP item 1's guest invites, not a follow-up to this task alone.

**2026-08-27 — Settings: Primary Currency, with both spec'd cosmetic effects wired.**
New `app/_lib/settings.ts` (`getUserSettings`/`updateUserSettingsAction`,
upserting `user_settings` via `onConflictDoUpdate`) backs a single-field
form (`PrimaryCurrencyForm`) on the account-level Settings page, with the
required on-screen disclaimer ("Sets your default currency — Tally never
converts between currencies") carried as `PageHeader`'s own `description`.
Both of UI-FLOW.md §8's named cosmetic effects implemented, not just the
storage: (1) `CreateGroupDialog`'s currency field now defaults to the
user's primary currency instead of a hardcoded `DEFAULT_CURRENCY` —
deliberately **not** extended to `ExpenseForm`'s own currency default,
which stays pinned to the group's `defaultCurrency` (a real product call:
an expense being added *into* a specific group should default to that
group's currency, not a personal preference — UI-FLOW.md's "and expense"
phrasing read as imprecise given Tally has no add-expense flow without a
group context to begin with). (2) Overview's per-currency rollups
(`owed`/`owe`/`netExposure`/`spentThisMonth`/`spentAllTime`) now rank the
primary currency first regardless of magnitude, via a new
`sortByPrimaryCurrency` helper — deliberately scoped to Overview only, not
Groups/People's breakdown rows, matching the spec's literal "Overview's
per-currency rollup" wording.

**Found and fixed a real bug live**: saving successfully persisted the
new currency (confirmed by querying the database directly — `EUR` was
there), but the `<Select>` kept visually showing the old value after the
in-page save completed, only correcting itself on a hard page reload.
Root cause: an uncontrolled `<select>`'s `defaultValue` only applies on
first mount — a Server Action re-rendering the parent Server Component
with a new prop value doesn't touch the already-mounted Client
Component's live DOM value. Fixed with `key={primaryCurrency}` on the
`Select`, forcing a remount (and fresh `defaultValue` application)
whenever the server-confirmed value actually changes.

Verified live end-to-end: switched primary currency to EUR, confirmed
Overview's "Spent all-time" and "Net exposure" cards reordered to show
`EUR 422.27` / `EUR 46.67` first even though the USD figures in the same
cards are larger in magnitude; confirmed "New group"'s currency field
opened pre-selected to EUR; confirmed Groups/People rows were unaffected
(still magnitude-sorted, as scoped). Reset back to USD afterward so the
dev account isn't left on a non-default currency.
`pnpm typecheck`/`eslint`/`prettier --check`/`design:tokens:check`/`pnpm
test` (36 tests) all clean.

**2026-08-27 — Icon replaced with the real app icon.**
`icon.svg` swapped from the scaffold's generic placeholder (a plain
grid/table glyph, `sv plugin new`'s default) for a real two-way exchange
icon supplied directly (`sovereign-plugin-tally-legacy`'s own `icon.svg`
on GitHub) — a two-directional loop/swap glyph, fitting for a
bill-splitting app. Reformatted to match Docs'/Sheets' more accessible
icon convention (`role="img"` + `<title>`/`<desc>`) rather than Kanban's
`aria-hidden` one, since I couldn't confirm this exact path data against
Lucide's current icon set (checked `repeat`, `repeat-2`, and
`arrow-right-left` — none matched exactly, likely an older Lucide version
or a custom variant) and didn't want to assert a specific "Lucide X icon"
name I hadn't verified, unlike Docs'/Sheets' own `<desc>` text. Verified
live: renders correctly at `/plugin-icons/fs.sovereign.tally.svg` (the
generate step's own copy target, confirmed already picked up by the dev
watcher) and in the app launcher's Tally card and the sidebar's
app-switcher rail — no stale cache, no console errors.

**2026-08-27 — Currency list expanded to the full ISO 4217 set.**
`CURRENCY_OPTIONS` (`app/_lib/currencies.ts`) grew from a curated 7-code
list to all 162 codes, per direct request. Generated, not hand-typed —
Node's own `Intl.supportedValuesOf('currency')` + `Intl.DisplayNames`
produced every code and its English name (the exact one-line snippet is
kept in the file's own doc comment so it can be regenerated later rather
than hand-edited), avoiding the transcription-error risk of typing ~160
codes/names from memory. Deliberately unfiltered — includes historical/
superseded currencies (`ZWL`, `SLL`) and reserve-asset codes (`XDR`)
exactly as Intl reports them, rather than this task applying its own
judgment about which are "still relevant." No other code changes needed:
`createExpenseAction`/`recordSettlementAction`/`createGroupAction` already
validate currency input against a generic 3-uppercase-letter regex, not
against `CURRENCY_OPTIONS` itself, so they already accepted any of the
new codes; `updateUserSettingsAction`'s validation set is built directly
from `CURRENCY_OPTIONS`, so it picked up the expansion automatically.
Verified live: Settings' Primary Currency dropdown lists all 162 options
correctly. `pnpm typecheck`/`eslint`/`prettier --check`/`pnpm test` (36
tests) all clean.

**2026-08-27 — Group settings: details edit + member management (Post-MVP
item 1, partial).** The next roadmap item picked up directly. Owner-only
(`group-manage`), reached via a new gear-icon CTA in `@detail/groups/page.tsx`'s
header — gated on a new `myRole` field added to `getGroupDetail`'s return
type so the page can hide the icon for non-owners without a second query.
New `app/_lib/group-settings.ts` holds every action: `updateGroupDetailsAction`
(name/description/default currency/start+end dates, one form),
`addMemberAction` (real user via a debounced `sdk.directory.searchUsers`
picker, or a guest via a name field with an optional email that triggers an
invite send), `resendGuestInviteAction`, `removeMemberAction`, and
`updateMemberRoleAction` — all reusing task 4's existing
`requireGroupManage`/`hasOtherActiveOwner`/`hasNonZeroBalance` guards
directly, no new authorization logic needed. `GroupSettingsDialog` (new
`app/_components/`) is a close structural port of Sheets'
`WorkbookShareDialog` — UI-FLOW.md §8's own explicitly validated reference
implementation for this exact shape (debounced 250ms/2-char search picker,
`Dialog` + `useActionState`, bound server actions passed down as props via
`.bind(null, groupId)` from the server-component page).

**Guest email invite**: `sdk.mailer.send()` returns `Promise<void>` with no
delivery-status return value, and no-ops silently when SMTP is unconfigured
(`docs/plugin-development.md`) — genuinely indistinguishable from a real
delivery at the call site. `sendGuestInviteEmail()` treats a non-throwing
call as `guest_invite_status: 'sent'` and a thrown error (a real send
failure or the platform's own per-plugin mailer rate limit) as `'bounced'`
— the most honest signal actually available through this SDK surface,
matching SPEC.md §8's own framing of the distinction. Also sends a
best-effort "added to a group" notification to a newly-added *real* user
(`sdk.notifications.send()`, try/catch, mirroring Sheets'
`notifyMember` exactly) — deliberately scoped to just this one new action's
own event, not a general Post-MVP item 7 activity/notification retrofit
across the plugin's existing actions (none of which call
`sdk.activity.log()`/`sdk.notifications.send()` today; left that way here
too, for consistency rather than inconsistently wiring only the newest
action).

**Deliberately deferred, not overlooked**: `archiveGroupAction` ("Close
group") and `deleteGroupAction` (hard delete). UI-FLOW.md §4 frames these as
two separate detail-column header CTAs alongside the "Group settings" gear
icon, not part of the settings screen itself — scoped out up front (agreed
with the developer before starting) to keep this task reviewable; SPEC.md
§6/§7 already fully specifies both for whenever they're picked up next.

**A staleness bug proactively avoided, not found live**: reused the
`key={primaryCurrency}`-remount fix `PrimaryCurrencyForm` already needed for
its one uncontrolled `<Select>` (see that entry above), generalized here as
a `refreshNonce` counter keying both the Details form and the add-member
form — this dialog refreshes several `defaultValue`-driven fields together
after every mutation, not just one, so the same staleness risk applies to
all of them at once.

`pnpm typecheck`/`eslint`/`prettier --check` (scoped to the files this task
touched — the rest of the plugin has pre-existing, unrelated Prettier drift
this task didn't introduce and didn't attempt to mass-fix)/`pnpm
design:tokens:check`/`pnpm test` (36 tests) all clean. **Not live-tested
this session** — browser-based verification was blocked by a broken
preview-server environment: `preview_start` reported success on three
separate attempts (after enabling `autoPort` in `.claude/launch.json`'s
`dev` config to work around another session's server already holding the
usual port), but no process ever actually bound the assigned port on any
attempt, confirmed directly via `lsof`/`ps` after waits up to 30s — a
session/tooling issue, not a code concern, and not something further
retries resolved. Per explicit developer decision, shipped without live
verification. The add-member search picker, the guest-invite email path,
and the last-owner/non-zero-balance guards' UI wiring (their *logic* is
covered by task 3's existing unit tests via `hasOtherActiveOwner`/
`hasNonZeroBalance`, but the dialog's own error-surfacing has not been
click-tested) should get a first real walkthrough before being treated as
fully proven — the same kind of gap task 8 flagged for settlements until
`scripts/seed.ts` made real multi-member testing possible.

**2026-08-27 — Group settings: Close group + Delete (Post-MVP item 1,
completes it).** The remaining half of the previous entry, picked up
directly. Two new detail-column header CTAs, owner-only, mutually
exclusive per SPEC.md §7's bright line: a group with any expense or
settlement history — even soft-deleted, since that's still real history —
can only ever be **closed** (soft-archived, `archivedAt` set, data stays
fully intact and visible), never hard-deleted; a group with *zero* history,
ever, can only be **deleted** (a true hard delete — nothing exists yet
another member's math could depend on). `getGroupDetail` (`app/_lib/groups.ts`)
gained `archivedAt`/`hasHistory` fields to drive this — `hasHistory` reuses
the same unfiltered `expenses`/`settlements` row fetches the activity feed
already pulls, no new query. Once closed, the header shows a "Closed"
`StatusBadge` in place of any button — there's no "reopen" action to route
to yet, so re-showing "Close group" on an already-closed group would be a
dead end.

New `archiveGroupAction`/`deleteGroupAction` (`app/_lib/group-settings.ts`,
alongside the other group-manage lifecycle actions from the previous
entry): `archiveGroupAction` loops every active member through the
existing `hasNonZeroBalance` helper (task 4) and blocks if any is non-zero,
matching UI-FLOW.md §4's "disabled with a tooltip explaining why" —
`GroupLifecycleActions` (new `app/_components/`) computes that same
condition client-side from `group.balances` (already fetched for the
Balances section, no extra query) so the button renders disabled
proactively rather than only failing after a click. `deleteGroupAction`
checks for any `expenses`/`settlements` row (any, including soft-deleted)
and, only once confirmed zero, cascade-deletes `group_members` rows before
the `groups` row itself — safe specifically *because* the zero-history
precondition rules out any `expense_payers`/`expense_splits` row
referencing one, unlike `removeMemberAction`'s soft-remove-only approach
elsewhere in this same file, which exists precisely to avoid that
orphaning risk when history *does* exist.

**Confirm-dialog pattern researched, not invented from scratch**: this
plugin's first destructive-action confirm, so the codebase was checked for
precedent first rather than hand-rolling one. `packages/ui`'s `ConfirmDialog`
(built on native `<dialog>`, not the fixed-size `Dialog`) plus a
`useTransition`-wrapped async `onConfirm` is the one established pattern,
found in kanban's `ManageProjectDialog` "Danger zone" (project delete) and
mirrored identically in Sheets' `WorkbookView` (workbook delete) — reused
here verbatim rather than inventing a second convention. Deliberately
**not** copied wholesale, though: kanban's boxed "Danger zone" section
(label + tinted background) is specific to a settings *dialog's* body;
UI-FLOW.md §4 places Close/Delete as compact peer CTAs directly in the
detail column's header row alongside "Group settings" and the close link,
so `GroupLifecycleActions` renders plain buttons there instead, matching
the header's existing density — only the `ConfirmDialog` + `useTransition`
wiring itself was reused, not the container styling around it. "Close
group" uses `Button variant="ghost"` (matching the header's other icon-style
buttons) with a non-destructive `ConfirmDialog`; "Delete" uses
`variant="destructive"` (the codebase's established delete-trigger style,
confirmed against both reference implementations) with `ConfirmDialog`'s
own `destructive` prop. A successful delete navigates back to
`/tally/groups` via `router.replace` (not `push`, so a deleted group's URL
doesn't linger in back-history) — necessary since the just-deleted group's
`?g=<id>` URL would otherwise keep resolving to nothing once revalidated.

`pnpm typecheck`/`eslint`/`prettier --check` (scoped to this task's touched
files, same rationale as the previous entry)/`pnpm design:tokens:check`/
`pnpm test` (36 tests) all clean.

**Live-verified in a follow-up pass, after root-causing the preview-server
gap rather than working around it again.** The `EADDRINUSE`/no-port-bound
failure from the previous two entries turned out to be a real, understood
cause, not environment flakiness: this monorepo's `turbo.json` has no
`envMode`/`passThroughEnv` configured, and Turborepo 2.x defaults to
`envMode: "strict"` — confirmed directly via `turbo run --dry=json`, which
reported `"envMode": "strict"` despite `turbo.json` never setting it. In
strict mode, only vars explicitly allowlisted in `passThroughEnv` reach a
task's spawned process, so a shell-exported `PORT`/`RUNTIME_PORT` (what
`preview_start`'s `autoPort` and a manual `pnpm dev` retry both tried) never
reached `next dev` at all — every sub-app silently fell back to its
`.env`-hardcoded default port instead, which explains both the earlier
"reports success, binds nothing" pattern (turbo's own dev-task wrapper
doesn't treat a child's immediate `EADDRINUSE` exit as a task failure) and
why setting the env var by hand didn't help either. Worked around (not
fixed at the `turbo.json` level, which is shared, committed platform
config out of scope for a plugin-only session) by pointing the browser tool
directly at the *other* session's already-running dev server
(`preview_start` with a plain `{url: "http://localhost:5020"}` — no
`{name}`-based spawn, so autoPort/strict-env never enters the picture) —
valid since Tally's `.local` plugin source is filesystem-watched and
hot-copied into the runtime regardless of which session's `pnpm dev`
process owns the watcher.

Verified end-to-end against the live seeded data plus two throwaway test
groups (removed after, one via the UI's own delete flow, one via a direct,
scratch, git-ignored DB script for the create-history-then-close case since
`deleteGroupAction` correctly refuses once history exists): "Close group"
disabled with the exact tooltip text on `Bali Trip` (real non-zero
balances); a fresh zero-history group showed "Delete" instead, and its
`ConfirmDialog` (destructive, red confirm) deleted it and correctly
returned to the plain groups list; adding one self-paid expense to a
second fresh group flipped it to an *enabled* "Close group" (zero net
balance), and its own `ConfirmDialog` (non-destructive) closed it,
replacing the button with the "Closed" `StatusBadge` — group data stayed
fully visible throughout, matching the confirm copy.

**Found and fixed a real bug this verification pass was for**: navigating
directly to a just-deleted group's `?g=<id>` URL (reachable via browser
back/forward, a bookmark, or shared link — not just the artificial
just-deleted-it case tested first) crashed to Next's generic "Something
went wrong" error boundary instead of the plain groups list. Root cause:
`deleteGroupAction` removes `group_members` rows along with `groups`
(correct — nothing references them once the zero-history precondition
holds), but `getGroupDetail` calls `requireGroupMember` *before* its own
`if (!group) return null` fallback, and that helper throws
`GroupAccessError` — not a null return — once no active membership row
resolves for the id. `@detail/groups/page.tsx` had no try/catch around the
call, so the throw reached Next's error boundary raw. This isn't unique to
deletion — any inaccessible/nonexistent group id hits the identical path —
but deletion is what makes it a normal, reachable flow rather than a
manually-forged URL. Fixed by wrapping the `getGroupDetail` call in
`GroupDetailSlot` with a try/catch that treats `GroupAccessError`
(imported from `membership.ts`) the same as a null return — a stale link
now renders nothing, like an unrecognized id always did — while any other,
truly unexpected error still propagates normally. Re-verified live after
the fix: the same stale URL now falls back cleanly, confirmed via both a
screenshot and the DOM/accessibility tree (the console tool's own
error-message buffer is known to persist stale entries across navigations
in this environment, per this file's own task-9 note, so the DOM/visual
check is the trustworthy signal here, not the console output). `pnpm
typecheck`/`eslint`/`prettier --check` re-run clean after the fix.

**2026-08-27 — Notifications + activity log wiring (Post-MVP item 7).** Every
mutating action across the plugin now calls `sdk.activity.log()`, and the
three events SPEC.md §6 names explicitly also call `sdk.notifications.send()`.
No manifest change needed — `activity:write` and `notifications:send` were
both already declared at scaffold time (task 1), anticipating this work;
this is what finally exercises them.

**Researched before writing any code**: `sdk.activity.log()`'s own SDK-level
doc comment calls it "RFC 0005 — reserved surface, not yet implemented,"
which reads as a hard blocker — checked the runtime's actual implementation
directly instead of trusting the comment at face value, and found
`activity.log` in `runtime/src/sdk-host.ts` fully implemented (writes to the
platform's real activity table via `recordActivity`), with a genuine
consumer already live at `/console/activity` (Console's admin activity
viewer) and one real, working precedent already in the codebase —
`plugins/account/app/actions.ts` calls `void sdk.activity.log({ action,
summary })` (fire-and-forget, no try/catch, no `requestHeaders` — it reads
`headers()` internally, unlike `mailer.send`/`notifications.send`) on every
self-mutation (password change, TOTP enroll, etc.). Matched that exact
pattern rather than inventing a new one; the "reserved surface" comment
appears stale.

**Action → event mapping** (`action` string, dotted verb; `summary` plain
text; `notify` only where SPEC.md §6's table names one):
`createGroupAction` → `group.created`; `createExpenseAction` →
`expense.added` + notify every other active *user*-kind member (never
guests — no session), excluding the actor, via `Promise.allSettled` so one
recipient's failure can't affect another's or the already-succeeded
expense; `recordSettlementAction` → `settlement.recorded` + notify the
counterparty, resolved as "whichever side the actor wasn't on" — only
well-defined when the actor is actually one of the two parties (a third
party recording a settlement between two others has no single spec-defined
recipient, so no notification fires for that case, matching SPEC.md §6's
literal formula rather than guessing a broader behavior);
`updateGroupDetailsAction` → `group.updated`; `addMemberAction` →
`group.member_added` (both the real-user and guest paths — the user path
already had its own "added to a group" notification from the previous
Group Settings task, now paired with a matching log entry);
`resendGuestInviteAction` → `group.guest_invite_resent`;
`removeMemberAction` → `group.member_removed`; `updateMemberRoleAction` →
`group.member_role_updated`; `archiveGroupAction` → `group.closed`;
`deleteGroupAction` → `group.deleted`; `updateUserSettingsAction` →
`settings.primary_currency_updated` (no notification — a personal
preference, no one else to tell, but still logged, matching `account`'s own
precedent of logging every self-mutation regardless of audience).

**Live-verified against the running dev server** (the same
`preview_start {url: ...}` workaround established in the previous entry),
not just via typecheck — the two genuinely non-trivial recipient-resolution
paths, specifically:

- Recorded a real settlement (Dev Owner → Dev Admin, USD 15.00) in the
  seeded "Roomies" group. Confirmed in Console's real `/console/activity`
  page: `fs.sovereign.tally:settlement.recorded` — "Recorded a payment of
  USD 15.00" — correctly namespaced by the runtime
  (`${pluginId}:${action}`), sitting directly above a `push.delivery_failed`
  / "push is not configured on this instance" platform log line at the same
  timestamp, which itself only fires *after* a real notification record is
  created — indirect but real confirmation the send path was reached, not
  short-circuited earlier (e.g. by a permission check). Queried the
  platform's own `notifications` table directly and found exactly one new
  row: recipient = Dev Admin's real user id, title "Settlement recorded",
  body "A payment of USD 15.00 was recorded." — the counterparty, not the
  actor, matching the resolution logic exactly.
- Added a real expense (USD 40.00, split across all 4 members) to the same
  group. Queried `notifications` again: exactly 3 new rows, one each for
  Dev Admin/Dev User/Dev Auditor (every active user-kind member except the
  actor, Dev Owner) — confirming the `Promise.allSettled` multi-recipient
  path resolves the correct recipient set, not more, not fewer.

**A real UI-testing obstacle hit and worked around, not a code bug**:
`ExpenseForm`'s "Split between" checkboxes are React-controlled — setting
`.checked` on the underlying DOM node directly (what the browser tool's
`form_input` does for a checkbox) updates the visible DOM but not the
component's own state, so a submission after only that path still saw zero
selected participants server-side and correctly rejected it. A real,
trusted click on each checkbox's `<label>` (verified via a direct
`el.checked` JS read between clicks, not just the screenshot, since the
custom checkbox's checked-state styling wasn't visually obvious at the
browser tool's screenshot resolution) fired the actual `onChange` and
worked as expected — noted here since this exact form is one of the
harder-to-drive parts of the plugin's UI for any future live-testing pass,
not something specific to this task.

Test data reset afterward (`pnpm seed -- --reset`) so the test settlement
and expense don't linger in the seeded dataset; confirmed "Roomies" back to
its exact original balance (`Owed USD 1632.93`) and activity feed via a
fresh screenshot. The handful of test notification/activity-log rows left
in the platform's own tables were **not** cleaned up — unlike the
plugin-scoped seed dataset, these are the platform's real accumulating
usage data in what's now a live, in-use instance (per the developer's own
"I deployed and started using" context), not pollution requiring reset.

`pnpm typecheck`/`eslint`/`prettier --check` (scoped to this task's touched
files)/`pnpm design:tokens:check`/`pnpm test` (36 tests) all clean, both
before and after live verification (no code changes were needed as a
result of live testing this time — everything worked as designed on the
first real attempt).

---

## Post-MVP-minus-chrome (v1 scope, not yet scheduled into tasks)

Everything else `CONCEPT.md`/`UI-FLOW.md` already designed for v1, roughly
in priority order:

1. ~~**Group settings**~~ — ✅ shipped 2026-08-27 (details edit + member
   management, then Close group/Delete — see Status below) — UI-FLOW.md
   §4/§8.
2. ~~**People**~~ — ✅ shipped 2026-08-27 — cross-group rollup list + a
   single detail view (not "tabs" — see Status below for what was scoped
   vs. deferred) — UI-FLOW.md §4/§8.
3. ~~**Overview**~~ — ✅ shipped 2026-08-27, redesigned from UI-FLOW.md §3's
   original scope (see Status below) — headline owed/owe, five key stats,
   and non-zero-balance breakdowns by group and by person. Charts (spend by
   category, monthly/yearly trend) and "recent activity" were dropped from
   this design rather than deferred inside it — see Status.
4. **Inbox** — 🚧 partially shipped 2026-08-27 (cross-group activity feed
   only — see Status below); actionable rows and Notification Center
   integration remain — merged activity/notification/action feed —
   UI-FLOW.md §5.
5. ~~**Settings (account-level)**~~ — ✅ shipped 2026-08-27 — Primary
   Currency — UI-FLOW.md §8. (Per-group settings — name/description/
   currency/dates edit, member management, guest invites — is item 1
   above, a separate, much larger surface UI-FLOW.md §8 also covers.)
6. **Mobile** — `ResponsiveSurface` fork, self-rendered `MobileFooter`,
   drill-down stack — UI-FLOW.md §6.
7. ~~**Notifications + activity log wiring**~~ — ✅ shipped 2026-08-27 —
   `sdk.activity.log()` on every mutating action, `sdk.notifications.send()`
   on the three SPEC.md §6 names (member added, expense added, settlement
   recorded) — see Status below. Unblocks Inbox's remaining actionable-rows
   half (item 4) whenever that's picked up next.
8. **Portability** — `provideExport`/`provideImport`/`provideDelete`,
   including the "block deletion with a non-zero balance is not actually
   enforceable today" finding from SPEC.md §7 (client-side warning only,
   pending a platform-level RFC for a real block).
9. **New icons** — `users`, `arrow-left-right`, `send`/`bell-ring` —
   UI-FLOW.md §7.
10. **Receipt image attach** — `sdk.storage` wiring per SPEC.md §8.

### Status — Overview (item 3)

Redesigned in conversation before implementation, not built to UI-FLOW.md
§3's original spec: **charts dropped** (no chart primitive exists anywhere
in this platform yet — building one is its own scoped effort per the
DS-first rule, not a page-level decision) and **"recent activity" dropped
entirely**, not deferred (it doesn't belong on a balance dashboard, and
UI-FLOW.md's own framing coupled it to Inbox's feed query, which isn't
built — decided this coupling wasn't worth taking on for this task). Final
content: a headline "You're owed"/"You owe" per-currency rollup, five stat
cards (spent this month, spent all-time, active groups, people with
balances, net exposure), and non-zero-balance breakdown lists for Groups
and People, each capped at 5 rows with a "View all N" link to the full
page. New `app/_lib/overview.ts` — `getOverviewData()` aggregates across
every group the user belongs to in one pass (bucketing expenses/payers/
splits/settlements by group, `computeNetBalances` once per group), then
derives the People breakdown by reusing `simplifyDebts`'s suggestions
filtered to payments touching the current user — the only well-defined
notion of "how much does A owe B" in a multi-person ledger, matching the
same algorithm the group's own "Settle up" section already uses.

**Found and fixed a real bug live, not just via typecheck**: the first
version picked a single "dominant" currency per Groups/People row (mirroring
`@detail/groups/page.tsx`'s existing `.find()`-picks-one-currency
simplification), reasoning a group/person spanning more than one currency
would be rare. Live-tested against the seeded dev data (`scripts/seed.ts`)
and caught immediately: "Dev Admin" is shared across both seeded groups —
owes the current user in Roomies (USD) but is owed by the current user in
Bali Trip (EUR) — and the dominant-currency pick silently dropped the EUR
46.67 relationship entirely, showing only "Owes USD 497.38" with no sign
anything was missing. Sharing multiple groups in different currencies is
the *normal* case for a cross-group person rollup, not an edge case, so the
simplification was wrong to carry over. Fixed by changing
`OverviewGroupItem`/`OverviewPersonItem` to carry a `balances:
CurrencyAmount[]` array instead of one currency/amount pair, and rendering
every entry (capped at 2 with a "+N more currencies" overflow, the same
stack-with-cap pattern used for the headline cards) via a new
`BalanceChipStack` — confirmed live afterward: Dev Admin's row correctly
shows both "Owes USD 497.38" and "Owed EUR 46.67".

Also confirmed live: the headline/stat cards' multi-currency stacking,
per-currency "spent this month" vs "spent all-time" cutoff logic (verified
by hand against the seed data's actual dates — Roomies' expenses all fall
within the current month, Bali Trip's predate it, and the numbers matched
exactly), and the People breakdown's cross-group netting for a real user
sharing groups in different currencies. `pnpm typecheck`/`pnpm exec
eslint`/`pnpm exec prettier --check`/`pnpm design:tokens:check`/`pnpm test`
all clean. Not yet tested: the zero-groups empty state and the
all-settled-up state (no seeded account currently hits either), and no
mobile-layout pass (Post-MVP item 6 owns that fork for the whole plugin,
not just this page).

## Explicitly out of scope

See `CONCEPT.md` §6/§12 and `SPEC.md` §12 — AI receipt scanning, recurring
expenses, real currency conversion (dropped entirely, not just deferred —
`SPEC.md` §4), Splitwise data import, any paid/Pro tier.
