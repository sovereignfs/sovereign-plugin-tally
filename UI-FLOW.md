# Tally — UI flow

**Status:** Draft, incorporating decisions resolved 2026-08-26\
**Follows:** [`CONCEPT.md`](CONCEPT.md) (why), [`SPEC.md`](SPEC.md) (data
model, actions, SDK surfaces). This doc is the screen-by-screen "what" and
"where."\
**Verified against:** `packages/ui/src/components/{ThreeColumnLayout,
MobileFooter, ResponsiveSurface, Tabs, NavTabs}`,
`example-plugins/example-layouts` (the reference `ThreeColumnLayout` +
mobile-fork implementation), `runtime/app/(platform)/_components/
MobileNav.tsx` (the platform's own footer usage), `docs/design-system.md`.

---

## 1. Shell

```json
"shell": "default",
"shellConfig": { "mobileFooter": false }
```

`mobileFooter: false` opts Tally into self-rendering its own `MobileFooter`
(RFC 0075's documented pattern) instead of the platform's default Home/
Search footer — required, since the nav items below are Tally-specific.
`mobileHeader` stays the platform default (`true`) — Settings reaches
through a gear icon added to that header, not a custom one (§5).

## 2. Web layout — `ThreeColumnLayout`

**Correction (2026-08-26):** reading the real Docs/Sheets plugin repos
directly showed the earlier claim here — "consistent with how Docs and
Sheets already use it" — was wrong. Both use `ThreeColumnLayout`, but
**strictly 2-column** (sidebar + main, via a persistent `(home)/layout.tsx`
route-group wrapper); drill-down (a folder, a document, a workbook) is a
real route navigation that fills the main slot, never a client-state third
column shown alongside a still-visible list. **Tally's 3-column design
(list + persistent detail pane, §4/§8 below) is confirmed to stay as
originally specified** — it matches your original ask — but it has no
sibling precedent in this app family; Tally is the first to actually use
`ThreeColumnLayout`'s 3-child mode. Noted here so this isn't mistaken for
an established pattern later.

Also worth designing around from the start: **`ThreeColumnLayout` has no
responsive behavior of its own** — its own doc comment says so explicitly,
and `example-plugins/example-layouts`' reference pair
(`ThreeColumnDemo.tsx` / `MobileStackedDemo.tsx`) shows the actual pattern:
two **completely separate trees** forked with `ResponsiveSurface`, not one
tree that squeezes itself. §6 below is Tally's mobile tree, built the same
way — a drill-down stack, not a shrunk three-column layout.

```tsx
<ResponsiveSurface web={<TallyThreeColumn />} mobile={<TallyMobileStack />} />
```

### Sidebar (first column, fixed width)

```
┌─────────────────┐
│  ⊞  Overview     │  layout-dashboard
│  ▤  Groups       │  (new icon — §7)
│  ◐  People       │  (new icon — §7)
│  ✉  Inbox        │  inbox
│                  │
│  ⋯ (spacer)      │
│                  │
│  ⚙  Settings     │  settings — pinned to the bottom, visually separated
└─────────────────┘
```

Four primary nav items map 1:1 to the platform-role/resource-role split
`SPEC.md` §5 already draws: **Overview** and **Inbox** are personal,
cross-group views; **Groups** and **People** are the two ways of slicing
the same underlying ledger data (by group vs. by person — `SPEC.md` §4's
"Cross-group rollups" section is what makes People possible without its
own table). Settings is deliberately outside that block — it's account-
level (`user_settings`, `SPEC.md`), not ledger content.

### Main + detail column, per section

| Section | Main (2nd column) | Detail (3rd column) |
|---|---|---|
| Overview | Stats/rollup content (§4) | *(none — 2-column only, per `ThreeColumnLayout`'s "omit the third child" mode)* |
| Groups | Group list + filters + "New group" | Selected group's tabs (§8) |
| People | Person list | Selected person's tabs (§8) |
| Inbox | Feed (§5) | *(none)* |

### The "Add expense" entry point

Not a nav item — a **persistent action**, not a destination, matching
Splitwise's own "+" pattern. Placed as a primary button in the sidebar
header (web) and as the mobile header's trailing action (§6) — always one
tap away regardless of which section is active. Opens directly to group
selection if launched from Overview/Inbox/People-without-selection, or
pre-fills the group if launched from a group already open in the detail
column. This was missing from the original nav breakdown — flagging it
explicitly here so it doesn't fall out of the build.

## 3. Overview

Now in v1 scope (`CONCEPT.md` §7, reversing the original non-goal). Content,
top to bottom:

1. **Headline rollup** — "You're owed **{X}** · You owe **{Y}**", shown
   **per currency** (`SPEC.md` §4 — no exchange rates in v1, confirmed
   2026-08-26). `user_settings.primary_currency` only decides which one
   renders first/largest when a user holds balances in more than one; a
   single-currency user just sees one clean line, and multi-currency users
   see e.g. "$340 · €50" side by side rather than one blended, silently
   wrong number.
2. **Groups needing attention** — up to N groups with a non-zero balance,
   each a `BalanceChip` + group name, linking straight into that group's
   detail column. This is the single most actionable Overview element —
   surfaced first, not buried under charts.
3. **Spend by category** — this month, per-currency (no conversion needed
   here — see `SPEC.md` §4's rationale). Simple bar/donut; defer exact
   chart choice to the `dataviz` skill when building.
4. **Monthly trend** — your share of expenses, last 6–12 months.
5. **Recent activity** — last handful of expenses/settlements across every
   group — intentionally the same underlying query as Inbox's feed (§5),
   just truncated and non-interactive here. One data source, two
   presentations, not two features to maintain.

Empty state (brand-new user, zero groups): skip the whole page, no charts
over zero data — a single `EmptyState` prompting "Create your first group"
in place of the entire stats stack.

## 4. Groups

**Main column:**

- Filter control at the top: All / Outstanding balances / You owe / You're
  owed. `SegmentedControl` on web; collapses to a `Select` on the mobile
  stack (§6) — four labels is tight for a touch-width segmented control.
- List of `Card`/`CardTile` rows: group name, member avatars (via
  `sdk.directory.resolveUsers`), and a `BalanceChip` summarizing *your*
  balance in that group (per-currency if the group has more than one — no
  blended number at this level, unlike Overview).
- "New group" CTA — opens `createGroupAction`'s form (name required;
  description, default currency, start/end dates, initial members all
  optional at creation, editable after via Group settings, §8).

**Detail column** (on selecting a group) — `Tabs`:

- **Balances** — every member's `BalanceChip`, per currency; the
  simplified-debt suggestion list (`SPEC.md` §4) with a "Settle up" button
  per suggested payment, pre-filled into `recordSettlementAction`.
- **Activity** — chronological log of this group's expenses/settlements/
  membership changes (backed by `sdk.activity.log()` entries, `SPEC.md` §6),
  with dates.
- **Analytics** — this group's own spend-by-category/trend, same shape as
  Overview's but scoped to one group.

CTAs (header of the detail column, not buried in a tab): **Settle up**
(jumps to the Balances tab's suggestion flow), **Close group** (§7's
`archiveGroupAction`, disabled with a tooltip explaining why while any
balance is non-zero), **Delete** (only rendered at all once the group has
zero expenses/settlements — `SPEC.md` §7), **Group settings** (gear icon →
§8).

## 5. Inbox

**Naming collision, deliberately accepted (2026-08-26):** Docs' and Sheets'
own Inbox pages are both explicitly scoped as "things shared with you by
others" (workbooks/folders you don't own) — a narrower, different concept
from Tally's. Confirmed to keep the name anyway: Tally's domain has no
real equivalent to "shared but not joined" (you're either a group member
or you're not), so the established meaning wouldn't map cleanly even if
adopted. Documented here so a future reader comparing Tally's Inbox to any
sibling app's Inbox knows the divergence was seen and chosen, not missed.

**Confirmed 2026-08-26: the merged-feed design below.** Your original
answer to what Inbox contains was "all of the above" — Tally-scoped
notifications, a cross-group activity feed, and action-required items —
and the merged single feed (over three separate sections) is the confirmed
way those combine:

One reverse-chronological feed, sourced from the same events every
mutating action already logs (`sdk.activity.log()` + `sdk.notifications.
send()`, `SPEC.md` §6) — not three separate data sources. Each item renders
with an inline action where one applies, rather than routing "actionable"
items to a separate section:

```
┌────────────────────────────────────────────┐
│ ● Jamie added "Groceries" · $42.10          │   Roomies · 2h ago
│                                              │
│ ● You were settled up with by Alex          │   Ski Trip · yesterday
│                                              │
│ ⚠ Alex's invite email bounced   [Resend]     │   Roomies · 2d ago
│                                              │
│ ● Sam owes you $18.00           [Remind]     │   Weekend · 4d ago
└────────────────────────────────────────────┘
```

- Plain informational rows (expense added, settled up) — no action, just
  the log.
- Rows with a real pending action (`guest_invite_status = 'bounced'`,
  or a person with an outstanding balance you haven't nudged recently) get
  an inline button — `Resend`/`Remind` calling straight into the matching
  `SPEC.md` §6 action, respecting the 24h reminder cooldown.
- The unread/dot state ties into the platform's real Notification Center
  (`sdk.notifications.list()`) so the sidebar's Inbox item can show an
  unread count consistent with the bell.

(The three-separate-sections alternative was considered and explicitly
not chosen — noted here for anyone revisiting this later.)

## 6. Mobile

**No sibling precedent for this section, checked directly:** Sheets (the
same `shell: "default"` as Tally) has zero custom mobile handling at all —
no `ResponsiveSurface` fork, no self-rendered footer, nothing; it just
inherits the platform's default chrome and whatever `ThreeColumnLayout`
does un-forked at narrow widths. Docs' custom mobile header exists only
because `shell: "minimal"` gives it no access to the platform's real shell
chrome at all — a forced consequence of that shell choice, not a general
"better mobile UX" pattern. Neither is really Tally's precedent; the
self-rendered-footer approach below instead follows the *other* documented
platform pattern (`sovereign-tasks`/`sovereign-shopper`, referenced
throughout `CLAUDE.md`'s changelog), which fits better here given Tally's
balance-checking/settling-up use case is plausibly mobile-first in a way
spreadsheet/document editing usually isn't.

### Footer (`MobileFooter`, self-rendered)

`MobileFooter` hard-caps at 2 icons per side around the fixed, non-
overridable center launcher (confirmed in `packages/ui`'s implementation).
Per your answer, Settings moves to a header gear icon — freeing the footer
for exactly the 4 primary sections, split to match the sidebar's own
top-to-bottom order:

```tsx
<MobileFooter
  onOpenApps={openPlatformDrawer}   // center — the platform's own app switcher, not Tally's
  leftIcons={[
    { icon: <Icon name="layout-dashboard" />, label: 'Overview', href: '/tally' },
    { icon: <Icon name="layers" />, label: 'Groups', href: '/tally/groups' },
  ]}
  rightIcons={[
    { icon: <Icon name="users" />, label: 'People', href: '/tally/people' },
    { icon: <Icon name="inbox" />, label: 'Inbox', href: '/tally/inbox' },
  ]}
/>
```

`onOpenApps` wires to the **platform's** app drawer (same as
`runtime/app/(platform)/_components/MobileNav.tsx` does today) — this was
already exactly what you asked for, not something new to build.

### Header

Standard platform mobile header, plus a trailing gear icon (Settings) and
the "Add expense" action (§2) — both always visible regardless of which
Tally section is active.

### Drill-down instead of a third column

Mirrors `example-plugins/example-layouts`' `MobileStackedDemo.tsx` exactly:
one full-width screen at a time, back-navigable, same underlying
list/detail state as the web tree — not a new pattern to invent.

```
Groups list  →  Group detail (tabs: Balances / Activity / Analytics)
People list  →  Person detail (tabs: Balances / Activity / Analytics)
```

Each screen owns a back affordance in its own header (`chevron-left` +
label), consistent with the reference implementation's `backLink` pattern.

## 7. New icons needed

Curated set is Lucide-sourced via `scripts/generate-icons.ts` — adding one
is a name in `scripts/icon-list.ts` + `pnpm generate:icons`, not a new
dependency. Already available: `layout-dashboard`, `inbox`, `settings`,
`user`, `layers`, `folders`, `history`, `activity`, `plus`, `x`,
`chevron-left`, `chevron-right`, `check`, `circle-check`, `trash-2`,
`alert-triangle`. Still needed:

- `users` (plural) — People nav + person rows.
- `arrow-left-right` — settle-up affordance (Lucide has this; reads more
  specifically as "settle/transfer" than a generic checkmark).
- `send` or `bell-ring` — the Inbox `Remind` inline action.

## 8. Settings

**Account-level (`/tally/settings`):**

- **Primary Currency** — a single `Select` of ISO 4217 codes, backing
  `user_settings.primary_currency` (`SPEC.md`). Two effects only, both
  cosmetic: pre-fills the currency field when creating a new group/expense,
  and decides display order on Overview's per-currency rollup (`SPEC.md`
  §4). **No conversion happens anywhere** — say this on the screen itself
  ("Sets your default currency — Tally never converts between
  currencies") so it's never mistaken for an aggregation/conversion
  setting.

**Per-group (`/tally/groups/:id/settings`, `group-manage` only):**

- Name, description, default/base currency, start date, end date
  (`updateGroupDetailsAction`, `SPEC.md` §6/§9) — one form.
- **Members — real-user path validated against a live reference
  implementation.** Sheets' `WorkbookShareDialog.tsx` (a close port of
  Docs' `FolderShareDialog`) is the pattern to follow for adding a
  Sovereign user: a debounced (250ms, 2-char minimum) `sdk.directory.
  searchUsers` live search feeding a picker, a role `Select`, member rows
  with a `StatusBadge` + `Remove` button, built on `Dialog` + `FormField` +
  `useActionState`. Confirms `SPEC.md`'s plan needs no structural change —
  this is exactly that shape, already proven in two shipped plugins.
  **The guest/email-invite half has no such precedent** — checked directly,
  and neither Docs' nor Sheets' sharing supports inviting someone without
  an account; their "email" step (`emailMember`) only notifies an
  *already-resolved* existing user at their real address, which is
  `sdk.email`/`notifications:send` territory, not the raw-address
  `mailer:sendExternal` path Tally's guest invite needs (`SPEC.md` §8).
  Tally would be first to build this in the app family — not a reason to
  drop it, just worth building carefully rather than assuming a pattern
  to copy. Supplying an email on a guest sends an actual notice via
  `sdk.mailer.send()`, gated on SMTP being configured on the instance.
  Surface delivery state per guest row (`guest_invite_status`: sent /
  bounced / none) with a `Resend` action where relevant — same action
  Inbox's inline button (§5) calls.
- Role management (owner/member) and remove-member, both subject to
  `SPEC.md` §5's last-owner and non-zero-balance guards — the UI should
  explain *why* a control is disabled (tooltip), not just grey it out.

## 9. Status: all UI-flow-level items resolved as of 2026-08-26

- ~~Inbox's merged-feed design~~ — confirmed (§5): one feed, inline actions,
  no three-section split.
- ~~Exchange rate source~~ — moot: no currency conversion in v1 at all
  (§3, §8).
- **Account deletion vs. outstanding balance** — intent decided (block),
  but `SPEC.md` §7 found the platform's actual RFC 0033 deletion design
  gives plugins no way to veto deletion, only post-commit cleanup. v1
  ships a warning dialog, not a real block — a genuine hard block needs a
  new platform-level RFC, outside this plugin's own scope.

Only item left, and it's outside this doc's scope: the external naming/
trademark check on "Tally" against `registry/plugins.json` and beyond,
before this leaves `.local` (`SPEC.md` §11, `CONCEPT.md` §7).
