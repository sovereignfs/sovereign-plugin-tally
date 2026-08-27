import { bigint, index, integer, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * Postgres migration-generation twin of `schema.ts` — same tables and
 * column names, never queried through (app code is not dialect-aware;
 * it always queries via the sqlite-core file). Only job: drive
 * `drizzle-kit generate --dialect postgresql`, which cannot read a
 * `sqliteTable()`-based schema (`docs/plugin-database.md`).
 *
 * Every timestamp column here is `bigint({ mode: 'number' })`, **not**
 * plain `integer` — a deliberate divergence from `docs/plugin-
 * database.md`'s general "never bigint" guidance. Postgres `integer` is a
 * genuine fixed 32-bit type (max 2147483647); Unix-epoch-seconds crosses
 * that ceiling in January 2038. `sovereign-plugin-kanban` hit exactly
 * this in production ("every insert failing immediately") and had to
 * `ALTER COLUMN ... SET DATA TYPE bigint` after the fact;
 * `sovereign-plugin-sheets` fixed it the same way this file does, from
 * the start (`SPEC.md` §3's "Drizzle schema files"). Booleans/cents/ids
 * are unaffected and stay plain `integer`/`text`.
 */

export const groups = pgTable('groups', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  defaultCurrency: text('default_currency').notNull(),
  startDate: bigint('start_date', { mode: 'number' }),
  endDate: bigint('end_date', { mode: 'number' }),
  createdByUserId: text('created_by_user_id').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  archivedAt: bigint('archived_at', { mode: 'number' }),
});

export const groupMembers = pgTable(
  'group_members',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    tenantId: text('tenant_id').notNull(),
    kind: text('kind').notNull(),
    userId: text('user_id'),
    guestName: text('guest_name'),
    guestEmail: text('guest_email'),
    guestInviteStatus: text('guest_invite_status'),
    guestOwnerUserId: text('guest_owner_user_id'),
    role: text('role').notNull().default('member'),
    joinedAt: bigint('joined_at', { mode: 'number' }).notNull(),
    leftAt: bigint('left_at', { mode: 'number' }),
  },
  (table) => [
    index('group_members_group_id_idx').on(table.groupId),
    index('group_members_user_id_idx').on(table.userId),
  ],
);

export const expenses = pgTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    tenantId: text('tenant_id').notNull(),
    description: text('description').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    category: text('category'),
    occurredOn: bigint('occurred_on', { mode: 'number' }).notNull(),
    notes: text('notes'),
    receiptStorageKey: text('receipt_storage_key'),
    splitMethod: text('split_method').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
    deletedAt: bigint('deleted_at', { mode: 'number' }),
  },
  (table) => [index('expenses_group_id_idx').on(table.groupId)],
);

export const expensePayers = pgTable(
  'expense_payers',
  {
    id: text('id').primaryKey(),
    expenseId: text('expense_id')
      .notNull()
      .references(() => expenses.id),
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

export const expenseSplits = pgTable(
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
    shareUnits: integer('share_units'),
  },
  (table) => [
    index('expense_splits_expense_id_idx').on(table.expenseId),
    index('expense_splits_member_id_idx').on(table.memberId),
  ],
);

export const settlements = pgTable(
  'settlements',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    tenantId: text('tenant_id').notNull(),
    fromMemberId: text('from_member_id')
      .notNull()
      .references(() => groupMembers.id),
    toMemberId: text('to_member_id')
      .notNull()
      .references(() => groupMembers.id),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    note: text('note'),
    settledOn: bigint('settled_on', { mode: 'number' }).notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    deletedAt: bigint('deleted_at', { mode: 'number' }),
  },
  (table) => [
    index('settlements_group_id_idx').on(table.groupId),
    index('settlements_from_member_id_idx').on(table.fromMemberId),
    index('settlements_to_member_id_idx').on(table.toMemberId),
  ],
);

export const userSettings = pgTable('user_settings', {
  userId: text('user_id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  primaryCurrency: text('primary_currency').notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
