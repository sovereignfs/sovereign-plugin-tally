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

**2026-08-27 — Inbox: actionable rows (Post-MVP item 4, completes it).**
The half deferred back when Inbox first shipped — both prerequisites
(guest invites, item 1; `sdk.activity.log()`/`sdk.notifications.send()`
wiring, item 7) landed since, unblocking this directly. Two new row kinds,
interleaved chronologically with the existing plain activity rows exactly
as UI-FLOW.md §5's mockup shows, not pinned separately:

- **`[Resend]`** — a bounced guest invite, reusing `resendGuestInviteAction`
  verbatim (no new action needed). Only surfaced for a group the user
  actually manages — matches that action's own `requireGroupManage` gate,
  so the button is never offered somewhere it would just fail.
- **`[Remind]`** — a new `sendReminderAction` (`app/_lib/reminders.ts`),
  `group-view` gated per SPEC.md §6 (any active member, not owner-only —
  the one action in this plugin that isn't `group-manage`-scoped). Requires
  a new `reminders` table (`group_id`/`tenant_id`/`from_member_id`/
  `to_member_id`/`sent_at`, migrations generated for both dialects,
  Postgres FK qualifiers manually stripped per the established
  `docs/plugin-database.md` convention) — the spec's "one reminder per
  (actor, target, group) per 24h, checked server-side" requirement has no
  way to be satisfied without persisted state; `sdk.activity.log()` is
  write-only from a plugin's own perspective (no read/query method in the
  SDK), so it couldn't double as that store.

**Re-derives the real balance server-side before allowing a reminder** —
`sendReminderAction` doesn't trust the client's claimed amount; it re-runs
`resolveCounterparties` on the group's current data and confirms the
target genuinely owes the actor, same discipline as every money-adjacent
action in this plugin. A row on cooldown is simply not shown at all
(rather than shown-but-disabled) — Inbox's whole purpose is "here's
something to act on," and the underlying balance is already visible on
Groups/People/Overview regardless, so a nudge with nothing new to do
isn't worth a row.

**`InboxActionButton`** (new, `app/_components/`) is a small shared
`useTransition` + `router.refresh()` trigger for both row kinds — no local
"resolved" state needed: a successful action changes the underlying data
(invite status flips to `'sent'`, or the reminder goes on cooldown), so the
row simply isn't in the feed anymore once the refresh re-fetches it
server-side, confirmed live (see below) rather than assumed.

**A real gap found and fixed, not anticipated during review**: the new
`reminders` table's foreign keys (`from_member_id`/`to_member_id` →
`group_members.id`) broke `scripts/seed.ts --reset` the first time it ran
after this table existed — `FOREIGN KEY constraint failed`, since the
script's own delete-in-dependency-order list predates this table and never
learned about it. Fixed by adding a `reminders` delete (scoped to the two
seed group ids, same as every other table there) immediately before the
existing `group_members` delete, matching the file's own established
ordering convention exactly. Editing this file surfaced its own
pre-existing, unrelated Prettier drift (same category noted in earlier
entries) — accepted the full-file reformat this time rather than leaving
it partially clean, since (unlike every other drifted file this session)
there was a real, substantive reason to touch this one; confirmed via a
filtered diff that every changed line was pure re-wrapping, no logic
changes, before accepting it.

**Live-verified end-to-end** against the running dev server (same
`preview_start {url: ...}` approach as prior entries), including applying
the new migration to the live database first via `sv plugin migrate
fs.sovereign.tally` (a real gap on its own: the already-running dev server
predates this migration file and has no file-watcher that re-applies new
ones — confirmed directly, not assumed, by querying `sqlite_master` for the
table before and after running the command):

- All three real "X owes you $Y — Remind" rows appeared correctly for the
  seeded "Roomies" group, sorted correctly among the plain activity rows.
  Clicking one succeeded, and the row was gone on the next render — the
  DB confirmed why: a real `notifications` row for the correct recipient
  (Dev Auditor, not the actor) with the exact coded title/body, a matching
  `reminders` row recording the rate-limit state, and a
  `fs.sovereign.tally:group.reminder_sent` entry in Console's own
  `/console/activity` page.
- Manually flipped a seeded guest's `guest_invite_status` to `'bounced'`
  (nothing in the seed data starts in that state) to reach the `[Resend]`
  path: the row rendered with the correct warning icon and copy, sorted by
  the guest's `joinedAt` far down the feed as designed. Clicking Resend
  surfaced a real, honest failure — "The invite email failed to send
  again" — because this dev instance has real SMTP configured (Mailpit,
  confirmed via `.env`) rather than running unconfigured, and the actual
  send failed for an environment reason (Mailpit most likely not running
  in this session). Treated as a successful verification of the *failure*
  path, not a blocker: the action correctly attempted a real send, caught
  the real error, and reported it honestly instead of falsely claiming
  success — proving the integration, even though the success path itself
  wasn't independently exercised this session.

Test state reset afterward (`pnpm seed -- --reset`, after fixing the FK
issue above) — confirmed via a fresh Inbox load that all three Remind rows
returned (cooldown cleared) and the bounced-invite row was gone (guest
status back to its seeded default).

`pnpm typecheck`/`eslint`/`prettier --check` (scoped to touched files, now
including the necessarily-reformatted `scripts/seed.ts`)/`pnpm
design:tokens:check`/`pnpm test` (36 tests) all clean.

**Still not built, deliberately**: the Notification Center unread-count
tie-in and the sidebar's own unread badge (`TallySidebar.tsx`) — a
separate UI surface from this feed, not a natural extension of it, and not
part of what was asked for this task. UI-FLOW.md §5 is otherwise now fully
implemented.

**2026-08-27 — Portability: export/import/delete (Post-MVP item 8,
delete-mitigation UI deferred — see below).** New `app/_lib/portability.ts`
implements all three `sdk.portability` hooks (SPEC.md §7/§8), registered
per-request from `(home)/layout.tsx` (best-effort try/catch, the same
in-process-registration-resets-on-restart pattern Docs' own
`registerPortabilityHandlers` already established — reused, not
reinvented).

- **Export** scoped to groups the exporting user actively belongs to
  (`kind: 'user'`, not left) — groups, members, expenses, payers, splits,
  settlements, plus the user's `primaryCurrency` setting. Other real users
  appear only as a captured `label` (their resolved display name at export
  time via `sdk.directory.resolveUsers`) with `isExportingUser: false` —
  never re-linked to their real account on import, matching Docs' own
  "informational only" precedent for other users' ids in an export. A
  `warnings` entry on the export section surfaces this to the importing
  user whenever the exported data actually includes another member.
- **Import** creates a brand-new group per exported group (remapped ids via
  `ctx.remapId`), the importing user as `owner`, and *every* other original
  member — real user or guest alike — recreated as a `guest`
  (`guestOwnerUserId` = importing user, `guestName` = the captured label).
  Deliberate, spec-consistent choice: an import is a personal
  backup/restore, not a live merge into other people's accounts, so nobody
  else's real account gets silently re-added to a group they never agreed
  to rejoin.
- **Delete** (`deleteTallyData`) leaves every `group_members`/`expenses`/
  `expense_payers`/`expense_splits`/`settlements` row in place exactly as
  SPEC.md §7 requires (joint ledger data, not personally-owned) — only the
  user's own `user_settings` row is removed, returning
  `{ deleted: 0 | 1 }`.

**Verified `sdk.db.getClient()` resolves the correct isolated plugin DB
before writing any code, not assumed** — read `runtime/src/portability/
{assemble,restore}.ts` directly and confirmed both wrap handler invocation
in `runWithPortabilityPlugin(pluginId, ...)`, and `sdk-host.ts`'s
`db.getClient()` checks that `AsyncLocalStorage` context as a fallback
(`pluginId ?? portability context ?? background-job context ?? null`) —
the same class of gotcha this file's own Status history already documents
for scheduler/job handlers (`background-plugin-context.ts`), checked
directly here rather than trusted by analogy.

**No manifest change needed** — `data:export`/`data:import` were already
declared at scaffold time (task 1), anticipating this work; this is what
finally exercises them, same pattern as `activity:write`/
`notifications:send` before it.

**Live-verified end-to-end against the real running dev server + real
database**, not just typecheck:

- **Export**: fetched `GET /api/account/export?includeFiles=false` via
  in-page `fetch()` — deliberately avoided the real "Export as ZIP"
  download button, since downloading files needs explicit user permission
  and this route stayed entirely in-browser instead — then manually parsed
  the returned ZIP's Central Directory + Local File Header +
  `DecompressionStream('deflate-raw')` (no library) to extract and inspect
  `plugins/fs.sovereign.tally/data.json` directly. Confirmed against the
  seeded data: 2 groups, 8 members with correct `isExportingUser` flags
  (true only for "Dev Owner" in each group), 14 expenses across all 4
  split methods and 2 currencies, and both settlements with correct
  payer/payee.
- **A real registration-timing non-bug surfaced and correctly diagnosed**:
  the first export attempt excluded Tally entirely (`manifest.json`'s own
  `notExported` array showed `"reason": "no-export-hook"`) — not a code
  bug, but a consequence of the documented "registrations reset on
  restart, re-register per request" pattern: this dev server process had
  never actually served a Tally page since the registration code was
  written, so `registerPortabilityHandlers()` had never run. Fixed by
  navigating to a Tally page first; no code change needed.
- **Import**: POSTed the same export ZIP to `/api/account/import` (the
  `bundle` form field — found by reading the route directly after a first
  attempt with a guessed field name 400'd). Confirmed via direct DB query:
  two new groups created, the importing user as `owner` in both, all 6
  other original members correctly converted to `guest` rows with
  preserved names and `guestOwnerUserId`, all 14 expenses and both
  settlements recreated with ids remapped throughout — settlement
  `from`/`to` member ids point at the correct guest/owner rows (e.g.
  "Jordan Lee → Dev Owner" survived the remap exactly). Cleaned up the two
  test groups afterward via a scratch DB script so they don't linger
  alongside the seeded dataset.
- **Delete**: rather than running a real destructive account deletion
  against the shared dev account, verified `deleteTallyData`'s actual
  logic (mirrored verbatim in a scratch script, matching the shipped code
  exactly) against a throwaway fake user id: correctly deletes that one
  `user_settings` row, returns `{ deleted: 1 }`, is idempotent on a second
  call (`{ deleted: 0 }`), and leaves every ledger table's row counts
  completely unchanged.

**Deliberately not built this task**: SPEC.md §7's "what this means for
v1" soft mitigation — a client-side warning shown before the user proceeds
to delete their account, if they have an outstanding Tally balance.
Researched, not skipped: grepped the runtime/SDK for any hook a plugin
could use to inject a warning into Account's own deletion-confirmation UI
(`deletionWarning`/`DeletionWarning`/`provideDeletionWarning`) — no
matches, confirming SPEC.md's own "not currently buildable" conclusion
extends even to the soft version, not just the hard block, since there's
no insertion point into a flow Tally doesn't own. The only buildable
variant left is a static informational note somewhere in Tally's own UI
(e.g. Settings) — not built here since it wasn't part of what was asked
for this task ("Portability next") and is new UI scope, not a
portability-hook wiring task; tracked as a small, separate follow-up
rather than silently dropped.

`pnpm typecheck`/`eslint`/`prettier --check` (scoped to
`app/_lib/portability.ts` + `app/(home)/layout.tsx`) all clean.

**2026-08-27 — New icons: `users`/`arrow-left-right`/`send` (Post-MVP item
9).** Checked the platform's curated Lucide set before writing any code —
UI-FLOW.md §7's "still needed" list turned out to be stale: all three icons
already existed in the platform's `scripts/icon-list.ts` and were already
generated in `packages/ui` (added at some point for Sheets/Docs/Shopper's
own needs, never circled back to update this plugin's own UI-FLOW.md).
`bell-ring` (the alternate option UI-FLOW.md named for the Remind action)
is **not** in the curated set — only `bell` is — so `send` was the only
one of the two actually available, settling that choice. **This task's
real work was consuming the icons in Tally's own UI, not creating them**:

- `users` — already wired into `TallySidebar`'s People nav link and
  `people/page.tsx`'s empty state before this task; person rows
  deliberately use `Avatar` (initials-based) instead, a richer,
  more-correct identity affordance than a generic icon for a contact list
  — not a gap, a better existing choice UI-FLOW.md's older phrasing hadn't
  anticipated.
- `arrow-left-right` — added to both `SettleUpButton` (the auto-suggested,
  one-click "Settle up" confirm) and `RecordSettlementDialog`'s "Record
  settlement" trigger. Scoped to both, not just the literal
  `SettleUpButton` UI-FLOW.md names, since the two buttons represent the
  same settle action in the same Balances section — icon-ing only one
  would have read as inconsistent, half-finished polish.
- `send` — added to `InboxActionButton` via a new optional `icon?:
  IconName` prop, wired only for the Remind action (`icon="send"` at its
  Inbox call site) — deliberately **not** added to Resend, matching
  UI-FLOW.md §7's literal scope (only Remind gets a named icon).

Followed the exact icon-inside-`Button`-as-children pattern already
established in this codebase (`GroupSettingsButton`'s icon-only gear
button, Sheets' `WorkbookShareButton`'s icon+label "Share" button) rather
than inventing a new convention.

**Live-verified against the real running dev server** (same
`preview_start {url: ...}` workaround as prior entries — the `{name:
"dev"}` spawn path is still broken per this file's own documented
`turbo.json` strict-envMode finding), via direct DOM/SVG inspection rather
than a screenshot glance alone: confirmed all 3 "Settle up" suggestion
buttons in the seeded "Roomies" group render the `arrow-left-right` SVG
(path data matches Lucide's icon exactly), "Record settlement" renders the
same icon, and all 3 "Remind" rows in Inbox render the `send` SVG (paper-
airplane path). A stale `GroupAccessError` appeared in the console buffer
during this pass — confirmed via a forced reload to be the exact
byte-identical entries as before the reload, i.e. this file's own
already-documented "console buffer persists stale entries across
navigations" quirk (task 9's note), not a fresh error; the DOM/screenshot
checks showed no visible breakage either way.

`pnpm typecheck`/`eslint`/`prettier --check` (scoped to the 4 touched
files, including `RecordSettlementDialog.tsx`'s necessary reformat once
its import line grew past print-width — confirmed via filtered diff to be
pure re-wrapping plus the intended icon addition, no logic changes)/`pnpm
design:tokens:check`/`pnpm test` (36 tests) all clean.

**2026-08-27 — Receipt image attach (Post-MVP item 10).** `sdk.storage`
wiring per SPEC.md §8: an optional image upload on `ExpenseForm`, and a
view-receipt link wherever an expense already renders — the shared
`ActivityFeed` component, so both the group's own feed and a person's
cross-group timeline get it identically with no extra plugin-side work.
`expenses.receipt_storage_key` already existed in the schema from task 2,
unused until now.

- **Upload** (`createExpenseAction`, `expenses.ts`): `ExpenseForm` gained
  a `FileDropzone` (`@sovereignfs/ui`, `name="receipt"`, `accept="image/*"`)
  as the form's last field, matching `CONCEPT.md`'s own listed field order
  (payer/date/category/note/receipt). Native `<form action={formAction}>`
  submission carries the `File` straight through FormData — no separate
  upload step or client-side fetch needed, `FileDropzone`'s own doc
  comment confirms this is exactly the supported pattern. Server-side:
  validates `file.type.startsWith('image/')` (CONCEPT.md's "manual image
  attach only" v1 scope), then `sdk.storage.put()` keyed
  `receipts/<expenseId>/<filename>` with **no `ownerUserId`** — a
  deliberate, spec-mandated choice (SPEC.md §8): the object must be
  plugin-scoped, not per-user-owned, since any active group member needs
  to view a receipt someone else attached, not just its uploader.
  Best-effort: an upload failure (bad type, over quota, etc.) surfaces as
  a warning appended to the success message rather than failing the whole
  expense — the split data the user just entered is the primary value,
  not the attachment.
- **View**: new `app/_lib/receipts.ts`'s `resolveReceiptUrls()` —
  batch-generates a `sdk.storage.getSignedUrl()` link (1800s expiry,
  regenerated fresh on every page load, never cached) per
  receipt-bearing expense, shared by `groups.ts`'s per-group feed and
  `people.ts`'s cross-group person feed rather than duplicating the
  signed-URL-generation-plus-per-expense-error-handling logic in both
  (this codebase's established "two real consumers → extract" bar).
  `GroupActivityItem` (`activity.ts`) gained an optional `receiptUrl`
  field; `ActivityFeed` renders a `file-text` icon link (opens in a new
  tab) inline in the row's description when present.
- **No new platform icon needed**: checked `packages/ui`'s curated Lucide
  set before reaching for a dedicated "receipt" icon — `file-text` was
  already available and reads perfectly well as "a document is attached
  here." Requesting a new icon would have meant a separate platform-repo
  branch + draft PR cycle (this plugin's own repo commits directly to
  `main`, but `packages/ui` does not) for a single glyph a suitable
  existing one already covers — deliberately avoided rather than taking
  on unrequested cross-repo process for this task.

**Live-verified end-to-end against the real running dev server + real
database**, not just typecheck — including the one part of this task
genuinely un-automatable through normal UI interaction: a native OS file
picker cannot be driven by browser-automation clicks at all, in any
environment. Injected a real 70-byte 1×1 PNG as a `File` into
`FileDropzone`'s hidden `<input type="file">` via `DataTransfer` +
a dispatched `change` event — exactly mirroring what `FileDropzone`'s own
drop handler already does internally, so this exercises the identical
code path a real drag-and-drop would.

- Submitted the real form (`form.requestSubmit()`, after finding and
  fixing a genuine gap in this session's own test setup, not a product
  bug: the Description field still showed only its placeholder text, not
  a real value, so the form's native validation correctly blocked
  submission client-side with zero network activity — confirmed via
  `form.checkValidity()` returning `false` before the fix and `true`
  after).
- Confirmed via direct DB query (isolated Tally namespace + the platform's
  own `plugin_storage_objects` table) that the created expense's
  `receipt_storage_key` and the storage object row match exactly, and
  critically that `owner_user_id` is `NULL` — the plugin-scoped access
  SPEC.md §8 requires, not silently defaulted to per-user.
- Confirmed the rendered "View receipt" link's `href` is a real
  `/api/storage/<token>` signed URL, and `fetch()`-ed it directly:
  `200 OK`, `Content-Type: image/png` (preserved from upload), `Cache-
  Control: private, no-store` (matching `docs/plugin-development.md`),
  and exactly 70 bytes back — the literal round-tripped image, not just a
  plausible-looking link.
- Confirmed the same link (a fresh, independently-generated signed URL —
  different token, same underlying object id) also renders correctly on
  Dev Admin's own Person detail page, proving `people.ts`'s independent
  `resolveReceiptUrls()` call site works identically to `groups.ts`'s, not
  just copy-pasted and untested.

Test expense and its storage object row removed afterward via a scratch,
git-ignored DB script (`expenses`/`expense_payers`/`expense_splits`
rows plus the matching `plugin_storage_objects` row) so this doesn't
linger alongside the seeded dataset; re-confirmed via a fresh reload that
"Roomies" is back to its exact original balance (`Owed USD 1632.93`) with
no orphaned activity row. The physical 70-byte file under
`data/plugins/fs.sovereign.tally/storage/` was not separately hunted down
and deleted — raw-SQL-deleting the metadata row (rather than calling the
real `sdk.storage.delete()`, not reachable from a standalone script
outside a plugin request context) doesn't remove it, and a single
throwaway 70-byte dev file is not worth a special-cased cleanup path.

`pnpm typecheck`/`eslint`/`prettier --check` (scoped to touched files,
including `ExpenseForm.tsx`'s/`expenses.ts`'s/others' necessary reformat
once import lists grew past print-width — confirmed pure re-wrapping, no
logic changes)/`pnpm design:tokens:check`/`pnpm test` (36 tests) all
clean.

**2026-08-28 — Mobile (Post-MVP item 6, the last item on this list).**
UI-FLOW.md §6's fork: below the platform's mobile breakpoint, the desktop
`ThreeColumnLayout` tree is never mounted at all — a completely different,
single-full-width-pane drill-down presentation renders instead, backed by
a self-rendered `MobileFooter` (`manifest.json`'s `shellConfig.mobileFooter:
false` had been set since scaffold time, anticipating this).

**Two scope decisions checked with the developer before building, both
because UI-FLOW.md's own text turned out to not fully match reality once
checked against the real `@sovereignfs/ui` component APIs and platform
architecture** (matching this session's own established discipline of not
trusting a spec doc at face value — the icon list and the "tabs" framing
were both already found stale earlier in this plugin's history):

- **Header: kept the platform's default, not self-rendered.**
  UI-FLOW.md asked for "the platform's header, plus a trailing gear icon
  and an Add-expense action, always visible" — but `MobileHeader`'s real
  API has no slot for extra actions beyond an optional `title`; self-
  rendering it (`shellConfig.mobileHeader: false`) means rebuilding a
  *working* notification bell and account menu from scratch (confirmed by
  reading `example-plugins/example-mobile-poc`, the platform's own
  stability-evaluation reference for this exact component pair), a real
  cost for a benefit an in-page alternative gets close enough to. Settings
  is reached instead via a `MobileSettingsLink` gear icon
  (`useIsMobile()`-gated, renders nothing on desktop) composed into each
  of the 4 list screens' existing `PageHeader`'s `action` slot — matching
  `PageHeader`'s own documented "the action content's own responsibility
  to look different on mobile" convention. "Add expense always visible
  regardless of section" was also corrected against reality, not just
  API constraints: desktop itself has never had a global Add-expense
  either — it's scoped to Group detail's own header, where it already
  lived — so mobile mirrors that instead of introducing a new global
  affordance neither platform nor spec's own desktop-side design has.
- **Footer: built a real "Apps" drawer, not a stub.** UI-FLOW.md claimed
  `MobileFooter`'s center launcher was "already exactly what you asked
  for, not something new to build" — false: there is no platform-level
  drawer a plugin can reach into (`runtime`'s own `MobileNav` is private
  to the shell). `example-plugins/example-mobile-poc` is the real
  reference; built the same way — `sdk.plugins.list()` (no manifest
  permission required, confirmed against `docs/plugin-development.md`'s
  full permission table — it's not gated) fetched server-side in
  `(home)/layout.tsx`, filtered to `availableToUser` and excluding Tally
  itself, passed down as a plain serializable prop, rendered via a real
  `MobileAppsDrawer`. Live-verified it lists the real 8 other installed
  plugins (Account/Console/Docs/Kanban/Launcher/Ledger/Sheets/Warden) with
  correct `/plugin-icons/<id>.svg` icons and working navigation.

**Drill-down**: `TallyResponsiveShell.tsx` (new, `useIsMobile()` + plain
early return — simpler than `<ResponsiveSurface web mobile/>` for this
two-branch case, no material difference either way) forks between the
unchanged desktop tree and `TallyMobileShell.tsx` (new), which shows
either the `@detail` slot (a selected group/person, full-width) or the
current section's list, plus the footer — 4 icons split left/right
matching the sidebar's own order (Overview/Groups left, People/Inbox
right; Settings freed from the footer, see above), `onClick` +
`router.push` rather than `FooterIcon`'s plain-`<a>` `href`, matching the
platform's own `MobileNav` precedent for client-side navigation.
`@detail/groups/page.tsx`/`@detail/people/page.tsx`'s existing X
close-link gained a CSS-only (`@media (max-width: 768px)`, matching
`MOBILE_BREAKPOINT_PX`) chevron-left-plus-label variant, reordered ahead
of the title via `order: -1` — desktop's X is completely unchanged, no
JS/breakpoint-conditional component needed for this piece at all.

**A real bug found and fixed, not anticipated during review** — blanked
the entire mobile content pane on every route with nothing selected. First
attempt picked which of `children`/`detail` to show via `detail ?? children`
(the parallel-route slot's content when present, else the current section).
Live-tested and found genuinely broken: `/tally` rendered the header/footer
chrome correctly but a completely empty content area. Root-caused by direct
inspection rather than guessing — a `detail === null` check printed `false`
even on `/tally`, a route where `@detail/default.tsx` really does
`return null` server-side. The `detail` *prop value* a client component
receives is a real Next.js parallel-route/RSC reference, never the literal
JS `null`, even when what it will eventually render is nothing — `??` only
treats `null`/`undefined` as absent, so it always picked `detail`, which
then correctly rendered as empty, exactly matching the observed bug. (First
fix attempt — switching `<ResponsiveSurface web mobile/>` to a plain
`useIsMobile()` early return — was a real simplification but didn't
address this; kept anyway, reverted the wrong theory out of the code
comment once the actual cause was confirmed.) Fixed by not testing the RSC
prop's nullness in JS at all: `TallyMobileShell` now decides via the URL's
own `?g=`/`?p=` param (`useSearchParams()`, real synchronously-known client
state) which of `children`/`detail` to render, passing both down rather
than pre-merging them.

**Live-verified end-to-end** against the real running dev server (mobile
viewport, `resize_window` preset mobile), including the one part
un-automatable through normal UI interaction — a native OS file-open
dialog doesn't apply here, but click coordinates from the accessibility
tree occasionally landed on the wrong element at this viewport size, worked
around by driving `aria-label`-targeted elements directly via
`javascript_tool` `.click()` calls, matching the exact real DOM nodes a
user's tap would hit:

- Overview: headline/stat cards, Groups/People breakdown, Settings gear —
  all render correctly full-width.
- Groups list → tapped into "Bali Trip": full drill-down (back link,
  gear, Close group, Add expense/Record settlement, Balance summary,
  Balances, Activity feed with the receipt-link icon slot intact) all
  rendered; back link returned cleanly to the list with no stale state.
- People list → tapped into "Dev Admin": same drill-down shape, cross-group
  activity feed with `· Roomies` group-name suffixes intact.
- Inbox: full feed including `[Remind]` actionable rows with their `send`
  icon, footer's Inbox icon correctly active.
- Settings: reachable via the gear icon from every one of the other 4
  screens, renders full-width, correctly has no active footer icon (not
  one of the 4 sections).
- Apps drawer: opens above the footer with correct clearance (confirming
  the `--sv-shell-footer-height` local redeclaration — the same defensive
  fix `example-mobile-poc` needed for the identical reason, a self-rendered
  footer zeroing the shell's own copy of that variable) — no clipped last
  row.
- **Desktop re-confirmed completely unaffected** after all of the above:
  fresh reload of `/tally/groups?g=seed-group-roomies` at desktop width
  shows the unchanged 3-column layout, sidebar, and the original X
  close-icon (not the mobile chevron+label) — the responsive fork and the
  CSS breakpoint swap both correctly leave desktop's existing, already-
  shipped experience untouched.

`pnpm typecheck`/`eslint`/`prettier --check`/`pnpm design:tokens:check`/
`pnpm test` (36 tests) all clean.

**2026-08-28 — Notification Center unread-count badge (the last piece of
Post-MVP item 4, Inbox).** UI-FLOW.md §5's own line: "The unread/dot state
ties into the platform's real Notification Center (`sdk.notifications.
list()`) so the sidebar's Inbox item can show an unread count consistent
with the bell." New `app/_lib/notifications.ts`'s `getUnreadInboxCount()`
does exactly that — fetched server-side in `(home)/layout.tsx` alongside
the already-fetched plugin list, threaded through `TallyResponsiveShell`
to both `TallySidebar` (a trailing numeric pill on the Inbox row) and
`TallyMobileShell` (an overlay badge on the footer's Inbox icon, plus the
icon's own `label`/`aria-label` gains "(N unread)" for screen readers,
matching the platform bell's own pattern of appending unread count to its
`aria-label` rather than relying on a visually-hidden, `aria-hidden` badge
alone).

**A real API constraint discovered and worked around, not assumed away**:
`sdk.notifications.list()`'s own doc comment says plainly "the same real,
cross-plugin list the platform's own bell shows... **not scoped to the
calling plugin**." There is no server-side per-plugin filter — every
plugin's notifications for the current user come back together. Filtered
client-side (well, server-side in this plugin's own code) to `source ===
'fs.sovereign.tally'`, at the SDK's own max `limit` (100, host-enforced).
Documented, not silently accepted: a user with an unusually large
cross-plugin inbox could theoretically have some of Tally's own
notifications pushed past that 100-item window, undercounting in that
edge case — not worth a bigger mechanism (there is no `list()` option to
avoid it) for a decorative sidebar badge.

**A real UI primitive found and deliberately not adopted, not missed**:
`@sovereignfs/ui` has a full `NotificationsPanel` component — a
generalized, presentational bell+dropdown (mark-read/dismiss/clear-all,
same visual structure as the platform's own `NotificationBell`) built
specifically so a plugin doesn't hand-roll one. Read it in full before
deciding: it's a complete interactive notification panel, a materially
bigger feature than what was asked for here ("the badge tie-in," matching
UI-FLOW.md's own literal "unread count" framing, not "build an in-app
bell"). Adopting it is a reasonable *future* task if an in-Tally
notification panel is ever wanted, but out of scope for this one — noted
here rather than silently building it anyway or silently ignoring that it
exists. What *was* borrowed from it: the semantic token pattern for an
unread badge's text color (`--sv-color-text-on-error`, found via its CSS,
confirmed against `--sv-color-error-text` for the background) rather than
a hardcoded `white` — `pnpm design:tokens:check` doesn't actually flag
bare CSS keyword colors like `white` (confirmed empirically — the
platform's own `NotificationBell.module.css` and `NotificationsPanel.
module.css` both use it unflagged), but the token is more correct and
theme-consistent regardless of what the checker catches.

**Deliberately not live-polled.** The platform bell's own unread count
updates via a 10s poll + SSE fallback loop — real, but platform-private
state (`runtime/app/(platform)/_components/NotificationBell.tsx`'s
module-level shared store, not reachable from a plugin; importing it would
violate the SDK boundary rule). Tally's own badge is fetched once per
server render (same request as the rest of the layout), so it's accurate
as of the last navigation, not updated in real time without one.
UI-FLOW.md's own phrasing — "consistent with the bell" — reads as "same
underlying data," not "same refresh cadence," and building an independent
poll loop for one sidebar badge would be disproportionate.

**Live-verified end-to-end against the real running dev server + real
database**, not just typecheck. The write side (real cross-user
notifications reaching Tally's own `sdk.notifications.send()` calls) was
already fully verified in an earlier task (Notifications + activity log
wiring) — this pass exercised specifically the *read*/badge side, which
hadn't existed until now:

- Confirmed via direct query that real, pre-existing unread Tally
  notifications already sat in the platform's `notifications` table for
  other seeded users (Dev User, Dev Auditor) from earlier sessions'
  live-testing — useful confirmation the write path's data was still
  there, but not usable for testing *this* user's own badge without
  switching identity.
- Inserted two realistic test notification rows for the actual
  logged-in dev session (Dev Owner, confirmed via `/api/auth/get-session`)
  matching the real `notifications` table schema exactly (checked via
  `PRAGMA table_info`) — a deliberate, minimal substitute for triggering a
  real cross-user action, which isn't reachable from a single authenticated
  browser session.
- Reloaded: the platform's own bell showed "2", `TallySidebar`'s Inbox row
  showed a matching "2" badge (desktop, confirmed both visually and via
  direct DOM inspection — `aria-label="Inbox (2 unread)"`), and
  `TallyMobileShell`'s footer Inbox icon showed the same "2" (confirmed at
  a real mobile viewport) — all three numbers agreeing, the literal
  "consistent with the bell" requirement.
- Called the platform's own real mark-all-read endpoint (the same one the
  bell's UI calls), reloaded, and confirmed the badge disappeared from both
  desktop and mobile on the next render — proving the read state, not just
  the initial unread state, flows through correctly.
- Test notification rows deleted afterward (scoped precisely to this
  session's own inserted rows, by recipient + a distinguishing body prefix)
  so the pre-existing real unread notifications for other seeded users
  were left untouched.

`pnpm typecheck`/`eslint`/`prettier --check`/`pnpm design:tokens:check`/
`pnpm test` (36 tests) all clean.

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
4. ~~**Inbox**~~ — ✅ shipped 2026-08-27 — cross-group activity feed, then
   `[Resend]`/`[Remind]` actionable rows — see Status below. The
   Notification Center unread-count tie-in and the sidebar's/mobile
   footer's own unread badge — a separate UI surface (`TallySidebar.tsx`/
   `TallyMobileShell.tsx`), not this feed — shipped separately, 2026-08-28,
   see below — UI-FLOW.md §5.
5. ~~**Settings (account-level)**~~ — ✅ shipped 2026-08-27 — Primary
   Currency — UI-FLOW.md §8. (Per-group settings — name/description/
   currency/dates edit, member management, guest invites — is item 1
   above, a separate, much larger surface UI-FLOW.md §8 also covers.)
6. ~~**Mobile**~~ — ✅ shipped 2026-08-28 — responsive fork, self-rendered
   `MobileFooter` with a real app drawer, drill-down stack — see Status
   below — UI-FLOW.md §6.
7. ~~**Notifications + activity log wiring**~~ — ✅ shipped 2026-08-27 —
   `sdk.activity.log()` on every mutating action, `sdk.notifications.send()`
   on the three SPEC.md §6 names (member added, expense added, settlement
   recorded) — see Status below. Unblocks Inbox's remaining actionable-rows
   half (item 4) whenever that's picked up next.
8. ~~**Portability**~~ — ✅ shipped 2026-08-27 —
   `provideExport`/`provideImport`/`provideDelete`, including the "block
   deletion with a non-zero balance is not actually enforceable today"
   finding from SPEC.md §7 — see Status below. The soft client-side warning
   mitigation SPEC.md §7 also names turned out to be separately
   not-currently-buildable too (no SDK insertion point into Account's own
   deletion UI) and remains a small, deferred follow-up, not silently
   dropped.
9. ~~**New icons**~~ — ✅ shipped 2026-08-27 — `users`, `arrow-left-right`,
   `send` — see Status below — UI-FLOW.md §7.
10. ~~**Receipt image attach**~~ — ✅ shipped 2026-08-27 — `sdk.storage`
    wiring per SPEC.md §8 — see Status below.

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
