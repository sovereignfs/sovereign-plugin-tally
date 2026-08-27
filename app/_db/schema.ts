import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Tally database schema (SQLite dialect — what application code queries
 * through). See `db/schema.postgres.ts` for the migration-generation
 * mirror and `SPEC.md` §3 for the full data-model writeup.
 *
 * Conventions (SPEC.md §3):
 * - IDs: `crypto.randomUUID()`, stored as `text`.
 * - Timestamps: Unix epoch seconds, `integer` here — `bigint({ mode:
 *   'number' })` in the Postgres mirror (see that file's own comment for
 *   why this one column type isn't dialect-uniform).
 * - Money: `integer` cents, never a float — matches `CurrencyInput`'s
 *   contract (`@sovereignfs/ui`).
 * - `tenant_id` on every user-scoped table, from day one.
 * - No slug prefix on table names — every plugin gets an unconditionally
 *   isolated store now (`docs/plugin-database.md`).
 */

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  defaultCurrency: text('default_currency').notNull(),
  /** Epoch seconds, date-only semantics. Purely informational — never
   *  auto-archives the group (SPEC.md §3). */
  startDate: integer('start_date'),
  endDate: integer('end_date'),
  createdByUserId: text('created_by_user_id').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  /** Set by "Close group" (SPEC.md §7). Hard delete is a separate,
   *  narrower path — see `SPEC.md` §7 — not a field on this table. */
  archivedAt: integer('archived_at'),
});

export type GroupRow = typeof groups.$inferSelect;

/**
 * The identity join for both real Sovereign users and guests — what
 * `expense_payers`/`expense_splits`/`settlements` actually reference, and
 * what `MemberMultiSelect`'s `{id, label}` options resolve from. Exactly
 * one of `userId` / `guestName` is set, matching `kind` — application-
 * enforced (SPEC.md §3), not a DB constraint.
 */
export const groupMembers = sqliteTable(
  'group_members',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    tenantId: text('tenant_id').notNull(),
    /** 'user' | 'guest' */
    kind: text('kind').notNull(),
    /** Sovereign user id — set iff `kind = 'user'`. */
    userId: text('user_id'),
    /** Display name — set iff `kind = 'guest'`. */
    guestName: text('guest_name'),
    /** Optional, `kind = 'guest'` only — populated via the email-invite
     *  flow (SPEC.md §8). A name-only guest with no email is still valid. */
    guestEmail: text('guest_email'),
    /** 'sent' | 'bounced' | null — only meaningful when `guestEmail` is set. */
    guestInviteStatus: text('guest_invite_status'),
    /** The instance user managing this guest's identity — set iff
     *  `kind = 'guest'`. A guest is always owned by a real member. */
    guestOwnerUserId: text('guest_owner_user_id'),
    /** 'owner' | 'member' — the grant table `sdk.authz.provide()`'s
     *  resolver reads (SPEC.md §5). Only meaningful for `kind = 'user'`
     *  rows; a guest has no session to exercise a role with. */
    role: text('role').notNull().default('member'),
    joinedAt: integer('joined_at').notNull(),
    /** Soft-remove — historical splits/payments must stay attributable to
     *  a departed member (SPEC.md §7). Rejoining creates a new row rather
     *  than resurrecting this one. */
    leftAt: integer('left_at'),
  },
  (table) => [
    index('group_members_group_id_idx').on(table.groupId),
    index('group_members_user_id_idx').on(table.userId),
  ],
);

export type GroupMemberRow = typeof groupMembers.$inferSelect;

export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    tenantId: text('tenant_id').notNull(),
    description: text('description').notNull(),
    /** Total expense amount, integer cents. */
    amountCents: integer('amount_cents').notNull(),
    /** ISO 4217. */
    currency: text('currency').notNull(),
    /** One of a fixed application-level enum (no dedicated table — SPEC.md §3). */
    category: text('category'),
    /** Epoch seconds — the user-entered "when this happened," distinct
     *  from `createdAt`. */
    occurredOn: integer('occurred_on').notNull(),
    notes: text('notes'),
    /** `sdk.storage` key for an attached receipt image (SPEC.md §8). */
    receiptStorageKey: text('receipt_storage_key'),
    /** `SplitMethod` from `@sovereignfs/ui` — 'equal' | 'amount' | 'percentage' | 'shares'. */
    splitMethod: text('split_method').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    /** Soft delete — preserves the audit trail (SPEC.md §3). */
    deletedAt: integer('deleted_at'),
  },
  (table) => [index('expenses_group_id_idx').on(table.groupId)],
);

export type ExpenseRow = typeof expenses.$inferSelect;

/**
 * Who actually paid, and how much of the total each paid — supports more
 * than one payer per expense. `sum(amountCents)` across a given expense's
 * rows must equal that expense's `amountCents` (application-enforced).
 */
export const expensePayers = sqliteTable(
  'expense_payers',
  {
    id: text('id').primaryKey(),
    expenseId: text('expense_id')
      .notNull()
      .references(() => expenses.id),
    /** May be a guest — someone paid on the guest's behalf. */
    memberId: text('member_id')
      .notNull()
      .references(() => groupMembers.id),
    amountCents: integer('amount_cents').notNull(),
  },
  (table) => [
    index('expense_payers_expense_id_idx').on(table.expenseId),
    index('expense_payers_member_id_idx').on(table.memberId),
  ],
);

export type ExpensePayerRow = typeof expensePayers.$inferSelect;

/**
 * Who owes what share. Always stores the *resolved* integer-cent amount
 * regardless of `splitMethod` — balance computation never re-derives from
 * percentages/shares at query time (SPEC.md §3/§4).
 */
export const expenseSplits = sqliteTable(
  'expense_splits',
  {
    id: text('id').primaryKey(),
    expenseId: text('expense_id')
      .notNull()
      .references(() => expenses.id),
    memberId: text('member_id')
      .notNull()
      .references(() => groupMembers.id),
    shareAmountCents: integer('share_amount_cents').notNull(),
    /** The *original* input for 'percentage' (basis points, e.g. 2500 =
     *  25.00%) or 'shares' (share count ×100). Never read by balance
     *  computation — only so re-opening the edit form shows what the user
     *  actually typed. Null for 'equal'/'amount' methods. */
    shareUnits: integer('share_units'),
  },
  (table) => [
    index('expense_splits_expense_id_idx').on(table.expenseId),
    index('expense_splits_member_id_idx').on(table.memberId),
  ],
);

export type ExpenseSplitRow = typeof expenseSplits.$inferSelect;

/**
 * A direct payment between two members that resolves debt. No payment
 * rail is ever touched — purely a ledger entry saying "this already
 * happened outside Tally" (SPEC.md §3).
 */
export const settlements = sqliteTable(
  'settlements',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    tenantId: text('tenant_id').notNull(),
    /** Who paid (the debtor). */
    fromMemberId: text('from_member_id')
      .notNull()
      .references(() => groupMembers.id),
    /** Who received (the creditor). */
    toMemberId: text('to_member_id')
      .notNull()
      .references(() => groupMembers.id),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    note: text('note'),
    /** When the real-world payment happened. */
    settledOn: integer('settled_on').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (table) => [
    index('settlements_group_id_idx').on(table.groupId),
    index('settlements_from_member_id_idx').on(table.fromMemberId),
    index('settlements_to_member_id_idx').on(table.toMemberId),
  ],
);

export type SettlementRow = typeof settlements.$inferSelect;

/**
 * Backs the Settings screen's Primary Currency — a default-currency +
 * display-order preference only, never a conversion input (SPEC.md §3/§4:
 * no currency conversion anywhere in v1).
 */
export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  primaryCurrency: text('primary_currency').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type UserSettingsRow = typeof userSettings.$inferSelect;

/**
 * One row per reminder nudge sent (Inbox's `[Remind]` action, SPEC.md §6) —
 * exists solely to enforce the spec's "one reminder per (actor, target,
 * group) per 24h" rate limit server-side; nothing else reads this table.
 * Never soft-deleted or otherwise mutated after insert — a plain append log.
 */
export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    tenantId: text('tenant_id').notNull(),
    /** Who sent the reminder. */
    fromMemberId: text('from_member_id')
      .notNull()
      .references(() => groupMembers.id),
    /** Who it was sent to — always `kind = 'user'` (a guest has no session
     *  to notify, enforced at the action layer, not here). */
    toMemberId: text('to_member_id')
      .notNull()
      .references(() => groupMembers.id),
    sentAt: integer('sent_at').notNull(),
  },
  (table) => [
    index('reminders_group_id_idx').on(table.groupId),
    index('reminders_from_to_idx').on(table.fromMemberId, table.toMemberId),
  ],
);

export type ReminderRow = typeof reminders.$inferSelect;
