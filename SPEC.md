# Tally — technical spec

**Status:** Draft — implementation-ready, pending a naming/collision check and
formal RFC/epic entry if this graduates out of `.local`\
**Date:** 2026-08-26\
**Precedes:** [`CONCEPT.md`](CONCEPT.md) (problem, competitive positioning,
v1 feature scope, non-goals — read that first). This doc is the "how," not
the "why."\
**Verified against:** `docs/plugin-development.md`, `docs/plugin-database.md`,
`packages/manifest/src/schema.ts`, `packages/db/src/schema/sqlite/platform.ts`,
`packages/ui/src/components/*`, at platform version `0.94.16`.

---

## 1. A platform finding that shapes this whole spec

`packages/ui` already ships components built for exactly this domain, with
doc comments that name the use case explicitly:

| Component | File | Purpose |
|---|---|---|
| `BalanceChip` | `packages/ui/src/components/BalanceChip/BalanceChip.tsx` | Green/red/neutral "owed / owes / settled" indicator. Its own doc comment says *"not Tally-specific despite the naming."* |
| `CurrencyInput` | `packages/ui/src/components/CurrencyInput/CurrencyInput.tsx` | Decimal entry that reports **integer cents**, never a float. |
| `SplitMethodSelector` | `packages/ui/src/components/SplitMethodSelector/SplitMethodSelector.tsx` | The exact `equal \| amount \| percentage \| shares` four-way picker from `CONCEPT.md` §4, already built. |
| `MemberMultiSelect` | `packages/ui/src/components/MemberMultiSelect/MemberMultiSelect.tsx` | Checkbox list over `{id, label}` options — explicitly documented as agnostic to "instance user vs. guest member." |
| `QuantityStepper` | `packages/ui/src/components/QuantityStepper/QuantityStepper.tsx` | +/- numeric input with fractional `step` — reusable for a "shares" split method's per-person share count. |

This means three data-model conventions are **not this spec's decision to
make** — they're already fixed by the design system it must render into:

1. **Money is always integer cents, never a float**, in every layer (DB
   column, server action payload, component prop).
2. **Split method is exactly the four-value union** `'equal' | 'amount' |
   'percentage' | 'shares'` — reuse `SplitMethodSelector`'s own exported
   `SplitMethod` type rather than redeclaring it.
3. **Guest members are a first-class, undifferentiated option in any
   member-picking UI** — `MemberMultiSelect` was built assuming this from day
   one, so the DB schema (§3) must give guests real, resolvable `{id, label}`
   identity.

## 2. Manifest

```json
{
  "schemaVersion": 1,
  "id": "fs.sovereign.tally",
  "name": "Tally",
  "version": "0.1.0",
  "description": "Split shared expenses with a group and track who owes whom.",
  "type": "sovereign",
  "runtime": "native",
  "routePrefix": "/tally",
  "shell": "default",
  "icon": "icon.svg",
  "repository": "https://github.com/sovereignfs/sovereign-tally",
  "permissions": [
    "auth:session",
    "db:readWrite",
    "storage:readWrite",
    "notifications:send",
    "activity:write",
    "data:export",
    "data:import",
    "mailer:send",
    "mailer:sendExternal"
  ],
  "capabilities": {
    "group-view": { "description": "View a group's expenses and balances." },
    "group-add-expense": {
      "description": "Add/edit expenses and record settlements in a group."
    },
    "group-manage": {
      "description": "Rename/delete a group, and add/remove its members."
    }
  },
  "roles": {
    "group-owner": {
      "description": "Full control of a group.",
      "capabilities": ["group-view", "group-add-expense", "group-manage"],
      "scope": "resource"
    },
    "group-member": {
      "description": "Regular group participant.",
      "capabilities": ["group-view", "group-add-expense"],
      "scope": "resource"
    }
  },
  "compatibility": {
    "minPlatformVersion": "0.94.0"
  }
}
```

Notes:

- `type: "sovereign"` (not `platform`) — Tally is a first-party app in its
  own repo eventually, like the `sovereign-tasks`/`sovereign-shopper`
  pattern referenced elsewhere in this codebase's docs, not a built-in
  platform chrome plugin. `repository` is a placeholder until a real repo
  exists.
- `shell: "default"` — a primary nav-level app (group list, group detail,
  expense history), not a settings-style overlay dialog.
- `mailer:send` + `mailer:sendExternal` — required together for the guest
  email-invite flow (§3, §8): `sdk.mailer.send()` is gated on `mailer:send`
  at the SDK host boundary for *any* send, and additionally requires
  `mailer:sendExternal` whenever the recipient is a raw address rather than
  a platform-resolved user id (`docs/plugin-development.md`'s "Plugin
  email" section — inviting someone without an account yet is its own
  worked example). Notification Center (`notifications:send`) still covers
  every in-app event for real users ("added to a group," "an expense was
  added," "settled up with you") — email is only for the guest-invite path,
  which has no session to deliver an in-app notification to.
- No `jobs:write`/`schedules` — recurring expenses are an explicit
  `CONCEPT.md` §6 non-goal for v1.
- No `crypto:use` (field encryption, RFC 0092) for v1. Expense
  descriptions/amounts are the kind of data every group member already sees
  by design — there's no within-group confidentiality boundary for a field
  encryption class to protect. Revisit only if a future feature needs
  operator-blind data.
- `data:export`/`data:import` are declared **because this spec registers
  both hooks** (§8) — never declare either without the matching
  `sdk.portability` registration (`docs/plugin-development.md`'s "Export
  completeness" section flags exactly this gap).

## 3. Data model

Every plugin gets an unconditionally isolated store now (no `database`
manifest field exists anymore — see `docs/plugin-database.md`), so table
names need **no slug prefix**. Conventions followed, matching
`packages/db/src/schema/sqlite/platform.ts`:

- IDs: `crypto.randomUUID()` — text primary keys. (The platform schema's own
  comment says "IDs are ULIDs," but no `ulid` package exists anywhere in
  this workspace's dependency tree; every real ID-generation call site found
  uses `crypto.randomUUID()`. Following the platform's actual practice, not
  its aspirational comment — `createdAt` already gives insertion order where
  it matters, so ULID's lexicographic-sort property buys nothing here.)
- Timestamps: Unix epoch seconds, `integer` in the `sqlite-core` schema app
  code queries through — but `bigint({ mode: 'number' })` in the
  `schema.postgres.ts` migration-generation mirror; see "Drizzle schema
  files" below for why this one column type deliberately isn't
  dialect-uniform.
- Booleans: `integer` with Drizzle's `{ mode: 'boolean' }`.
- `tenant_id` on every user-scoped table, from day one.
- Money: `integer` cents, ISO 4217 `text` currency code alongside it
  wherever an amount appears (per §1, no exceptions).

```
groups ──< group_members >── (guest OR real user)
  │
  └──< expenses ──< expense_payers  (who paid, and how much of the total)
  │           └──< expense_splits   (who owes what share)
  │
  └──< settlements  (a direct payment between two members)
```

### `groups`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `tenant_id` | text NOT NULL | |
| `name` | text NOT NULL | |
| `description` | text NULL | |
| `default_currency` | text(3) NOT NULL | ISO 4217, pre-fills new expenses — also the group's "base currency" referenced in the group-settings UI |
| `start_date` | integer NULL | Epoch seconds, date-only semantics. Purely informational for v1 — see rationale below |
| `end_date` | integer NULL | Same. **Deliberately does not auto-archive the group** — an unsettled group past its end date must stay open; nothing here should ever silently hide an outstanding balance |
| `created_by_user_id` | text NOT NULL | Sovereign user id |
| `created_at` | integer NOT NULL | |
| `updated_at` | integer NOT NULL | |
| `archived_at` | integer NULL | Soft-archive ("Close group," §7) once fully settled; hard delete is a separate, much narrower path — see §7 |

### `group_members`

The identity join for both real users and guests — this is what
`MemberMultiSelect`'s `{id, label}` options resolve from.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | The `id` every `expense_payers`/`expense_splits` row references — **not** the raw Sovereign `user_id`, so guest and user rows are symmetric |
| `group_id` | text NOT NULL, FK → `groups.id` | |
| `tenant_id` | text NOT NULL | |
| `kind` | text NOT NULL | `'user' \| 'guest'` |
| `user_id` | text NULL | Sovereign user id — set iff `kind = 'user'` |
| `guest_name` | text NULL | Display name — set iff `kind = 'guest'` |
| `guest_email` | text NULL | Optional, `kind = 'guest'` only — populated when the guest was added via the email-invite flow (§8); a name-only guest with no email is still fully valid |
| `guest_invite_status` | text NULL | `'none' \| 'sent' \| 'bounced'` — only meaningful when `guest_email` is set; §8 |
| `guest_owner_user_id` | text NULL | The instance user managing this guest's identity — set iff `kind = 'guest'` (resolves `CONCEPT.md`'s open question: a guest is always owned by a real member, never freestanding) |
| `role` | text NOT NULL, default `'member'` | `'owner' \| 'member'` — this column **is** the grant table `sdk.authz.provide()`'s resolver reads (§5); it only carries meaning for `kind = 'user'` rows, since a guest cannot hold a platform session to exercise it |
| `joined_at` | integer NOT NULL | |
| `left_at` | integer NULL | Soft-remove — a departed member's historical splits/payments must stay attributable (see §7) |

Constraints (application-enforced, Drizzle has no `CHECK` support on
SQLite/Postgres portably at this project's Drizzle version):

- Exactly one of `user_id` / `guest_name` is set, matching `kind`.
- Unique `(group_id, user_id)` for `kind = 'user'` rows with `left_at IS
  NULL` — a user can't join the same group twice concurrently, but can
  rejoin after leaving (a new row, not resurrecting the old one, so old
  splits keep pointing at the original membership record).

### `expenses`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `group_id` | text NOT NULL, FK → `groups.id` | |
| `tenant_id` | text NOT NULL | |
| `description` | text NOT NULL | |
| `amount_cents` | integer NOT NULL | Total expense amount |
| `currency` | text(3) NOT NULL | ISO 4217 |
| `category` | text NULL | One of a fixed application-level enum (§4) — deliberately **not** its own table for v1; see rationale below |
| `occurred_on` | integer NOT NULL | Epoch seconds — the user-entered "when this happened," distinct from `created_at` |
| `notes` | text NULL | |
| `receipt_storage_key` | text NULL | `sdk.storage` key (§8) |
| `split_method` | text NOT NULL | `SplitMethod` from `@sovereignfs/ui` — `'equal' \| 'amount' \| 'percentage' \| 'shares'` |
| `created_by_user_id` | text NOT NULL | |
| `created_at` | integer NOT NULL | |
| `updated_at` | integer NOT NULL | |
| `deleted_at` | integer NULL | Soft delete — Splitwise's own audit trail shows "deleted" rather than erasing history; matches `activity:write`'s purpose |

**Categories as a fixed enum, not a table:** matches `CONCEPT.md` §4's "small
fixed set" scope and avoids a whole CRUD surface (create/rename/reorder
categories) that no competitor's *free* tier even offers. A starting set —
refine during UI design: `general`, `rent`, `groceries`, `utilities`,
`transport`, `entertainment`, `travel`, `other`. If per-group custom
categories are ever requested, that's a real future table + migration, not
a v1 concern.

**Settlements are a separate concept, not `expenses` with a flag.** Spliit
and Splitwise both internally special-case "this expense is actually a
payment" with a boolean. This spec instead gives settlements their own table
(below) because a settlement is structurally simpler — always exactly one
payer, one payee, no split to compute — and keeping it separate means
balance computation (§4) never has to branch on an expense's type.

### `expense_payers`

Supports more than one payer per expense (two people split paying a large
bill) — `sum(amount_cents)` across a given `expense_id` must equal that
expense's `amount_cents`.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `expense_id` | text NOT NULL, FK → `expenses.id` | |
| `member_id` | text NOT NULL, FK → `group_members.id` | A payer may be a guest (someone paid on the guest's behalf and recorded it) |
| `amount_cents` | integer NOT NULL | |

### `expense_splits`

Who owes what share. Always stores the **resolved** integer-cent amount
regardless of `split_method`, so balance computation (§4) is one query with
no per-expense branching on how the split was originally entered.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `expense_id` | text NOT NULL, FK → `expenses.id` | |
| `member_id` | text NOT NULL, FK → `group_members.id` | |
| `share_amount_cents` | integer NOT NULL | Resolved amount owed — `sum()` across an expense's splits must equal `expenses.amount_cents` |
| `share_units` | integer NULL | The *original* input for `'percentage'` (basis points, e.g. `2500` = 25.00%) or `'shares'` (raw share count ×100, to allow `QuantityStepper`'s fractional `step`) — kept only so re-opening the edit form shows what the user actually typed, never read by balance computation |

**Rounding rule** (application code, not DB-enforced): splitting an odd
amount N ways will not divide evenly in cents. Compute each share via
integer division, then distribute the leftover 1-cent remainder — always
`< N` cents — one each to the first members in the split's stable input
order (the order `MemberMultiSelect`'s options were rendered in). This must
be deterministic and must be the **same rule** used whether adding or
editing an expense, or re-editing the same equal split twice would silently
shift a penny between different members.

### `settlements`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `group_id` | text NOT NULL, FK → `groups.id` | |
| `tenant_id` | text NOT NULL | |
| `from_member_id` | text NOT NULL, FK → `group_members.id` | Who paid (the debtor) |
| `to_member_id` | text NOT NULL, FK → `group_members.id` | Who received (the creditor) |
| `amount_cents` | integer NOT NULL | |
| `currency` | text(3) NOT NULL | |
| `note` | text NULL | |
| `settled_on` | integer NOT NULL | When the real-world payment happened |
| `created_by_user_id` | text NOT NULL | |
| `created_at` | integer NOT NULL | |
| `deleted_at` | integer NULL | Soft delete |

No payment rail is ever touched here — this table is purely a ledger entry
saying "this already happened outside Tally," exactly matching
`CONCEPT.md` §4's "Tally does not move money" decision.

### `user_settings`

Backs the Settings screen's **Primary Currency**. **Revised 2026-08-26: no
currency conversion of any kind in v1** (dropped — see §4's "Aggregation
views"), so this is a smaller feature than originally scoped: a default-
currency preference only — pre-fills the currency field on new
groups/expenses, and orders a per-currency breakdown (primary first) —
never a value anything gets converted into or summed through.

| Column | Type | Notes |
|---|---|---|
| `user_id` | text PK | Sovereign user id — one row per user |
| `tenant_id` | text NOT NULL | |
| `primary_currency` | text(3) NOT NULL | ISO 4217. Defaults to the platform instance's own locale-implied currency if one is resolvable, else `USD`, at first-use (row created lazily on first read, not at account creation) |
| `updated_at` | integer NOT NULL | |

### Drizzle schema files

Per `docs/plugin-database.md`: application code queries through one
`sqlite-core` file; a structural `pgTable` mirror exists **only** to drive
`drizzle-kit generate --dialect postgresql` and is never imported by app
code. The Postgres mirror uses plain `integer` for booleans and cents — but
**not** for timestamps.

**Revised 2026-08-26: every timestamp column in `schema.postgres.ts` must be
`bigint('...', { mode: 'number' })`, never plain `integer`** — a deliberate,
documented divergence from `docs/plugin-database.md`'s general "never
bigint" guidance, following the exact precedent set by `sovereign-sheets`
(`app/_db/schema.postgres.ts`) after `sovereign-kanban` hit this in a real
production deploy: Postgres `integer` is a genuine fixed 32-bit type
(max `2147483647`), and Unix-epoch-seconds — this spec's own convention,
§3 — crosses that ceiling in January 2038, only ~12 years out, not some
comfortably distant future concern. Kanban's incident was "every insert
failing immediately" once a real Postgres instance was hit; the fix
required an `ALTER COLUMN ... SET DATA TYPE bigint` after the fact. Every
timestamp column in this spec (`created_at`, `updated_at`, `deleted_at`,
`archived_at`, `start_date`, `end_date`, `occurred_on`, `joined_at`,
`left_at`, `settled_on`) gets `bigint({ mode: 'number' })` in the Postgres
mirror **from the start** — `id`/cents/boolean columns are unaffected and
stay plain `integer`/`text` as originally specified.

**Schema lives at `app/_db/schema.ts`, not a top-level `db/schema.ts`** —
corrected 2026-08-27 after hitting a real build break following
`docs/plugin-database.md`'s own top-level-`db/`-folder example literally.
The generate step only copies a plugin's `app/` tree into the runtime
(`docs/plugin-development.md`, "Build-time composition") — a schema file
living *outside* `app/` is simply absent from the composed tree at
runtime, so any relative import reaching for it
(`app/_lib/*.ts` → `../../db/schema`) 404s the moment the plugin actually
runs, even though it type-checks and even though the written docs show
exactly that layout. Confirmed against both Docs' and Sheets' real,
shipped `app/_db/schema.ts` before fixing — this is the actually-working
convention, not the documented one. `migrations/` stays outside `app/`
(the migration runner reads it from the plugin's own repo directly, not
the composed tree, matching Sheets' own `db:generate` script target).

```
app/
  _db/
    schema.ts            # sqlite-core — what app code imports and queries
    schema.postgres.ts   # pg-core mirror — drizzle-kit generate target only
migrations/
  sqlite/
  postgres/
```

## 4. Balances and debt simplification

Pure functions, no DB access — take rows, return numbers. Lives in
`app/_lib/balances.ts`, unit-testable in isolation.

**Net balance per member, per currency, within one group:**

```
netBalanceCents(memberId, currency) =
    sum(expense_payers.amount_cents  WHERE member_id = X AND expense.currency = currency AND expense.deleted_at IS NULL)
  − sum(expense_splits.share_amount_cents WHERE member_id = X AND expense.currency = currency AND expense.deleted_at IS NULL)
  + sum(settlements.amount_cents WHERE to_member_id = X   AND currency = currency AND deleted_at IS NULL)
  − sum(settlements.amount_cents WHERE from_member_id = X AND currency = currency AND deleted_at IS NULL)
```

Positive = owed to them, negative = they owe, zero = settled — the exact
sign convention `BalanceChip`'s `amountCents` prop already expects, so the
component needs zero adaptation.

**No cross-currency netting in v1.** A group with expenses in both USD and
EUR produces **one balance per currency per member**, shown as separate
`BalanceChip`s — matching `CONCEPT.md` §4's "manual currency, no
auto-conversion" decision. Silently summing different currencies together
would be simply wrong, not just a missing feature.

**Debt simplification** (the "Splitwise's clever feature" from
`CONCEPT.md` §1) — standard greedy min-cash-flow algorithm, computed
per-currency over the group's net balances:

```
simplify(balances: Map<memberId, cents>): Payment[]
  creditors = balances entries > 0, sorted descending
  debtors   = balances entries < 0, sorted ascending (most negative first)
  payments = []
  while creditors and debtors both non-empty:
    creditor = creditors[0]; debtor = debtors[0]
    amount = min(creditor.amount, -debtor.amount)
    payments.push({ from: debtor.id, to: creditor.id, amountCents: amount })
    creditor.amount -= amount; debtor.amount += amount
    if creditor.amount == 0: creditors.shift()
    if debtor.amount == 0: debtors.shift()
  return payments
```

This is a **read-side projection**, never stored — recompute on every
group-detail page load from the four tables above. Nothing here needs a
cache; a group's expense count is small enough (dozens to low hundreds)
that recomputing per request is cheap, and a stored cache would be one more
place to keep consistent through edits/deletes.

### Cross-group rollups (People, Overview)

A person's balance can span multiple groups. Same `netBalanceCents` query,
just grouped by `member.user_id` (joined across every `group_members` row
for groups the current user shares) instead of scoped to one `group_id` —
still **per-currency**, no netting, for the same reason as above. The
People detail panel shows both the per-currency total and a per-group
breakdown underneath it.

**"Settle up" from the People panel is a UI convenience over §6's
per-group `recordSettlementAction`, not a new settlement concept.** There
is no cross-group settlement row in the schema, deliberately — settling
"with a person" across three groups creates three ordinary `settlements`
rows (one per group with a non-zero balance against that person) behind a
single confirm click, exactly as if the user had visited each group and
settled individually.

### Aggregation views (Overview) — no currency conversion, v1 or otherwise

**Revised 2026-08-26: dropped the display-only conversion idea entirely —
no exchange rates in v1.** Overview needs things `netBalanceCents` alone
doesn't give: owed/owe totals, spend by category, monthly/yearly trend —
all built from the same four ledger tables, all **per-currency, always**:

- **Spend by category / monthly / yearly**: `SUM(expense_splits.
  share_amount_cents)` grouped by `expenses.category` /
  `date_trunc`-equivalent-on-`occurred_on`, scoped to the current user's own
  `member_id` in each group, per currency.
- **"You're owed / you owe"**: sum `netBalanceCents` across every group
  **within each currency separately** — `user_settings.primary_currency`
  only decides *which currency's total renders first/most prominent* when
  a user holds balances in more than one; every other currency still shows
  as its own real, unconverted figure right alongside it. No blended
  single number, ever — consistent with the per-group rule two sections up,
  and it means there's no exchange-rate dependency to build, source, or
  keep fresh at all.

## 5. Authorization

Two layers, per the hard architectural rules:

**1. Platform capability gate — `sdk.auth`.** Every server action starts
with `await sdk.auth.requireSession()`. This proves *some* authenticated
user, nothing group-specific.

**2. Resource-scoped role — a direct query against `group_members.role`
(§3), not `sdk.authz` (RFC 0054).** **Revised after checking real
precedent**: `sdk.authz`'s resource-grant mechanism is a real, implemented
SDK surface, but a direct search across the Docs and Sheets sibling
plugins found **zero actual usage of it anywhere** — both instead resolve
a role via a plain query against their own membership table
(`resolveDocumentRole`/`resolveFolderRole` in Docs' `app/_lib/
documents.ts`) and check it inline in each server action. This spec
follows that proven pattern instead of the theoretically-cleaner but
unvalidated `sdk.authz.provide()`/`hasGrant()`/`requireGrant()` layer —
simpler to reason about, and every action author in this app family
already recognizes the shape.

```ts
// app/_lib/membership.ts
import { and, eq, isNull } from 'drizzle-orm';
import { groupMembers } from '../_db/schema';
import type { Db } from './context';
import { canManageGroup, isGroupMemberRole, type GroupMemberRole } from './group-rules';

export async function resolveGroupRole(
  db: Db,
  tenantId: string,
  userId: string,
  groupId: string,
): Promise<GroupMemberRole | null> {
  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.tenantId, tenantId),
        eq(groupMembers.userId, userId),
        eq(groupMembers.kind, 'user'),
        isNull(groupMembers.leftAt),
      ),
    );
  if (!membership || !isGroupMemberRole(membership.role)) return null;
  return membership.role;
}
```

Every group-scoped server action then does `const role = await
requireGroupMember(db, tenantId, userId, groupId)` (throws
`GroupAccessError` if not an active member) or `await
requireGroupManage(...)` (throws unless `role === 'owner'`) — fails closed
by construction, same guarantee `sdk.authz` would have given, with one
fewer indirection layer.

**Last-owner protection** (required per `docs/plugin-development.md`'s
`roles` section, "wherever lockout is possible"): before demoting or
removing an `owner` member, check whether any other active `owner` row
exists in the group; block the action with a clear error if not. Enforced
in the same server action that performs the removal/demotion — never
trust a client-side disabled button alone.

**A member with a non-zero balance cannot leave or be removed.** Not a
platform rule — a Tally-specific one, but the same "check inside the
action, not just in the UI" discipline applies: compute
`netBalanceCents(memberId, *)` across every currency before honoring a
leave/remove request; refuse (with the specific outstanding amount in the
error) if any is non-zero. Force a settlement first, exactly as Splitwise
requires.

## 6. Server actions

`'use server'`, `ActionResult` return-type convention (matches
`plugins/console/app/settings/actions.ts` / `plugins/console/app/plugins/remove-actions.ts`):

```ts
export type ActionResult = { ok: true; message: string } | { ok: false; error: string };
```

| Action | Auth check | Notes |
|---|---|---|
| `createGroupAction` | session only | Creator becomes the sole `owner` member row |
| `updateGroupDetailsAction` | `group-manage` | Name, description, default currency, start/end dates — one action, one form (§9's group settings screen) |
| `archiveGroupAction` | `group-manage` | "Close group" — blocked if any member has a non-zero balance |
| `deleteGroupAction` | `group-manage` | Hard delete — only offered/succeeds when the group has zero expenses and zero settlements ever (§7) |
| `addMemberAction` | `group-manage` | Real user via `sdk.directory.searchUsers`; guest via a name field, with an optional email that triggers an invite send (§8) |
| `resendGuestInviteAction` | `group-manage` | Re-sends the invite email for a `guest_invite_status` that never delivered |
| `removeMemberAction` | `group-manage` | Last-owner + non-zero-balance checks (§5) |
| `updateMemberRoleAction` | `group-manage` | Last-owner check (§5) |
| `addExpenseAction` | `group-add-expense` | Validates payer sum == total, split sum == total |
| `editExpenseAction` | `group-add-expense` | Any member can edit any expense — matches Splitwise's own trust model, not creator-only |
| `deleteExpenseAction` | `group-add-expense` | Soft delete |
| `recordSettlementAction` | `group-add-expense` | |
| `deleteSettlementAction` | `group-add-expense` | Soft delete |
| `sendReminderAction` | `group-view` (any active member, not just `group-manage`) | Notifies a specific member of their outstanding balance to *you* the actor — rate-limited to one reminder per (actor, target, group) per 24h, checked server-side, not just a disabled button |
| `updatePrimaryCurrencyAction` | session only | Writes `user_settings.primary_currency` — default-currency + display-order preference only, no conversion involved (§4) |

Every mutating action calls `sdk.activity.log()` (audit trail — required for
`activity:write` to be an earned permission) and, where user-facing,
`sdk.notifications.send()`:

| Event | Notify |
|---|---|
| Added to a group | The added user (skip for guests — no session to notify) |
| Expense added/edited by someone else | Other active user-kind members |
| Settlement recorded | The counterparty (`to_member_id` if the actor was `from_member_id`, or vice versa) |

## 7. Lifecycle and deletion semantics

**Close vs. delete a group — two different actions, not two names for one
action.** `archiveGroupAction` ("Close group") sets `archived_at` and is the
**only** path when the group has any expense/settlement history — blocked,
same as leaving, while any member has a non-zero balance. A true hard
delete (removing the `groups` row and cascading) is only ever offered when
the group has **zero** `expenses` and **zero** `settlements` rows, ever —
i.e. nothing exists yet that another member's math could depend on. In
practice: "delete" is what you get for a group created by mistake with
nothing in it; "close" is what every real group eventually gets. The UI
should not present both buttons once a single expense has been added —
only "Close" remains reachable at that point.

**Groups and memberships are never hard-deleted** (once they have real
history — see above). `expense_payers` and
`expense_splits` reference `group_members.id`, not the raw
`user_id`/`guest_name` — hard-deleting a membership row on "leave" would
orphan every historical split pointing at it. Leaving sets `left_at`; the
row (and its historical attribution) stays forever. A left member still
shows correctly in past expenses ("Alex paid $40, split with Jamie
(left)").

**Account deletion (RFC 0033, `sdk.portability.provideDelete`) does *not*
cascade-delete a user's expense/settlement history.** This is the one place
this spec deliberately departs from the simpler pattern most plugins use
(delete everything the leaving user owns). A todo list's rows only affect
their owner; a shared ledger's rows are **joint** records other members'
balances depend on — deleting them on account-deletion would silently
corrupt every other group member's math (an expense missing its payer, or a
split missing the person who owed it). The handler instead:

- Leaves every `group_members`/`expenses`/`expense_payers`/
  `expense_splits`/`settlements` row in place.
- Returns `{ deleted: 0 }` with a `warnings`-equivalent note (the
  `DeletionContext` doesn't carry a warnings channel today — document this
  behavior plainly in the plugin's own README instead, per
  `docs/plugin-development.md`'s fallback guidance for plugins whose rows
  stay in place).
- Relies on `sdk.directory.resolveUsers()` to naturally stop resolving a
  deleted user's display name/avatar going forward (display degrades
  gracefully to "id"-only or a "former member" label — confirm the exact
  fallback shape `sdk.directory` returns for a deleted user id before
  building the UI's fallback string).

**Decided 2026-08-26: account deletion should be blocked while a non-zero
balance exists in any group**, mirroring §5's "can't leave a group with a
balance" rule. **But this is not currently buildable as a Tally-only
change** — checked directly against `docs/rfcs/0033-user-data-deletion.md`
(RFC 0033, Implemented), which is the platform's actual account-deletion
design:

- `provideDelete` handlers are **cleanup hooks that run after deletion is
  already committed**, awaited in parallel with per-handler try/catch — a
  handler that throws is caught and logged, it does not stop the cascade.
  There is no return value or mechanism by which a plugin can veto or pause
  deletion.
- RFC 0033 does have exactly one hardcoded deletion block today — "self-
  delete as sole `platform:owner` → 409" (its own review checklist) — which
  proves the *concept* of a blocked deletion exists at the platform level,
  but only for that one specific, hardcoded platform-role case. There is no
  generic plugin-extensible pre-check/veto hook a plugin like Tally can
  register into.
- RFC 0033's own "Open questions" section doesn't raise this gap either —
  a plugin wanting to block deletion for its own data-integrity reasons
  isn't an anticipated case in the current design.

**What this means for v1**: Tally can enforce the softer version only —
warn, not block. A client-side confirmation step ("You have an outstanding
balance of $X in Tally — deleting your account won't clear it, and it'll
stay attributed to you in other members' balances. Continue?") before the
user proceeds to the platform's real deletion flow, plus `provideDelete`
leaving the ledger rows in place exactly as already designed above.
**Actually enforcing a hard block requires a new platform-level RFC**
extending RFC 0033 with a pre-deletion veto/check hook, generalized enough
that any plugin with similar joint-data concerns could use it — out of
scope for a single plugin's spec to design unilaterally. Flag this
upstream if a hard block is a real requirement, rather than silently
building only the soft warning and calling the decision satisfied.

## 8. SDK surfaces used

| Surface | Use |
|---|---|
| `sdk.auth` | Session, `requireSession()` |
| `sdk.authz` | Resource-scoped `group-owner`/`group-member` grants (§5) |
| `sdk.db` | `getClient()` → this plugin's dedicated Drizzle store |
| `sdk.directory` | `searchUsers()` to add a real member; `resolveUsers()` to render stored `user_id`s as name/avatar |
| `sdk.storage` | Receipt image attach — `put()`/`get()`/`getSignedUrl()`, keyed `receipts/<expenseId>` |
| `sdk.notifications` | Group/expense/settlement notifications (§6) |
| `sdk.activity` | Audit log for every mutating action (§6) |
| `sdk.mailer` | `sdk.mailer.send()` — guest email invites (below) |
| `sdk.portability` | `provideExport`/`provideImport` (Sovereign-native backup/restore — **not** a Splitwise-format importer, which is a `CONCEPT.md` §6 non-goal) and `provideDelete` (§7) |

Receipt storage key convention: `receipts/<expenseId>/<originalFilename>`,
`ownerUserId` omitted (plugin-scoped, not per-user-owned) since any active
group member must be able to view a receipt someone else attached, not just
its uploader — `sdk.storage`'s per-user ownership model would wrongly
restrict this.

**Guest email invite** (`addMemberAction`'s guest path, when an email is
supplied): calls `sdk.mailer.send({ to: guestEmail, subject, html, text })`
— a raw external address, so both `mailer:send` and `mailer:sendExternal`
are required (§2). Sets `group_members.guest_invite_status = 'sent'` on
success; the send is rate-limited per-plugin/per-recipient by the platform
itself (`docs/plugin-development.md`), so no additional app-level
throttling is needed on top. The invite email is **informational only for
v1** — a plain "you were added to `<group name>` on Tally by `<inviter>`,
here's what you're being tracked for" notice with no login link and no
claim-this-identity flow (that's the "guest → real user" migration
`CONCEPT.md` explicitly punts). No SMTP configured on the instance means
`sdk.mailer.send()` no-ops silently (`docs/plugin-development.md`'s
mailer no-op behavior) — the guest is still added as a member either way;
only the notice fails to send. Surface that distinction in the UI (guest
added vs. invite email actually delivered) rather than conflating them.

## 9. Route structure

**Revised 2026-08-27 to match what was actually built and verified live**
(ROADMAP.md tasks 5–6) — two corrections from the original sketch above,
both checked against real precedent before building:

- **A group is selected via `?g=<id>`, not a `[groupId]` path segment.**
  `ThreeColumnLayout` is instantiated once in `(home)/layout.tsx` with
  fixed JSX children — a page rendered into `children` has no way to
  inject a sibling third child into its own ancestor's element tree, so
  the detail pane comes from a Next.js parallel route (`@detail`) instead.
  Keeping the *path* constant (`/tally/groups`) and varying only the query
  string lets both the main list and the `@detail` slot read the same
  `searchParams` independently, with no duplicate "list" page needed per
  slot. Verified live: select/switch/close all work, list stays visible.
- **"New group" is a `Dialog` + `useActionState`, not a `/groups/new`
  route.** Checked directly against Docs' `CreateFolderDialog`/Sheets'
  `NewWorkbookDialog` before building — neither uses a dedicated route for
  creation, both use exactly this shape.

```
app/
  (home)/
    layout.tsx                    ThreeColumnLayout + TallySidebar + {children} + {detail}
    layout.module.css
    page.tsx                      → /tally                Overview
    page.module.css
    groups/
      page.tsx                    → /tally/groups          list + "New group" dialog
      page.module.css
    people/page.tsx                → /tally/people
    inbox/page.tsx                  → /tally/inbox
    settings/page.tsx               → /tally/settings
    @detail/
      default.tsx                  fallback (null) for every path with no more specific match
      groups/
        page.tsx                   reads ?g=<id> — the 3rd-column detail pane
        page.module.css
  _components/
    TallySidebar.tsx / .module.css
    CreateGroupDialog.tsx
    DialogForm.module.css          shared dialog-form layout, matches Docs'/Sheets' own
  _lib/
    context.ts                    ActionResult, Db type, getContext(), now()
    ids.ts                        newId()
    currencies.ts                 curated ISO 4217 list for v1's pickers
    group-rules.ts                GroupMemberRole, canManageGroup() — pure
    membership.ts                 resolveGroupRole/requireGroupMember/requireGroupManage/
                                   hasOtherActiveOwner/hasNonZeroBalance — §5
    groups.ts                     listGroupsForUser/getGroupDetail/createGroupAction
    balances.ts                   §4 — pure, unit-tested
    rounding.ts                   §3's remainder-distribution rule — pure, unit-tested
    __tests__/
  _db/
    schema.ts                     sqlite-core — what app code imports and queries
    schema.postgres.ts            pg-core mirror — drizzle-kit generate target only
migrations/
  sqlite/
  postgres/
```

Expenses/settlements/People/Inbox/Settings routes and their own `_lib`
files land in later tasks, following this same shape (a query-param-keyed
`@detail` entry per selectable resource, `Dialog`-based create/edit forms,
one `_lib` file per domain concern).

`PageContainer` (design system) supplies page padding/max-width — never a
local `padding`/`max-width` rule (hard architectural rule). Mobile
header/footer use the standard `MobileHeader`/`MobileFooter` components,
which self-publish their height; no custom measurement code needed.

## 10. Non-functional checklist (hard rules this plugin must not violate)

- [ ] Every server action authorizes inside the action (`requireSession` +
      `sdk.authz`/capability check) — never rely on route-level gating alone.
- [ ] `tenant_id` present on every user-scoped table.
- [ ] Money is `integer` cents everywhere, never a float, matching
      `CurrencyInput`'s contract.
- [ ] Migration files are append-only once shipped/merged.
- [ ] Postgres mirror schema uses plain `integer` for booleans/cents, but
      `bigint({ mode: 'number' })` for every timestamp column — not plain
      `integer` (§3's "Drizzle schema files" — this is the one deliberate
      exception, confirmed against `sovereign-sheets`' own schema after
      `sovereign-kanban`'s production incident).
- [ ] `data:export`/`data:import` permissions declared **only** alongside
      their registered `sdk.portability` hooks.
- [ ] No hardcoded colour literals — semantic `--sv-*` tokens only
      (`pnpm design:tokens:check`).
- [ ] "Plugin" never appears in user-facing copy — "app" only (naming
      convention, `CLAUDE.md`).

## 11. Open questions carried from `CONCEPT.md`, now resolved or narrowed

| Question | Resolution |
|---|---|
| Guest member model | `group_members.kind = 'guest'`, owned by `guest_owner_user_id`, optional `guest_email` triggering a real invite send (§3, §8). Claiming a guest identity later (a guest signs up and wants their history attributed to their new account) is **still not** designed here — punt to a future migration tool if requested. |
| DB isolation mode | Moot — the platform retired the shared/isolated manifest choice; every plugin is unconditionally isolated now (§3). |
| Group-level vs. cross-group balance rollup | **Resolved: v1 needs both.** Group-level (§4's `netBalanceCents`) for the Groups section; a cross-group rollup (§4's "Cross-group rollups") for People and Overview. **No currency conversion anywhere, including here** (revised 2026-08-26) — a cross-group total is always shown per-currency, never blended. |
| Naming collision | Narrowed, not fully resolved — see `CONCEPT.md` §7: `sovereign-tally` is already in consistent internal use across this repo's own docs, lowering (not eliminating) collision risk. External registry/trademark check still open. |
| Account deletion vs. outstanding balance | **Intent decided (block), but not buildable as a Tally-only change** — RFC 0033 gives plugins no veto over deletion, only post-commit cleanup (§7). v1 ships a client-side warning instead; a real hard block needs a new platform RFC. |
| Delete vs. close a group | **Resolved (§7):** close (`archived_at`) is the only path once any expense/settlement exists; hard delete only for a group with zero history. |
| Overview stats scope | **Resolved 2026-08-26 — in v1**, reversing `CONCEPT.md`'s original deferral. See §4's "Aggregation views." |

## 12. Explicitly not in this spec (see `CONCEPT.md` §6)

AI/OCR receipt scanning, recurring expenses, real (ledger-level) automatic
currency conversion, Splitwise data import, any paid/Pro tier — all
deferred, none stubbed. Spending charts/statistics **moved into v1 scope**
(§4) as of 2026-08-26 — no longer on this list. Building any of the
remaining items now would be scope creep against a spec whose job was to
nail the free-tier-Splitwise-parity core plus the specific additions this
UI-flow discussion resolved.
