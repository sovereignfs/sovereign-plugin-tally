import { and, eq, inArray, isNull } from 'drizzle-orm';
import { sdk } from '@sovereignfs/sdk';
import type {
  DeletionContext,
  DeletionResult,
  ExportContext,
  ImportContext,
  PluginExportSection,
} from '@sovereignfs/sdk';
import {
  expensePayers,
  expenseSplits,
  expenses,
  groupMembers,
  groups,
  settlements,
  userSettings,
} from '../_db/schema';
import type { Db } from './context';
import { newId } from './ids';

/**
 * Registers Tally's export/import/delete participation (RFC 0007/RFC 0033,
 * SPEC.md §7/§8) — "Sovereign-native backup/restore," not a Splitwise-format
 * importer (`CONCEPT.md` §6 non-goal). Must be called from a request-scoped
 * Tally route — this repo calls it from `app/(home)/layout.tsx`, same
 * precedent as Docs' `registerPortabilityHandlers` (registrations are
 * in-process and reset on restart, so re-registering on every request is
 * the established pattern, not a one-time setup step).
 */
const PLUGIN_ID = 'fs.sovereign.tally';
const EXPORT_SCHEMA_VERSION = 1;

export async function registerPortabilityHandlers(): Promise<void> {
  await sdk.portability.provideExport(exportTallyData);
  await sdk.portability.provideImport(importTallyData);
  await sdk.portability.provideDelete(deleteTallyData);
}

// ---- Export shape ----
// Scoped to every group the exporting user is a *current active member* of
// (owner or member) — unlike Docs' "owned content only" model, a shared
// ledger's real value to the exporting user is the complete group, not just
// their own rows (a partial expense list can't even reconstruct correct
// balances). Real users' current display names are captured now, at export
// time — a raw account id has no guaranteed counterpart on another Sovereign
// instance (same reasoning Docs' own `documentMembers` export already
// established), so a name is the only portable identity worth keeping.

interface ExportGroup {
  id: string;
  name: string;
  description: string | null;
  defaultCurrency: string;
  startDate: number | null;
  endDate: number | null;
  archivedAt: number | null;
  createdAt: number;
}

interface ExportMember {
  id: string;
  groupId: string;
  kind: 'user' | 'guest';
  /** Captured display name — a guest's own name, or a real member's
   *  directory name/email at export time. */
  label: string;
  /** True only for the exporting user's own membership row — see the
   *  import section below for why this is the one member restored as a
   *  real account rather than a guest. */
  isExportingUser: boolean;
  role: 'owner' | 'member';
  joinedAt: number;
}

interface ExportExpense {
  id: string;
  groupId: string;
  description: string;
  amountCents: number;
  currency: string;
  category: string | null;
  occurredOn: number;
  notes: string | null;
  splitMethod: string;
  createdAt: number;
  updatedAt: number;
}

interface ExportExpensePayer {
  expenseId: string;
  memberId: string;
  amountCents: number;
}

interface ExportExpenseSplit {
  expenseId: string;
  memberId: string;
  shareAmountCents: number;
  shareUnits: number | null;
}

interface ExportSettlement {
  id: string;
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
  currency: string;
  note: string | null;
  settledOn: number;
  createdAt: number;
}

interface TallyExportData {
  primaryCurrency: string | null;
  groups: ExportGroup[];
  members: ExportMember[];
  expenses: ExportExpense[];
  payers: ExportExpensePayer[];
  splits: ExportExpenseSplit[];
  settlements: ExportSettlement[];
}

async function exportTallyData(ctx: ExportContext): Promise<PluginExportSection> {
  const db = (await sdk.db.getClient()) as Db;
  const { userId, tenantId } = ctx;

  const myMemberships = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.userId, userId),
        eq(groupMembers.tenantId, tenantId),
        eq(groupMembers.kind, 'user'),
        isNull(groupMembers.leftAt),
      ),
    );
  const groupIds = Array.from(new Set(myMemberships.map((m) => m.groupId)));

  const empty: TallyExportData = {
    primaryCurrency: null,
    groups: [],
    members: [],
    expenses: [],
    payers: [],
    splits: [],
    settlements: [],
  };
  if (groupIds.length === 0) {
    return { pluginId: PLUGIN_ID, schemaVersion: EXPORT_SCHEMA_VERSION, data: empty };
  }

  const [groupRows, memberRows, expenseRows, settlementRows, settingsRows] = await Promise.all([
    db.select().from(groups).where(inArray(groups.id, groupIds)),
    db
      .select()
      .from(groupMembers)
      .where(and(inArray(groupMembers.groupId, groupIds), isNull(groupMembers.leftAt))),
    db
      .select()
      .from(expenses)
      .where(and(inArray(expenses.groupId, groupIds), isNull(expenses.deletedAt))),
    db
      .select()
      .from(settlements)
      .where(and(inArray(settlements.groupId, groupIds), isNull(settlements.deletedAt))),
    db
      .select({ primaryCurrency: userSettings.primaryCurrency })
      .from(userSettings)
      .where(eq(userSettings.userId, userId)),
  ]);

  const expenseIds = expenseRows.map((e) => e.id);
  const [payerRows, splitRows] = await Promise.all([
    expenseIds.length > 0
      ? db.select().from(expensePayers).where(inArray(expensePayers.expenseId, expenseIds))
      : Promise.resolve([]),
    expenseIds.length > 0
      ? db.select().from(expenseSplits).where(inArray(expenseSplits.expenseId, expenseIds))
      : Promise.resolve([]),
  ]);

  const realUserIds = Array.from(
    new Set(memberRows.filter((m) => m.kind === 'user' && m.userId).map((m) => m.userId as string)),
  );
  const resolvedUsers =
    realUserIds.length > 0 ? await sdk.directory.resolveUsers({ ids: realUserIds }) : [];
  const nameByUserId = new Map(resolvedUsers.map((u) => [u.id, u.name ?? u.email]));

  const data: TallyExportData = {
    primaryCurrency: settingsRows[0]?.primaryCurrency ?? null,
    groups: groupRows.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      defaultCurrency: g.defaultCurrency,
      startDate: g.startDate,
      endDate: g.endDate,
      archivedAt: g.archivedAt,
      createdAt: g.createdAt,
    })),
    members: memberRows.map((m) => ({
      id: m.id,
      groupId: m.groupId,
      kind: m.kind === 'guest' ? 'guest' : 'user',
      label:
        m.kind === 'user'
          ? (nameByUserId.get(m.userId ?? '') ?? 'Unknown member')
          : (m.guestName ?? 'Guest'),
      isExportingUser: m.kind === 'user' && m.userId === userId,
      role: m.role === 'owner' ? 'owner' : 'member',
      joinedAt: m.joinedAt,
    })),
    expenses: expenseRows.map((e) => ({
      id: e.id,
      groupId: e.groupId,
      description: e.description,
      amountCents: e.amountCents,
      currency: e.currency,
      category: e.category,
      occurredOn: e.occurredOn,
      notes: e.notes,
      splitMethod: e.splitMethod,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    })),
    payers: payerRows.map((p) => ({
      expenseId: p.expenseId,
      memberId: p.memberId,
      amountCents: p.amountCents,
    })),
    splits: splitRows.map((s) => ({
      expenseId: s.expenseId,
      memberId: s.memberId,
      shareAmountCents: s.shareAmountCents,
      shareUnits: s.shareUnits,
    })),
    settlements: settlementRows.map((s) => ({
      id: s.id,
      groupId: s.groupId,
      fromMemberId: s.fromMemberId,
      toMemberId: s.toMemberId,
      amountCents: s.amountCents,
      currency: s.currency,
      note: s.note,
      settledOn: s.settledOn,
      createdAt: s.createdAt,
    })),
  };

  const hasOtherMembers = data.members.some((m) => !m.isExportingUser);
  const warnings = hasOtherMembers
    ? [
        'Other group members are restored as guests on import, using their name at export time — their original accounts are not re-linked. Re-add them as real members from Group settings after importing, if needed.',
      ]
    : undefined;

  return { pluginId: PLUGIN_ID, schemaVersion: EXPORT_SCHEMA_VERSION, data, warnings };
}

// ---- Import ----
// Every imported group is created fresh, owned solely by the importing
// user — mirrors Docs' "every restored document is local, owned by the
// importing user" precedent. The exporting user's own membership becomes
// the new group's real (and only) 'user'-kind member; every *other*
// original member (real user or guest alike) is restored as a guest, since
// a real user's account id has no guaranteed counterpart on the
// destination instance — this preserves the full ledger's math (every
// split/payer still resolves to a valid member) without silently
// re-granting a stranger's account access to data it never actually
// belonged to on this instance.

function isTallyExportData(value: unknown): value is TallyExportData {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<TallyExportData>;
  return (
    Array.isArray(c.groups) &&
    Array.isArray(c.members) &&
    Array.isArray(c.expenses) &&
    Array.isArray(c.settlements)
  );
}

async function importTallyData(section: PluginExportSection, ctx: ImportContext): Promise<void> {
  if (section.schemaVersion !== EXPORT_SCHEMA_VERSION || !isTallyExportData(section.data)) {
    throw new Error('Tally import section has an unrecognized shape.');
  }
  const data = section.data;
  const db = (await sdk.db.getClient()) as Db;
  const ts = Math.floor(Date.now() / 1000);

  if (data.primaryCurrency) {
    await db
      .insert(userSettings)
      .values({
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        primaryCurrency: data.primaryCurrency,
        updatedAt: ts,
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { primaryCurrency: data.primaryCurrency, updatedAt: ts },
      });
  }

  for (const g of data.groups) {
    await db.insert(groups).values({
      id: ctx.remapId(g.id),
      tenantId: ctx.tenantId,
      name: g.name,
      description: g.description,
      defaultCurrency: g.defaultCurrency,
      startDate: g.startDate,
      endDate: g.endDate,
      createdByUserId: ctx.userId,
      createdAt: g.createdAt,
      updatedAt: ts,
      archivedAt: g.archivedAt,
    });
  }

  for (const m of data.members) {
    const base = {
      id: ctx.remapId(m.id),
      groupId: ctx.remapId(m.groupId),
      tenantId: ctx.tenantId,
      joinedAt: m.joinedAt,
    };
    if (m.isExportingUser) {
      await db.insert(groupMembers).values({
        ...base,
        kind: 'user',
        userId: ctx.userId,
        // Sole real member on this instance — always the owner, regardless
        // of the exporting user's original role (mirrors Docs' identical
        // "every restored document is owned by the importing user" call).
        role: 'owner',
      });
    } else {
      await db.insert(groupMembers).values({
        ...base,
        kind: 'guest',
        guestName: m.label,
        guestOwnerUserId: ctx.userId,
        role: 'member',
      });
    }
  }

  for (const e of data.expenses) {
    await db.insert(expenses).values({
      id: ctx.remapId(e.id),
      groupId: ctx.remapId(e.groupId),
      tenantId: ctx.tenantId,
      description: e.description,
      amountCents: e.amountCents,
      currency: e.currency,
      category: e.category,
      occurredOn: e.occurredOn,
      notes: e.notes,
      splitMethod: e.splitMethod,
      createdByUserId: ctx.userId,
      createdAt: e.createdAt,
      updatedAt: ts,
    });
  }

  if (data.payers.length > 0) {
    await db.insert(expensePayers).values(
      data.payers.map((p) => ({
        id: newId(),
        expenseId: ctx.remapId(p.expenseId),
        memberId: ctx.remapId(p.memberId),
        amountCents: p.amountCents,
      })),
    );
  }

  if (data.splits.length > 0) {
    await db.insert(expenseSplits).values(
      data.splits.map((s) => ({
        id: newId(),
        expenseId: ctx.remapId(s.expenseId),
        memberId: ctx.remapId(s.memberId),
        shareAmountCents: s.shareAmountCents,
        shareUnits: s.shareUnits,
      })),
    );
  }

  for (const s of data.settlements) {
    await db.insert(settlements).values({
      id: ctx.remapId(s.id),
      groupId: ctx.remapId(s.groupId),
      tenantId: ctx.tenantId,
      fromMemberId: ctx.remapId(s.fromMemberId),
      toMemberId: ctx.remapId(s.toMemberId),
      amountCents: s.amountCents,
      currency: s.currency,
      note: s.note,
      settledOn: s.settledOn,
      createdByUserId: ctx.userId,
      createdAt: s.createdAt,
    });
  }
}

// ---- Delete ----
// SPEC.md §7: a shared ledger's rows are joint records other members'
// balances depend on — deleting them on this user's account deletion would
// silently corrupt every other member's math (an expense missing its payer,
// or a split missing the person who owed it). Every group_members/expenses/
// expense_payers/expense_splits/settlements row is left in place entirely,
// exactly as already designed there; only this user's own personal
// preference row (not joint data) is cleaned up. A real hard block for a
// non-zero balance was decided but found not buildable as a Tally-only
// change (`provideDelete` runs after deletion is already committed, with no
// veto mechanism) — flagged upstream in SPEC.md §7 as needing a new
// platform-level RFC, not silently dropped.
async function deleteTallyData(ctx: DeletionContext): Promise<DeletionResult> {
  const db = ctx.db as Db;
  const existing = await db
    .select({ userId: userSettings.userId })
    .from(userSettings)
    .where(and(eq(userSettings.userId, ctx.userId), eq(userSettings.tenantId, ctx.tenantId)));
  if (existing.length > 0) {
    await db
      .delete(userSettings)
      .where(and(eq(userSettings.userId, ctx.userId), eq(userSettings.tenantId, ctx.tenantId)));
  }
  return { deleted: existing.length };
}
